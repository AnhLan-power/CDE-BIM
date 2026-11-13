/* =====================================================================
   CDE FILES — Quản lý file CDE theo cây thư mục (ISO 19650 / TCVN 14177)
   Trạng thái (WIP · Shared · Published · Archived)
     └─ Mục con (Tệp tin, Pháp lý, Mô hình, …) ──► 1 thư mục Google Drive do BIM Manager gắn

   - Quyền xem/tải lên/xoá theo (vai trò × trạng thái) do Edge Function drive-proxy QUYẾT ĐỊNH
     (action cde_permissions); giao diện chỉ phản ánh lại để ẩn/hiện nút.
   - Cây thư mục lưu ở bảng cde_folders; nhật ký thao tác ở cde_audit (xem migration_cde_folders.sql);
     lịch sử chuyển trạng thái ở cde_transitions (xem migration_cde_transitions.sql).
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
    S.view = "files"; S.auditRows = null;
    if (!pid) { S.projectId = null; S.folders = []; S.selectedId = null; S.files = []; S.banner = "Chọn dự án trong panel 📁 CDE trước."; render(); return; }
    S.projectId = pid;
    S.banner = "";
    render();                                   // hiện khung trống ngay, tải xong sẽ vẽ lại
    await Promise.all([loadRules(), loadFolders()]);
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
        <button class="cfm-btn" data-act="audit">📜 Nhật ký</button>
      </div>`;
    }
    el.innerHTML = html;
  }

  function renderPane() {
    const el = $("cfmPane");
    if (!el) return;
    if (S.view === "audit") { el.innerHTML = renderAudit(); return; }
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

    if (canUp) {
      html += `<div style="border:1px dashed #b6c6e3;border-radius:6px;padding:8px;margin-bottom:8px;">
        <div style="display:flex;gap:6px;align-items:center;">
          <input type="file" id="cfmFileInput" multiple style="flex:1;min-width:0;font-size:11px;">
          <button class="cfm-btn primary" data-act="upload" id="cfmUploadBtn" ${S.uploading ? "disabled" : ""}>⬆️ Tải lên</button>
        </div>
        <div id="cfmProgress" style="margin-top:5px;color:${S.progressErr ? "#c5221f" : "#1a73e8"};white-space:pre-line;">${esc(S.progress)}</div>
      </div>`;
    } else {
      html += `<div style="color:#888;margin-bottom:6px;">Vai trò ${esc(ROLE_LABEL[S.role] || S.role)} chỉ được xem/tải về ở trạng thái ${f.status}.</div>`;
    }

    const trs = myTransitions(f.status);
    if (trs.length) {
      html += `<div style="color:#555;margin-bottom:6px;">➡️ Bạn có thể chuyển file từ <b>${f.status}</b> sang: ${trs.map((t) => `<b>${t.to}</b> <span style="color:#888;">(${esc(t.label)})</span>`).join(" · ")}</div>`;
    }
    html += `<div id="cfmMoveBox"></div><div id="cfmSelBar"></div>`;

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
        html += `<tr>${canMove ? `<td><input type="checkbox" data-act="selfile" data-idx="${i}" ${S.selFiles.has(file.id) ? "checked" : ""}></td>` : ""}<td><span>${iconFor(file.name)}</span> <span title="${esc(file.name)}">${esc(file.name)}</span></td>
          <td>${esc(fmtSize(file.size))}</td><td>${esc(fmtDate(file.modifiedTime))}</td>
          <td>${file.uploadedByName ? esc(file.uploadedByName) : `<span style="color:#aaa;">—</span>`}</td>
          <td style="white-space:nowrap;">
            ${canMove ? b("fmove", "➡️", "Chuyển trạng thái") : ""}${PREVIEWABLE.includes(e) ? b("fview", "👁", "Xem trước") : ""}${b("fdown", "⬇️", "Tải về")}
            ${LOADABLE.includes(e) ? b("fload", "🧊", "Nạp vào mô hình 3D") : ""}${mayDelete ? b("fdel", "🗑", "Xoá (chuyển vào thùng rác Drive)", "danger") : ""}
          </td></tr>`;
      });
      html += `</tbody></table>`;
    }
    el.innerHTML = html;
    renderSelBar(); renderMoveBox();
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
    S.move = { files, from: f, toState: (opts.find((t) => linkedFolders(t.to).length) || opts[0]).to, note: "", busy: false, result: null };
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
    html += `<label>Ghi chú ${tr && tr.noteRequired ? `<b style="color:#c5221f;">(bắt buộc — lý do trả về)</b>` : "(tuỳ chọn)"}</label>
      <textarea id="cfmMoveNote" rows="2" maxlength="500" placeholder="${tr && tr.noteRequired ? "VD: Sai cao độ tầng 2, cần sửa lại" : "VD: Đã kiểm tra nội bộ, đủ điều kiện chia sẻ"}" ${m.busy ? "disabled" : ""}>${esc(m.note)}</textarea>
      <div id="cfmMoveProg" style="color:#1a73e8;margin-bottom:6px;white-space:pre-line;">${esc(m.progress || "")}</div>
      <button class="cfm-btn primary" data-act="moveok" ${m.busy || !list.length ? "disabled" : ""}>Xác nhận chuyển</button>
      <button class="cfm-btn" data-act="movecancel" ${m.busy ? "disabled" : ""}>Huỷ</button></div>`;
    el.innerHTML = html;
  }

  // Lỗi mang tính cố định (sai quyền/luồng/cấu hình): lặp lại cho các file còn lại là vô ích -> dừng
  const FATAL_MOVE = /không được chuyển|Không có luồng|Cần ghi lý do|BẢN CŨ|quyền ĐỌC|chưa được BIM Manager gắn link|cùng một thư mục|không tồn tại trong dự án|Phiên đăng nhập/;

  async function confirmMove() {
    const m = S.move; if (!m || m.busy) return;
    const toState = ($("cfmMoveTo") || {}).value || m.toState;
    const toFolderId = ($("cfmMoveFolder") || {}).value;
    const note = (($("cfmMoveNote") || {}).value || "").trim();
    const tr = myTransitions(m.from.status).find((t) => t.to === toState);
    if (!tr) return alert("Luồng chuyển này không có trong quyền của bạn.");
    if (!toFolderId) return alert("Chọn mục đích.");
    if (tr.noteRequired && !note) return alert(`Cần ghi lý do khi chuyển file từ ${tr.from} về ${tr.to}.`);
    const target = S.folders.find((x) => x.id === toFolderId);
    const label = `${toState} › ${target ? target.name : ""}`;
    if (!confirm(`Chuyển ${m.files.length} file từ ${m.from.status} › ${m.from.name} sang ${label}?\n\nThao tác được ghi vào lịch sử. File giữ nguyên nội dung, chỉ đổi thư mục trên Drive.`)) return;

    m.busy = true; m.toState = toState; m.targetId = toFolderId; m.note = note; renderMoveBox();
    const okNames = [], failed = [], warnings = [];
    let stopped = null;
    for (let i = 0; i < m.files.length; i++) {
      const file = m.files[i];
      m.progress = `⏳ (${i + 1}/${m.files.length}) ${file.name}`;
      const pr = $("cfmMoveProg"); if (pr) pr.textContent = m.progress;
      try {
        const res = await call({ action: "cde_move", folderId: m.from.id, fileId: file.id, toFolderId, note });
        okNames.push(file.name);
        if (res.auditWarning) warnings.push(res.auditWarning);
      } catch (e) {
        failed.push(`• ${file.name}: ${e.message}`);
        if (FATAL_MOVE.test(e.message)) { stopped = e.message; break; }
      }
    }
    const left = m.files.length - okNames.length - failed.length;
    let text = okNames.length ? `✅ Đã chuyển ${okNames.length}/${m.files.length} file sang ${label}.` : `❌ Không chuyển được file nào.`;
    if (failed.length) text += `\n${failed.join("\n")}`;
    if (left > 0) text += `\n(Đã dừng — ${left} file còn lại chưa được chuyển.)`;
    if (warnings.length) text += `\n⚠️ ${warnings[0]}`;
    m.busy = false; m.result = { text, fail: !okNames.length || !!failed.length };
    S.selFiles = new Set();
    renderMoveBox();
    if (okNames.length) { const keep = m; await loadFiles(); S.move = keep; renderMoveBox(); }   // làm mới danh sách nhưng giữ hộp kết quả
  }

  function renderAudit() {
    let html = `<div style="font-weight:700;font-size:13px;margin-bottom:6px;">📜 Nhật ký thao tác CDE <button class="cfm-btn" data-act="auditback" style="margin-left:8px;">← Quay lại</button></div>`;
    if (!S.auditRows) return html + `<div style="color:#888;">⏳ Đang tải…</div>`;
    if (S.auditError) return html + `<div style="color:#c5221f;">${esc(S.auditError)}</div>`;
    if (S.auditNote) html += `<div style="color:#8a4b00;margin-bottom:6px;">⚠️ ${esc(S.auditNote)}</div>`;
    if (!S.auditRows.length) return html + `<div style="color:#999;font-style:italic;">Chưa có thao tác nào được ghi nhận.</div>`;
    html += `<table><thead><tr><th>Thời gian</th><th>Người thực hiện</th><th>Hành động</th><th>Trạng thái › mục</th><th>File</th></tr></thead><tbody>`;
    for (const r of S.auditRows) {
      const label = r.action === "upload" ? "⬆️ Tải lên" : r.action === "move" ? "➡️ Chuyển" : "🗑 Xoá";
      const where = r.action === "move" ? `${esc(r.from_status)} › ${esc(r.from_folder_name || "")} → <b>${esc(r.to_status)} › ${esc(r.to_folder_name || "")}</b>` : `${esc(r.status || "")} › ${esc(r.folder_name || "")}`;
      html += `<tr><td>${esc(fmtDate(r.created_at))}</td><td>${esc(r.userName || "—")}</td>
        <td>${label}</td><td>${where}</td>
        <td title="${esc(r.file_name || "")}">${esc(r.file_name || "")} <span style="color:#999;">${r.size_bytes ? "(" + esc(fmtSize(r.size_bytes)) + ")" : ""}</span>${r.note ? `<div style="color:#555;font-style:italic;">“${esc(r.note)}”</div>` : ""}</td></tr>`;
    }
    return html + `</tbody></table>`;
  }

  /* ------------------------- sự kiện ------------------------- */
  function onChange(e) {
    const t = e.target;
    if (t && t.id === "cfmMoveTo" && S.move) {          // đổi trạng thái đích -> nạp lại danh sách mục + nhãn ghi chú, giữ nội dung ghi chú đã gõ
      S.move.note = (($("cfmMoveNote") || {}).value || "");
      S.move.toState = t.value; S.move.targetId = null;
      renderMoveBox();
    }
  }

  async function onClick(e) {
    const t = e.target.closest ? e.target.closest("[data-act]") : null;
    if (!t) return;
    const act = t.dataset.act;
    try {
      if (act === "toggle") { S.expanded[t.dataset.state] = !S.expanded[t.dataset.state]; return renderTree(); }
      if (act === "select") { S.selectedId = t.dataset.id; S.view = "files"; S.progress = ""; renderTree(); return loadFiles(); }
      if (act === "config") { S.configMode = !S.configMode; S.addingFor = null; return render(); }
      if (act === "add") { S.addingFor = t.dataset.state; renderTree(); const i = $("cfmNewName"); if (i) i.focus(); return; }
      if (act === "addok") return addCategory(t.dataset.state);
      if (act === "rename") return renameCategory(t.dataset.id);
      if (act === "delfolder") return deleteCategory(t.dataset.id);
      if (act === "savelink") return saveLink(t.dataset.id);
      if (act === "clearlink") return clearLink(t.dataset.id);
      if (act === "defaults") return createDefaults();
      if (act === "audit") return showAudit();
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
    const merged = (data || []).concat(moves).sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, 150);
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

  async function uploadOne(folder, file, label) {
    const init = await call({ action: "cde_upload_init", folderId: folder.id, fileName: file.name, mimeType: file.type || "", size: file.size });
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
    const dups = files.filter((x) => S.files.some((e) => e.name === x.name));
    if (dups.length && !confirm(`Đã có file cùng tên trong mục này:\n${dups.map((d) => "• " + d.name).join("\n")}\n\nVẫn tải lên (sẽ có 2 file trùng tên)?`)) return;

    S.uploading = true; setProgress("⏳ Đang chuẩn bị…");
    const btn = $("cfmUploadBtn"); if (btn) btn.disabled = true;
    const done = [], warnings = [];
    try {
      for (let i = 0; i < files.length; i++) {
        const res = await uploadOne(f, files[i], `⏳ (${i + 1}/${files.length}) ${files[i].name}`);
        done.push(files[i].name);
        if (res.auditWarning) warnings.push(res.auditWarning);
      }
      setProgress(`✅ Đã tải lên ${done.length} file vào ${f.status} › ${f.name}` + (warnings.length ? `\n⚠️ ${warnings[0]}` : ""));
      if (input) input.value = "";
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
