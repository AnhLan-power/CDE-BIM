/* =====================================================================
   CDE VIEWS MODULE — Lưu và khôi phục góc nhìn camera (kiểu Trimble
   Connect Views). Dùng chung sb, activeProjectId, activeRole, currentUser
   (từ cde-auth.js) và viewer (window.viewer, export từ module chính).
   ===================================================================== */

let cdeViewsCache = [];

function injectViewsUI() {
  const panel = document.createElement("div");
  panel.className = "panel";
  panel.id = "viewsPanel";
  panel.style.display = "none";
  panel.innerHTML = `
    <div class="panel-header">
      <b>📷 Views</b>
      <span style="cursor:pointer" onclick="document.getElementById('viewsPanel').style.display='none'">✕</span>
    </div>
    <div id="vwNoProjectMsg" style="color:#999;padding:8px 0;">Vào panel 📁 CDE, chọn dự án trước đã.</div>
    <div id="vwContent" style="display:none;">
      <div id="vwSaveBox"></div>
      <div id="vwListBox"></div>
    </div>`;
  document.body.appendChild(panel);
}

window.toggleViewsPanel = function () {
  const p = document.getElementById("viewsPanel");
  const willShow = p.style.display !== "block";
  p.style.display = willShow ? "block" : "none";
  if (willShow) refreshViewsPanel();
};

async function refreshViewsPanel() {
  if (!activeProjectId) {
    document.getElementById("vwNoProjectMsg").style.display = "block";
    document.getElementById("vwContent").style.display = "none";
    return;
  }
  document.getElementById("vwNoProjectMsg").style.display = "none";
  document.getElementById("vwContent").style.display = "block";

  renderSaveViewBox();
  await loadViewsList();
}

function canEditViews() {
  return ["author", "task_team_manager", "bim_manager"].includes(activeRole);
}

/* ---------------------------------------------------------------------
   1. LƯU GÓC NHÌN HIỆN TẠI
   --------------------------------------------------------------------- */
function renderSaveViewBox() {
  const box = document.getElementById("vwSaveBox");
  if (!canEditViews()) { box.innerHTML = ""; return; }
  box.innerHTML = `
    <div class="cde-file-card">
      <div class="fname">💾 Lưu góc nhìn hiện tại</div>
      <input type="text" id="vwNewTitle" placeholder="Tên góc nhìn, vd: Mặt tiền chính">
      <input type="text" id="vwNewDesc" placeholder="Mô tả ngắn">
      <button class="btn btn-primary" style="width:100%;margin-top:6px;" id="vwSaveBtn">💾 Lưu</button>
    </div>`;
  document.getElementById("vwSaveBtn").addEventListener("click", saveCurrentView);
}

function captureThumbnail() {
  try {
    const srcCanvas = viewer.scene.canvas.canvas;
    const small = document.createElement("canvas");
    small.width = 160; small.height = 100;
    const ctx = small.getContext("2d");
    ctx.drawImage(srcCanvas, 0, 0, small.width, small.height);
    return small.toDataURL("image/jpeg", 0.55);
  } catch (e) { return null; }
}

async function saveCurrentView() {
  const title = document.getElementById("vwNewTitle").value.trim();
  const description = document.getElementById("vwNewDesc").value.trim();
  if (!title) { alert("Đặt tên cho góc nhìn trước."); return; }

  const cam = viewer.camera;
  const thumbnail = captureThumbnail();

  const { error } = await sb.from("project_views").insert({
    project_id: activeProjectId,
    title, description,
    camera_eye: [...cam.eye],
    camera_look: [...cam.look],
    camera_up: [...cam.up],
    thumbnail,
    created_by: currentUser.id
  });
  if (error) { alert("Lỗi lưu view: " + error.message); return; }

  document.getElementById("vwNewTitle").value = "";
  document.getElementById("vwNewDesc").value = "";
  showToast ? showToast("✅ Đã lưu góc nhìn", "success") : alert("Đã lưu.");
  await loadViewsList();
}

/* ---------------------------------------------------------------------
   2. DANH SÁCH VIEWS + KHÔI PHỤC
   --------------------------------------------------------------------- */
async function loadViewsList() {
  const box = document.getElementById("vwListBox");
  box.innerHTML = "Đang tải...";

  const { data, error } = await sb
    .from("project_views")
    .select("*")
    .eq("project_id", activeProjectId)
    .order("created_at", { ascending: false });

  if (error) { box.innerHTML = `<div style="color:#d9534f">${error.message}</div>`; return; }
  cdeViewsCache = data || [];

  if (cdeViewsCache.length === 0) {
    box.innerHTML = `<div style="color:#999;padding:8px 0;">Chưa có góc nhìn nào được lưu.</div>`;
    return;
  }

  box.innerHTML = `<div style="font-size:11px;font-weight:700;margin:10px 0 4px;">📋 Danh sách (${cdeViewsCache.length})</div>`;
  cdeViewsCache.forEach(v => box.appendChild(buildViewCard(v)));
}

function buildViewCard(v) {
  const card = document.createElement("div");
  card.className = "cde-file-card";
  card.innerHTML = `
    ${v.thumbnail ? `<img src="${v.thumbnail}" style="width:100%;border-radius:6px;margin-bottom:6px;">` : ""}
    <div class="fname">${v.title}</div>
    <div class="meta">${v.description || ""}<br>${new Date(v.created_at).toLocaleString("vi-VN")}</div>
    <div class="actions" id="vwActions_${v.id}"></div>`;

  const actionsEl = card.querySelector(".actions");
  const btnGo = document.createElement("button");
  btnGo.innerText = "▶ Đi tới";
  btnGo.addEventListener("click", () => flyToView(v));
  actionsEl.appendChild(btnGo);

  if (canEditViews()) {
    const btnDelete = document.createElement("button");
    btnDelete.innerText = "❌ Xoá";
    btnDelete.addEventListener("click", () => deleteView(v.id));
    actionsEl.appendChild(btnDelete);
  }
  return card;
}

window.flyToView = function (v) {
  viewer.cameraFlight.flyTo({
    eye: v.camera_eye, look: v.camera_look, up: v.camera_up, duration: 0.8
  });
};

async function deleteView(id) {
  if (!confirm("Xoá góc nhìn này?")) return;
  const { error } = await sb.from("project_views").delete().eq("id", id);
  if (error) { alert("Lỗi xoá: " + error.message); return; }
  await loadViewsList();
}

injectViewsUI();
