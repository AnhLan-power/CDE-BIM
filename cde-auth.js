/* =====================================================================
   CDE AUTH + FILE MANAGER MODULE
   Yêu cầu: đã include <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
   và file cde-auth.css TRƯỚC file này trong index.html.
   ===================================================================== */

// !!! ĐIỀN THÔNG TIN DỰ ÁN SUPABASE CỦA CẬU VÀO ĐÂY !!!
const SUPABASE_URL = "https://znzakqzdezxzqzfplmgv.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpuemFrcXpkZXp4enF6ZnBsbWd2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc4MTQyNzAsImV4cCI6MjEwMzM5MDI3MH0.aV5YaOLxTySiB26ror4CRzJvQsjANNI1DwbtbxcNe4A";

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const ROLE_LABELS = {
  bim_manager: "BIM Manager",
  task_team_manager: "Task Team Manager",
  author: "Author",
  approver: "Approver",
  viewer: "Viewer"
};

const STATUS_LABELS = { WIP: "WIP", SHARED: "Shared", PUBLISHED: "Published", ARCHIVED: "Archived" };

let currentUser = null;
let currentProfile = null;
let currentProjects = [];   // [{project_id, name, role}]
let activeProjectId = null;
let activeRole = null;
let activeStatusTab = "WIP";

/* ---------------------------------------------------------------------
   1. DỰNG GIAO DIỆN (chèn vào DOM khi file này chạy)
   --------------------------------------------------------------------- */
function injectCdeUI() {
  const overlay = document.createElement("div");
  overlay.id = "cdeAuthOverlay";
  overlay.innerHTML = `
    <div id="cdeAuthBox">
      <h2>Đăng nhập CDE BIM</h2>
      <p class="sub">Common Data Environment · ISO 19650</p>
      <input type="text" id="cdeFullName" placeholder="Họ tên" style="display:none">
      <input type="email" id="cdeEmail" placeholder="Email">
      <input type="password" id="cdePassword" placeholder="Mật khẩu">
      <button class="btn-full" id="cdeSubmitBtn">Đăng nhập</button>
      <div class="cde-error" id="cdeAuthError"></div>
      <div class="switch-mode" id="cdeSwitchMode">Chưa có tài khoản? Đăng ký</div>
    </div>`;
  document.body.appendChild(overlay);

  const badge = document.createElement("div");
  badge.id = "cdeUserBadge";
  badge.style.display = "none";
  badge.innerHTML = `<span id="cdeUserName">—</span><span class="role-chip" id="cdeRoleChip">—</span>`;
  document.body.appendChild(badge);

  const panel = document.createElement("div");
  panel.className = "panel";
  panel.id = "cdeFilesPanel";
  panel.innerHTML = `
    <div class="panel-header">
      <b>📁 Quản Lý File CDE</b>
      <span style="cursor:pointer" onclick="document.getElementById('cdeFilesPanel').style.display='none'">✕</span>
    </div>
    <div style="margin:8px 0;">
      <select id="cdeProjectSelect"></select>
    </div>
    <div class="cde-status-tabs" id="cdeStatusTabs"></div>
    <div id="cdeFilesList"></div>
    <div id="cdeMembersBox" style="display:none;"></div>`;
  document.body.appendChild(panel);

  let isSignup = false;
  document.getElementById("cdeSwitchMode").addEventListener("click", () => {
    isSignup = !isSignup;
    document.getElementById("cdeFullName").style.display = isSignup ? "block" : "none";
    document.getElementById("cdeSubmitBtn").innerText = isSignup ? "Đăng ký" : "Đăng nhập";
    document.getElementById("cdeSwitchMode").innerText = isSignup ? "Đã có tài khoản? Đăng nhập" : "Chưa có tài khoản? Đăng ký";
    document.getElementById("cdeAuthError").innerText = "";
  });

  document.getElementById("cdeSubmitBtn").addEventListener("click", async () => {
    const email = document.getElementById("cdeEmail").value.trim();
    const password = document.getElementById("cdePassword").value;
    const errBox = document.getElementById("cdeAuthError");
    errBox.innerText = "";
    if (!email || !password) { errBox.innerText = "Nhập đầy đủ email và mật khẩu."; return; }

    try {
      if (isSignup) {
        const fullName = document.getElementById("cdeFullName").value.trim() || email;
        const { error } = await sb.auth.signUp({
          email, password,
          options: {
            data: { full_name: fullName },
            emailRedirectTo: window.location.origin + window.location.pathname
          }
        });
        if (error) throw error;
        errBox.style.color = "#5cb85c";
        errBox.innerText = "Đăng ký thành công! Kiểm tra email để xác nhận, sau đó đăng nhập.";
      } else {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (e) {
      errBox.style.color = "#d9534f";
      errBox.innerText = e.message || "Có lỗi xảy ra.";
    }
  });

  badge.addEventListener("click", async () => {
    if (confirm("Đăng xuất?")) { await sb.auth.signOut(); }
  });
}

/* ---------------------------------------------------------------------
   2. QUẢN LÝ PHIÊN ĐĂNG NHẬP
   --------------------------------------------------------------------- */
sb.auth.onAuthStateChange(async (event, session) => {
  if (session && session.user) {
    currentUser = session.user;
    await loadProfileAndProjects();
    document.getElementById("cdeAuthOverlay").classList.add("hidden");
    document.getElementById("cdeUserBadge").style.display = "flex";
  } else {
    currentUser = null;
    document.getElementById("cdeAuthOverlay").classList.remove("hidden");
    document.getElementById("cdeUserBadge").style.display = "none";
    document.getElementById("cdeFilesPanel").style.display = "none";
  }
});

async function loadProfileAndProjects() {
  const { data: profile } = await sb.from("profiles").select("*").eq("id", currentUser.id).single();
  currentProfile = profile;
  document.getElementById("cdeUserName").innerText = profile?.full_name || currentUser.email;

  const { data: memberships } = await sb
    .from("project_members")
    .select("project_id, role, projects(name)")
    .eq("user_id", currentUser.id);

  currentProjects = (memberships || []).map(m => ({
    project_id: m.project_id, role: m.role, name: m.projects?.name || "(dự án)"
  }));

  const sel = document.getElementById("cdeProjectSelect");
  sel.innerHTML = "";
  if (currentProjects.length === 0) {
    sel.innerHTML = `<option>-- Chưa thuộc dự án nào --</option>`;
    const optNew = document.createElement("option");
    optNew.value = "__new__";
    optNew.innerText = "➕ Tạo dự án mới (bạn sẽ là BIM Manager)";
    sel.appendChild(optNew);
  } else {
    currentProjects.forEach(p => {
      const opt = document.createElement("option");
      opt.value = p.project_id;
      opt.innerText = `${p.name} (${ROLE_LABELS[p.role]})`;
      sel.appendChild(opt);
    });
    const optNew = document.createElement("option");
    optNew.value = "__new__";
    optNew.innerText = "➕ Tạo dự án mới";
    sel.appendChild(optNew);
    activeProjectId = currentProjects[0].project_id;
    activeRole = currentProjects[0].role;
  }

  sel.addEventListener("change", onProjectChange);
  document.getElementById("cdeRoleChip").innerText = activeRole ? ROLE_LABELS[activeRole] : "—";
  if (activeProjectId) renderStatusTabs();
}

async function onProjectChange(e) {
  const val = e.target.value;
  if (val === "__new__") {
    const name = prompt("Tên dự án mới:");
    if (!name) { e.target.value = activeProjectId || ""; return; }
    const code = prompt("Mã dự án (vd: PRJ-001):", "PRJ-" + Date.now().toString().slice(-4));
    const { data, error } = await sb.rpc("create_project_as_manager", { p_name: name, p_code: code });
    if (error) { alert(error.message); return; }
    await loadProfileAndProjects();
    activeProjectId = data;
    activeRole = "bim_manager";
    document.getElementById("cdeProjectSelect").value = data;
  } else {
    activeProjectId = val;
    activeRole = currentProjects.find(p => p.project_id === val)?.role;
  }
  document.getElementById("cdeRoleChip").innerText = ROLE_LABELS[activeRole] || "—";
  renderStatusTabs();
}

/* ---------------------------------------------------------------------
   3. TAB TRẠNG THÁI CDE (WIP / Shared / Published / Archived)
   --------------------------------------------------------------------- */
function renderStatusTabs() {
  const tabsEl = document.getElementById("cdeStatusTabs");
  tabsEl.innerHTML = "";
  Object.keys(STATUS_LABELS).forEach(st => {
    const tab = document.createElement("div");
    tab.className = "cde-status-tab" + (st === activeStatusTab ? " active" : "");
    tab.dataset.status = st;
    tab.innerText = STATUS_LABELS[st];
    tab.addEventListener("click", () => { activeStatusTab = st; renderStatusTabs(); });
    tabsEl.appendChild(tab);
  });
  renderMembersButton();
  loadActiveProjectDriveLinks();
}

/* ---------------------------------------------------------------------
   3b. LIÊN KẾT THƯ MỤC GOOGLE DRIVE THEO TỪNG TRẠNG THÁI (Cách A)
   Mỗi dự án có 4 link thư mục Drive tương ứng WIP/Shared/Published/Archived.
   Chỉ BIM Manager được đặt/sửa link — thành viên khác chỉ mở link để thao
   tác trực tiếp trên giao diện Google Drive quen thuộc. Việc phân quyền ai
   được xem/sửa file TRONG Drive nằm ở phần chia sẻ (Share) của chính thư
   mục đó trên Google Drive — BIM Manager cần tự cấu hình đúng ở Drive.
   --------------------------------------------------------------------- */
const STATUS_COLUMN = {
  WIP: "drive_wip_url",
  SHARED: "drive_shared_url",
  PUBLISHED: "drive_published_url",
  ARCHIVED: "drive_archived_url"
};

let activeProjectDriveLinks = {};

async function loadActiveProjectDriveLinks() {
  const box = document.getElementById("cdeFilesList");
  box.innerHTML = "Đang tải...";

  const { data, error } = await sb
    .from("projects")
    .select("id, drive_wip_url, drive_shared_url, drive_published_url, drive_archived_url")
    .eq("id", activeProjectId)
    .single();

  if (error) { box.innerHTML = `<div style="color:#d9534f">${error.message}</div>`; return; }
  activeProjectDriveLinks = data || {};
  renderDriveLinkBox();
}

function renderDriveLinkBox() {
  const box = document.getElementById("cdeFilesList");
  const col = STATUS_COLUMN[activeStatusTab];
  const url = activeProjectDriveLinks ? activeProjectDriveLinks[col] : null;
  const isBimManager = activeRole === "bim_manager";

  if (url) {
    box.innerHTML = `
      <div class="cde-file-card">
        <div class="fname">📁 Thư mục ${STATUS_LABELS[activeStatusTab]} trên Google Drive</div>
        <div class="meta" style="word-break:break-all;">${url}</div>
        <div class="actions">
          <button id="cdeOpenDrive">🔗 Mở trên Google Drive</button>
          ${isBimManager ? `<button id="cdeEditDrive">✏ Sửa link</button>` : ""}
        </div>
      </div>
      <button class="btn" style="width:100%;margin:6px 0;" id="cdeListDriveFiles">📄 Tải danh sách file (nạp thẳng vào Viewer)</button>
      <div id="cdeDriveFileList"></div>`;
    document.getElementById("cdeOpenDrive").addEventListener("click", () => window.open(url, "_blank"));
    if (isBimManager) document.getElementById("cdeEditDrive").addEventListener("click", () => showDriveLinkForm(col, url));
    document.getElementById("cdeListDriveFiles").addEventListener("click", listDriveFilesViaApi);
    return;
  }

  if (isBimManager) {
    showDriveLinkForm(col, "");
    return;
  }

  box.innerHTML = `<div style="color:#999">Chưa có thư mục Drive cho trạng thái này. Liên hệ BIM Manager để thêm.</div>`;
}

function showDriveLinkForm(col, currentValue) {
  const box = document.getElementById("cdeFilesList");
  box.innerHTML = `
    <div class="cde-file-card">
      <div class="fname" style="margin-bottom:6px;">Link thư mục Drive cho trạng thái ${STATUS_LABELS[activeStatusTab]}</div>
      <input type="text" id="cdeDriveLinkInput" placeholder="Dán link thư mục Google Drive vào đây" value="${(currentValue || "").replace(/"/g, "&quot;")}">
      <button class="btn btn-primary" style="width:100%;margin-top:6px;" id="cdeSaveDriveLink">💾 Lưu link</button>
    </div>`;
  document.getElementById("cdeSaveDriveLink").addEventListener("click", () => saveDriveLink(col));
}

async function saveDriveLink(col) {
  const val = document.getElementById("cdeDriveLinkInput").value.trim();
  if (!val) { alert("Dán link thư mục Drive trước đã."); return; }

  const { error } = await sb.from("projects").update({ [col]: val }).eq("id", activeProjectId);
  if (error) { alert("Lỗi lưu link: " + error.message); return; }

  activeProjectDriveLinks[col] = val;
  renderDriveLinkBox();
}

/* ---------------------------------------------------------------------
   3c. NẠP FILE TRỰC TIẾP TỪ DRIVE VÀO VIEWER (Cách B — qua Edge Function)
   Yêu cầu đã deploy function "drive-proxy" (xem HUONG_DAN_CACH_B.md).
   Chỉ hoạt động với file .ifc/.xkt/.glb — các loại khác dùng nút Tải xuống.
   --------------------------------------------------------------------- */
async function listDriveFilesViaApi() {
  const listBox = document.getElementById("cdeDriveFileList");
  listBox.innerHTML = "Đang tải danh sách file từ Drive...";

  const { data, error } = await sb.functions.invoke("drive-proxy", {
    body: { action: "list", projectId: activeProjectId, status: activeStatusTab }
  });

  if (error) {
    listBox.innerHTML = `<div style="color:#d9534f">${error.message || error}</div>`;
    return;
  }
  if (!data || data.length === 0) {
    listBox.innerHTML = `<div style="color:#999">Thư mục này chưa có file nào.</div>`;
    return;
  }

  listBox.innerHTML = "";
  data.forEach(f => listBox.appendChild(buildDriveFileCard(f)));
}

function buildDriveFileCard(f) {
  const card = document.createElement("div");
  card.className = "cde-file-card";
  const sizeKb = f.size ? (f.size / 1024).toFixed(0) + " KB" : "";
  card.innerHTML = `
    <div class="fname">${f.name}</div>
    <div class="meta">${sizeKb} · sửa lúc ${f.modifiedTime ? new Date(f.modifiedTime).toLocaleString("vi-VN") : "-"}</div>
    <div class="actions"></div>`;

  const actionsEl = card.querySelector(".actions");
  const ext = (f.name.split(".").pop() || "").toLowerCase();

  if (["ifc", "xkt", "glb"].includes(ext)) {
    const btnOpen = document.createElement("button");
    btnOpen.innerText = "👁 Nạp vào Viewer";
    btnOpen.addEventListener("click", () => openDriveFileInViewer(f));
    actionsEl.appendChild(btnOpen);
  }

  const btnDownload = document.createElement("button");
  btnDownload.innerText = "⬇ Tải xuống";
  btnDownload.addEventListener("click", () => downloadDriveFile(f));
  actionsEl.appendChild(btnDownload);

  return card;
}

async function fetchDriveFileBlob(f) {
  const { data: sessionData } = await sb.auth.getSession();
  const token = sessionData?.session?.access_token;
  const res = await fetch(`${SUPABASE_URL}/functions/v1/drive-proxy`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
      "apikey": SUPABASE_ANON_KEY
    },
    body: JSON.stringify({ action: "download", projectId: activeProjectId, status: activeStatusTab, fileId: f.id })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || ("Lỗi tải file (HTTP " + res.status + ")"));
  }
  return res.blob();
}

async function downloadDriveFile(f) {
  try {
    const blob = await fetchDriveFileBlob(f);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = f.name; a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    alert(e.message);
  }
}

// Nạp file Drive thẳng vào viewer hiện có, tận dụng lại input file gốc của
// app (không đụng vào logic loader IFC/XKT đã có sẵn).
async function openDriveFileInViewer(f) {
  try {
    const blob = await fetchDriveFileBlob(f);
    const ext = (f.name.split(".").pop() || "").toLowerCase();
    const targetInputId = ext === "ifc" ? "ifcModelFileInput" : "modelFileInput";
    const input = document.getElementById(targetInputId);
    if (!input) { alert("Không tìm thấy input nạp file phù hợp cho ." + ext); return; }

    const file = new File([blob], f.name);
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event("change"));
    document.getElementById("cdeFilesPanel").style.display = "none";
  } catch (e) {
    alert(e.message);
  }
}

/* ---------------------------------------------------------------------
   5. QUẢN LÝ THÀNH VIÊN & QUYỀN (chỉ BIM Manager)
   --------------------------------------------------------------------- */
function renderMembersButton() {
  const box = document.getElementById("cdeMembersBox");
  if (activeRole !== "bim_manager") { box.style.display = "none"; box.innerHTML = ""; return; }
  box.style.display = "block";
  box.innerHTML = `
    <div style="border-top:1px solid #eee;margin-top:10px;padding-top:10px;">
      <div style="font-size:11px;font-weight:700;margin-bottom:4px;">👥 Thêm thành viên</div>
      <input type="email" id="cdeInviteEmail" placeholder="Email thành viên (đã đăng ký)">
      <select id="cdeInviteRole">
        ${Object.entries(ROLE_LABELS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}
      </select>
      <button class="btn" style="width:100%;margin-top:6px;" id="cdeInviteSubmit">Thêm vào dự án</button>
    </div>`;
  document.getElementById("cdeInviteSubmit").addEventListener("click", async () => {
    const email = document.getElementById("cdeInviteEmail").value.trim();
    const role = document.getElementById("cdeInviteRole").value;
    if (!email) return;
    const { error } = await sb.rpc("invite_member_by_email", { p_project_id: activeProjectId, p_email: email, p_role: role });
    if (error) { alert(error.message); return; }
    alert("Đã thêm thành viên.");
  });
}

/* ---------------------------------------------------------------------
   6. NÚT MỞ PANEL (gắn vào toolbar hiện có, xem hướng dẫn tích hợp)
   --------------------------------------------------------------------- */
window.toggleCdeFilesPanel = function () {
  const p = document.getElementById("cdeFilesPanel");
  p.style.display = p.style.display === "block" ? "none" : "block";
};

injectCdeUI();
