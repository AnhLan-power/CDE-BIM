// Supabase Edge Function: drive-proxy
// Nhiệm vụ: nhận yêu cầu từ frontend rồi gọi Google Drive thay cho người
// dùng bằng refresh token của BIM Manager (không lộ ra frontend), SAU KHI đã
// kiểm tra quyền theo vai trò trong bảng project_members.
//
// Nhóm 1 — File theo trạng thái CDE (WIP/Shared/Published/Archived):
//   action = "list" | "download"          (body JSON: action, projectId, status, fileId)
//
// Nhóm 2 — Tài liệu thiết bị Digital Twin (thư mục riêng projects.drive_assets_url):
//   action = "asset_upload_init"          (JSON: projectId, fileName, mimeType, size)
//   action = "asset_upload_chunk"         (query: projectId, sessionUri, start, total; body = bytes)
//   action = "asset_upload_status"        (query: projectId, sessionUri, total)
//   action = "asset_download"             (JSON: projectId, fileId)
//   action = "asset_delete"               (JSON: projectId, fileId)  -> chuyển vào thùng rác Drive
//
// Upload dùng giao thức "resumable" của Drive, mỗi lần gửi 1 khúc <= 8 MiB để
// không bị giới hạn RAM (256 MB) / thời gian của Edge Function và có thể tiếp
// tục khi đứt mạng.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Các địa chỉ Google. Biến môi trường chỉ dùng khi kiểm thử với Drive giả —
// trên môi trường thật KHÔNG đặt, sẽ dùng địa chỉ chính thức bên dưới.
const DRIVE_API = Deno.env.get("DRIVE_API_BASE") ?? "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD = Deno.env.get("DRIVE_UPLOAD_BASE") ?? "https://www.googleapis.com/upload/drive/v3";
const GOOGLE_TOKEN_URL = Deno.env.get("GOOGLE_TOKEN_URL") ?? "https://oauth2.googleapis.com/token";

// Vai trò nào được xem file ở trạng thái nào (khớp với ma trận quyền ISO 19650
// đã dùng trong index.html/cde-auth.js)
const ALLOWED_ROLES: Record<string, string[]> = {
  WIP: ["author", "task_team_manager", "bim_manager"],
  SHARED: ["author", "approver", "task_team_manager", "bim_manager"],
  PUBLISHED: ["author", "approver", "task_team_manager", "bim_manager", "viewer"],
  ARCHIVED: ["author", "approver", "task_team_manager", "bim_manager", "viewer"],
};

const STATUS_COLUMN: Record<string, string> = {
  WIP: "drive_wip_url",
  SHARED: "drive_shared_url",
  PUBLISHED: "drive_published_url",
  ARCHIVED: "drive_archived_url",
};

// Tài liệu thiết bị: ai được ghi/xoá (xem thì mọi thành viên dự án đều được)
const WRITE_ROLES = ["author", "task_team_manager", "bim_manager"];
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;   // 25 MiB / file
const MAX_CHUNK_BYTES = 8 * 1024 * 1024;     // mỗi khúc tối đa 8 MiB
const CHUNK_MULTIPLE = 256 * 1024;           // Drive yêu cầu khúc không-cuối là bội số 256 KiB
const ALLOWED_TYPES: Record<string, string[]> = {
  "application/pdf": ["pdf"],
  "image/png": ["png"],
  "image/jpeg": ["jpg", "jpeg"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ["docx"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ["xlsx"],
};

function jsonResponse(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Đổi refresh_token (đã lưu khi BIM Manager kết nối Drive) lấy access_token
// mới — access_token chỉ sống ~1 giờ nên mỗi lần gọi API phải đổi lại.
async function getGoogleAccessTokenForProject(
  supabaseAdmin: ReturnType<typeof createClient>,
  projectId: string
): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from("project_drive_connections")
    .select("refresh_token")
    .eq("project_id", projectId)
    .single();

  if (error || !data?.refresh_token) {
    throw new Error("Dự án chưa kết nối Google Drive. BIM Manager cần bấm 'Kết nối Google Drive' trước.");
  }

  const clientId = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID")!;
  const clientSecret = Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET")!;

  const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: data.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) {
    throw new Error("Không làm mới được access token Google: " + JSON.stringify(tokenData));
  }
  return tokenData.access_token as string;
}

function extractFolderId(folderUrl: string | null | undefined, emptyMsg: string): string {
  if (!folderUrl) throw new Error(emptyMsg);
  const match = folderUrl.match(/folders\/([a-zA-Z0-9_-]+)/);
  if (!match) throw new Error("Link thư mục Drive không đúng định dạng");
  return match[1];
}

// Chỉ cho thao tác trên file là CON TRỰC TIẾP của thư mục được phép. Nếu
// không kiểm tra, người gọi có thể truyền fileId bất kỳ (kể cả file ở thư mục
// khác/không được phép xem) và function sẽ dùng token của BIM Manager để đọc.
async function assertFileInFolder(fileId: string, folderId: string, accessToken: string) {
  if (!/^[A-Za-z0-9_-]{10,}$/.test(fileId)) throw new Error("fileId không hợp lệ");
  const res = await fetch(
    `${DRIVE_API}/files/${fileId}?fields=id,name,mimeType,parents,trashed&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) throw new Error("Không tìm thấy file trên Drive (HTTP " + res.status + ")");
  const meta = await res.json();
  if (meta.trashed) throw new Error("File đã bị xoá khỏi Drive");
  if (!Array.isArray(meta.parents) || !meta.parents.includes(folderId)) {
    throw new Error("File không thuộc thư mục được phép của dự án này");
  }
  return meta as { id: string; name: string; mimeType: string };
}

function sanitizeFileName(name: string): string {
  const cleaned = name
    // deno-lint-ignore no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length <= 150) return cleaned;
  const dot = cleaned.lastIndexOf(".");
  const ext = dot > 0 ? cleaned.slice(dot) : "";
  return cleaned.slice(0, 150 - ext.length) + ext;
}

// Chỉ nhận phiên upload do chính Google cấp (chặn SSRF: không cho client bắt
// function gửi dữ liệu tới địa chỉ tuỳ ý).
function assertGoogleSessionUri(sessionUri: string): string {
  let u: URL;
  try { u = new URL(sessionUri); } catch { throw new Error("sessionUri không hợp lệ"); }
  const allowed = new URL(DRIVE_UPLOAD);
  if (u.origin !== allowed.origin || !u.pathname.startsWith("/upload/drive/") || !u.searchParams.get("upload_id")) {
    throw new Error("sessionUri không phải phiên upload của Google Drive");
  }
  return u.toString();
}

async function handleAssetAction(
  supabaseAdmin: ReturnType<typeof createClient>,
  userId: string,
  body: Record<string, unknown>,
  req: Request
): Promise<Response> {
  const action = String(body.action);
  const projectId = body.projectId ? String(body.projectId) : "";
  if (!projectId) throw new Error("Thiếu projectId");

  // 1) Vai trò của người gọi trong dự án
  const { data: member } = await supabaseAdmin
    .from("project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .single();
  const role = member?.role as string | undefined;
  if (!role) throw new Error("Bạn không thuộc dự án này");

  const needsWrite = action === "asset_upload_init" || action === "asset_upload_chunk" ||
    action === "asset_upload_status" || action === "asset_delete";
  if (needsWrite && !WRITE_ROLES.includes(role)) {
    throw new Error("Vai trò của bạn không được phép tải lên/xoá tài liệu thiết bị (cần Author trở lên)");
  }

  // Khúc dữ liệu & truy vấn trạng thái: dùng thẳng phiên upload Google đã cấp
  // (không cần access token nên không phải gọi lại Google OAuth mỗi khúc).
  if (action === "asset_upload_chunk" || action === "asset_upload_status") {
    const sessionUri = assertGoogleSessionUri(String(body.sessionUri || ""));
    const total = Number(body.total);
    if (!Number.isInteger(total) || total <= 0 || total > MAX_UPLOAD_BYTES) throw new Error("total không hợp lệ");

    let contentRange: string;
    let payload: ArrayBuffer;
    if (action === "asset_upload_chunk") {
      const start = Number(body.start);
      if (!Number.isInteger(start) || start < 0) throw new Error("start không hợp lệ");
      payload = await req.arrayBuffer();
      const len = payload.byteLength;
      if (len === 0 || len > MAX_CHUNK_BYTES) throw new Error("Kích thước khúc không hợp lệ");
      const end = start + len - 1;
      if (end >= total) throw new Error("Khúc dữ liệu vượt quá kích thước file đã khai báo");
      if (end !== total - 1 && len % CHUNK_MULTIPLE !== 0) {
        throw new Error("Khúc không-cuối phải là bội số của 256 KiB");
      }
      contentRange = `bytes ${start}-${end}/${total}`;
    } else {
      payload = new ArrayBuffer(0);
      contentRange = `bytes */${total}`;
    }

    const res = await fetch(sessionUri, {
      method: "PUT",
      redirect: "manual",
      headers: { "Content-Range": contentRange },
      body: payload,
    });

    if (res.status === 308) {
      const range = res.headers.get("Range"); // vd "bytes=0-4194303"
      const received = range ? Number(range.split("-")[1]) + 1 : 0;
      return jsonResponse({ done: false, received });
    }
    if (res.status === 200 || res.status === 201) {
      const file = await res.json();
      return jsonResponse({ done: true, file });
    }
    if (res.status === 404 || res.status === 410) {
      throw new Error("Phiên upload đã hết hạn, hãy tải lên lại từ đầu");
    }
    throw new Error("Drive trả lỗi khi nhận dữ liệu (HTTP " + res.status + ")");
  }

  // 2) Các thao tác còn lại cần thư mục + access token
  const { data: project } = await supabaseAdmin
    .from("projects")
    .select("drive_assets_url")
    .eq("id", projectId)
    .single();
  const folderId = extractFolderId(
    (project as Record<string, string> | null)?.drive_assets_url,
    "BIM Manager chưa cấu hình thư mục Drive cho tài liệu thiết bị của dự án này"
  );
  const accessToken = await getGoogleAccessTokenForProject(supabaseAdmin, projectId);

  if (action === "asset_upload_init") {
    const size = Number(body.size);
    const mimeType = String(body.mimeType || "");
    const fileName = sanitizeFileName(String(body.fileName || ""));
    if (!fileName) throw new Error("Thiếu tên file");
    if (!Number.isInteger(size) || size <= 0) throw new Error("File rỗng hoặc kích thước không hợp lệ");
    if (size > MAX_UPLOAD_BYTES) {
      throw new Error(`File quá lớn (tối đa ${MAX_UPLOAD_BYTES / 1024 / 1024} MB)`);
    }
    const ext = (fileName.split(".").pop() || "").toLowerCase();
    if (!ALLOWED_TYPES[mimeType] || !ALLOWED_TYPES[mimeType].includes(ext)) {
      throw new Error("Chỉ nhận file PDF, DOCX, XLSX, PNG, JPG (đuôi file phải khớp loại file)");
    }

    const initRes = await fetch(
      `${DRIVE_UPLOAD}/files?uploadType=resumable&supportsAllDrives=true&fields=id,name,mimeType,size`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json; charset=UTF-8",
          "X-Upload-Content-Type": mimeType,
          "X-Upload-Content-Length": String(size),
        },
        body: JSON.stringify({ name: fileName, parents: [folderId] }),
      }
    );
    if (!initRes.ok) {
      throw new Error("Drive từ chối tạo phiên upload (HTTP " + initRes.status + "): " + (await initRes.text()).slice(0, 300));
    }
    const sessionUri = initRes.headers.get("Location");
    if (!sessionUri) throw new Error("Drive không trả địa chỉ phiên upload");
    return jsonResponse({ sessionUri, fileName, maxChunkBytes: MAX_CHUNK_BYTES, chunkMultiple: CHUNK_MULTIPLE });
  }

  if (action === "asset_download") {
    const meta = await assertFileInFolder(String(body.fileId || ""), folderId, accessToken);
    const res = await fetch(`${DRIVE_API}/files/${meta.id}?alt=media&supportsAllDrives=true`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error("Tải file từ Drive thất bại (HTTP " + res.status + ")");
    return new Response(res.body, {
      headers: { ...corsHeaders, "Content-Type": res.headers.get("Content-Type") || meta.mimeType || "application/octet-stream" },
    });
  }

  if (action === "asset_delete") {
    const meta = await assertFileInFolder(String(body.fileId || ""), folderId, accessToken);
    // Chuyển vào thùng rác (khôi phục được) thay vì xoá vĩnh viễn
    const res = await fetch(`${DRIVE_API}/files/${meta.id}?supportsAllDrives=true`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ trashed: true }),
    });
    if (!res.ok) throw new Error("Không xoá được file trên Drive (HTTP " + res.status + ")");
    return jsonResponse({ ok: true });
  }

  throw new Error("action không hợp lệ: " + action);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Thiếu Authorization header");

    // Client "admin" dùng service_role để: (1) xác thực JWT của người gọi,
    // (2) đọc project_members/projects mà không bị chặn bởi RLS
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const jwt = authHeader.replace("Bearer ", "");
    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(jwt);
    if (userErr || !userData?.user) throw new Error("Phiên đăng nhập không hợp lệ, hãy đăng nhập lại");
    const userId = userData.user.id;

    // Khúc upload & truy vấn trạng thái gửi dữ liệu nhị phân nên tham số đi
    // theo query string; các action khác dùng body JSON.
    const url = new URL(req.url);
    const qAction = url.searchParams.get("action");
    let body: Record<string, unknown>;
    if (qAction === "asset_upload_chunk" || qAction === "asset_upload_status") {
      body = {
        action: qAction,
        projectId: url.searchParams.get("projectId"),
        sessionUri: url.searchParams.get("sessionUri"),
        start: url.searchParams.get("start"),
        total: url.searchParams.get("total"),
      };
    } else {
      body = await req.json();
    }

    const action = body.action as string | undefined;
    if (typeof action === "string" && action.startsWith("asset_")) {
      return await handleAssetAction(supabaseAdmin, userId, body, req);
    }

    const { projectId, status, fileId } = body as { projectId?: string; status?: string; fileId?: string };
    if (!projectId || !status) throw new Error("Thiếu projectId hoặc status");
    if (!STATUS_COLUMN[status]) throw new Error("status không hợp lệ");

    // 1) Kiểm tra vai trò của người gọi trong dự án này
    const { data: member } = await supabaseAdmin
      .from("project_members")
      .select("role")
      .eq("project_id", projectId)
      .eq("user_id", userId)
      .single();

    const role = member?.role;
    if (!role) throw new Error("Bạn không thuộc dự án này");
    if (!ALLOWED_ROLES[status].includes(role)) {
      throw new Error("Vai trò của bạn không được phép xem file ở trạng thái " + status);
    }

    // 2) Lấy link thư mục Drive tương ứng, tách folderId ra từ URL
    const { data: project } = await supabaseAdmin
      .from("projects")
      .select(STATUS_COLUMN[status])
      .eq("id", projectId)
      .single();

    const folderId = extractFolderId(
      (project as Record<string, string> | null)?.[STATUS_COLUMN[status]],
      "Dự án chưa có link thư mục Drive cho trạng thái này"
    );

    // 3) Lấy access token Google rồi gọi Drive API
    const accessToken = await getGoogleAccessTokenForProject(supabaseAdmin, projectId);

    if (action === "list") {
      const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
      const listUrl =
        `${DRIVE_API}/files?q=${q}` +
        `&fields=files(id,name,mimeType,size,modifiedTime)` +
        `&supportsAllDrives=true&includeItemsFromAllDrives=true`;
      const res = await fetch(listUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      return jsonResponse(data.files || []);
    }

    if (action === "download") {
      if (!fileId) throw new Error("Thiếu fileId");
      // Bản cũ tải thẳng mọi fileId client gửi lên -> thành viên Published có
      // thể đọc cả file WIP hoặc file ngoài dự án. Nay chỉ cho tải file nằm
      // đúng trong thư mục của trạng thái đã được kiểm quyền ở trên.
      const meta = await assertFileInFolder(fileId, folderId, accessToken);
      const res = await fetch(`${DRIVE_API}/files/${meta.id}?alt=media&supportsAllDrives=true`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) throw new Error("Tải file từ Drive thất bại (HTTP " + res.status + ")");
      const contentType = res.headers.get("Content-Type") || "application/octet-stream";
      return new Response(res.body, {
        headers: { ...corsHeaders, "Content-Type": contentType },
      });
    }

    throw new Error("action không hợp lệ");
  } catch (e) {
    return jsonResponse({ error: (e as Error).message }, 400);
  }
});
