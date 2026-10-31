/* =====================================================================
   CDE TIMELINE MODULE — Tiến độ thi công 4D & Animation (Navisworks / Fuzor style)
   Yêu cầu: chạy SAU cde-auth.js và SAU phần khởi tạo viewer xeokit trong index.html.
   ===================================================================== */

let timelineTasks = [];               // Cache danh sách task của dự án đang chọn
let timelineTaskElements = {};        // { task_id: [globalId, ...] }
let timelineSelectedTaskId = null;    // Task đang được chọn để gắn cấu kiện
let timelineEditingTaskId = null;     // Task đang mở form sửa
let timelinePlaying = false;
let animationFrameId = null;
let currentPlayDay = 0;

// Cache lưu ma trận gốc của các Model máy móc trong scene
const modelBaseMatrices = {};

const TASK_TYPE_LABELS = { construction: "Thi công", demolition: "Tháo dỡ", temporary: "Tạm thời" };
const TASK_TYPE_COLORS = { construction: "#3B82F6", demolition: "#EF4444", temporary: "#F59E0B" };

/* ---------------------------------------------------------------------
   1. DỰNG GIAO DIỆN
   --------------------------------------------------------------------- */
function injectTimelineUI() {
  if (document.getElementById("timelinePanel")) return;
  const panel = document.createElement("div");
  panel.className = "panel";
  panel.id = "timelinePanel";
  panel.style.display = "none";
  panel.innerHTML = `
    <div class="panel-header">
      <b>📅 Tiến Độ Thi Công & Animation 4D</b>
      <span style="cursor:pointer" onclick="document.getElementById('timelinePanel').style.display='none'">✕</span>
    </div>
    <div id="tlNoProjectMsg" style="color:#999;padding:8px 0;">Vào panel 📁 CDE, chọn dự án trước đã.</div>
    <div id="tlContent" style="display:none;">
      <div id="tlSimulateBox"></div>
      <div id="tlAddTaskBox"></div>
      <div id="tlImportBox"></div>
      <div id="tlTaskList"></div>
    </div>`;
  document.body.appendChild(panel);
}

window.toggleTimelinePanel = function () {
  const p = document.getElementById("timelinePanel");
  const willShow = p.style.display !== "block";
  p.style.display = willShow ? "block" : "none";
  if (willShow) refreshTimelinePanel();
};

async function refreshTimelinePanel() {
  if (!window.activeProjectId) {
    document.getElementById("tlNoProjectMsg").style.display = "block";
    document.getElementById("tlContent").style.display = "none";
    return;
  }
  document.getElementById("tlNoProjectMsg").style.display = "none";
  document.getElementById("tlContent").style.display = "block";

  await loadTimelineTasks();
  renderAddTaskBox();
  renderImportBox();
  renderTaskList();
  renderSimulateBox();
}

/* ---------------------------------------------------------------------
   2. TẢI DỮ LIỆU TỪ SUPABASE
   --------------------------------------------------------------------- */
async function loadTimelineTasks() {
  const client = window.sb;
  if (!client) return;

  const { data: tasks, error } = await client
    .from("project_tasks")
    .select("*")
    .eq("project_id", window.activeProjectId)
    .order("planned_start", { ascending: true });

  if (error) { alert("Lỗi tải tiến độ: " + error.message); return; }
  timelineTasks = tasks || [];

  const taskIds = timelineTasks.map(t => t.id);
  timelineTaskElements = {};
  if (taskIds.length > 0) {
    const { data: links } = await client.from("task_elements").select("task_id, global_id").in("task_id", taskIds);
    (links || []).forEach(l => {
      if (!timelineTaskElements[l.task_id]) timelineTaskElements[l.task_id] = [];
      timelineTaskElements[l.task_id].push(l.global_id);
    });
  }
}

function canEditTasks() {
  if (!window.activeRole) return true;
  const r = String(window.activeRole).toLowerCase().trim();
  return r.includes("author") || r.includes("manager") || r.includes("admin") || r.includes("bim") || r.includes("team");
}

/* ---------------------------------------------------------------------
   3. THÊM / SỬA / XOÁ TASK
   --------------------------------------------------------------------- */
function renderAddTaskBox() {
  const box = document.getElementById("tlAddTaskBox");
  if (!canEditTasks()) { box.innerHTML = ""; return; }
  box.innerHTML = `
    <div class="cde-file-card">
      <div class="fname" style="margin-bottom:6px;">➕ Thêm công việc & Cấu hình Animation</div>
      <input type="text" id="tlNewName" placeholder="Tên công việc, vd: Lắp dầm / Cẩu tháp">
      
      <div style="display:flex;gap:6px;margin:4px 0;">
        <select id="tlNewType" style="flex:1;padding:6px;border:1px solid #dcdfe3;border-radius:6px;font-size:11px;">
          <option value="construction">Thi công (Xây mới)</option>
          <option value="demolition">Tháo dỡ</option>
          <option value="temporary">Tạm thời</option>
        </select>
        <select id="tlNewAnim" style="flex:1;padding:6px;border:1px solid #dcdfe3;border-radius:6px;font-size:11px;">
          <option value="fade">✨ Hiệu ứng: Mờ dần (Fade)</option>
          <option value="slide">📦 Hiệu ứng: Trượt / Nổi bật</option>
        </select>
      </div>

      <div style="margin:4px 0;">
        <select id="tlNewMachine" style="width:100%;padding:6px;border:1px solid #dcdfe3;border-radius:6px;font-size:11px;">
          <option value="none">🚜 Máy móc: Không có / Bình thường</option>
          <option value="rotate">🔄 Máy móc: Xoay vòng (Cẩu tháp, quạt...)</option>
          <option value="translate">🚚 Máy móc: Di chuyển tịnh tiến (Xe chạy...)</option>
        </select>
      </div>

      <div style="display:flex;gap:6px;margin-top:4px;">
        <input type="date" id="tlNewStart" style="flex:1;">
        <input type="date" id="tlNewEnd" style="flex:1;">
      </div>
      <button class="btn btn-primary" style="width:100%;margin-top:6px;" id="tlAddTaskSubmit">Thêm công việc</button>
    </div>`;
  document.getElementById("tlAddTaskSubmit").addEventListener("click", addTimelineTask);
}

async function addTimelineTask() {
  const name = document.getElementById("tlNewName").value.trim();
  const type = document.getElementById("tlNewType").value;
  const anim = document.getElementById("tlNewAnim").value;
  const machine = document.getElementById("tlNewMachine").value;
  const start = document.getElementById("tlNewStart").value;
  const end = document.getElementById("tlNewEnd").value;

  if (!name || !start || !end) { alert("Điền đủ tên, ngày bắt đầu và kết thúc."); return; }
  if (end < start) { alert("Ngày kết thúc phải sau ngày bắt đầu."); return; }

  const { error } = await window.sb.from("project_tasks").insert({
    project_id: window.activeProjectId,
    name, 
    task_type: type,
    animation_type: anim,
    machine_mode: machine,
    planned_start: start, 
    planned_end: end,
    color: TASK_TYPE_COLORS[type],
    created_by: window.currentUser ? window.currentUser.id : null
  });
  if (error) { alert("Lỗi thêm công việc: " + error.message); return; }

  document.getElementById("tlNewName").value = "";
  await refreshTimelinePanel();
}

async function deleteTimelineTask(taskId) {
  if (!confirm("Xoá công việc này? Cấu kiện gắn kèm cũng sẽ bị gỡ liên kết.")) return;
  const { error } = await window.sb.from("project_tasks").delete().eq("id", taskId);
  if (error) { alert("Lỗi xoá: " + error.message); return; }
  if (timelineSelectedTaskId === taskId) timelineSelectedTaskId = null;
  await refreshTimelinePanel();
}

async function saveEditedTask(taskId) {
  const name = document.getElementById("tlEditName").value.trim();
  const type = document.getElementById("tlEditType").value;
  const anim = document.getElementById("tlEditAnim").value;
  const machine = document.getElementById("tlEditMachine").value;
  const start = document.getElementById("tlEditStart").value;
  const end = document.getElementById("tlEditEnd").value;

  if (!name || !start || !end) { alert("Điền đủ tên, ngày bắt đầu và kết thúc."); return; }
  if (end < start) { alert("Ngày kết thúc phải sau ngày bắt đầu."); return; }

  const { error } = await window.sb.from("project_tasks").update({
    name, 
    task_type: type,
    animation_type: anim,
    machine_mode: machine,
    planned_start: start, 
    planned_end: end,
    color: TASK_TYPE_COLORS[type]
  }).eq("id", taskId);
  if (error) { alert("Lỗi lưu chỉnh sửa: " + error.message); return; }

  timelineEditingTaskId = null;
  await refreshTimelinePanel();
}

/* ---------------------------------------------------------------------
   4. GẮN CẤU KIỆN 3D VÀO TASK
   --------------------------------------------------------------------- */
async function attachSelectedElementsToTask(taskId) {
  if (typeof window.multiSelectedIds === "undefined" || window.multiSelectedIds.size === 0) {
    alert("Bấm nút 'Chọn Nhiều' trên thanh công cụ, chọn các cấu kiện trong mô hình 3D trước, rồi mới bấm nút này.");
    return;
  }
  const viewer = window.xeokitViewer || window.viewer;
  const globalIds = [...window.multiSelectedIds].map(id => {
    const e = viewer && viewer.scene && viewer.scene.objects[id];
    return (e && e.originalSystemId) || id;
  });

  const rows = globalIds.map(gid => ({ task_id: taskId, global_id: gid }));
  const { error } = await window.sb.from("task_elements").upsert(rows, { onConflict: "task_id,global_id" });
  if (error) { alert("Lỗi gắn cấu kiện: " + error.message); return; }

  if (typeof window.showToast === "function") {
    window.showToast(`✅ Đã gắn ${globalIds.length} cấu kiện vào công việc`, "success");
  } else {
    alert("Đã gắn cấu kiện thành công.");
  }
  await refreshTimelinePanel();
}

async function detachAllElementsFromTask(taskId) {
  if (!confirm("Gỡ toàn bộ cấu kiện đang gắn với công việc này?")) return;
  const { error } = await window.sb.from("task_elements").delete().eq("task_id", taskId);
  if (error) { alert("Lỗi: " + error.message); return; }
  await refreshTimelinePanel();
}

/* ---------------------------------------------------------------------
   5. DANH SÁCH TASK (GANTT ĐƠN GIẢN)
   --------------------------------------------------------------------- */
function renderTaskList() {
  const box = document.getElementById("tlTaskList");
  if (timelineTasks.length === 0) {
    box.innerHTML = `<div style="color:#999;padding:8px 0;">Chưa có công việc nào.</div>`;
    return;
  }

  const allDates = timelineTasks.flatMap(t => [new Date(t.planned_start), new Date(t.planned_end)]);
  const minDate = new Date(Math.min(...allDates));
  const maxDate = new Date(Math.max(...allDates));
  const totalDays = Math.max(1, (maxDate - minDate) / 86400000);

  box.innerHTML = `<div style="font-size:11px;font-weight:700;margin:10px 0 4px;">📋 Danh sách công việc (${timelineTasks.length})</div>`;

  timelineTasks.forEach(t => {
    const start = new Date(t.planned_start);
    const end = new Date(t.planned_end);
    const leftPct = ((start - minDate) / 86400000 / totalDays) * 100;
    const widthPct = Math.max(2, ((end - start) / 86400000 / totalDays) * 100);
    const elemCount = (timelineTaskElements[t.id] || []).length;
    const isSelected = timelineSelectedTaskId === t.id;

    const card = document.createElement("div");
    card.className = "cde-file-card";
    if (isSelected) card.style.border = "2px solid #0275d8";

    if (timelineEditingTaskId === t.id) {
      card.innerHTML = `
        <div class="fname" style="margin-bottom:6px;">✏ Sửa công việc</div>
        <input type="text" id="tlEditName" value="${t.name.replace(/"/g, "&quot;")}">
        <div style="display:flex;gap:6px;margin:4px 0;">
          <select id="tlEditType" style="flex:1;padding:6px;border:1px solid #dcdfe3;border-radius:6px;font-size:11px;">
            <option value="construction" ${t.task_type === "construction" ? "selected" : ""}>Thi công</option>
            <option value="demolition" ${t.task_type === "demolition" ? "selected" : ""}>Tháo dỡ</option>
            <option value="temporary" ${t.task_type === "temporary" ? "selected" : ""}>Tạm thời</option>
          </select>
          <select id="tlEditAnim" style="flex:1;padding:6px;border:1px solid #dcdfe3;border-radius:6px;font-size:11px;">
            <option value="fade" ${t.animation_type === "fade" ? "selected" : ""}>✨ Mờ (Fade)</option>
            <option value="slide" ${t.animation_type === "slide" ? "selected" : ""}>📦 Trượt/Nổi bật</option>
          </select>
        </div>
        <div style="margin:4px 0;">
          <select id="tlEditMachine" style="width:100%;padding:6px;border:1px solid #dcdfe3;border-radius:6px;font-size:11px;">
            <option value="none" ${t.machine_mode === "none" ? "selected" : ""}>🚜 Máy móc: Không</option>
            <option value="rotate" ${t.machine_mode === "rotate" ? "selected" : ""}>🔄 Máy móc: Xoay vòng</option>
            <option value="translate" ${t.machine_mode === "translate" ? "selected" : ""}>🚚 Máy móc: Di chuyển</option>
          </select>
        </div>
        <div style="display:flex;gap:6px;">
          <input type="date" id="tlEditStart" value="${t.planned_start}" style="flex:1;">
          <input type="date" id="tlEditEnd" value="${t.planned_end}" style="flex:1;">
        </div>
        <div class="actions" style="margin-top:6px;">
          <button id="tlEditSave">💾 Lưu</button>
          <button id="tlEditCancel">Huỷ</button>
        </div>`;
      box.appendChild(card);
      document.getElementById("tlEditSave").addEventListener("click", () => saveEditedTask(t.id));
      document.getElementById("tlEditCancel").addEventListener("click", () => { timelineEditingTaskId = null; renderTaskList(); });
      return;
    }

    const animLabel = t.animation_type === "slide" ? "📦 Trượt" : "✨ Mờ";
    const machLabel = t.machine_mode === "rotate" ? " · 🔄 Xoay" : (t.machine_mode === "translate" ? " · 🚚 Di chuyển" : "");

    card.innerHTML = `
      <div class="fname">${t.name} <span style="font-weight:400;color:#888;">(${TASK_TYPE_LABELS[t.task_type]} · ${animLabel}${machLabel})</span></div>
      <div class="meta">${t.planned_start} → ${t.planned_end} · ${elemCount} cấu kiện gắn</div>
      <div style="background:#eee;border-radius:4px;height:8px;margin:6px 0;position:relative;">
        <div style="position:absolute;left:${leftPct}%;width:${widthPct}%;height:100%;background:${t.color || "#3B82F6"};border-radius:4px;"></div>
      </div>
      <div class="actions" id="tlActions_${t.id}"></div>`;

    const actionsEl = card.querySelector(".actions");

    const btnSelect = document.createElement("button");
    btnSelect.innerText = isSelected ? "✓ Đang chọn" : "🎯 Chọn công việc này";
    btnSelect.addEventListener("click", () => { timelineSelectedTaskId = isSelected ? null : t.id; renderTaskList(); });
    actionsEl.appendChild(btnSelect);

    if (canEditTasks()) {
      const btnEdit = document.createElement("button");
      btnEdit.innerText = "✏ Sửa";
      btnEdit.addEventListener("click", () => { timelineEditingTaskId = t.id; renderTaskList(); });
      actionsEl.appendChild(btnEdit);

      const btnAttach = document.createElement("button");
      btnAttach.innerText = "🔗 Gắn cấu kiện đã chọn";
      btnAttach.addEventListener("click", () => attachSelectedElementsToTask(t.id));
      actionsEl.appendChild(btnAttach);

      if (elemCount > 0) {
        const btnDetach = document.createElement("button");
        btnDetach.innerText = "🗑 Gỡ hết cấu kiện";
        btnDetach.addEventListener("click", () => detachAllElementsFromTask(t.id));
        actionsEl.appendChild(btnDetach);
      }

      const btnDelete = document.createElement("button");
      btnDelete.innerText = "❌ Xoá";
      btnDelete.addEventListener("click", () => deleteTimelineTask(t.id));
      actionsEl.appendChild(btnDelete);
    }

    box.appendChild(card);
  });
}

/* ---------------------------------------------------------------------
   6. MÔ PHỎNG 4D VỚI HIỆU ỨNG NÂNG CAO & MÁY MÓC (XEIKOT MODEL MATRIX)
   --------------------------------------------------------------------- */
function renderSimulateBox() {
  const box = document.getElementById("tlSimulateBox");
  if (timelineTasks.length === 0) { box.innerHTML = ""; return; }

  const allDates = timelineTasks.flatMap(t => [new Date(t.planned_start), new Date(t.planned_end)]);
  const minDate = new Date(Math.min(...allDates));
  const maxDate = new Date(Math.max(...allDates));
  const totalDays = Math.max(1, Math.round((maxDate - minDate) / 86400000));

  box.innerHTML = `
    <div class="cde-file-card">
      <div class="fname">🎬 Mô phỏng 4D & Animation</div>
      <div style="display:flex;align-items:center;gap:8px;margin:8px 0;">
        <button id="tlPlayBtn" style="flex-shrink:0;">▶ Chạy</button>
        <input type="range" id="tlDateSlider" min="0" max="${totalDays}" value="0" style="flex:1;">
      </div>
      <div style="text-align:center;font-size:12px;font-weight:700;" id="tlDateLabel">${formatDateVN(minDate)}</div>
      <div style="display:flex;gap:6px;justify-content:center;font-size:10px;margin-top:6px;color:#666;">
        <span>🟢 Thi công</span><span>🔴 Tháo dỡ</span><span>🟠 Tạm thời</span>
      </div>
      <div class="actions" style="margin-top:6px;">
        <button id="tlResetVisBtn">↺ Hiện lại tất cả (Thoát mô phỏng)</button>
      </div>
    </div>`;

  const slider = document.getElementById("tlDateSlider");
  slider.addEventListener("input", () => {
    const val = parseFloat(slider.value);
    const d = new Date(minDate.getTime() + val * 86400000);
    document.getElementById("tlDateLabel").innerText = formatDateVN(d);
    applyTimelineDateWithAnimation(d, val);
  });

  document.getElementById("tlPlayBtn").addEventListener("click", () => toggleTimelinePlay(minDate, totalDays));
  document.getElementById("tlResetVisBtn").addEventListener("click", resetTimelineVisibility);
}

function formatDateVN(d) {
  return d.toLocaleDateString("vi-VN");
}

function toggleTimelinePlay(minDate, totalDays) {
  const btn = document.getElementById("tlPlayBtn");
  const slider = document.getElementById("tlDateSlider");
  timelinePlaying = !timelinePlaying;

  if (timelinePlaying) {
    btn.innerText = "⏸ Dừng";
    currentPlayDay = parseFloat(slider.value);

    function playLoop() {
      if (!timelinePlaying) return;
      currentPlayDay += 0.3; // Tốc độ chạy mô phỏng
      if (currentPlayDay > totalDays) currentPlayDay = 0;

      slider.value = currentPlayDay;
      const d = new Date(minDate.getTime() + currentPlayDay * 86400000);
      document.getElementById("tlDateLabel").innerText = formatDateVN(d);
      
      applyTimelineDateWithAnimation(d, currentPlayDay);

      animationFrameId = requestAnimationFrame(playLoop);
    }
    animationFrameId = requestAnimationFrame(playLoop);
  } else {
    btn.innerText = "▶ Chạy";
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
  }
}

/**
 * 🚀 ÁP DỤNG TRẠNG THÁI TIẾN ĐỘ & HOẠT HOẠ MODEL MÁY MÓC TRONG XEIKOT
 */
function applyTimelineDateWithAnimation(currentDate, floatDay) {
  const viewer = window.xeokitViewer || window.viewer;
  if (!viewer || !viewer.scene) return;

  const globalIdToViewerIds = {};
  viewer.scene.objectIds.forEach(id => {
    const e = viewer.scene.objects[id];
    const gid = (e && e.originalSystemId) || id;
    if (!globalIdToViewerIds[gid]) globalIdToViewerIds[gid] = [];
    globalIdToViewerIds[gid].push(id);
  });

  timelineTasks.forEach(t => {
    const globalIds = timelineTaskElements[t.id] || [];
    if (globalIds.length === 0) return;

    const start = new Date(t.planned_start);
    const end = new Date(t.planned_end);
    const viewerIds = globalIds.flatMap(gid => globalIdToViewerIds[gid] || []);
    const animType = t.animation_type || "fade";
    const machineMode = t.machine_mode || "none";

    if (t.task_type === "construction") {
      if (currentDate < start) {
        setObjectsStateAdvanced(viewerIds, false, 0.0, null, animType);
      } else if (currentDate <= end) {
        const totalDuration = Math.max(1, end - start);
        const elapsed = currentDate - start;
        const progress = Math.min(1.0, Math.max(0.0, elapsed / totalDuration));
        
        const activeColor = animType === "slide" ? [1.0, 0.75, 0.0] : [0.25, 0.85, 0.35];
        setObjectsStateAdvanced(viewerIds, true, progress, activeColor, animType);
      } else {
        setObjectsStateAdvanced(viewerIds, true, 1.0, null, animType);
      }
    } else if (t.task_type === "demolition") {
      if (currentDate < start) {
        setObjectsStateAdvanced(viewerIds, true, 1.0, null, animType);
      } else if (currentDate <= end) {
        setObjectsStateAdvanced(viewerIds, true, 1.0, [0.95, 0.3, 0.3], animType);
      } else {
        setObjectsStateAdvanced(viewerIds, false, 0.0, null, animType);
      }
    } else { // temporary
      if (currentDate < start || currentDate > end) {
        setObjectsStateAdvanced(viewerIds, false, 0.0, null, animType);
      } else {
        setObjectsStateAdvanced(viewerIds, true, 1.0, [0.95, 0.65, 0.15], animType);
      }
    }

    // HOẠT HOẠ MÁY MÓC TRÊN MODEL (Xoay vòng hoặc Di chuyển tịnh tiến)
    if (machineMode !== "none") {
      animateMachineryModels(viewer, t, machineMode, floatDay);
    }
  });

  // Tự động quét các model có tên chứa từ khóa máy móc (Crane, cẩu, tháp...)
  animateAutoMachineryModels(viewer, floatDay);
  
  viewer.scene._needUpdate = 1;
  if (typeof viewer.scene.render === "function") viewer.scene.render();
}

function setObjectsStateAdvanced(viewerIds, visible, progress, colorize, animType) {
  const viewer = window.xeokitViewer || window.viewer;
  if (!viewer || !viewer.scene) return;

  viewerIds.forEach(id => {
    const e = viewer.scene.objects[id];
    if (!e) return;

    e.visible = visible;
    if (!visible) return;

    if (animType === "slide") {
      e.opacity = Math.max(0.5, progress);
    } else {
      e.opacity = progress;
    }

    e.colorize = colorize;
  });
}

/**
 * 🔄 CAN THIỆP TRỰC TIẾP VÀO MODEL MATRIX CỦA XEIKOT ĐỂ XOAY HOẶC DI CHUYỂN MÁY MÓC
 */
function animateMachineryModels(viewer, task, mode, floatDay) {
  if (!viewer || !viewer.scene || !viewer.scene.models) return;

  const globalIds = timelineTaskElements[task.id] || [];

  Object.keys(viewer.scene.models).forEach(modelId => {
    const model = viewer.scene.models[modelId];
    if (!model) return;

    // Kiểm tra nếu model khớp với công việc hoặc tên chứa từ khóa máy móc
    const isMatch = globalIds.some(gid => modelId.includes(gid) || gid.includes(modelId)) ||
                    modelId.toLowerCase().includes("crane") || 
                    modelId.toLowerCase().includes("cẩu") ||
                    modelId.toLowerCase().includes("may") ||
                    modelId.toLowerCase().includes("xe");

    if (isMatch) {
      if (!modelBaseMatrices[modelId]) {
        modelBaseMatrices[modelId] = model.matrix ? Float32Array.from(model.matrix) : null;
      }

      if (model.matrix && modelBaseMatrices[modelId]) {
        const baseMat = modelBaseMatrices[modelId];
        const mat = Float32Array.from(baseMat);

        if (mode === "rotate") {
          // Xoay vòng tròn quanh trục Z (trục đứng)
          const angleRad = (floatDay * 15) * (Math.PI / 180);
          const cos = Math.cos(angleRad);
          const sin = Math.sin(angleRad);

          mat[0] = baseMat[0] * cos - baseMat[4] * sin;
          mat[1] = baseMat[1] * cos - baseMat[5] * sin;
          mat[4] = baseMat[0] * sin + baseMat[4] * cos;
          mat[5] = baseMat[1] * sin + baseMat[5] * cos;
        } else if (mode === "translate") {
          // Di chuyển tịnh tiến theo trục X
          const offset = Math.sin(floatDay * 0.5) * 8.0;
          mat[12] = baseMat[12] + offset;
        }

        model.matrix = mat;
      }
    }
  });
}

/**
 * 🏗️ XOAY TỰ ĐỘNG CÁC MODEL CẨU THÁP TRONG SCENE
 */
function animateAutoMachineryModels(viewer, floatDay) {
  if (!viewer || !viewer.scene || !viewer.scene.models) return;

  const angleRad = (floatDay * 12) * (Math.PI / 180);

  Object.keys(viewer.scene.models).forEach(modelId => {
    const lowerId = modelId.toLowerCase();
    if (lowerId.includes("crane") || lowerId.includes("cẩu") || lowerId.includes("tháp")) {
      const model = viewer.scene.models[modelId];
      if (!model) return;

      if (!modelBaseMatrices[modelId]) {
        modelBaseMatrices[modelId] = model.matrix ? Float32Array.from(model.matrix) : null;
      }

      if (model.matrix && modelBaseMatrices[modelId]) {
        const baseMat = modelBaseMatrices[modelId];
        const mat = Float32Array.from(baseMat);
        const cos = Math.cos(angleRad);
        const sin = Math.sin(angleRad);

        mat[0] = baseMat[0] * cos - baseMat[4] * sin;
        mat[1] = baseMat[1] * cos - baseMat[5] * sin;
        mat[4] = baseMat[0] * sin + baseMat[4] * cos;
        mat[5] = baseMat[1] * sin + baseMat[5] * cos;

        model.matrix = mat;
      }
    }
  });
}

function resetTimelineVisibility() {
  timelinePlaying = false;
  if (animationFrameId) cancelAnimationFrame(animationFrameId);
  const btn = document.getElementById("tlPlayBtn");
  if (btn) btn.innerText = "▶ Chạy";

  const viewer = window.xeokitViewer || window.viewer;
  if (viewer && viewer.scene) {
    viewer.scene.setObjectsVisible(viewer.scene.objectIds, true);
    viewer.scene.objectIds.forEach(id => {
      const e = viewer.scene.objects[id];
      if (e) {
        e.opacity = 1.0;
        e.colorize = null;
      }
    });

    // Khôi phục ma trận gốc của các model máy móc
    if (viewer.scene.models) {
      Object.keys(viewer.scene.models).forEach(modelId => {
        const model = viewer.scene.models[modelId];
        if (model && modelBaseMatrices[modelId]) {
          model.matrix = modelBaseMatrices[modelId];
        }
      });
    }

    viewer.scene._needUpdate = 1;
    if (typeof viewer.scene.render === "function") viewer.scene.render();
  }
}

/* ---------------------------------------------------------------------
   7. IMPORT EXCEL / MS PROJECT XML
   --------------------------------------------------------------------- */
function renderImportBox() {
  const box = document.getElementById("tlImportBox");
  if (!canEditTasks()) { box.innerHTML = ""; return; }
  box.innerHTML = `
    <div class="cde-file-card">
      <div class="fname" style="margin-bottom:6px;">📥 Import tiến độ có sẵn</div>
      <div style="font-size:10px;color:#888;margin-bottom:6px;">
        Excel: cần cột tên chứa "tên"/"name", "bắt đầu"/"start", "kết thúc"/"end"/"finish".<br>
        MS Project: xuất file XML.
      </div>
      <input type="file" id="tlImportFile" accept=".xlsx,.xls,.xml">
      <button class="btn" style="width:100%;margin-top:6px;" id="tlImportSubmit">Import</button>
    </div>`;
  document.getElementById("tlImportSubmit").addEventListener("click", handleTimelineImport);
}

async function handleTimelineImport() {
  const fileInput = document.getElementById("tlImportFile");
  const file = fileInput.files[0];
  if (!file) { alert("Chọn 1 file trước."); return; }

  const ext = (file.name.split(".").pop() || "").toLowerCase();
  try {
    let parsedTasks = [];
    if (ext === "xlsx" || ext === "xls") {
      parsedTasks = await parseExcelTasks(file);
    } else if (ext === "xml") {
      parsedTasks = await parseMsProjectXml(file);
    } else {
      alert("Chỉ hỗ trợ file .xlsx, .xls, .xml"); return;
    }

    if (parsedTasks.length === 0) { alert("Không đọc được công việc nào từ file này."); return; }
    if (!confirm(`Tìm thấy ${parsedTasks.length} công việc trong file. Thêm hết vào dự án?`)) return;

    const rows = parsedTasks.map(t => ({
      project_id: window.activeProjectId,
      name: t.name,
      task_type: "construction",
      animation_type: "fade",
      machine_mode: "none",
      planned_start: t.start,
      planned_end: t.end,
      color: TASK_TYPE_COLORS.construction,
      created_by: window.currentUser ? window.currentUser.id : null
    }));
    const { error } = await window.sb.from("project_tasks").insert(rows);
    if (error) { alert("Lỗi lưu vào database: " + error.message); return; }

    if (typeof window.showToast === "function") {
      window.showToast(`✅ Đã import ${rows.length} công việc`, "success");
    } else {
      alert("Import xong.");
    }
    await refreshTimelinePanel();
  } catch (e) {
    alert("Lỗi đọc file: " + e.message);
  }
}

function parseExcelTasks(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const workbook = XLSX.read(e.target.result, { type: "array", cellDates: true });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
        if (rows.length === 0) return resolve([]);

        const headers = Object.keys(rows[0]);
        const nameCol = headers.find(h => /tên|ten|name|công việc|cong viec|task/i.test(h));
        const startCol = headers.find(h => /bắt đầu|bat dau|start/i.test(h));
        const endCol = headers.find(h => /kết thúc|ket thuc|end|finish/i.test(h));
        if (!nameCol || !startCol || !endCol) {
          return reject(new Error("Không tìm thấy đủ cột tên/bắt đầu/kết thúc trong file Excel."));
        }

        const toIsoDate = (v) => {
          if (v instanceof Date) return v.toISOString().slice(0, 10);
          const d = new Date(v);
          return isNaN(d) ? null : d.toISOString().slice(0, 10);
        };

        const tasks = rows
          .map(r => ({ name: String(r[nameCol]).trim(), start: toIsoDate(r[startCol]), end: toIsoDate(r[endCol]) }))
          .filter(t => t.name && t.start && t.end);
        resolve(tasks);
      } catch (err) { reject(err); }
    };
    reader.onerror = () => reject(new Error("Không đọc được file."));
    reader.readAsArrayBuffer(file);
  });
}

/* ---------------------------------------------------------------------
   8. PARSE MS PROJECT XML
   --------------------------------------------------------------------- */
function parseMsProjectXml(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const xml = new DOMParser().parseFromString(e.target.result, "text/xml");
        const taskNodes = xml.getElementsByTagName("Task");
        const tasks = [];
        for (const node of taskNodes) {
          const name = node.getElementsByTagName("Name")[0]?.textContent?.trim();
          const start = node.getElementsByTagName("Start")[0]?.textContent?.slice(0, 10);
          const finish = node.getElementsByTagName("Finish")[0]?.textContent?.slice(0, 10);
          const isSummary = node.getElementsByTagName("Summary")[0]?.textContent === "1";
          if (name && start && finish && !isSummary) tasks.push({ name, start, end: finish });
        }
        resolve(tasks);
      } catch (err) { reject(err); }
    };
    reader.onerror = () => reject(new Error("Không đọc được file."));
    reader.readAsText(file);
  });
}

// Khởi tạo tự động UI khi nạp script
injectTimelineUI();