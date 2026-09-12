/* =====================================================================
   CDE TODOS MODULE — Giao việc kiểu Trimble Connect ToDos.
   Dùng chung sb, activeProjectId, activeRole, currentUser, currentProjects
   (từ cde-auth.js) và viewer (window.viewer).
   ===================================================================== */

const TODO_PRIORITY_LABELS = { low: "Thấp", normal: "Bình thường", high: "Cao" };
const TODO_TYPE_LABELS = { undefined: "Chưa phân loại", issue: "Vấn đề", clash: "Va chạm", rfi: "RFI", task: "Công việc" };

let cdeProjectMembersCache = [];

function injectTodosUI() {
  const panel = document.createElement("div");
  panel.className = "panel";
  panel.id = "todosPanel";
  panel.style.display = "none";
  panel.innerHTML = `
    <div class="panel-header">
      <b>✅ ToDos</b>
      <span style="cursor:pointer" onclick="document.getElementById('todosPanel').style.display='none'">✕</span>
    </div>
    <div id="tdNoProjectMsg" style="color:#999;padding:8px 0;">Vào panel 📁 CDE, chọn dự án trước đã.</div>
    <div id="tdContent" style="display:none;">
      <div id="tdAddBox"></div>
      <div class="cde-status-tabs" id="tdStatusTabs"></div>
      <div id="tdListBox"></div>
    </div>`;
  document.body.appendChild(panel);
}

let tdActiveTab = "open";

window.toggleTodosPanel = function () {
  const p = document.getElementById("todosPanel");
  const willShow = p.style.display !== "block";
  p.style.display = willShow ? "block" : "none";
  if (willShow) refreshTodosPanel();
};

async function refreshTodosPanel() {
  if (!activeProjectId) {
    document.getElementById("tdNoProjectMsg").style.display = "block";
    document.getElementById("tdContent").style.display = "none";
    return;
  }
  document.getElementById("tdNoProjectMsg").style.display = "none";
  document.getElementById("tdContent").style.display = "block";

  await loadProjectMembersForTodos();
  renderAddTodoBox();
  renderTodoStatusTabs();
}

function canEditTodos() {
  return ["author", "task_team_manager", "bim_manager"].includes(activeRole);
}

async function loadProjectMembersForTodos() {
  const { data: members, error: memErr } = await sb
    .from("project_members")
    .select("user_id, role")
    .eq("project_id", activeProjectId);

  if (memErr || !members || members.length === 0) {
    console.warn("Không tải được project_members:", memErr);
    cdeProjectMembersCache = [];
    return;
  }

  const userIds = members.map(m => m.user_id);
  const { data: profiles } = await sb
    .from("profiles")
    .select("id, full_name, email")
    .in("id", userIds);

  const profileById = {};
  (profiles || []).forEach(p => { profileById[p.id] = p; });

  cdeProjectMembersCache = members.map(m => ({
    user_id: m.user_id,
    role: m.role,
    profiles: profileById[m.user_id] || null
  }));
}

/* ---------------------------------------------------------------------
   1. TẠO TODO MỚI (gọi được kèm sẵn dữ liệu — dùng từ Check Va Chạm)
   --------------------------------------------------------------------- */
function renderAddTodoBox(prefill) {
  const box = document.getElementById("tdAddBox");
  if (!canEditTodos()) { box.innerHTML = ""; return; }

  const memberOptions = cdeProjectMembersCache.map(m =>
    `<label style="display:block;font-size:11px;margin:2px 0;">
      <input type="checkbox" class="td-assignee-cb" value="${m.user_id}" ${prefill && prefill.assignees && prefill.assignees.includes(m.user_id) ? "checked" : ""}>
      ${m.profiles?.full_name || m.profiles?.email || m.user_id}
    </label>`).join("");

  const typeOptions = Object.entries(TODO_TYPE_LABELS)
    .map(([k, v]) => `<option value="${k}" ${prefill && prefill.type === k ? "selected" : ""}>${v}</option>`).join("");
  const priorityOptions = Object.entries(TODO_PRIORITY_LABELS)
    .map(([k, v]) => `<option value="${k}">${v}</option>`).join("");

  const box2 = document.createElement("div");
  box.innerHTML = "";
  box2.className = "cde-file-card";
  box2.innerHTML = `
    <div class="fname">➕ Tạo ToDo mới</div>
    <input type="text" id="tdNewTitle" placeholder="Tiêu đề (bắt buộc)" value="${prefill?.title ? prefill.title.replace(/"/g, "&quot;") : ""}">
    <input type="text" id="tdNewDesc" placeholder="Mô tả" value="${prefill?.description ? prefill.description.replace(/"/g, "&quot;") : ""}">
    <div style="display:flex;gap:6px;">
      <select id="tdNewType" style="flex:1;">${typeOptions}</select>
      <select id="tdNewPriority" style="flex:1;">${priorityOptions}</select>
    </div>
    <div style="display:flex;gap:6px;">
      <input type="date" id="tdNewDue" style="flex:1;">
      <input type="number" id="tdNewCompletion" min="0" max="100" placeholder="% hoàn thành" style="flex:1;">
    </div>
    <input type="text" id="tdNewTags" placeholder="Tags, cách nhau bởi dấu phẩy">
    <label style="display:block;font-size:11px;margin:6px 0;">
      <input type="checkbox" id="tdAttachView" ${prefill?.autoSaveView ? "checked disabled" : ""}>
      📷 Đính kèm góc nhìn camera hiện tại
    </label>
    <div style="font-size:10px;color:#888;margin-top:4px;">Người phụ trách:</div>
    <div style="max-height:90px;overflow-y:auto;border:1px solid #eee;border-radius:6px;padding:4px 6px;">${memberOptions || "<i style='font-size:11px;color:#999;'>Chưa có thành viên khác</i>"}</div>
    ${prefill && prefill.linkedGlobalIds ? `<div class="meta" style="margin-top:4px;">🔗 Đã liên kết ${prefill.linkedGlobalIds.length} cấu kiện + 1 góc nhìn camera</div>` : ""}
    <button class="btn btn-primary" style="width:100%;margin-top:6px;" id="tdSubmitBtn">Tạo ToDo</button>`;
  box.appendChild(box2);

  if (prefill?.dueDate) document.getElementById("tdNewDue").value = prefill.dueDate;

  document.getElementById("tdSubmitBtn").addEventListener("click", () => submitNewTodo(prefill));
}

async function submitNewTodo(prefill) {
  const title = document.getElementById("tdNewTitle").value.trim();
  const description = document.getElementById("tdNewDesc").value.trim();
  const type = document.getElementById("tdNewType").value;
  const priority = document.getElementById("tdNewPriority").value;
  const dueDate = document.getElementById("tdNewDue").value || null;
  const completion = parseInt(document.getElementById("tdNewCompletion").value) || 0;
  const tags = document.getElementById("tdNewTags").value.split(",").map(t => t.trim()).filter(Boolean);
  const assigneeIds = [...document.querySelectorAll(".td-assignee-cb:checked")].map(cb => cb.value);

  if (!title) { alert("Nhập tiêu đề."); return; }

  let linkedViewId = null;
  const wantsView = document.getElementById("tdAttachView")?.checked;
  if (wantsView) {
    const cam = viewer.camera;
    const { data: viewRow, error: viewErr } = await sb.from("project_views").insert({
      project_id: activeProjectId,
      title: "Góc nhìn cho: " + title,
      description: "Tự động lưu khi tạo ToDo",
      camera_eye: [...cam.eye], camera_look: [...cam.look], camera_up: [...cam.up],
      thumbnail: (typeof captureThumbnail === "function") ? captureThumbnail() : null,
      created_by: currentUser.id
    }).select().single();
    if (!viewErr) linkedViewId = viewRow.id;
  }

  const { data: todo, error } = await sb.from("project_todos").insert({
    project_id: activeProjectId,
    title, description,
    due_date: dueDate,
    priority, completion_percent: completion,
    todo_type: type, tags,
    linked_view_id: linkedViewId,
    linked_global_ids: prefill?.linkedGlobalIds || null,
    created_by: currentUser.id
  }).select().single();

  if (error) { alert("Lỗi tạo ToDo: " + error.message); return; }

  if (assigneeIds.length > 0) {
    const rows = assigneeIds.map(uid => ({ todo_id: todo.id, user_id: uid }));
    await sb.from("project_todo_assignees").insert(rows);
  }

  showToast ? showToast("✅ Đã tạo ToDo", "success") : alert("Đã tạo ToDo.");
  renderAddTodoBox();
  renderTodoStatusTabs();
}

/* ---------------------------------------------------------------------
   2. DANH SÁCH TODO (tab Đang mở / Đã xong)
   --------------------------------------------------------------------- */
function renderTodoStatusTabs() {
  const tabsEl = document.getElementById("tdStatusTabs");
  tabsEl.innerHTML = "";
  [["open", "Đang mở"], ["closed", "Đã xong"]].forEach(([key, label]) => {
    const tab = document.createElement("div");
    tab.className = "cde-status-tab" + (tdActiveTab === key ? " active" : "");
    tab.innerText = label;
    tab.addEventListener("click", () => { tdActiveTab = key; renderTodoStatusTabs(); });
    tabsEl.appendChild(tab);
  });
  loadTodosList();
}

async function loadTodosList() {
  const box = document.getElementById("tdListBox");
  box.innerHTML = "Đang tải...";

  const { data, error } = await sb
    .from("project_todos")
    .select("*, project_todo_assignees(user_id, profiles(full_name))")
    .eq("project_id", activeProjectId)
    .eq("status", tdActiveTab)
    .order("created_at", { ascending: false });

  if (error) { box.innerHTML = `<div style="color:#d9534f">${error.message}</div>`; return; }
  if (!data || data.length === 0) { box.innerHTML = `<div style="color:#999;padding:8px 0;">Không có ToDo nào.</div>`; return; }

  box.innerHTML = "";
  data.forEach(t => box.appendChild(buildTodoCard(t)));
}

const PRIORITY_COLORS = { low: "#6c757d", normal: "#0275d8", high: "#d9534f" };

function buildTodoCard(t) {
  const card = document.createElement("div");
  card.className = "cde-file-card";
  const assignNames = (t.project_todo_assignees || []).map(a => a.profiles?.full_name).filter(Boolean).join(", ") || "Chưa gán";
  card.innerHTML = `
    <div class="fname">${t.title}
      <span style="font-weight:400;color:${PRIORITY_COLORS[t.priority]};font-size:10px;">● ${TODO_PRIORITY_LABELS[t.priority]}</span>
    </div>
    <div class="meta">
      ${TODO_TYPE_LABELS[t.todo_type]} · ${t.completion_percent}% hoàn thành ${t.due_date ? "· Hạn " + t.due_date : ""}<br>
      ${t.description || ""}<br>
      👤 ${assignNames}
    </div>
    <div class="actions" id="tdActions_${t.id}"></div>`;

  const actionsEl = card.querySelector(".actions");

  if (t.linked_view_id) {
    const btnView = document.createElement("button");
    btnView.innerText = "📷 Xem góc nhìn";
    btnView.addEventListener("click", async () => {
      const { data: v } = await sb.from("project_views").select("*").eq("id", t.linked_view_id).single();
      if (v) window.flyToView(v);
    });
    actionsEl.appendChild(btnView);
  }

  if (t.linked_global_ids && t.linked_global_ids.length > 0) {
    const btnElems = document.createElement("button");
    btnElems.innerText = "🎯 Xem cấu kiện";
    btnElems.addEventListener("click", () => highlightTodoElements(t.linked_global_ids));
    actionsEl.appendChild(btnElems);
  }

  if (canEditTodos()) {
    const btnToggle = document.createElement("button");
    btnToggle.innerText = t.status === "open" ? "✓ Đánh dấu xong" : "↺ Mở lại";
    btnToggle.addEventListener("click", () => toggleTodoStatus(t.id, t.status));
    actionsEl.appendChild(btnToggle);

    const btnDelete = document.createElement("button");
    btnDelete.innerText = "❌ Xoá";
    btnDelete.addEventListener("click", () => deleteTodo(t.id));
    actionsEl.appendChild(btnDelete);
  }

  return card;
}

function highlightTodoElements(globalIds) {
  const resolved = [];
  globalIds.forEach(gid => {
    if (viewer.scene.objects[gid]) { resolved.push(gid); return; }
    for (const id of viewer.scene.objectIds) {
      const e = viewer.scene.objects[id];
      if (e && e.originalSystemId === gid) { resolved.push(id); break; }
    }
  });
  if (resolved.length === 0) { alert("Không tìm thấy cấu kiện nào trong model đang mở."); return; }

  if (resolved.length === 2 && window.highlightClashPair) {
    window.highlightClashPair(resolved[0], resolved[1]);
    return;
  }

  resolved.forEach(id => { const e = viewer.scene.objects[id]; if (e) e.colorize = [1, 0.3, 0.3]; });
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  resolved.forEach(id => {
    const aabb = viewer.scene.objects[id]?.aabb;
    if (!aabb) return;
    minX = Math.min(minX, aabb[0]); minY = Math.min(minY, aabb[1]); minZ = Math.min(minZ, aabb[2]);
    maxX = Math.max(maxX, aabb[3]); maxY = Math.max(maxY, aabb[4]); maxZ = Math.max(maxZ, aabb[5]);
  });
  viewer.cameraFlight.flyTo({ aabb: [minX, minY, minZ, maxX, maxY, maxZ], duration: 0.6 });
}

async function toggleTodoStatus(id, currentStatus) {
  const newStatus = currentStatus === "open" ? "closed" : "open";
  const { error } = await sb.from("project_todos").update({ status: newStatus }).eq("id", id);
  if (error) { alert("Lỗi: " + error.message); return; }
  loadTodosList();
}

async function deleteTodo(id) {
  if (!confirm("Xoá ToDo này?")) return;
  const { error } = await sb.from("project_todos").delete().eq("id", id);
  if (error) { alert("Lỗi xoá: " + error.message); return; }
  loadTodosList();
}

/* ---------------------------------------------------------------------
   3. TẠO TODO TỪ 1 CẶP VA CHẠM (gọi từ Check Va Chạm / lịch sử va chạm)
   --------------------------------------------------------------------- */
window.createTodoFromClash = async function (labelA, labelB, globalIdA, globalIdB) {
  if (!activeProjectId) { alert("Chọn dự án trong panel CDE trước."); return; }
  document.getElementById("todosPanel").style.display = "block";
  await refreshTodosPanel();

  await loadProjectMembersForTodos();
  renderAddTodoBox({
    title: `Va chạm: ${labelA} × ${labelB}`,
    description: `Cấu kiện A: ${labelA}\nCấu kiện B: ${labelB}`,
    type: "clash",
    linkedGlobalIds: [globalIdA, globalIdB],
    autoSaveView: true
  });
  document.getElementById("tdAddBox").scrollIntoView({ behavior: "smooth" });
};

injectTodosUI();
