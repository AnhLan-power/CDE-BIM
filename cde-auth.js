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
    <div id="cdeUploadBox"></div>
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
          email, password, options: { data: { full_name: fullName } }
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
    tab.addEventListener("click", () => { activeStatusTab = st; renderStatusTabs(); loadFilesList(); });
    tabsEl.appendChild(tab);
  });
  renderUploadBox();
  renderMembersButton();
  loadFilesList();
}

function canUpload() {
  return ["author", "task_team_manager", "bim_manager"].includes(activeRole);
}

function renderUploadBox() {
  const box = document.getElementById("cdeUploadBox");
  if (!canUpload()) { box.innerHTML = ""; return; }
  box.innerHTML = `
    <div style="font-size:11px;font-weight:700;margin-bottom:4px;">⬆️ Nạp file lên CDE (trạng thái WIP)</div>
    <input type="file" id="cdeUploadInput" accept=".ifc,.xkt,.glb,.pdf">
    <input type="text" id="cdeUploadOriginator" placeholder="Mã đơn vị tạo (Originator), vd: ABC">
    <input type="text" id="cdeUploadDiscipline" placeholder="Bộ môn, vd: AR / ST / ME">
    <input type="text" id="cdeUploadDesc" placeholder="Mô tả ngắn">
    <button class="btn btn-primary" style="width:100%;margin-top:6px;" id="cdeUploadSubmit">Tải lên</button>`;
  document.getElementById("cdeUploadSubmit").addEventListener("click", doUploadFile);
}

async function doUploadFile() {
  const fileInput = document.getElementById("cdeUploadInput");
  const file = fileInput.files[0];
  if (!file) { alert("Chọn 1 file trước."); return; }

  const path = `${activeProjectId}/${Date.now()}_${file.name}`;
  const { error: upErr } = await sb.storage.from("cde-files").upload(path, file);
  if (upErr) { alert("Lỗi tải file lên Storage: " + upErr.message); return; }

  const { error: dbErr } = await sb.from("cde_files").insert({
    project_id: activeProjectId,
    file_name: file.name,
    file_path: path,
    file_type: file.name.split(".").pop().toLowerCase(),
    file_size: file.size,
    originator: document.getElementById("cdeUploadOriginator").value.trim(),
    discipline: document.getElementById("cdeUploadDiscipline").value.trim(),
    description: document.getElementById("cdeUploadDesc").value.trim(),
    uploaded_by: currentUser.id,
    status: "WIP"
  });
  if (dbErr) { alert("Lỗi ghi metadata: " + dbErr.message); return; }

  showToast ? showToast("✅ Đã tải file lên CDE (WIP)", "success") : alert("Đã tải lên.");
  activeStatusTab = "WIP";
  renderStatusTabs();
}

/* ---------------------------------------------------------------------
   4. DANH SÁCH FILE + HÀNH ĐỘNG CHUYỂN TRẠNG THÁI
   --------------------------------------------------------------------- */
async function loadFilesList() {
  const listEl = document.getElementById("cdeFilesList");
  listEl.innerHTML = "Đang tải...";
  const { data, error } = await sb
    .from("cde_files")
    .select("*")
    .eq("project_id", activeProjectId)
    .eq("status", activeStatusTab)
    .order("uploaded_at", { ascending: false });

  if (error) { listEl.innerHTML = `<div style="color:#d9534f">${error.message}</div>`; return; }
  if (!data || data.length === 0) { listEl.innerHTML = `<div style="color:#999">Không có file nào ở trạng thái này.</div>`; return; }

  listEl.innerHTML = "";
  data.forEach(f => listEl.appendChild(buildFileCard(f)));
}

function buildFileCard(f) {
  const card = document.createElement("div");
  card.className = "cde-file-card";
  card.innerHTML = `
    <div class="fname">${f.file_name}</div>
    <div class="meta">Rev ${f.revision || "-"} · ${f.originator || "-"}/${f.discipline || "-"} · ${(f.file_size / 1024).toFixed(0)} KB<br>
    Tải lên: ${new Date(f.uploaded_at).toLocaleString("vi-VN")}</div>
    <div class="actions" id="actions_${f.id}"></div>`;

  const actionsEl = card.querySelector(".actions");

  const btnOpen = document.createElement("button");
  btnOpen.innerText = "👁 Nạp vào Viewer";
  btnOpen.addEventListener("click", () => openFileInViewer(f));
  actionsEl.appendChild(btnOpen);

  const btnDownload = document.createElement("button");
  btnDownload.innerText = "⬇ Tải xuống";
  btnDownload.addEventListener("click", () => downloadFile(f));
  actionsEl.appendChild(btnDownload);

  // Nút chuyển trạng thái theo vai trò hiện tại
  const transitions = getAvailableTransitions(f.status, activeRole);
  transitions.forEach(t => {
    const btn = document.createElement("button");
    btn.innerText = t.label;
    btn.addEventListener("click", () => changeStatus(f.id, t.to));
    actionsEl.appendChild(btn);
  });

  return card;
}

function getAvailableTransitions(status, role) {
  const out = [];
  if (status === "WIP" && ["author", "task_team_manager", "bim_manager"].includes(role))
    out.push({ to: "SHARED", label: "➡ Gửi Shared" });
  if (status === "SHARED" && ["approver", "task_team_manager", "bim_manager"].includes(role))
    out.push({ to: "WIP", label: "↩ Trả về WIP" });
  if (status === "SHARED" && role === "bim_manager")
    out.push({ to: "PUBLISHED", label: "✅ Publish" });
  if (status === "PUBLISHED" && role === "bim_manager")
    out.push({ to: "ARCHIVED", label: "🗄 Archive" });
  return out;
}

async function changeStatus(fileId, newStatus) {
  const comment = prompt("Ghi chú (không bắt buộc):", "") || null;
  const { error } = await sb.rpc("change_file_status", { p_file_id: fileId, p_new_status: newStatus, p_comment: comment });
  if (error) { alert("Không thể chuyển trạng thái: " + error.message); return; }
  loadFilesList();
}

async function downloadFile(f) {
  const { data, error } = await sb.storage.from("cde-files").download(f.file_path);
  if (error) { alert(error.message); return; }
  const url = URL.createObjectURL(data);
  const a = document.createElement("a");
  a.href = url; a.download = f.file_name; a.click();
  URL.revokeObjectURL(url);
}

// Nạp file CDE thẳng vào viewer hiện có bằng cách tái sử dụng input nạp file
// gốc của app (không đụng vào logic loader IFC/XKT đã có sẵn).
async function openFileInViewer(f) {
  const { data, error } = await sb.storage.from("cde-files").download(f.file_path);
  if (error) { alert(error.message); return; }

  const targetInputId = f.file_type === "ifc" ? "ifcModelFileInput" : "modelFileInput";
  const input = document.getElementById(targetInputId);
  if (!input) { alert("Không tìm thấy input nạp file phù hợp cho ." + f.file_type); return; }

  const file = new File([data], f.file_name, { type: data.type });
  const dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;
  input.dispatchEvent(new Event("change"));
  document.getElementById("cdeFilesPanel").style.display = "none";
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
