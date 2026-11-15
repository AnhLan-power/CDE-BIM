/* =====================================================================
   CDE FILES — Quản lý file CDE theo cây thư mục (ISO 19650 / TCVN 14177)
   Trạng thái (WIP · Shared · Published · Archived)
     └─ Mục con (Tệp tin, Pháp lý, Mô hình, …) ──► 1 thư mục Google Drive do BIM Manager gắn

   - Quyền xem/tải lên/xoá theo (vai trò × trạng thái) do Edge Function drive-proxy QUYẾT ĐỊNH
     (action cde_permissions); giao diện chỉ phản ánh lại để ẩn/hiện nút.
   - Cây thư mục lưu ở bảng cde_folders; nhật ký thao tác ở cde_audit (xem migration_cde_folders.sql);
     lịch sử chuyển trạng thái ở cde_transitions (xem migration_cde_transitions.sql).
   - Quy ước đặt tên + mã trạng thái (suitability) + mã phiên bản (revision) theo ISO 19650-2: cấu hình theo dự án ở bảng
     cde_naming (xem migration_cde_naming.sql); việc kiểm tra tên do Edge Function làm (cde_validate_name) nên không lệch
     giữa trình duyệt và máy chủ. Chưa bật quy ước thì mọi thứ chạy như cũ.
   - Chuyển trạng thái (WIP → Shared → Published → Archived): chọn 1 hoặc nhiều file → ➡️ Chuyển; luồng và vai
     trò được phép do Edge Function quyết định (cde_permissions trả về `transitions`).
   - Dùng chung biến toàn cục của cde-auth.js: sb, activeProjectId, activeRole, currentUser.
   - Không sửa cde-auth.js: module này ẩn phần "tab trạng thái + danh sách file" cũ trong panel CDE
     và thay bằng nút mở trình quản lý này.
   ===================================================================== */

(function () {
  "use strict";

  const STATES = ["WIP", "SHARED", "PUBLISHED", "ARCHIVED"];
  const META = {
    WIP: { vn: "Đang thực hiện", icon: "🟡" },
    SHARED: { vn: "Chia sẻ", icon: "🔵" },
    PUBLISHED: { vn: "Phát hành", icon: "🟢" },
    ARCHIVED: { vn: "Lưu trữ", icon: "⚫" },
  };
  const ROLE_LABEL = {
    bim_manager: "BIM Manager", task_team_manager: "Task Team Manager",
    author: "Author", approver: "Approver", viewer: "Viewer",
  };
  const SUGGESTED = ["Tệp tin", "Pháp lý", "Mô hình", "Bản vẽ", "Báo cáo", "Biên bản"];
  const DEFAULT_CATEGORIES = ["Tệp tin", "Pháp lý", "Mô hình"];
  const CHUNK = 4 * 1024 * 1024;   // bội số của 256 KiB (yêu cầu của Drive)
  const PREVIEWABLE = ["pdf", "png", "jpg", "jpeg", "gif", "webp", "docx", "xlsx"];
  const LOADABLE = ["ifc", "xkt"];

  // Dự phòng CHỈ để hiển thị khi function cũ chưa có cde_permissions (mọi thao tác vẫn do server chặn thật)
  const ALL = ["bim_manager", "task_team_manager", "author", "approver", "viewer"];
  const FALLBACK_RULES = {
    WIP: { view: ["bim_manager", "task_team_manager", "author"], upload: ["bim_manager", "task_team_manager", "author"], deleteAny: ["bim_manager"], deleteOwn: ["task_team_manager", "author"] },
    SHARED: { view: ["bim_manager", "task_team_manager", "author", "approver"], upload: ["bim_manager", "task_team_manager"], deleteAny: ["bim_manager"], deleteOwn: ["task_team_manager"] },
    PUBLISHED: { view: ALL, upload: ["bim_manager", "approver"], deleteAny: ["bim_manager"], deleteOwn: [] },
    ARCHIVED: { view: ALL, upload: ["bim_manager"], deleteAny: ["bim_manager"], deleteOwn: [] },
  };

  // Dự phòng CHỈ để hiển thị khi function cũ chưa trả `transitions` (server vẫn chặn thật)
  const FALLBACK_TRANSITIONS = [
    { from: "WIP", to: "SHARED", roles: ["bim_manager", "task_team_manager"], label: "Chia sẻ để phối hợp" },
    { from: "SHARED", to: "PUBLISHED", roles: ["bim_manager", "approver"], label: "Phê duyệt phát hành" },
    { from: "SHARED", to: "WIP", roles: ["bim_manager", "task_team_manager", "approver"], label: "Trả về WIP để chỉnh sửa", noteRequired: true },
    { from: "SHARED", to: "ARCHIVED", roles: ["bim_manager"], label: "Lưu trữ" },
    { from: "PUBLISHED", to: "ARCHIVED", roles: ["bim_manager"], label: "Lưu trữ (đã có bản thay thế)" },
  ];

  const S = {
    transitions: FALLBACK_TRANSITIONS, selFiles: new Set(), move: null,
    naming: null, namingErr: "", val: {}, upl: { names: [] }, ren: null, draft: null, ndMsg: "", ndErr: false,
    projectId: null, role: null, rules: null, rulesFromServer: false,
    banner: "", folders: [], selectedId: null, files: [], perms: null, filesError: "", filesLoading: false,
    configMode: false, view: "files",           // "files" | "audit"
    expanded: { WIP: true, SHARED: true, PUBLISHED: true, ARCHIVED: true },
    uploading: false, progress: "", progressErr: false, addingFor: null, auditRows: null,
  };

  /* ------------------------- tiện ích ------------------------- */
  function esc(v) {
    return String(v === null || v === undefined ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function $(id) { return document.getElementById(id); }
  function fmtSize(n) {
    n = Number(n) || 0;
    if (n >= 1073741824) return (n / 1073741824).toFixed(2) + " GB";
    if (n >= 1048576) return (n / 1048576).toFixed(1) + " MB";
    if (n >= 1024) return Math.round(n / 1024) + " KB";
    return n + " B";
  }
  function fmtDate(s) { if (!s) return "—"; const d = new Date(s); return isNaN(d) ? "—" : d.toLocaleString("vi-VN"); }
  function extOf(name) { return (String(name).split(".").pop() || "").toLowerCase(); }
  function iconFor(name) {
    const e = extOf(name);
    if (e === "pdf") return "📕"; if (["doc", "docx"].includes(e)) return "📘"; if (["xls", "xlsx", "csv"].includes(e)) return "📗";
    if (["png", "jpg", "jpeg", "gif", "webp"].includes(e)) return "🖼️"; if (["ifc", "xkt", "rvt", "rfa", "nwd", "nwc", "glb", "gltf"].includes(e)) return "🧊";
    if (["dwg", "dxf"].includes(e)) return "📐"; if (["zip", "rar", "7z"].includes(e)) return "🗜️"; return "📄";
  }
  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
  function toast(msg) { if (typeof window.showToast === "function") window.showToast(msg, "success"); else alert(msg); }

  function curProject() { return window.activeProjectId || null; }
  function curRole() { try { return activeRole; } catch (e) { return null; } }
  function curUserId() { try { return currentUser && currentUser.id; } catch (e) { return null; } }
  function client() { return (typeof sb !== "undefined" && sb) ? sb : window.sb; }
  function isManager() { return S.role === "bim_manager"; }

  function myTransitions(status) { return (S.transitions || []).filter((t) => t.from === status && t.roles.includes(S.role)); }
  function linkedFolders(status) { return S.folders.filter((f) => f.status === status && hasLink(f)); }

  function rulesFor(status) { return ((S.rules || FALLBACK_RULES)[status]) || { view: [], upload: [], deleteAny: [], deleteOwn: [] }; }
  function can(status, what) { return rulesFor(status)[what].includes(S.role); }
  function selected() { return S.folders.find((f) => f.id === S.selectedId) || null; }
  function hasLink(f) { return !!(f && f.drive_url && /folders\/[a-zA-Z0-9_-]+/.test(f.drive_url)); }

  /* ------------------------- quy ước đặt tên (ISO 19650-2) ------------------------- */
  function namingOn() { return !!(S.naming && S.naming.enabled); }
  function nmDelim(cfg) { return ((cfg || S.naming || {}).delimiter) || "-"; }
  function nmFields(cfg) { const c = cfg || S.naming; return c && Array.isArray(c.fields) ? c.fields : []; }
  function nmStatuses(cfg) { const c = cfg || S.naming; return c && Array.isArray(c.statuses) ? c.statuses : []; }
  function nmRev(cfg) { const r = ((cfg || S.naming || {}).revision) || {}; return { pPrefix: r.pPrefix || "P", cPrefix: r.cPrefix || "C", digits: Number(r.digits) || 2, versionDigits: Number(r.versionDigits) || 2 }; }
  function pad(n, w) { return String(n).padStart(w, "0"); }
  function statusDefFor(raw, cfg) {
    for (const st of nmStatuses(cfg)) {
      if (!st.numbered && raw === st.code) return st;
      if (st.numbered && new RegExp("^" + st.code + "[0-9]{1,2}$").test(raw)) return st;
    }
    return null;
  }
  function revSample(kind, cfg) {
    const r = nmRev(cfg), n = pad(1, r.digits), v = pad(1, r.versionDigits);
    return kind === "P.v" ? `${r.pPrefix}${n}.${v}` : kind === "P" ? `${r.pPrefix}${n}` : `${r.cPrefix}${n}`;
  }
  function fieldSample(f) {
    if (f.codes && f.codes.length) return f.codes[0].code;
    return f.charset === "digits" ? pad(1, Number(f.min) || 1) : "A".repeat(Number(f.min) || 1);
  }
  // Tên mẫu cho 1 trạng thái CDE, vd XLNT-SIBA-ZZ-00-M3-A-0001-S0-P01.01.ifc
  function nameExample(state, cfg, ext) {
    const d = nmDelim(cfg);
    const st = nmStatuses(cfg).find((x) => x.state === state) || nmStatuses(cfg)[0];
    const parts = nmFields(cfg).map(fieldSample);
    parts.push(st ? (st.numbered ? st.code + "1" : st.code) : "S0");
    parts.push(revSample(st ? st.revision : "P.v", cfg));
    return parts.join(d) + "." + (ext || "ext");
  }
  function splitName(name) {
    const dot = String(name).lastIndexOf(".");
    const base = dot > 0 ? name.slice(0, dot) : name;
    return { base, ext: dot > 0 ? name.slice(dot + 1) : "", parts: base.split(nmDelim()) };
  }
  // Tăng mã phiên bản ở cuối tên: P01.01 → P01.02 (bản làm việc), P01 → P02 (bản chính)
  function bumpName(name) {
    const { ext, parts } = splitName(name);
    if (parts.length < 2) return name;
    const rev = parts[parts.length - 1];
    let m = rev.match(/^([A-Z])([0-9]+)\.([0-9]+)$/);
    if (m) parts[parts.length - 1] = `${m[1]}${m[2]}.${pad(Number(m[3]) + 1, m[3].length)}`;
    else if ((m = rev.match(/^([A-Z])([0-9]+)$/))) parts[parts.length - 1] = `${m[1]}${pad(Number(m[2]) + 1, m[2].length)}`;
    else return name;
    return parts.join(nmDelim()) + (ext ? "." + ext : "");
  }
  // Gợi ý mã phiên bản khi đổi trạng thái (người dùng luôn sửa được; máy chủ kiểm tra lại):
  //  → "P"  (Shared / Published B): giữ số bản, bỏ số bản làm việc (P01.03 → P01)
  //  → "C"  (Published A / CR): bản hợp đồng đầu tiên C01 (nếu đã là C thì giữ)
  //  → "P.v" (trả về WIP): bản sơ bộ kế tiếp, bắt đầu lại bản làm việc (P01 → P02.01)
  function suggestRevision(oldRev, kind) {
    const r = nmRev(); const m = String(oldRev).match(/^([A-Z])([0-9]+)(?:\.([0-9]+))?$/);
    if (!m) return revSample(kind);
    const major = Number(m[2]);
    if (kind === "P") return `${r.pPrefix}${pad(major, r.digits)}`;
    if (kind === "C") return m[1] === r.cPrefix ? `${r.cPrefix}${pad(major, r.digits)}` : revSample("C");
    return m[3] !== undefined ? `${r.pPrefix}${pad(major, r.digits)}.${pad(Number(m[3]), r.versionDigits)}` : `${r.pPrefix}${pad(major + 1, r.digits)}.${pad(1, r.versionDigits)}`;
  }
  function suggestMoveName(oldName, statusCode) {
    const { ext, parts } = splitName(oldName);
    const nf = nmFields().length;
    if (parts.length !== nf + 2) return oldName;                 // tên cũ không theo quy ước: để người dùng tự nhập
    const st = statusDefFor(statusCode);
    if (!st) return oldName;
    parts[nf] = statusCode;
    parts[nf + 1] = suggestRevision(parts[nf + 1], st.revision);
    return parts.join(nmDelim()) + (ext ? "." + ext : "");
  }

  // Kiểm tra tên qua Edge Function (nguồn kiểm tra duy nhất), có bộ nhớ đệm theo (trạng thái, tên)
  let valTimer = null;
  function valKey(state, name) { return state + "|" + name; }
  async function validateNow(state, names) {
    const need = [...new Set(names.map((n) => String(n)).filter((n) => n.trim() && !(valKey(state, n) in S.val)))];
    if (!need.length) return;
    const j = await call({ action: "cde_validate_name", state, names: need });
    if (!j.enabled) { need.forEach((n) => { S.val[valKey(state, n)] = { ok: true, problems: [] }; }); return; }
    (j.results || []).forEach((r) => { S.val[valKey(state, r.name)] = r; });
  }
  function scheduleValidate(state, names, after) {
    clearTimeout(valTimer);
    valTimer = setTimeout(async () => { try { await validateNow(state, names); } catch (e) { /* giữ trạng thái "đang kiểm tra" */ } if (after) after(); }, 350);
  }
  function valBadge(state, name) {
    if (!String(name).trim()) return `<span style="color:#c5221f;">❌ Tên trống</span>`;
    const r = S.val[valKey(state, name)];
    if (!r) return `<span style="color:#888;">⏳ Đang kiểm tra…</span>`;
    if (r.ok) return `<span style="color:#188038;">✅ Đúng quy ước${r.status ? " · " + esc(r.status) : ""}${r.revision ? " · " + esc(r.revision) : ""}</span>`;
    return `<span style="color:#c5221f;">❌ ${(r.problems || []).map(esc).join("<br>❌ ")}</span>`;
  }

  function renderCodeTable(cfg) {
    let html = `<details style="margin-top:4px;"><summary style="cursor:pointer;color:#1a73e8;">📖 Bảng mã của quy ước</summary><div style="padding:6px 4px;">`;
    html += `<div><b>Cấu trúc:</b> <code>${esc(nmFields(cfg).map((f) => f.label).concat(["Mã trạng thái", "Mã phiên bản"]).join(nmDelim(cfg)))}</code></div>`;
    nmFields(cfg).forEach((f, i) => {
      html += `<div style="margin-top:4px;"><b>${i + 1}. ${esc(f.label)}</b> — ${f.min === f.max ? f.min : f.min + "–" + f.max} ký tự (${esc(f.charset === "digits" ? "số" : f.charset === "letters" ? "chữ in hoa" : "chữ in hoa/số")})`;
      if (f.codes && f.codes.length) html += `<div style="color:#555;">${f.codes.map((c) => `<code>${esc(c.code)}</code>${c.label ? " " + esc(c.label) : ""}`).join(" · ")}</div>`;
      html += `</div>`;
    });
    html += `<div style="margin-top:6px;"><b>Mã trạng thái (suitability) → trạng thái CDE → dạng phiên bản</b></div>`;
    for (const st of STATES) {
      const list = nmStatuses(cfg).filter((x) => x.state === st);
      if (list.length) html += `<div><b>${st}:</b> ${list.map((x) => `<code>${esc(x.code)}${x.numbered ? "+số" : ""}</code>${x.label ? " " + esc(x.label) : ""} <span style="color:#888;">(${esc(revSample(x.revision, cfg))})</span>`).join(" · ")}</div>`;
    }
    html += `<div style="color:#777;margin-top:4px;">ARCHIVED nhận mọi mã trạng thái (giữ nguyên trạng thái lúc lưu trữ). Phiên bản mới phải lớn hơn bản đã có của cùng mã định danh trong mục.</div></div></details>`;
    return html;
  }

  /* ------------------------- gọi Edge Function ------------------------- */
  function apiBase() {
    const url = (typeof SUPABASE_URL !== "undefined" && SUPABASE_URL) ? SUPABASE_URL : (client() && client().supabaseUrl);
    const key = (typeof SUPABASE_ANON_KEY !== "undefined" && SUPABASE_ANON_KEY) ? SUPABASE_ANON_KEY : "";
    return { fn: `${url}/functions/v1/drive-proxy`, key };
  }
  async function token() {
    const { data } = await client().auth.getSession();
    const t = data && data.session && data.session.access_token;
    if (!t) throw new Error("Phiên đăng nhập đã hết hạn, hãy đăng nhập lại.");
    return t;
  }
  function errMsg(j, res) {
    const msg = (j && j.error) || `Lỗi máy chủ (HTTP ${res.status})`;
    // Bản drive-proxy cũ đòi "status" cho mọi yêu cầu và không biết action cde_*
    if (/Thiếu projectId hoặc status|action không hợp lệ/.test(msg)) {
      return 'Edge Function "drive-proxy" trên Supabase vẫn là BẢN CŨ (chưa hỗ trợ file CDE theo cây thư mục). Hãy deploy bản mới (drive-proxy-function/index.ts) rồi thử lại.';
    }
    return msg;
  }
  async function call(body) {
    const t = await token(); const api = apiBase();
    const res = await fetch(api.fn, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}`, apikey: api.key },
      body: JSON.stringify({ projectId: S.projectId, ...body }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || j.error) throw new Error(errMsg(j, res));
    return j;
  }
  async function binary(action, folderId, extra, blob) {
    const t = await token(); const api = apiBase();
    const q = new URLSearchParams({ action, projectId: S.projectId, folderId, ...extra });
    const res = await fetch(`${api.fn}?${q}`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream", Authorization: `Bearer ${t}`, apikey: api.key },
      body: blob,
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || j.error) throw new Error(errMsg(j, res));
    return j;
  }
  async function fetchBlob(folder, file) {
    const t = await token(); const api = apiBase();
    const res = await fetch(api.fn, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}`, apikey: api.key },
      body: JSON.stringify({ action: "cde_download", projectId: S.projectId, folderId: folder.id, fileId: file.id }),
    });
    if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(errMsg(j, res)); }
    return res.blob();
  }

  /* ------------------------- nạp dữ liệu ------------------------- */
  async function loadRules() {
    S.banner = "";
    try {
      const j = await call({ action: "cde_permissions" });
      S.rules = j.rules; S.rulesFromServer = true;
      if (Array.isArray(j.transitions)) S.transitions = j.transitions;
      if (j.role) S.role = j.role;
    } catch (e) {
      S.rules = FALLBACK_RULES; S.rulesFromServer = false; S.transitions = FALLBACK_TRANSITIONS;
      S.banner = e.message;
    }
  }
  async function loadNamingCfg() {
    S.naming = null; S.namingErr = ""; S.val = {};
    try {
      const { data, error } = await client().from("cde_naming").select("*").eq("project_id", S.projectId).maybeSingle();
      if (error) S.namingErr = error.message;       // thiếu bảng (chưa chạy SQL): tính năng tuỳ chọn nên không báo lỗi ồn ào
      else S.naming = data || null;
    } catch (e) { S.namingErr = e.message; }
  }
  async function loadFolders() {
    const { data, error } = await client().from("cde_folders").select("*")
      .eq("project_id", S.projectId).order("sort_order", { ascending: true }).order("created_at", { ascending: true });
    if (error) {
      S.folders = [];
      S.banner = `Không đọc được cây thư mục: ${error.message} (đã chạy SQL migration_cde_folders.sql chưa?)`;
      return;
    }
    S.folders = data || [];
  }

  async function refresh() {
    const pid = curProject();
    S.role = curRole();
    S.view = "files"; S.auditRows = null; S.move = null; S.ren = null; S.selFiles = new Set(); S.upl.names = [];   // bỏ hộp thoại/lựa chọn của lần trước
    if (!pid) { S.projectId = null; S.folders = []; S.selectedId = null; S.files = []; S.banner = "Chọn dự án trong panel 📁 CDE trước."; render(); return; }
    S.projectId = pid;
    S.banner = "";
    render();                                   // hiện khung trống ngay, tải xong sẽ vẽ lại
    await Promise.all([loadRules(), loadFolders(), loadNamingCfg()]);
    if (pid !== curProject()) return;           // đã đổi dự án trong lúc chờ
    const stillThere = S.folders.some((f) => f.id === S.selectedId);
    if (!stillThere) {
      const pick = S.folders.find((f) => can(f.status, "view") && hasLink(f)) || S.folders.find((f) => can(f.status, "view")) || null;
      S.selectedId = pick ? pick.id : null;
    }
    render();
    await loadFiles();
  }

  async function loadFiles() {
    const f = selected();
    S.files = []; S.perms = null; S.filesError = ""; S.selFiles = new Set();
    if (!f || !can(f.status, "view") || !hasLink(f)) { renderPane(); return; }
    S.filesLoading = true; renderPane();
    const forId = f.id;
    try {
      const j = await call({ action: "cde_list", folderId: f.id });
      if (S.selectedId !== forId) return;       // người dùng đã chuyển mục khác
      S.files = j.files || []; S.perms = j.perms || null;
    } catch (e) {
      if (S.selectedId !== forId) return;
      S.filesError = e.message;
    }
    S.filesLoading = false; renderPane();
  }

  /* ------------------------- vẽ giao diện ------------------------- */
  function ensurePanel() {
    if ($("cfmPanel")) return;
    const style = document.createElement("style");
    style.id = "cfmStyle";
    style.textContent = `
      #cdeStatusTabs, #cdeFilesList { display: none !important; }   /* thay bằng trình quản lý cây thư mục */
      #cfmPanel { position:absolute; left:15px; top:70px; width:780px; max-width:96vw; max-height:88vh; overflow:auto; font-size:12px; }
      #cfmPanel .cfm-row { display:flex; align-items:center; gap:6px; padding:5px 7px; border-radius:6px; cursor:pointer; }
      #cfmPanel .cfm-row:hover { background:#f1f3f5; }
      #cfmPanel .cfm-row.sel { background:#e7f1ff; font-weight:600; }
      #cfmPanel .cfm-row.locked { color:#999; cursor:default; }
      #cfmPanel .cfm-chip { display:inline-block; padding:1px 6px; border-radius:9px; font-size:10px; background:#eef2f6; color:#445; margin-right:3px; }
      #cfmPanel .cfm-chip.no { background:#f4f4f4; color:#aaa; text-decoration:line-through; }
      #cfmPanel button.cfm-btn { padding:4px 9px; border:1px solid #ccd; background:#f8f9fa; border-radius:5px; cursor:pointer; font-size:11px; }
      #cfmPanel button.cfm-btn.primary { background:#1a73e8; border-color:#1a73e8; color:#fff; }
      #cfmPanel button.cfm-btn.danger { color:#c5221f; }
      #cfmPanel table { width:100%; border-collapse:collapse; }
      #cfmPanel th { text-align:left; font-size:10px; color:#777; padding:4px 5px; border-bottom:1px solid #ddd; }
      #cfmPanel td { padding:5px; border-bottom:1px solid #f0f0f0; vertical-align:middle; }
      #cfmPanel .cfm-link { color:#1a73e8; }
      #cfmPanel .cfm-box { background:#f6f8fa; border:1px solid #d7dee8; border-radius:6px; padding:8px; margin-bottom:8px; }
      #cfmPanel select, #cfmPanel textarea { width:100%; box-sizing:border-box; padding:4px; font-size:12px; margin:2px 0 6px; }
    `;
    document.head.appendChild(style);

    const panel = document.createElement("div");
    panel.className = "panel";
    panel.id = "cfmPanel";
    panel.style.display = "none";
    panel.innerHTML = `
      <div class="panel-header"><b>🗂 Quản Lý File CDE</b><span style="cursor:pointer" id="cfmClose">✕</span></div>
      <div id="cfmBanner"></div>
      <div id="cfmBody" style="display:flex;flex-wrap:wrap;gap:12px;">
        <div id="cfmTree" style="flex:1 1 230px;min-width:210px;"></div>
        <div id="cfmPane" style="flex:2 1 340px;min-width:260px;"></div>
      </div>`;
    document.body.appendChild(panel);
    $("cfmClose").addEventListener("click", () => { panel.style.display = "none"; });
    panel.addEventListener("click", onClick);
    panel.addEventListener("change", onChange);
    panel.addEventListener("input", onInput);
  }

  function injectEntryButton() {
    const legacy = $("cdeFilesPanel");
    if (!legacy || $("cfmOpenBtn")) return;
    const anchor = $("cdeStatusTabs");
    const wrap = document.createElement("div");
    wrap.innerHTML = `<button class="btn btn-primary" id="cfmOpenBtn" style="width:100%;margin-top:8px;">🗂 Mở trình quản lý file CDE (cây thư mục)</button>`;
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(wrap.firstChild, anchor);
    else legacy.appendChild(wrap.firstChild);
    $("cfmOpenBtn").addEventListener("click", () => { window.toggleCdeFilesManager(true); });
  }

  function render() {
    if (!$("cfmPanel")) return;
    $("cfmBanner").innerHTML = S.banner
      ? `<div style="margin:6px 0;padding:8px 10px;background:#fff4e5;border:1px solid #ffd8a8;border-radius:6px;color:#8a4b00;">⚠️ ${esc(S.banner)}</div>` : "";
    renderTree();
    renderPane();
  }

  function roleChips(status) {
    const r = rulesFor(status);
    const chip = (ok, label, title) => `<span class="cfm-chip ${ok ? "" : "no"}" title="${esc(title)}">${label}</span>`;
    return chip(r.view.includes(S.role), "👁 Xem", "Quyền xem file ở trạng thái này") +
      chip(r.upload.includes(S.role), "⬆ Tải lên", "Quyền tải file lên") +
      chip(r.deleteAny.includes(S.role) || r.deleteOwn.includes(S.role), r.deleteAny.includes(S.role) ? "🗑 Xoá" : "🗑 Xoá file mình", "Quyền xoá file");
  }

  function renderTree() {
    const el = $("cfmTree");
    if (!el) return;
    let html = `<div style="font-weight:700;margin-bottom:6px;">Dự án · vai trò <span class="cfm-chip">${esc(ROLE_LABEL[S.role] || S.role || "—")}</span></div>`;
    for (const st of STATES) {
      const m = META[st], viewable = can(st, "view");
      const kids = S.folders.filter((f) => f.status === st);
      html += `<div style="margin-bottom:8px;">
        <div class="cfm-row ${viewable ? "" : "locked"}" data-act="toggle" data-state="${st}">
          <span>${S.expanded[st] ? "▾" : "▸"}</span><span>${m.icon}</span><b>${st}</b><span style="color:#777;">${esc(m.vn)}</span>
          ${viewable ? "" : `<span title="Vai trò của bạn không được xem trạng thái này">🔒</span>`}
          ${S.configMode && isManager() ? `<button class="cfm-btn" style="margin-left:auto;" data-act="add" data-state="${st}" title="Thêm mục con">➕</button>` : ""}
        </div>
        <div style="margin-left:22px;">${roleChips(st)}</div>`;
      if (S.expanded[st]) {
        if (!viewable) html += `<div style="margin:4px 0 0 22px;color:#999;">Không có quyền xem</div>`;
        else if (!kids.length) html += `<div style="margin:4px 0 0 22px;color:#999;">${isManager() ? "Chưa có mục con — bật ⚙️ Cấu hình để thêm" : "Chưa có mục con (BIM Manager chưa thiết lập)"}</div>`;
        // Trạng thái bị khoá: KHÔNG vẽ tên mục con (tránh lộ cấu trúc thư mục của WIP/SHARED cho vai trò không được xem)
        for (const f of (viewable ? kids : [])) {
          html += `<div class="cfm-row ${f.id === S.selectedId ? "sel" : ""}" style="margin-left:18px;" data-act="select" data-id="${esc(f.id)}">
            <span>${hasLink(f) ? "📁" : "⚠️"}</span><span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(f.name)}">${esc(f.name)}</span>
            ${hasLink(f) ? "" : `<span style="color:#e37400;font-size:10px;">chưa gắn link</span>`}
            ${S.configMode && isManager() ? `<button class="cfm-btn" data-act="rename" data-id="${esc(f.id)}" title="Đổi tên">✏️</button><button class="cfm-btn danger" data-act="delfolder" data-id="${esc(f.id)}" title="Xoá mục (không xoá file trên Drive)">🗑</button>` : ""}
          </div>`;
        }
        if (S.configMode && isManager() && S.addingFor === st) {
          html += `<div style="margin:4px 0 0 18px;display:flex;gap:4px;">
            <input id="cfmNewName" list="cfmSuggest" placeholder="Tên mục con…" style="flex:1;min-width:0;padding:4px;">
            <button class="cfm-btn primary" data-act="addok" data-state="${st}">Thêm</button>
            <datalist id="cfmSuggest">${SUGGESTED.filter((n) => !kids.some((k) => k.name === n)).map((n) => `<option value="${esc(n)}">`).join("")}</datalist>
          </div>`;
        }
      }
      html += `</div>`;
    }
    if (isManager()) {
      html += `<div style="border-top:1px solid #eee;padding-top:8px;margin-top:4px;display:flex;flex-wrap:wrap;gap:6px;">
        <button class="cfm-btn ${S.configMode ? "primary" : ""}" data-act="config">⚙️ ${S.configMode ? "Đang cấu hình" : "Cấu hình cây thư mục"}</button>
        ${S.configMode ? `<button class="cfm-btn" data-act="defaults" title="Tạo mục Tệp tin / Pháp lý / Mô hình cho các trạng thái còn trống">✨ Tạo mục mặc định</button>` : ""}
        <button class="cfm-btn ${S.view === "naming" ? "primary" : ""}" data-act="naming" title="Quy ước đặt tên file, mã trạng thái, mã phiên bản (ISO 19650-2)">📐 Quy ước đặt tên</button>
        <button class="cfm-btn" data-act="audit">📜 Nhật ký</button>
      </div>`;
    }
    el.innerHTML = html;
  }

  function renderPane() {
    const el = $("cfmPane");
    if (!el) return;
    if (S.view === "audit") { el.innerHTML = renderAudit(); return; }
    if (S.view === "naming") { el.innerHTML = renderNamingEditor(); updateNdExample(); return; }
    const f = selected();
    if (!S.projectId) { el.innerHTML = ""; return; }
    if (!f) {
      el.innerHTML = `<div style="color:#888;padding:20px 0;">${S.folders.length ? "Chọn 1 mục con ở bên trái." : (isManager()
        ? `Chưa có mục con nào. Bấm <b>⚙️ Cấu hình cây thư mục</b> rồi <b>✨ Tạo mục mặc định</b> hoặc <b>➕</b> để thêm.` : "Chưa có mục con nào được thiết lập.")}</div>`;
      return;
    }
    const m = META[f.status], viewable = can(f.status, "view"), canUp = can(f.status, "upload");
    let html = `<div style="font-weight:700;font-size:13px;margin-bottom:6px;">${m.icon} ${f.status} › ${esc(f.name)}</div>`;

    if (S.configMode && isManager()) {
      html += `<div style="background:#f6f8fa;border-radius:6px;padding:8px;margin-bottom:8px;">
        <div style="font-weight:600;margin-bottom:4px;">🔗 Link thư mục Google Drive của mục này</div>
        <input id="cfmLinkInput" value="${esc(f.drive_url || "")}" placeholder="https://drive.google.com/drive/folders/..." style="width:100%;padding:5px;box-sizing:border-box;">
        <div style="margin-top:5px;display:flex;gap:6px;flex-wrap:wrap;">
          <button class="cfm-btn primary" data-act="savelink" data-id="${esc(f.id)}">Kiểm tra &amp; lưu</button>
          ${hasLink(f) ? `<button class="cfm-btn danger" data-act="clearlink" data-id="${esc(f.id)}">Gỡ link</button><a class="cfm-link" href="${esc(f.drive_url)}" target="_blank" rel="noopener noreferrer">mở trên Drive</a>` : ""}
        </div>
        <div style="color:#777;margin-top:4px;">Tài khoản Google đã kết nối (panel CDE) phải có quyền <b>Chỉnh sửa</b> trên thư mục này. Mỗi thư mục Drive chỉ gắn cho <b>1</b> mục.</div>
      </div>`;
    }

    if (!viewable) { el.innerHTML = html + `<div style="color:#c5221f;">🔒 Vai trò của bạn không được xem file ở trạng thái ${f.status}.</div>`; return; }
    if (!hasLink(f)) { el.innerHTML = html + `<div style="color:#e37400;">⚠️ Mục này chưa được BIM Manager gắn link thư mục Drive.</div>`; return; }

    if (namingOn()) {
      html += `<div style="background:#eef6ff;border:1px solid #cfe2ff;border-radius:6px;padding:6px 8px;margin-bottom:8px;">
        📐 <b>Quy ước đặt tên: BẬT</b> (${S.naming.mode === "block" ? "chặn file sai quy ước" : "chỉ cảnh báo"})
        <div style="color:#555;">Mẫu cho ${f.status}: <code>${esc(nameExample(f.status))}</code></div>${renderCodeTable()}</div>`;
    }
    if (canUp) {
      html += `<div style="border:1px dashed #b6c6e3;border-radius:6px;padding:8px;margin-bottom:8px;">
        <div style="display:flex;gap:6px;align-items:center;">
          <input type="file" id="cfmFileInput" multiple style="flex:1;min-width:0;font-size:11px;">
          <button class="cfm-btn primary" data-act="upload" id="cfmUploadBtn" ${S.uploading ? "disabled" : ""}>⬆️ Tải lên</button>
        </div>
        <div id="cfmNameBox"></div>
        <div id="cfmProgress" style="margin-top:5px;color:${S.progressErr ? "#c5221f" : "#1a73e8"};white-space:pre-line;">${esc(S.progress)}</div>
      </div>`;
    } else {
      html += `<div style="color:#888;margin-bottom:6px;">Vai trò ${esc(ROLE_LABEL[S.role] || S.role)} chỉ được xem/tải về ở trạng thái ${f.status}.</div>`;
    }

    const trs = myTransitions(f.status);
    if (trs.length) {
      html += `<div style="color:#555;margin-bottom:6px;">➡️ Bạn có thể chuyển file từ <b>${f.status}</b> sang: ${trs.map((t) => `<b>${t.to}</b> <span style="color:#888;">(${esc(t.label)})</span>`).join(" · ")}</div>`;
    }
    html += `<div id="cfmRenameBox"></div><div id="cfmMoveBox"></div><div id="cfmSelBar"></div>`;

    if (S.filesLoading) html += `<div style="color:#888;padding:10px 0;">⏳ Đang tải danh sách file…</div>`;
    else if (S.filesError) html += `<div style="color:#c5221f;padding:6px 0;">❌ ${esc(S.filesError)}</div>`;
    else if (!S.files.length) html += `<div style="color:#999;padding:10px 0;font-style:italic;">Chưa có file nào.</div>`;
    else {
      const canMove = trs.length > 0;
      html += `<div style="color:#777;margin-bottom:4px;">${S.files.length} file</div><table><thead><tr>${canMove ? `<th style="width:22px;"><input type="checkbox" data-act="selall" title="Chọn tất cả"></th>` : ""}<th>Tên file</th><th>Dung lượng</th><th>Cập nhật</th><th>Người tải lên</th><th></th></tr></thead><tbody>`;
      S.files.forEach((file, i) => {
        const e = extOf(file.name);
        const mayDelete = (S.perms && S.perms.canDeleteAny) || (S.perms && S.perms.canDeleteOwn && file.uploadedBy && file.uploadedBy === curUserId());
        const b = (act, label, title, cls) => `<button class="cfm-btn ${cls || ""}" data-act="${act}" data-idx="${i}" title="${title}">${label}</button>`;
        html += `<tr>${canMove ? `<td><input type="checkbox" data-act="selfile" data-idx="${i}" ${S.selFiles.has(file.id) ? "checked" : ""}></td>` : ""}<td><span>${iconFor(file.name)}</span> <span title="${esc(file.name)}">${esc(file.name)}</span>${nameChip(file)}</td>
          <td>${esc(fmtSize(file.size))}</td><td>${esc(fmtDate(file.modifiedTime))}</td>
          <td>${file.uploadedByName ? esc(file.uploadedByName) : `<span style="color:#aaa;">—</span>`}</td>
          <td style="white-space:nowrap;">
            ${namingOn() && mayDelete ? b("frename", "✏️", "Đổi tên theo quy ước") : ""}${canMove ? b("fmove", "➡️", "Chuyển trạng thái") : ""}${PREVIEWABLE.includes(e) ? b("fview", "👁", "Xem trước") : ""}${b("fdown", "⬇️", "Tải về")}
            ${LOADABLE.includes(e) ? b("fload", "🧊", "Nạp vào mô hình 3D") : ""}${mayDelete ? b("fdel", "🗑", "Xoá (chuyển vào thùng rác Drive)", "danger") : ""}
          </td></tr>`;
      });
      html += `</tbody></table>`;
    }
    el.innerHTML = html;
    renderSelBar(); renderMoveBox(); renderRenameBox(); renderNameBox(); updateUploadGate();
  }

  function nameChip(file) {
    if (!namingOn() || !file.naming) return "";
    if (file.naming.ok) return ` <span class="cfm-chip" title="Đúng quy ước đặt tên">${esc(file.naming.status)} · ${esc(file.naming.revision)}</span>`;
    return ` <span class="cfm-chip" style="background:#fde7e7;color:#c5221f;text-decoration:none;" title="${esc((file.naming.problems || []).join("\\n"))}">⚠️ sai quy ước</span>`;
  }

  /* ------------------------- tên file khi tải lên (theo quy ước) ------------------------- */
  function renderNameBox() {
    const el = $("cfmNameBox"); if (!el) return;
    const f = selected(); const input = $("cfmFileInput");
    const files = input && input.files ? Array.from(input.files) : [];
    if (!namingOn() || !f || !files.length) { el.innerHTML = ""; S.upl.names = []; return; }
    if (S.upl.names.length !== files.length) S.upl.names = files.map((x) => x.name);
    el.innerHTML = `<div style="margin-top:6px;color:#555;">Tên lưu trên CDE (sửa cho đúng quy ước):</div>` + files.map((file, i) => `
      <div style="margin:4px 0;">
        <div style="color:#999;font-size:10px;">${esc(file.name)}</div>
        <div style="display:flex;gap:4px;"><input class="cfm-nm" data-i="${i}" value="${esc(S.upl.names[i])}" style="flex:1;min-width:0;font-family:monospace;font-size:11px;padding:3px;"><button class="cfm-btn" data-act="nmbump" data-i="${i}" title="Tăng mã phiên bản (P01.01 → P01.02)">⬆ Phiên bản</button></div>
        <div class="cfm-nmstat" data-i="${i}" style="font-size:11px;">${valBadge(f.status, S.upl.names[i])}</div></div>`).join("");
  }
  function refreshNameStatuses() {
    const f = selected(); if (!f) return;
    document.querySelectorAll("#cfmNameBox .cfm-nmstat").forEach((el) => { el.innerHTML = valBadge(f.status, S.upl.names[Number(el.dataset.i)] || ""); });
    updateUploadGate();
  }
  // Chế độ "chặn": khoá nút tải lên tới khi mọi tên đều đúng quy ước (máy chủ vẫn kiểm tra lại khi tải)
  function updateUploadGate() {
    const btn = $("cfmUploadBtn"); if (!btn) return;
    if (S.uploading) { btn.disabled = true; return; }
    const f = selected();
    if (!namingOn() || S.naming.mode !== "block" || !f || !S.upl.names.length) { btn.disabled = false; return; }
    btn.disabled = !S.upl.names.every((n) => { const r = S.val[valKey(f.status, n)]; return r && r.ok; });
  }
  function onFilesChosen() {
    S.upl.names = []; renderNameBox();
    const f = selected(); if (!namingOn() || !f) return;
    refreshNameStatuses(); scheduleValidate(f.status, S.upl.names, refreshNameStatuses);
  }

  /* ------------------------- đổi tên file ------------------------- */
  function openRename(file) {
    const f = selected(); if (!f || !file) return;
    S.ren = { file, name: file.name, busy: false, result: null };
    renderRenameBox();
    scheduleValidate(f.status, [file.name], refreshRenStat);
  }
  function renderRenameBox() {
    const el = $("cfmRenameBox"); if (!el) return;
    const r = S.ren, f = selected();
    if (!r || !f) { el.innerHTML = ""; return; }
    if (r.result) {
      el.innerHTML = `<div class="cfm-box"><div style="white-space:pre-line;color:${r.result.fail ? "#c5221f" : "#188038"};margin-bottom:6px;">${esc(r.result.text)}</div><button class="cfm-btn" data-act="rncancel">Đóng</button></div>`;
      return;
    }
    el.innerHTML = `<div class="cfm-box"><div style="font-weight:700;margin-bottom:4px;">✏️ Đổi tên file (${f.status} › ${esc(f.name)})</div>
      <div style="color:#666;margin-bottom:4px;">Tên hiện tại: <code>${esc(r.file.name)}</code></div>
      <div style="display:flex;gap:4px;"><input id="cfmRenName" value="${esc(r.name)}" ${r.busy ? "disabled" : ""} style="flex:1;min-width:0;font-family:monospace;font-size:11px;padding:3px;"><button class="cfm-btn" data-act="rnbump" ${r.busy ? "disabled" : ""}>⬆ Phiên bản</button></div>
      <div id="cfmRenStat" style="font-size:11px;margin:4px 0;">${valBadge(f.status, r.name)}</div>
      <div style="color:#777;margin-bottom:6px;">Mẫu: <code>${esc(nameExample(f.status, null, extOf(r.file.name)))}</code> · không đổi được phần mở rộng</div>
      <button class="cfm-btn primary" data-act="rnok" id="cfmRenOk" ${r.busy ? "disabled" : ""}>Xác nhận đổi tên</button>
      <button class="cfm-btn" data-act="rncancel" ${r.busy ? "disabled" : ""}>Huỷ</button></div>`;
    updateRenGate();
  }
  function refreshRenStat() { const r = S.ren, f = selected(); const el = $("cfmRenStat"); if (!r || !f || !el) return; el.innerHTML = valBadge(f.status, r.name); updateRenGate(); }
  function updateRenGate() {
    const b = $("cfmRenOk"), r = S.ren, f = selected(); if (!b || !r || !f) return;
    const v = S.val[valKey(f.status, r.name)];
    b.disabled = r.busy || !r.name.trim() || r.name === r.file.name || (S.naming && S.naming.mode === "block" && !(v && v.ok));
  }
  async function confirmRename() {
    const r = S.ren, f = selected(); if (!r || !f || r.busy) return;
    const newName = r.name.trim();
    r.busy = true; renderRenameBox();
    try {
      const res = await call({ action: "cde_rename", folderId: f.id, fileId: r.file.id, newName });
      const warn = (res.namingWarnings || []).concat(res.auditWarning ? [res.auditWarning] : []);
      r.result = { text: `✅ Đã đổi tên thành ${res.file.name}` + (warn.length ? `\n⚠️ ${warn[0]}` : ""), fail: false };
    } catch (e) { r.result = { text: "❌ " + e.message, fail: true }; }
    r.busy = false; renderRenameBox();
    if (!r.result.fail) { const keep = r; await loadFiles(); S.ren = keep; renderRenameBox(); }
  }

  /* ------------------------- chuyển trạng thái ------------------------- */
  function renderSelBar() {
    const el = $("cfmSelBar"); if (!el) return;
    const n = S.selFiles.size;
    el.innerHTML = n ? `<div class="cfm-box" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
      <b>Đã chọn ${n} file</b>
      <button class="cfm-btn primary" data-act="movesel">➡️ Chuyển trạng thái…</button>
      <button class="cfm-btn" data-act="selnone">Bỏ chọn</button></div>` : "";
  }

  function openMoveDialog(files) {
    const f = selected(); if (!f || !files.length) return;
    const opts = myTransitions(f.status);
    if (!opts.length) return alert(`Vai trò ${ROLE_LABEL[S.role] || S.role} không được chuyển file ở trạng thái ${f.status}.`);
    S.move = { files, from: f, toState: (opts.find((t) => linkedFolders(t.to).length) || opts[0]).to, note: "", busy: false, result: null, statusCode: null, names: null };
    renderMoveBox();
    const box = $("cfmMoveBox"); if (box && box.scrollIntoView) box.scrollIntoView({ block: "nearest" });
  }

  function moveDefaultTarget(m) {
    const list = linkedFolders(m.toState);
    return (list.find((x) => x.name === m.from.name) || list[0] || {}).id || "";
  }

  function renderMoveBox() {
    const el = $("cfmMoveBox"); if (!el) return;
    const m = S.move;
    if (!m) { el.innerHTML = ""; return; }
    const opts = myTransitions(m.from.status);
    const tr = opts.find((t) => t.to === m.toState) || opts[0];
    const list = linkedFolders(m.toState);
    const names = m.files.slice(0, 3).map((x) => esc(x.name)).join(", ") + (m.files.length > 3 ? ` … (+${m.files.length - 3})` : "");
    let html = `<div class="cfm-box"><div style="font-weight:700;margin-bottom:4px;">➡️ Chuyển ${m.files.length} file từ ${m.from.status} › ${esc(m.from.name)}</div>
      <div style="color:#666;margin-bottom:6px;" title="${esc(m.files.map((x) => x.name).join("\n"))}">${names}</div>`;
    if (m.result) {
      html += `<div style="white-space:pre-line;color:${m.result.fail ? "#c5221f" : "#188038"};margin-bottom:6px;">${esc(m.result.text)}</div>
        <button class="cfm-btn" data-act="movecancel">Đóng</button></div>`;
      el.innerHTML = html; return;
    }
    html += `<label>Đến trạng thái</label><select id="cfmMoveTo" ${m.busy ? "disabled" : ""}>
      ${opts.map((t) => `<option value="${t.to}" ${t.to === m.toState ? "selected" : ""} ${linkedFolders(t.to).length ? "" : "disabled"}>${t.to} — ${esc(t.label)}${linkedFolders(t.to).length ? "" : " (chưa có mục nào gắn link)"}</option>`).join("")}
    </select>`;
    if (!list.length) {
      html += `<div style="color:#c5221f;margin-bottom:6px;">Trạng thái ${m.toState} chưa có mục con nào được gắn link Drive — nhờ BIM Manager thiết lập trước.</div>`;
    } else {
      const def = m.targetId && list.some((x) => x.id === m.targetId) ? m.targetId : moveDefaultTarget(m);
      html += `<label>Vào mục</label><select id="cfmMoveFolder" ${m.busy ? "disabled" : ""}>${list.map((x) => `<option value="${esc(x.id)}" ${x.id === def ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select>`;
    }
    if (namingOn() && list.length) {
      const sts = nmStatuses().filter((x) => x.state === m.toState);
      if (!m.statusCode || !sts.some((x) => statusCodeSample(x) === m.statusCode)) { m.statusCode = sts.length ? statusCodeSample(sts[0]) : null; m.names = null; }
      if (!m.names) m.names = m.files.map((x) => (m.statusCode ? suggestMoveName(x.name, m.statusCode) : x.name));
      html += `<label>Mã trạng thái mới (theo quy ước)</label><select id="cfmMoveStatus" ${m.busy ? "disabled" : ""}>
        ${sts.map((x) => `<option value="${esc(statusCodeSample(x))}" ${statusCodeSample(x) === m.statusCode ? "selected" : ""}>${esc(x.code)}${x.numbered ? "+số" : ""} — ${esc(x.label || "")} (phiên bản ${esc(revSample(x.revision))})</option>`).join("") || `<option value="">(chưa có mã nào cho ${m.toState})</option>`}</select>
        <label>Tên file sau khi chuyển <span style="color:#888;">(sửa được; đổi mã trạng thái sẽ tính lại gợi ý)</span></label>`;
      m.files.forEach((file, i) => {
        html += `<div style="margin:3px 0;"><div style="color:#999;font-size:10px;">${esc(file.name)}</div>
          <div style="display:flex;gap:4px;"><input class="cfm-mn" data-i="${i}" value="${esc(m.names[i])}" ${m.busy ? "disabled" : ""} style="flex:1;min-width:0;font-family:monospace;font-size:11px;padding:3px;"><button class="cfm-btn" data-act="mnbump" data-i="${i}" title="Tăng mã phiên bản" ${m.busy ? "disabled" : ""}>⬆</button></div>
          <div class="cfm-mnstat" data-i="${i}" style="font-size:11px;">${valBadge(m.toState, m.names[i])}</div></div>`;
      });
    }
    html += `<label>Ghi chú ${tr && tr.noteRequired ? `<b style="color:#c5221f;">(bắt buộc — lý do trả về)</b>` : "(tuỳ chọn)"}</label>
      <textarea id="cfmMoveNote" rows="2" maxlength="500" placeholder="${tr && tr.noteRequired ? "VD: Sai cao độ tầng 2, cần sửa lại" : "VD: Đã kiểm tra nội bộ, đủ điều kiện chia sẻ"}" ${m.busy ? "disabled" : ""}>${esc(m.note)}</textarea>
      <div id="cfmMoveProg" style="color:#1a73e8;margin-bottom:6px;white-space:pre-line;">${esc(m.progress || "")}</div>
      <button class="cfm-btn primary" data-act="moveok" ${m.busy || !list.length ? "disabled" : ""}>Xác nhận chuyển</button>
      <button class="cfm-btn" data-act="movecancel" ${m.busy ? "disabled" : ""}>Huỷ</button></div>`;
    el.innerHTML = html;
    if (namingOn() && list.length && m.names) { updateMoveStats(); scheduleValidate(m.toState, m.names, updateMoveStats); }
  }

  function statusCodeSample(st) { return st.numbered ? st.code + "1" : st.code; }
  function updateMoveStats() {
    const m = S.move; if (!m || m.result) return;
    document.querySelectorAll("#cfmMoveBox .cfm-mnstat").forEach((el) => { el.innerHTML = valBadge(m.toState, (m.names || [])[Number(el.dataset.i)] || ""); });
    const b = document.querySelector('#cfmMoveBox [data-act="moveok"]');
    if (b && namingOn() && S.naming.mode === "block" && m.names) {
      b.disabled = m.busy || !m.names.every((n) => { const r = S.val[valKey(m.toState, n)]; return r && r.ok; });
    }
  }
  function onMoveNameInput(t) {
    const m = S.move; if (!m) return;
    m.names[Number(t.dataset.i)] = t.value; updateMoveStats();
    scheduleValidate(m.toState, [t.value], updateMoveStats);
  }
  function onMoveStatusChange(code) {
    const m = S.move; if (!m) return;
    m.note = (($("cfmMoveNote") || {}).value || "");
    m.statusCode = code; m.names = null; renderMoveBox();
  }

  // Lỗi mang tính cố định (sai quyền/luồng/cấu hình): lặp lại cho các file còn lại là vô ích -> dừng
  const FATAL_MOVE = /không được chuyển|Không có luồng|Cần ghi lý do|BẢN CŨ|quyền ĐỌC|chưa được BIM Manager gắn link|cùng một thư mục|không tồn tại trong dự án|Phiên đăng nhập|Cấu hình quy ước/;

  async function confirmMove() {
    const m = S.move; if (!m || m.busy) return;
    const toState = ($("cfmMoveTo") || {}).value || m.toState;
    const toFolderId = ($("cfmMoveFolder") || {}).value;
    const note = (($("cfmMoveNote") || {}).value || "").trim();
    const tr = myTransitions(m.from.status).find((t) => t.to === toState);
    if (!tr) return alert("Luồng chuyển này không có trong quyền của bạn.");
    if (!toFolderId) return alert("Chọn mục đích.");
    if (tr.noteRequired && !note) return alert(`Cần ghi lý do khi chuyển file từ ${tr.from} về ${tr.to}.`);
    // Quy ước đặt tên (nếu bật): mã trạng thái/phiên bản trong tên phải hợp với trạng thái đích
    let names = null;
    if (namingOn()) {
      const inputs = Array.from(document.querySelectorAll("#cfmMoveBox .cfm-mn"));
      names = inputs.length === m.files.length ? inputs.map((i) => i.value.trim()) : (m.names || m.files.map((x) => x.name));
      if (names.some((n) => !n)) return alert("Có tên file đang trống.");
      try { await validateNow(toState, names); } catch (e) { return alert("Không kiểm tra được tên file: " + e.message); }
      const bad = names.map((n) => ({ n, r: S.val[valKey(toState, n)] })).filter((x) => x.r && !x.r.ok);
      if (bad.length && S.naming.mode === "block") { m.names = names; updateMoveStats(); return alert("Có tên file chưa đúng quy ước ở trạng thái " + toState + ":\n" + bad.map((x) => "• " + x.n + ": " + x.r.problems[0]).join("\n")); }
      if (bad.length && !confirm("Có tên file chưa đúng quy ước (chế độ cảnh báo):\n" + bad.map((x) => "• " + x.n + ": " + x.r.problems[0]).join("\n") + "\n\nVẫn chuyển?")) return;
    }
    const target = S.folders.find((x) => x.id === toFolderId);
    const label = `${toState} › ${target ? target.name : ""}`;
    if (!confirm(`Chuyển ${m.files.length} file từ ${m.from.status} › ${m.from.name} sang ${label}?\n\nThao tác được ghi vào lịch sử. File giữ nguyên nội dung, chỉ đổi thư mục trên Drive.`)) return;

    m.busy = true; m.toState = toState; m.targetId = toFolderId; m.note = note; if (names) m.names = names; renderMoveBox();
    const okNames = [], failed = [], warnings = [], nwarn = [];
    let stopped = null;
    for (let i = 0; i < m.files.length; i++) {
      const file = m.files[i];
      m.progress = `⏳ (${i + 1}/${m.files.length}) ${file.name}`;
      const pr = $("cfmMoveProg"); if (pr) pr.textContent = m.progress;
      try {
        const res = await call({ action: "cde_move", folderId: m.from.id, fileId: file.id, toFolderId, note, newName: names ? names[i] : undefined });
        okNames.push((res.file && res.file.name) || file.name);
        if (res.auditWarning) warnings.push(res.auditWarning);
        (res.namingWarnings || []).forEach((w) => nwarn.push(`${(res.file && res.file.name) || file.name}: ${w}`));
      } catch (e) {
        failed.push(`• ${file.name}: ${e.message}`);
        if (FATAL_MOVE.test(e.message)) { stopped = e.message; break; }
      }
    }
    const left = m.files.length - okNames.length - failed.length;
    let text = okNames.length ? `✅ Đã chuyển ${okNames.length}/${m.files.length} file sang ${label}.` : `❌ Không chuyển được file nào.`;
    if (failed.length) text += `\n${failed.join("\n")}`;
    if (left > 0) text += `\n(Đã dừng — ${left} file còn lại chưa được chuyển.)`;
    if (nwarn.length) text += `\n⚠️ Chưa đúng quy ước — ${nwarn[0]}`;
    if (warnings.length) text += `\n⚠️ ${warnings[0]}`;
    m.busy = false; m.result = { text, fail: !okNames.length || !!failed.length };
    S.selFiles = new Set();
    renderMoveBox();
    if (okNames.length) { const keep = m; await loadFiles(); S.move = keep; renderMoveBox(); }   // làm mới danh sách nhưng giữ hộp kết quả
  }

  /* ------------------------- trình cấu hình quy ước đặt tên (BIM Manager) ------------------------- */
  // Mẫu tham chiếu theo Phụ lục quốc gia Anh của BS EN ISO 19650-2 (Bảng NA.1) — phải đối chiếu với BEP/EIR của dự án.
  const PRESET_UKNA = {
    delimiter: "-",
    fields: [
      { label: "Dự án", min: 2, max: 6, charset: "alnum", codes: [] },
      { label: "Đơn vị lập", min: 2, max: 6, charset: "alnum", codes: [] },
      { label: "Chức năng / Hệ thống", min: 2, max: 2, charset: "alnum", codes: [] },
      { label: "Không gian / Tầng", min: 2, max: 2, charset: "alnum", codes: [] },
      { label: "Loại thông tin", min: 2, max: 2, charset: "alnum", codes: [
        ["AF", "Hoạt ảnh"], ["BQ", "Bảng khối lượng"], ["CA", "Tính toán"], ["CM", "Mô hình tổng hợp"], ["CO", "Công văn / thư từ"], ["CP", "Kế hoạch chi phí"],
        ["DB", "Cơ sở dữ liệu"], ["DR", "Bản vẽ"], ["FN", "Ghi chú hồ sơ"], ["HS", "An toàn lao động"], ["IE", "Trao đổi thông tin"], ["M2", "Mô hình 2D"],
        ["M3", "Mô hình 3D"], ["MI", "Biên bản họp"], ["MR", "Mô hình kết xuất"], ["MS", "Biện pháp thi công"], ["PP", "Bản trình bày"], ["PR", "Tiến độ"],
        ["RD", "Bảng thông số phòng"], ["RI", "Yêu cầu làm rõ (RFI)"], ["RP", "Báo cáo"], ["SA", "Bảng diện tích"], ["SH", "Bảng thống kê"],
        ["SN", "Danh sách tồn tại"], ["SP", "Đặc tả kỹ thuật"], ["SU", "Khảo sát"], ["VS", "Hình ảnh phối cảnh"]].map(([code, label]) => ({ code, label })) },
      { label: "Chuyên ngành", min: 1, max: 1, charset: "letters", codes: [
        ["A", "Kiến trúc"], ["B", "Khảo sát công trình"], ["C", "Xây dựng dân dụng"], ["D", "Thoát nước / đường"], ["E", "Điện"], ["F", "Quản lý vận hành"],
        ["G", "Trắc địa / địa chất"], ["H", "Thông gió – sưởi"], ["I", "Nội thất"], ["K", "Chủ đầu tư"], ["L", "Cảnh quan"], ["M", "Cơ khí"], ["P", "Cấp thoát nước"],
        ["Q", "Dự toán / khối lượng"], ["S", "Kết cấu"], ["T", "Quy hoạch"], ["W", "Nhà thầu"], ["X", "Nhà thầu phụ"], ["Y", "Thiết kế chuyên biệt"],
        ["Z", "Chung (không theo bộ môn)"]].map(([code, label]) => ({ code, label })) },
      { label: "Số thứ tự", min: 4, max: 4, charset: "digits", codes: [] },
    ],
    statuses: [
      { code: "S0", label: "Trạng thái ban đầu (đang thực hiện)", state: "WIP", revision: "P.v", numbered: false },
      { code: "S1", label: "Phù hợp để phối hợp", state: "SHARED", revision: "P", numbered: false },
      { code: "S2", label: "Phù hợp để cung cấp thông tin", state: "SHARED", revision: "P", numbered: false },
      { code: "S3", label: "Phù hợp để xem xét và góp ý", state: "SHARED", revision: "P", numbered: false },
      { code: "S4", label: "Phù hợp để phê duyệt giai đoạn", state: "SHARED", revision: "P", numbered: false },
      { code: "S5", label: "Phù hợp để cấp phép PIM", state: "SHARED", revision: "P", numbered: false },
      { code: "S6", label: "Phù hợp để cấp phép AIM", state: "SHARED", revision: "P", numbered: false },
      { code: "A", label: "Đã cấp phép và chấp thuận", state: "PUBLISHED", revision: "C", numbered: true },
      { code: "B", label: "Chấp thuận một phần (có góp ý)", state: "PUBLISHED", revision: "P", numbered: true },
      { code: "CR", label: "Hồ sơ hoàn công", state: "PUBLISHED", revision: "C", numbered: false },
    ],
    revision: { pPrefix: "P", cPrefix: "C", digits: 2, versionDigits: 2 },
  };

  function codesToText(codes) { return (codes || []).map((c) => (c.label ? `${c.code} = ${c.label}` : c.code)).join("\n"); }
  function parseCodes(text) {
    return String(text || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
      const i = l.indexOf("=");
      return i < 0 ? { code: l.toUpperCase(), label: "" } : { code: l.slice(0, i).trim().toUpperCase(), label: l.slice(i + 1).trim() };
    });
  }
  function emptyDraft() { return { enabled: false, mode: "warn", delimiter: "-", fields: [], statuses: [], revision: { pPrefix: "P", cPrefix: "C", digits: 2, versionDigits: 2 } }; }
  function draftFromPayload(p, base) {
    return {
      enabled: !!(base ? base.enabled : p.enabled), mode: (base && base.mode) || "warn", delimiter: p.delimiter || "-",
      fields: (p.fields || []).map((f) => ({ label: f.label, charset: f.charset, min: f.min, max: f.max, codesText: codesToText(f.codes) })),
      statuses: (p.statuses || []).map((x) => ({ code: x.code, label: x.label || "", state: x.state, revision: x.revision, numbered: !!x.numbered })),
      revision: { pPrefix: "P", cPrefix: "C", digits: 2, versionDigits: 2, ...(p.revision || {}) },
    };
  }
  function draftFromRow(row) { return row ? draftFromPayload(row, row) : emptyDraft(); }
  function draftToPayload(d) {
    return {
      enabled: !!d.enabled, mode: d.mode === "block" ? "block" : "warn", delimiter: d.delimiter === "_" ? "_" : "-",
      fields: d.fields.map((f) => ({ label: String(f.label || "").trim(), min: Number(f.min), max: Number(f.max), charset: f.charset, codes: parseCodes(f.codesText) })),
      statuses: d.statuses.map((x) => ({ code: String(x.code || "").trim().toUpperCase(), label: String(x.label || "").trim(), state: x.state, revision: x.revision, numbered: !!x.numbered })),
      revision: { pPrefix: String(d.revision.pPrefix || "").trim().toUpperCase(), cPrefix: String(d.revision.cPrefix || "").trim().toUpperCase(), digits: Number(d.revision.digits), versionDigits: Number(d.revision.versionDigits) },
    };
  }
  const CHARSET_RE = { letters: /^[A-Z]+$/, digits: /^[0-9]+$/, alnum: /^[A-Z0-9]+$/ };
  // Kiểm tra trước khi lưu (máy chủ kiểm tra lại cùng luật khi dùng cấu hình)
  function payloadError(p) {
    if (!p.fields.length || p.fields.length > 12) return "Cần từ 1 đến 12 trường mã định danh.";
    for (let i = 0; i < p.fields.length; i++) {
      const f = p.fields[i], n = i + 1;
      if (!f.label || f.label.length > 40) return `Trường ${n}: cần tên (tối đa 40 ký tự).`;
      if (!Number.isInteger(f.min) || !Number.isInteger(f.max) || f.min < 1 || f.max > 12 || f.min > f.max) return `Trường “${f.label}”: độ dài tối thiểu/tối đa phải từ 1 đến 12 và tối thiểu ≤ tối đa.`;
      if (!CHARSET_RE[f.charset]) return `Trường “${f.label}”: chọn loại ký tự.`;
      const seen = new Set();
      for (const c of f.codes) {
        if (!CHARSET_RE[f.charset].test(c.code) || c.code.length < f.min || c.code.length > f.max) return `Trường “${f.label}”: mã “${c.code}” không khớp loại ký tự/độ dài của trường.`;
        if (seen.has(c.code)) return `Trường “${f.label}”: mã “${c.code}” bị trùng.`;
        seen.add(c.code);
      }
    }
    if (!p.statuses.length) return "Cần ít nhất 1 mã trạng thái.";
    const seenSt = new Set();
    for (const x of p.statuses) {
      if (!/^[A-Z][A-Z0-9]{0,3}$/.test(x.code)) return `Mã trạng thái “${x.code}”: gồm 1–4 chữ in hoa/số và bắt đầu bằng chữ.`;
      if (x.numbered && !/^[A-Z]+$/.test(x.code)) return `Mã trạng thái “${x.code}” có số thứ tự thì chỉ gồm chữ cái (vd A → A1, A2…).`;
      if (seenSt.has(x.code)) return `Mã trạng thái “${x.code}” bị trùng.`;
      seenSt.add(x.code);
    }
    for (const st of ["WIP", "SHARED", "PUBLISHED"]) {
      if (!p.statuses.some((x) => x.state === st)) return `Trạng thái ${st} chưa có mã trạng thái nào — sẽ không tải file lên được ở ${st}.`;
    }
    const r = p.revision;
    if (!/^[A-Z]$/.test(r.pPrefix) || !/^[A-Z]$/.test(r.cPrefix) || r.pPrefix === r.cPrefix) return "Tiền tố phiên bản sơ bộ và hợp đồng phải là 2 chữ cái in hoa khác nhau.";
    if (![r.digits, r.versionDigits].every((n) => Number.isInteger(n) && n >= 1 && n <= 3)) return "Số chữ số của phiên bản phải từ 1 đến 3.";
    return null;
  }

  function setPath(obj, path, val) {
    const keys = path.split("."); let o = obj;
    for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]];
    o[keys[keys.length - 1]] = val;
  }
  function optHtml(value, label, cur) { return `<option value="${esc(value)}" ${String(cur) === String(value) ? "selected" : ""}>${esc(label)}</option>`; }

  function renderNamingEditor() {
    const d = S.draft || (S.draft = draftFromRow(S.naming));
    let html = `<div style="font-weight:700;font-size:13px;margin-bottom:6px;">📐 Quy ước đặt tên · mã trạng thái · mã phiên bản <button class="cfm-btn" data-act="ndback" style="margin-left:8px;">← Quay lại</button></div>`;
    if (!isManager()) return html + `<div style="color:#c5221f;">Chỉ BIM Manager được cấu hình quy ước đặt tên.</div>`;
    html += `<div style="color:#555;margin-bottom:6px;">ISO 19650-2 / TCVN 14177 yêu cầu mã định danh duy nhất theo quy ước đã thống nhất và văn bản hoá (BEP/EIR). Các mã <b>S0–S6, A, B, CR</b> và phiên bản <b>P01.01 / C01</b> là của Phụ lục quốc gia Anh nên chỉ là <b>mẫu tham chiếu</b> — hãy đối chiếu với BEP của dự án và sửa cho khớp. Mã trạng thái và phiên bản được gắn vào tên file dạng hậu tố để thấy ngay trên Drive.</div>`;
    if (S.namingErr) html += `<div style="color:#8a4b00;margin-bottom:6px;">⚠️ Không đọc được cấu hình hiện có: ${esc(S.namingErr)} (đã chạy migration_cde_naming.sql chưa?)</div>`;
    html += `<div class="cfm-box">
      <label><input type="checkbox" data-nd="enabled" ${d.enabled ? "checked" : ""}> <b>Bật kiểm tra tên file</b> <span style="color:#888;">(tắt = dự án chạy như cũ)</span></label>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:4px;">
        <label>Chế độ <select data-nd="mode" style="width:auto;">${optHtml("warn", "Cảnh báo (vẫn cho tải lên)", d.mode)}${optHtml("block", "Chặn (từ chối file sai quy ước)", d.mode)}</select></label>
        <label>Ký tự ngăn cách <select data-nd="delimiter" style="width:auto;">${optHtml("-", "- (gạch ngang)", d.delimiter)}${optHtml("_", "_ (gạch dưới)", d.delimiter)}</select></label>
      </div>
      <div style="margin-top:6px;"><button class="cfm-btn" data-act="ndpreset">📋 Áp mẫu ISO 19650-2 (Phụ lục quốc gia Anh)</button></div>
      <div style="margin-top:6px;color:#555;">Tên mẫu: <code id="cfmNdExample"></code></div></div>`;

    html += `<div style="font-weight:600;margin:8px 0 4px;">1. Các trường của mã định danh (theo thứ tự trong tên file)</div>`;
    d.fields.forEach((f, i) => {
      html += `<div class="cfm-box"><div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
        <b>${i + 1}.</b><input data-nd="fields.${i}.label" value="${esc(f.label)}" placeholder="Tên trường" style="flex:1;min-width:120px;padding:3px;">
        <select data-nd="fields.${i}.charset" style="width:auto;">${optHtml("alnum", "Chữ hoa + số", f.charset)}${optHtml("letters", "Chỉ chữ hoa", f.charset)}${optHtml("digits", "Chỉ số", f.charset)}</select>
        dài <input type="number" min="1" max="12" data-nd="fields.${i}.min" value="${esc(f.min)}" style="width:44px;padding:3px;">–<input type="number" min="1" max="12" data-nd="fields.${i}.max" value="${esc(f.max)}" style="width:44px;padding:3px;">
        <button class="cfm-btn" data-act="ndupf" data-i="${i}" title="Lên">↑</button><button class="cfm-btn" data-act="nddownf" data-i="${i}" title="Xuống">↓</button><button class="cfm-btn danger" data-act="ndrmf" data-i="${i}" title="Xoá trường">✖</button></div>
        <textarea data-nd="fields.${i}.codesText" rows="2" placeholder="Danh mục mã (tuỳ chọn) — mỗi dòng: MÃ = mô tả. Để trống = cho phép mọi giá trị đúng loại ký tự/độ dài." style="margin-top:4px;">${esc(f.codesText)}</textarea></div>`;
    });
    html += `<button class="cfm-btn" data-act="ndaddf">➕ Thêm trường</button>`;

    html += `<div style="font-weight:600;margin:10px 0 4px;">2. Mã trạng thái (suitability) — gắn với trạng thái CDE và dạng mã phiên bản</div>
      <div style="color:#777;margin-bottom:4px;">Dạng phiên bản: <b>${esc(revSample("P.v", draftToPayload(d)))}</b> = bản sơ bộ + bản làm việc (WIP) · <b>${esc(revSample("P", draftToPayload(d)))}</b> = bản sơ bộ (Shared) · <b>${esc(revSample("C", draftToPayload(d)))}</b> = bản hợp đồng (Published). “+số” = có số thứ tự (A → A1, A2…).</div>`;
    d.statuses.forEach((x, i) => {
      html += `<div style="display:flex;gap:4px;flex-wrap:wrap;align-items:center;margin-bottom:4px;">
        <input data-nd="statuses.${i}.code" value="${esc(x.code)}" placeholder="Mã" style="width:48px;padding:3px;text-transform:uppercase;">
        <input data-nd="statuses.${i}.label" value="${esc(x.label)}" placeholder="Mô tả" style="flex:1;min-width:110px;padding:3px;">
        <select data-nd="statuses.${i}.state" style="width:auto;">${STATES.map((st) => optHtml(st, st, x.state)).join("")}</select>
        <select data-nd="statuses.${i}.revision" style="width:auto;">${optHtml("P.v", "P01.01 (bản làm việc)", x.revision)}${optHtml("P", "P01 (bản sơ bộ)", x.revision)}${optHtml("C", "C01 (bản hợp đồng)", x.revision)}</select>
        <label title="Có số thứ tự (A1, A2…)"><input type="checkbox" data-nd="statuses.${i}.numbered" ${x.numbered ? "checked" : ""}>+số</label>
        <button class="cfm-btn danger" data-act="ndrmst" data-i="${i}" title="Xoá mã">✖</button></div>`;
    });
    html += `<button class="cfm-btn" data-act="ndaddst">➕ Thêm mã trạng thái</button>`;

    html += `<div style="font-weight:600;margin:10px 0 4px;">3. Mã phiên bản</div><div class="cfm-box" style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;">
      <label>Tiền tố bản sơ bộ <input data-nd="revision.pPrefix" value="${esc(d.revision.pPrefix)}" maxlength="1" style="width:30px;padding:3px;text-transform:uppercase;"></label>
      <label>Tiền tố bản hợp đồng <input data-nd="revision.cPrefix" value="${esc(d.revision.cPrefix)}" maxlength="1" style="width:30px;padding:3px;text-transform:uppercase;"></label>
      <label>Số chữ số bản <input type="number" min="1" max="3" data-nd="revision.digits" value="${esc(d.revision.digits)}" style="width:44px;padding:3px;"></label>
      <label>Số chữ số bản làm việc <input type="number" min="1" max="3" data-nd="revision.versionDigits" value="${esc(d.revision.versionDigits)}" style="width:44px;padding:3px;"></label></div>`;

    html += `<div style="margin-top:10px;display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
      <button class="cfm-btn primary" data-act="ndsave">💾 Lưu quy ước</button><button class="cfm-btn" data-act="ndback">Huỷ</button>
      <span id="cfmNdMsg" style="color:${S.ndErr ? "#c5221f" : "#188038"};white-space:pre-line;">${esc(S.ndMsg)}</span></div>`;
    return html;
  }
  function updateNdExample() {
    const el = $("cfmNdExample"); if (!el || !S.draft) return;
    try { const p = draftToPayload(S.draft); el.textContent = p.fields.length && p.statuses.length ? nameExample("WIP", p) : "(thêm trường và mã trạng thái để xem tên mẫu)"; } catch (e) { el.textContent = "…"; }
  }
  function onNamingEditorInput(t) {
    if (!S.draft) return;
    setPath(S.draft, t.dataset.nd, t.type === "checkbox" ? t.checked : t.value);
    updateNdExample();
  }
  async function onNamingEditorClick(act, t) {
    const d = S.draft; const i = Number(t.dataset.i);
    if (act === "ndback") { S.view = "files"; S.ndMsg = ""; renderTree(); return renderPane(); }
    if (!d) return;
    if (act === "ndpreset") {
      if (d.fields.length && !confirm("Áp mẫu sẽ thay toàn bộ các trường, mã trạng thái và mã phiên bản hiện có trong form. Tiếp tục?")) return;
      S.draft = draftFromPayload(PRESET_UKNA, { enabled: d.enabled, mode: d.mode }); S.ndMsg = ""; return renderPane();
    }
    if (act === "ndaddf") { d.fields.push({ label: "", charset: "alnum", min: 2, max: 2, codesText: "" }); return renderPane(); }
    if (act === "ndrmf") { d.fields.splice(i, 1); return renderPane(); }
    if (act === "ndupf" && i > 0) { [d.fields[i - 1], d.fields[i]] = [d.fields[i], d.fields[i - 1]]; return renderPane(); }
    if (act === "nddownf" && i < d.fields.length - 1) { [d.fields[i + 1], d.fields[i]] = [d.fields[i], d.fields[i + 1]]; return renderPane(); }
    if (act === "ndaddst") { d.statuses.push({ code: "", label: "", state: "WIP", revision: "P.v", numbered: false }); return renderPane(); }
    if (act === "ndrmst") { d.statuses.splice(i, 1); return renderPane(); }
    if (act === "ndsave") return saveNaming();
  }
  async function saveNaming() {
    const d = S.draft; if (!d) return;
    const payload = draftToPayload(d);
    const err = payload.enabled ? payloadError(payload) : null;
    if (err) { S.ndMsg = "❌ " + err; S.ndErr = true; const el = $("cfmNdMsg"); if (el) { el.textContent = S.ndMsg; el.style.color = "#c5221f"; } return; }
    const row = { project_id: S.projectId, ...payload, updated_by: curUserId(), updated_at: new Date().toISOString() };
    const { data, error } = await client().from("cde_naming").upsert(row, { onConflict: "project_id" }).select("project_id");
    if (error) { S.ndMsg = "❌ Không lưu được: " + error.message; S.ndErr = true; return renderPane(); }
    if (!data || !data.length) { S.ndMsg = "⛔ Không lưu được (chỉ BIM Manager của dự án được đổi quy ước)."; S.ndErr = true; return renderPane(); }
    S.naming = row; S.val = {}; S.draft = draftFromRow(S.naming);
    S.ndMsg = payload.enabled ? `✅ Đã lưu — quy ước đang BẬT (${payload.mode === "block" ? "chặn" : "cảnh báo"}).` : "✅ Đã lưu — quy ước đang TẮT."; S.ndErr = false;
    renderTree(); renderPane(); await loadFiles();
  }

  /* ------------------------- nhật ký thao tác ------------------------- */

  function renderAudit() {
    let html = `<div style="font-weight:700;font-size:13px;margin-bottom:6px;">📜 Nhật ký thao tác CDE <button class="cfm-btn" data-act="auditback" style="margin-left:8px;">← Quay lại</button></div>`;
    if (!S.auditRows) return html + `<div style="color:#888;">⏳ Đang tải…</div>`;
    if (S.auditError) return html + `<div style="color:#c5221f;">${esc(S.auditError)}</div>`;
    if (S.auditNote) html += `<div style="color:#8a4b00;margin-bottom:6px;">⚠️ ${esc(S.auditNote)}</div>`;
    if (!S.auditRows.length) return html + `<div style="color:#999;font-style:italic;">Chưa có thao tác nào được ghi nhận.</div>`;
    html += `<table><thead><tr><th>Thời gian</th><th>Người thực hiện</th><th>Hành động</th><th>Trạng thái › mục</th><th>File</th></tr></thead><tbody>`;
    for (const r of S.auditRows) {
      const label = r.action === "upload" ? "⬆️ Tải lên" : r.action === "move" ? "➡️ Chuyển" : r.action === "rename" ? "✏️ Đổi tên" : "🗑 Xoá";
      const where = r.action === "move" ? `${esc(r.from_status)} › ${esc(r.from_folder_name || "")} → <b>${esc(r.to_status)} › ${esc(r.to_folder_name || "")}</b>` : `${esc(r.status || "")} › ${esc(r.folder_name || "")}`;
      const fileCell = r.action === "rename" ? `${esc(r.old_name || "")} → <b>${esc(r.new_name || "")}</b>`
        : (r.action === "move" && r.new_file_name) ? `${esc(r.file_name || "")} → <b>${esc(r.new_file_name)}</b>` : esc(r.file_name || "");
      html += `<tr><td>${esc(fmtDate(r.created_at))}</td><td>${esc(r.userName || "—")}</td>
        <td>${label}</td><td>${where}</td>
        <td>${fileCell} <span style="color:#999;">${r.size_bytes ? "(" + esc(fmtSize(r.size_bytes)) + ")" : ""}</span>${r.note ? `<div style="color:#555;font-style:italic;">“${esc(r.note)}”</div>` : ""}</td></tr>`;
    }
    return html + `</tbody></table>`;
  }

  /* ------------------------- sự kiện ------------------------- */
  function onInput(e) {
    const t = e.target; if (!t) return;
    const f = selected();
    if (t.classList && t.classList.contains("cfm-nm") && f) {                 // tên file khi tải lên
      S.upl.names[Number(t.dataset.i)] = t.value; refreshNameStatuses();
      scheduleValidate(f.status, [t.value], refreshNameStatuses); return;
    }
    if (t.id === "cfmRenName" && S.ren && f) { S.ren.name = t.value; refreshRenStat(); scheduleValidate(f.status, [t.value], refreshRenStat); return; }
    if (t.classList && t.classList.contains("cfm-mn") && S.move) { onMoveNameInput(t); return; }   // tên sau khi chuyển
    if (t.dataset && t.dataset.nd) onNamingEditorInput(t);                                          // trình cấu hình quy ước
  }

  function onChange(e) {
    const t = e.target;
    if (t && t.id === "cfmFileInput") return onFilesChosen();
    if (t && t.dataset && t.dataset.nd) return onNamingEditorInput(t);
    if (t && t.id === "cfmMoveStatus" && S.move) return onMoveStatusChange(t.value);
    if (t && t.id === "cfmMoveTo" && S.move) {          // đổi trạng thái đích -> nạp lại danh sách mục + nhãn ghi chú, giữ nội dung ghi chú đã gõ
      S.move.note = (($("cfmMoveNote") || {}).value || "");
      S.move.toState = t.value; S.move.targetId = null; S.move.statusCode = null; S.move.names = null;
      renderMoveBox();
    }
  }

  async function onClick(e) {
    const t = e.target.closest ? e.target.closest("[data-act]") : null;
    if (!t) return;
    const act = t.dataset.act;
    try {
      if (act === "toggle") { S.expanded[t.dataset.state] = !S.expanded[t.dataset.state]; return renderTree(); }
      if (act === "select") { S.selectedId = t.dataset.id; S.view = "files"; S.progress = ""; S.ren = null; S.upl.names = []; renderTree(); return loadFiles(); }
      if (act === "config") { S.configMode = !S.configMode; S.addingFor = null; return render(); }
      if (act === "add") { S.addingFor = t.dataset.state; renderTree(); const i = $("cfmNewName"); if (i) i.focus(); return; }
      if (act === "addok") return addCategory(t.dataset.state);
      if (act === "rename") return renameCategory(t.dataset.id);
      if (act === "delfolder") return deleteCategory(t.dataset.id);
      if (act === "savelink") return saveLink(t.dataset.id);
      if (act === "clearlink") return clearLink(t.dataset.id);
      if (act === "defaults") return createDefaults();
      if (act === "audit") return showAudit();
      if (act === "naming") { S.view = "naming"; S.draft = draftFromRow(S.naming); S.ndMsg = ""; renderTree(); return renderPane(); }
      if (act === "nmbump") { const i = Number(t.dataset.i); const f0 = selected(); S.upl.names[i] = bumpName(S.upl.names[i]); const inp = document.querySelector(`#cfmNameBox .cfm-nm[data-i="${i}"]`); if (inp) inp.value = S.upl.names[i]; refreshNameStatuses(); return scheduleValidate(f0.status, [S.upl.names[i]], refreshNameStatuses); }
      if (act === "rnbump") { const f0 = selected(); S.ren.name = bumpName(S.ren.name); const inp = $("cfmRenName"); if (inp) inp.value = S.ren.name; refreshRenStat(); return scheduleValidate(f0.status, [S.ren.name], refreshRenStat); }
      if (act === "mnbump") { const i = Number(t.dataset.i); const m0 = S.move; if (!m0) return; m0.names[i] = bumpName(m0.names[i]); const inp = document.querySelector(`#cfmMoveBox .cfm-mn[data-i="${i}"]`); if (inp) inp.value = m0.names[i]; updateMoveStats(); return scheduleValidate(m0.toState, [m0.names[i]], updateMoveStats); }
      if (act === "rnok") return confirmRename();
      if (act === "rncancel") { S.ren = null; return renderRenameBox(); }
      if (act.startsWith("nd")) return onNamingEditorClick(act, t);
      if (act === "auditback") { S.view = "files"; return renderPane(); }
      if (act === "upload") return uploadSelected();
      if (act === "selall") { const on = t.checked; S.selFiles = new Set(on ? S.files.map((x) => x.id) : []); document.querySelectorAll('#cfmPane [data-act="selfile"]').forEach((c) => { c.checked = on; }); return renderSelBar(); }
      if (act === "selfile") { const fl = S.files[Number(t.dataset.idx)]; if (!fl) return; if (t.checked) S.selFiles.add(fl.id); else S.selFiles.delete(fl.id); return renderSelBar(); }
      if (act === "selnone") { S.selFiles = new Set(); document.querySelectorAll('#cfmPane [data-act="selfile"], #cfmPane [data-act="selall"]').forEach((c) => { c.checked = false; }); return renderSelBar(); }
      if (act === "movesel") return openMoveDialog(S.files.filter((x) => S.selFiles.has(x.id)));
      if (act === "moveok") return confirmMove();
      if (act === "movecancel") { S.move = null; return renderMoveBox(); }
      const file = S.files[Number(t.dataset.idx)];
      if (act === "fmove") return openMoveDialog([file]);
      if (act === "frename") return openRename(file);
      if (act === "fview") return viewFile(file, t);
      if (act === "fdown") return downloadFile(file, t);
      if (act === "fload") return loadIntoViewer(file, t);
      if (act === "fdel") return deleteFile(file);
    } catch (err) { alert(err.message); }
  }

  /* ------------------------- cấu hình (BIM Manager) ------------------------- */
  async function addCategory(status) {
    const name = ($("cfmNewName") && $("cfmNewName").value || "").trim();
    if (!name) return alert("Nhập tên mục con.");
    if (S.folders.some((f) => f.status === status && f.name.toLowerCase() === name.toLowerCase())) return alert(`Đã có mục "${name}" trong ${status}.`);
    const order = S.folders.filter((f) => f.status === status).length;
    const { error } = await client().from("cde_folders").insert({ project_id: S.projectId, status, name, sort_order: order, created_by: curUserId() });
    if (error) return alert("Không thêm được: " + error.message);
    S.addingFor = null; await loadFolders(); render();
  }
  async function renameCategory(id) {
    const f = S.folders.find((x) => x.id === id); if (!f) return;
    const name = (prompt(`Đổi tên mục "${f.name}" thành:`, f.name) || "").trim();
    if (!name || name === f.name) return;
    const { data, error } = await client().from("cde_folders").update({ name }).eq("id", id).select("id");
    if (error) return alert("Không đổi được tên: " + (/duplicate|unique/i.test(error.message) ? "đã có mục trùng tên trong trạng thái này" : error.message));
    if (!data || !data.length) return alert("⛔ Không cập nhật được (chỉ BIM Manager của dự án được sửa).");
    await loadFolders(); render();
  }
  async function deleteCategory(id) {
    const f = S.folders.find((x) => x.id === id); if (!f) return;
    if (!confirm(`Xoá mục "${f.name}" (${f.status}) khỏi cây thư mục?\n\nChỉ xoá cấu hình trong ứng dụng — file và thư mục trên Google Drive KHÔNG bị xoá. Nhật ký thao tác cũ vẫn được giữ.`)) return;
    const { data, error } = await client().from("cde_folders").delete().eq("id", id).select("id");
    if (error) return alert("Không xoá được: " + error.message);
    if (!data || !data.length) return alert("⛔ Không xoá được (chỉ BIM Manager của dự án được xoá).");
    if (S.selectedId === id) S.selectedId = null;
    await loadFolders();
    if (!S.selectedId) { const p = S.folders.find((x) => can(x.status, "view")); S.selectedId = p ? p.id : null; }
    render(); await loadFiles();
  }
  async function clearLink(id) {
    const f = S.folders.find((x) => x.id === id); if (!f) return;
    if (!confirm(`Gỡ link thư mục Drive khỏi mục "${f.name}"? Thành viên sẽ không xem/tải file ở mục này nữa cho tới khi gắn lại.`)) return;
    const { data, error } = await client().from("cde_folders").update({ drive_url: null }).eq("id", id).select("id");
    if (error) return alert("Lỗi: " + error.message);
    if (!data || !data.length) return alert("⛔ Không cập nhật được (chỉ BIM Manager của dự án được đổi link).");
    await loadFolders(); render(); await loadFiles();
  }
  async function saveLink(id) {
    const f = S.folders.find((x) => x.id === id); if (!f) return;
    const url = ($("cfmLinkInput").value || "").trim();
    if (!/folders\/[a-zA-Z0-9_-]+/.test(url)) return alert("Link phải có dạng https://drive.google.com/drive/folders/<mã thư mục>");
    const btn = document.querySelector('[data-act="savelink"]'); if (btn) { btn.disabled = true; btn.textContent = "⏳ Đang kiểm tra…"; }
    try {
      const chk = await call({ action: "cde_check_folder", driveUrl: url });
      if (!chk.canWrite && !confirm(`Thư mục "${chk.name}" hợp lệ nhưng tài khoản Google đã kết nối CHỈ có quyền xem — thành viên sẽ KHÔNG tải lên được.\n\nVẫn lưu link?`)) return;
      const { data, error } = await client().from("cde_folders").update({ drive_url: url }).eq("id", id).select("id");
      if (error) return alert(/duplicate|unique/i.test(error.message) ? "Thư mục Drive này đã được gắn cho một mục khác của dự án. Mỗi thư mục chỉ gắn cho 1 mục (để file không hiện ở 2 trạng thái)." : "Không lưu được: " + error.message);
      if (!data || !data.length) return alert("⛔ Không cập nhật được (chỉ BIM Manager của dự án được đổi link).");
      toast(`✅ Đã gắn thư mục "${chk.name}" cho ${f.status} › ${f.name}`);
      await loadFolders(); render(); await loadFiles();
    } catch (e) { alert(e.message); }
    finally { if (btn) { btn.disabled = false; btn.textContent = "Kiểm tra & lưu"; } }
  }
  async function createDefaults() {
    const rows = [];
    for (const st of STATES) {
      if (S.folders.some((f) => f.status === st)) continue;            // chỉ tạo cho trạng thái còn trống
      DEFAULT_CATEGORIES.forEach((name, i) => rows.push({ project_id: S.projectId, status: st, name, sort_order: i, created_by: curUserId() }));
    }
    if (!rows.length) return alert("Các trạng thái đều đã có mục con, không cần tạo mặc định.");
    if (!confirm(`Tạo ${rows.length} mục con mặc định (${DEFAULT_CATEGORIES.join(", ")}) cho các trạng thái còn trống?\nSau đó gắn link Drive cho từng mục.`)) return;
    const { error } = await client().from("cde_folders").insert(rows);
    if (error) return alert("Không tạo được: " + error.message);
    await loadFolders(); render();
  }

  async function showAudit() {
    S.view = "audit"; S.auditRows = null; S.auditError = ""; renderPane();
    const { data, error } = await client().from("cde_audit").select("*").eq("project_id", S.projectId).order("created_at", { ascending: false }).limit(100);
    if (error) { S.auditError = "Không đọc được nhật ký: " + error.message; S.auditRows = []; return renderPane(); }
    // Lịch sử chuyển trạng thái nằm ở bảng riêng; thiếu bảng (chưa chạy migration) thì vẫn xem được phần còn lại
    S.auditNote = "";
    let moves = [];
    const tq = await client().from("cde_transitions").select("*").eq("project_id", S.projectId).order("created_at", { ascending: false }).limit(100);
    if (tq.error) S.auditNote = "Chưa xem được lịch sử chuyển trạng thái (đã chạy migration_cde_transitions.sql chưa?): " + tq.error.message;
    else moves = (tq.data || []).map((r) => ({ ...r, action: "move" }));
    let renames = [];
    const rq = await client().from("cde_renames").select("*").eq("project_id", S.projectId).order("created_at", { ascending: false }).limit(100);
    if (rq.error) S.auditNote += (S.auditNote ? " " : "") + "Chưa xem được lịch sử đổi tên (đã chạy migration_cde_naming.sql chưa?): " + rq.error.message;
    else renames = (rq.data || []).map((r) => ({ ...r, action: "rename" }));
    const merged = (data || []).concat(moves, renames).sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, 150);
    const ids = [...new Set(merged.map((r) => r.user_id).filter(Boolean))];
    let names = {};
    if (ids.length) {
      const { data: profs } = await client().from("profiles").select("id, full_name").in("id", ids);
      (profs || []).forEach((p) => { names[p.id] = p.full_name; });
    }
    S.auditRows = merged.map((r) => ({ ...r, userName: names[r.user_id] || null }));
    renderPane();
  }

  /* ------------------------- tải lên ------------------------- */
  function setProgress(msg, isErr) {
    S.progress = msg; S.progressErr = !!isErr;
    const p = $("cfmProgress"); if (p) { p.textContent = msg; p.style.color = isErr ? "#c5221f" : "#1a73e8"; }
  }

  async function uploadOne(folder, file, label, nameOverride) {
    const init = await call({ action: "cde_upload_init", folderId: folder.id, fileName: nameOverride || file.name, mimeType: file.type || "", size: file.size });
    let offset = 0, failures = 0, stalls = 0, result = null;
    while (offset < file.size) {
      const end = Math.min(offset + CHUNK, file.size);
      try {
        const j = await binary("cde_upload_chunk", folder.id,
          { sessionUri: init.sessionUri, start: String(offset), total: String(file.size) }, file.slice(offset, end));
        if (j.done) { result = j; break; }
        stalls = (j.received <= offset) ? stalls + 1 : 0;
        if (stalls >= 3) throw new Error("Drive không nhận thêm dữ liệu, hãy thử tải lên lại.");
        offset = j.received; failures = 0;
      } catch (e) {
        // Lỗi quyền/đầu vào là cố định -> dừng ngay; chỉ thử lại khi lỗi mạng/tạm thời
        if (/không được|Phiên upload đã hết hạn|không hợp lệ|BẢN CŨ/.test(e.message) || ++failures > 3) throw e;
        await sleep(700 * failures);
        const st = await binary("cde_upload_status", folder.id, { sessionUri: init.sessionUri, total: String(file.size) });
        if (st.done) { result = st; break; }
        offset = st.received;
      }
      setProgress(`${label} — ${Math.min(100, Math.round(offset / file.size * 100))}%`);
    }
    if (!result || !result.file) throw new Error("Upload không hoàn tất.");
    result.namingWarnings = init.namingWarnings || [];
    return result;
  }

  async function uploadSelected() {
    if (S.uploading) return;
    const f = selected(); const input = $("cfmFileInput");
    const files = input && input.files ? Array.from(input.files) : [];
    if (!f) return;
    if (!files.length) return alert("Chọn file cần tải lên trước.");
    if (!can(f.status, "upload")) return alert(`Vai trò của bạn không được tải lên ở trạng thái ${f.status}.`);
    if (!hasLink(f)) return alert("Mục này chưa được gắn link thư mục Drive.");
    // Quy ước đặt tên (nếu dự án đã bật): kiểm tra lại tên lần cuối; chế độ chặn thì dừng, chế độ cảnh báo thì hỏi
    let names = files.map((x) => x.name);
    if (namingOn()) names = files.map((x, i) => String(S.upl.names[i] || x.name).trim());
    const dups = names.filter((n) => S.files.some((e) => e.name === n));
    // Bật quy ước: máy chủ luôn từ chối trùng tên → báo thẳng (và báo TRƯỚC câu hỏi về tên sai quy ước), không hỏi "vẫn tải lên?" rồi bị từ chối
    if (namingOn() && dups.length) return alert(`Đã có file cùng tên trong mục này:\n${dups.map((d) => "• " + d).join("\n")}\n\nQuy ước đặt tên không cho trùng tên — hãy tăng mã phiên bản (nút ⬆ Phiên bản) hoặc đổi số thứ tự.`);
    if (namingOn()) {
      try { await validateNow(f.status, names); } catch (e) { return alert("Không kiểm tra được tên file: " + e.message); }
      const bad = names.map((n) => ({ n, r: S.val[valKey(f.status, n)] })).filter((x) => x.r && !x.r.ok);
      refreshNameStatuses();
      if (bad.length && S.naming.mode === "block") return alert("Có tên file chưa đúng quy ước, hãy sửa trước khi tải lên:\n" + bad.map((x) => "• " + x.n + ": " + x.r.problems[0]).join("\n"));
      if (bad.length && !confirm("Có tên file chưa đúng quy ước (chế độ cảnh báo):\n" + bad.map((x) => "• " + x.n + ": " + x.r.problems[0]).join("\n") + "\n\nVẫn tải lên?")) return;
    }
    if (dups.length && !confirm(`Đã có file cùng tên trong mục này:\n${dups.map((d) => "• " + d).join("\n")}\n\nVẫn tải lên (sẽ có 2 file trùng tên)?`)) return;

    S.uploading = true; setProgress("⏳ Đang chuẩn bị…");
    const btn = $("cfmUploadBtn"); if (btn) btn.disabled = true;
    const done = [], warnings = [], nwarn = [];
    try {
      for (let i = 0; i < files.length; i++) {
        const res = await uploadOne(f, files[i], `⏳ (${i + 1}/${files.length}) ${names[i]}`, names[i]);
        done.push(names[i]);
        if (res.auditWarning) warnings.push(res.auditWarning);
        (res.namingWarnings || []).forEach((w) => nwarn.push(`${names[i]}: ${w}`));
      }
      setProgress(`✅ Đã tải lên ${done.length} file vào ${f.status} › ${f.name}` + (nwarn.length ? `\n⚠️ Chưa đúng quy ước — ${nwarn[0]}` : "") + (warnings.length ? `\n⚠️ ${warnings[0]}` : ""));
      if (input) input.value = "";
      S.upl.names = []; renderNameBox();
    } catch (e) {
      setProgress(`❌ ${e.message}` + (done.length ? `\n(đã tải xong: ${done.join(", ")})` : ""), true);
    } finally {
      S.uploading = false;
      const b2 = $("cfmUploadBtn"); if (b2) b2.disabled = false;
    }
    const keep = S.progress, keepErr = S.progressErr;
    await loadFiles();
    setProgress(keep, keepErr);
  }

  /* ------------------------- thao tác trên file ------------------------- */
  async function withBusy(btn, label, fn) {
    const old = btn ? btn.textContent : "";
    if (btn) { btn.disabled = true; btn.textContent = label; }
    try { return await fn(); }
    finally { if (btn) { btn.disabled = false; btn.textContent = old; } }
  }
  async function viewFile(file, btn) {
    await withBusy(btn, "⏳", async () => {
      const blob = await fetchBlob(selected(), file);
      if (typeof renderPreviewBlob === "function") await renderPreviewBlob(file.name, blob);
      else window.open(URL.createObjectURL(blob), "_blank");
    });
  }
  async function downloadFile(file, btn) {
    await withBusy(btn, "⏳", async () => {
      const blob = await fetchBlob(selected(), file);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = file.name; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    });
  }
  async function loadIntoViewer(file, btn) {
    await withBusy(btn, "⏳", async () => {
      const blob = await fetchBlob(selected(), file);
      const ext = extOf(file.name);
      const input = $(ext === "ifc" ? "ifcModelFileInput" : "modelFileInput");
      if (!input) return alert("Không tìm thấy ô nạp file phù hợp cho ." + ext);
      const dt = new DataTransfer(); dt.items.add(new File([blob], file.name));
      input.files = dt.files; input.dispatchEvent(new Event("change"));
      $("cfmPanel").style.display = "none";
    });
  }
  async function deleteFile(file) {
    const f = selected();
    if (!confirm(`Xoá file "${file.name}" khỏi ${f.status} › ${f.name}?\n(File được chuyển vào thùng rác Google Drive — khôi phục được; thao tác được ghi vào nhật ký.)`)) return;
    try {
      await call({ action: "cde_delete", folderId: f.id, fileId: file.id });
      await loadFiles();
    } catch (e) { alert("Lỗi xoá file: " + e.message); }
  }

  /* ------------------------- điểm vào ------------------------- */
  window.toggleCdeFilesManager = function (forceOpen) {
    ensurePanel();
    const p = $("cfmPanel");
    const open = forceOpen === true ? true : p.style.display !== "block";
    p.style.display = open ? "block" : "none";
    if (open) { S.configMode = false; S.addingFor = null; refresh(); }   // mở lại luôn ở chế độ xem (tránh sửa cấu hình nhầm)
  };

  // Tự nhận biết khi người dùng đổi dự án / vai trò ở panel CDE lúc trình quản lý đang mở
  setInterval(() => {
    const p = $("cfmPanel");
    if (!p || p.style.display !== "block") return;
    if (curProject() !== S.projectId || curRole() !== S.role) refresh();
  }, 800);

  function init() { ensurePanel(); injectEntryButton(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();

  window.CdeFiles = { state: S, refresh, esc };   // phục vụ kiểm thử
})();
