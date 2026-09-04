/* =====================================================================
   CDE TIMELINE MODULE — Tiến độ thi công 4D (kiểu Navisworks TimeLiner)
   Yêu cầu: chạy SAU cde-auth.js (dùng chung biến sb, activeProjectId,
   activeRole, currentUser) và SAU phần khởi tạo viewer xeokit trong
   index.html (dùng chung biến viewer, multiSelectedIds, multiSelectMode,
   showToast).
   ===================================================================== */

let timelineTasks = [];               // cache danh sách task của dự án đang chọn
let timelineTaskElements = {};        // { task_id: [globalId, ...] }
let timelineSelectedTaskId = null;    // task đang được chọn để gắn cấu kiện
let timelinePlaying = false;
let timelinePlayTimer = null;

const TASK_TYPE_LABELS = { construction: "Thi công", demolition: "Tháo dỡ", temporary: "Tạm thời" };
const TASK_TYPE_COLORS = { construction: "#3B82F6", demolition: "#EF4444", temporary: "#F59E0B" };

/* ---------------------------------------------------------------------
   1. DỰNG GIAO DIỆN
   --------------------------------------------------------------------- */
function injectTimelineUI() {
  const panel = document.createElement("div");
  panel.className = "panel";
  panel.id = "timelinePanel";
  panel.style.display = "none";
  panel.innerHTML = `
    <div class="panel-header">
      <b>📅 Tiến Độ Thi Công</b>
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
  if (!activeProjectId) {
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
   2. TẢI DỮ LIỆU
   --------------------------------------------------------------------- */
async function loadTimelineTasks() {
  const { data: tasks, error } = await sb
    .from("project_tasks")
    .select("*")
    .eq("project_id", activeProjectId)
    .order("planned_start", { ascending: true });

  if (error) { alert("Lỗi tải tiến độ: " + error.message); return; }
  timelineTasks = tasks || [];

  const taskIds = timelineTasks.map(t => t.id);
  timelineTaskElements = {};
  if (taskIds.length > 0) {
    const { data: links } = await sb.from("task_elements").select("task_id, global_id").in("task_id", taskIds);
    (links || []).forEach(l => {
      if (!timelineTaskElements[l.task_id]) timelineTaskElements[l.task_id] = [];
      timelineTaskElements[l.task_id].push(l.global_id);
    });
  }
}

function canEditTasks() {
  return ["author", "task_team_manager", "bim_manager"].includes(activeRole);
}

/* ---------------------------------------------------------------------
   3. THÊM / SỬA / XOÁ TASK
   --------------------------------------------------------------------- */
function renderAddTaskBox() {
  const box = document.getElementById("tlAddTaskBox");
  if (!canEditTasks()) { box.innerHTML = ""; return; }
  box.innerHTML = `
    <div class="cde-file-card">
      <div class="fname" style="margin-bottom:6px;">➕ Thêm công việc</div>
      <input type="text" id="tlNewName" placeholder="Tên công việc, vd: Đổ bê tông cột trục A">
      <select id="tlNewType" style="width:100%;padding:7px 8px;margin:4px 0;border:1px solid #dcdfe3;border-radius:6px;font-size:11px;">
        <option value="construction">Thi công (xây mới)</option>
        <option value="demolition">Tháo dỡ</option>
        <option value="temporary">Tạm thời (dàn giáo, cốp pha...)</option>
      </select>
      <div style="display:flex;gap:6px;">
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
  const start = document.getElementById("tlNewStart").value;
  const end = document.getElementById("tlNewEnd").value;

  if (!name || !start || !end) { alert("Điền đủ tên, ngày bắt đầu và kết thúc."); return; }
  if (end < start) { alert("Ngày kết thúc phải sau ngày bắt đầu."); return; }

  const { error } = await sb.from("project_tasks").insert({
    project_id: activeProjectId,
    name, task_type: type,
    planned_start: start, planned_end: end,
    color: TASK_TYPE_COLORS[type],
    created_by: currentUser.id
  });
  if (error) { alert("Lỗi thêm công việc: " + error.message); return; }

  document.getElementById("tlNewName").value = "";
  await refreshTimelinePanel();
}

async function deleteTimelineTask(taskId) {
  if (!confirm("Xoá công việc này? Cấu kiện gắn kèm cũng sẽ bị gỡ liên kết.")) return;
  const { error } = await sb.from("project_tasks").delete().eq("id", taskId);
  if (error) { alert("Lỗi xoá: " + error.message); return; }
  if (timelineSelectedTaskId === taskId) timelineSelectedTaskId = null;
  await refreshTimelinePanel();
}

/* ---------------------------------------------------------------------
   4. GẮN CẤU KIỆN 3D ĐÃ CHỌN VÀO TASK (dùng lại cơ chế "Chọn Nhiều" có sẵn)
   --------------------------------------------------------------------- */
async function attachSelectedElementsToTask(taskId) {
  if (typeof multiSelectedIds === "undefined" || multiSelectedIds.size === 0) {
    alert("Bấm nút 'Chọn Nhiều' trên thanh công cụ, chọn các cấu kiện trong mô hình 3D trước, rồi mới bấm nút này.");
    return;
  }
  const globalIds = [...multiSelectedIds].map(id => {
    const e = viewer.scene.objects[id];
    return (e && e.originalSystemId) || id;
  });

  const rows = globalIds.map(gid => ({ task_id: taskId, global_id: gid }));
  const { error } = await sb.from("task_elements").upsert(rows, { onConflict: "task_id,global_id" });
  if (error) { alert("Lỗi gắn cấu kiện: " + error.message); return; }

  showToast ? showToast(`✅ Đã gắn ${globalIds.length} cấu kiện vào công việc`, "success") : alert("Đã gắn cấu kiện.");
  await refreshTimelinePanel();
}

async function detachAllElementsFromTask(taskId) {
  if (!confirm("Gỡ toàn bộ cấu kiện đang gắn với công việc này?")) return;
  const { error } = await sb.from("task_elements").delete().eq("task_id", taskId);
  if (error) { alert("Lỗi: " + error.message); return; }
  await refreshTimelinePanel();
}

/* ---------------------------------------------------------------------
   5. DANH SÁCH TASK (dạng bảng + thanh Gantt đơn giản)
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
    card.innerHTML = `
      <div class="fname">${t.name} <span style="font-weight:400;color:#888;">(${TASK_TYPE_LABELS[t.task_type]})</span></div>
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
      btnDelete.innerText = "❌ Xoá công việc";
      btnDelete.addEventListener("click", () => deleteTimelineTask(t.id));
      actionsEl.appendChild(btnDelete);
    }

    box.appendChild(card);
  });
}

/* ---------------------------------------------------------------------
   6. THANH THỜI GIAN MÔ PHỎNG (kéo/play để xem mô hình theo tiến độ)
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
      <div class="fname">🎬 Mô phỏng tiến độ</div>
      <div style="display:flex;align-items:center;gap:8px;margin:8px 0;">
        <button id="tlPlayBtn" style="flex-shrink:0;">▶ Chạy</button>
        <input type="range" id="tlDateSlider" min="0" max="${totalDays}" value="0" style="flex:1;">
      </div>
      <div style="text-align:center;font-size:12px;font-weight:700;" id="tlDateLabel">${formatDateVN(minDate)}</div>
      <div class="actions" style="margin-top:6px;">
        <button id="tlResetVisBtn">↺ Hiện lại tất cả (thoát mô phỏng)</button>
      </div>
    </div>`;

  const slider = document.getElementById("tlDateSlider");
  slider.addEventListener("input", () => {
    const d = new Date(minDate.getTime() + slider.value * 86400000);
    document.getElementById("tlDateLabel").innerText = formatDateVN(d);
    applyTimelineDate(d);
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
    timelinePlayTimer = setInterval(() => {
      let val = parseInt(slider.value) + 1;
      if (val > totalDays) val = 0;
      slider.value = val;
      const d = new Date(minDate.getTime() + val * 86400000);
      document.getElementById("tlDateLabel").innerText = formatDateVN(d);
      applyTimelineDate(d);
    }, 400);
  } else {
    btn.innerText = "▶ Chạy";
    clearInterval(timelinePlayTimer);
  }
}

// Áp dụng ẩn/hiện lên viewer 3D theo ngày đang chọn trên thanh trượt.
// - construction: hiện từ ngày bắt đầu trở đi (xây xong thì tồn tại luôn)
// - demolition: hiện trong khoảng [bắt đầu, kết thúc), sau đó biến mất (đã tháo dỡ)
// - temporary: chỉ hiện trong đúng khoảng [bắt đầu, kết thúc]
function applyTimelineDate(currentDate) {
  const idsToShow = [];
  const idsToHide = [];

  // Map GlobalId -> danh sách object id thật đang có trong viewer (có thể
  // khác GlobalId gốc do bị globalize thành "<modelId>#<globalId>")
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
    let visible;
    if (t.task_type === "construction") visible = currentDate >= start;
    else if (t.task_type === "demolition") visible = currentDate >= start && currentDate < end;
    else visible = currentDate >= start && currentDate <= end;

    globalIds.forEach(gid => {
      const viewerIds = globalIdToViewerIds[gid] || [];
      (visible ? idsToShow : idsToHide).push(...viewerIds);
    });
  });

  if (idsToHide.length) viewer.scene.setObjectsVisible(idsToHide, false);
  if (idsToShow.length) viewer.scene.setObjectsVisible(idsToShow, true);
}

function resetTimelineVisibility() {
  clearInterval(timelinePlayTimer);
  timelinePlaying = false;
  const btn = document.getElementById("tlPlayBtn");
  if (btn) btn.innerText = "▶ Chạy";
  viewer.scene.setObjectsVisible(viewer.scene.objectIds, true);
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
        MS Project: xuất file theo Project → Save As → XML (không đọc được .mpp gốc).
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
      project_id: activeProjectId,
      name: t.name,
      task_type: "construction",
      planned_start: t.start,
      planned_end: t.end,
      color: TASK_TYPE_COLORS.construction,
      created_by: currentUser.id
    }));
    const { error } = await sb.from("project_tasks").insert(rows);
    if (error) { alert("Lỗi lưu vào database: " + error.message); return; }

    showToast ? showToast(`✅ Đã import ${rows.length} công việc`, "success") : alert("Import xong.");
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

injectTimelineUI();
