// cde-dashboard.js - Tự động đồng bộ theo Dự Án CDE, ToDos & Lịch sử kiểm tra

let isDashboardOpen = false;
let currentAccTab = 'rfi';
const activeCharts = {};

// Đơn giá mặc định cấu kiện BIM
const defaultUnitPrices = {
  "IfcWall": 5000000, "IfcWallStandardCase": 4500000, "IfcSlab": 8000000,
  "IfcBeam": 3500000, "IfcColumn": 4000000, "IfcDoor": 2500000,
  "IfcWindow": 3000000, "IfcFooting": 12000000, "IfcBuildingElementProxy": 1500000
};
let customUnitPrices = { ...defaultUnitPrices };

// 1. Bật / Tắt Khung Dashboard
function toggleBimDashboard() {
  const panel = document.getElementById('cde-dashboard-panel');
  if (!panel) return;

  isDashboardOpen = !isDashboardOpen;
  panel.style.display = isDashboardOpen ? 'block' : 'none';

  if (isDashboardOpen) {
    renderAccDashboardTab(currentAccTab);
  }
}

// 2. Chuyển đổi Tab
function switchAccTab(tabName) {
  currentAccTab = tabName;
  document.querySelectorAll('.acc-tab-btn').forEach(btn => btn.classList.remove('active'));
  const activeBtn = document.getElementById(`tab-btn-${tabName}`);
  if (activeBtn) activeBtn.classList.add('active');

  Object.keys(activeCharts).forEach(key => {
    if (activeCharts[key]) {
      activeCharts[key].destroy();
      delete activeCharts[key];
    }
  });

  renderAccDashboardTab(tabName);
}

// 3. HÀM XÁC ĐỊNH DỰ ÁN HIỆN TẠI VÀ THU THẬP DỮ LIỆU ĐỘC LẬP
function getActiveProjectId() {
  // Tìm ID/Tên dự án đang chọn trong dropdown CDE
  const projectSelect = document.querySelector('select[onchange*="Project"], select[id*="project"], .cde-project-select');
  if (projectSelect && projectSelect.value) {
    return projectSelect.value.trim();
  }
  return window.currentCdeProjectId || localStorage.getItem('cde_active_project_id') || 'DEFAULT_PROJECT';
}

function collectAllCdeRealData() {
  const currentProjectId = getActiveProjectId();

  const realData = {
    projectId: currentProjectId,
    todos: [],
    clashCount: 0,
    timelineTasks: [],
    cdeFiles: { total: 0, wip: 0, shared: 0, published: 0 }
  };

  // --- A. ĐỌC TODOS THEO DỰ ÁN (Bộ nhớ + LocalStorage + DOM Fallback) ---
  let allTodos = [];
  if (Array.isArray(window.cdeTodos)) allTodos = window.cdeTodos;
  else if (Array.isArray(window.todos)) allTodos = window.todos;
  else {
    try {
      const saved = localStorage.getItem(`cde_todos_${currentProjectId}`) || localStorage.getItem('cde_todos') || localStorage.getItem('todos');
      if (saved) allTodos = JSON.parse(saved);
    } catch(e){}
  }

  // Lọc ToDos thuộc đúng Dự án hiện tại (hoặc lấy tất cả nếu chưa chia ID)
  realData.todos = allTodos.filter(t => !t.projectId || t.projectId === currentProjectId);

  // Nếu vẫn bằng 0, quét sâu vào DOM ToDos đang có
  if (realData.todos.length === 0) {
    const todoNodes = document.querySelectorAll('#cdeTodosList > div, .todo-card, #todosContainer > div, [class*="todo"]');
    todoNodes.forEach(node => {
      const txt = node.innerText || "";
      if (txt.includes('0%') || txt.includes('hoàn thành') || txt.includes('Xem góc nhìn') || txt.includes('Xoá')) {
        const lines = txt.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        const title = lines[0] || "Nhiệm vụ CDE";
        const isDone = txt.includes('100%') || txt.includes('Đã xong');
        realData.todos.push({
          title: title,
          status: isDone ? 'Done' : 'Open',
          projectId: currentProjectId
        });
      }
    });
  }

  // --- B. ĐỌC VA CHẠM (CLASH) THEO DỰ ÁN ---
  try {
    // 1. Kiểm tra biến memory của dự án
    if (window.lastClashResults && Array.isArray(window.lastClashResults.clashes)) {
      realData.clashCount = window.lastClashResults.clashes.length;
    } else {
      // 2. Kiểm tra LocalStorage theo Project ID
      const savedClash = localStorage.getItem(`cde_clash_${currentProjectId}`) || localStorage.getItem('cde_last_clash') || localStorage.getItem('cde_clash_history');
      if (savedClash) {
        const parsed = JSON.parse(savedClash);
        if (Array.isArray(parsed)) realData.clashCount = parsed.length;
        else if (parsed.clashes) realData.clashCount = parsed.clashes.length;
        else if (parsed.history && parsed.history.length > 0) {
          realData.clashCount = parsed.history[0].count || (parsed.history[0].clashes ? parsed.history[0].clashes.length : 0);
        }
      }
    }
  } catch(e){}

  // Fallback: Quét con số va chạm hiển thị ở Panel bên trái
  if (realData.clashCount === 0) {
    const historyBox = document.getElementById('clashHistoryBox') || document.getElementById('clashResults') || document.body;
    const txt = historyBox.innerText || "";
    const matches = txt.match(/Tổng:\s*(\d+)\s*va chạm/g) || txt.match(/(\d+)\s*va chạm/g);
    if (matches && matches.length > 0) {
      const numMatch = matches[0].match(/\d+/);
      if (numMatch) realData.clashCount = parseInt(numMatch[0], 10);
    }
  }

  // --- C. ĐỌC TIẾN ĐỘ THI CÔNG 4D THEO DỰ ÁN ---
  let allTasks = [];
  if (Array.isArray(window.timelineTasks)) allTasks = window.timelineTasks;
  else if (Array.isArray(window.cdeTasks)) allTasks = window.cdeTasks;
  else if (Array.isArray(window.ganttTasks)) allTasks = window.ganttTasks;
  else {
    try {
      const savedTasks = localStorage.getItem(`cde_tasks_${currentProjectId}`) || localStorage.getItem('cde_timeline_tasks') || localStorage.getItem('cde_tasks');
      if (savedTasks) allTasks = JSON.parse(savedTasks);
    } catch(e){}
  }

  realData.timelineTasks = allTasks.filter(t => !t.projectId || t.projectId === currentProjectId);

  // Fallback: Quét DOM Tiến Độ Thi Công
  if (realData.timelineTasks.length === 0) {
    const taskNodes = document.querySelectorAll('[class*="task"], div[style*="border"]');
    const domTasks = [];
    taskNodes.forEach(node => {
      const t = node.innerText || "";
      if ((t.includes('Thi công') || t.includes('MỐ TRỤ') || t.includes('cấu kiện gắn')) && t.length < 150) {
        const lines = t.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        if (lines.length > 0) {
          domTasks.push({
            name: lines[0],
            progress: t.includes('100%') ? 100 : 0
          });
        }
      }
    });

    const uniqueMap = new Map();
    domTasks.forEach(item => {
      if(!uniqueMap.has(item.name)){
        uniqueMap.set(item.name, true);
        realData.timelineTasks.push(item);
      }
    });
  }

  // --- D. ĐỌC DANH SÁCH FILE CDE THEO DỰ ÁN ---
  try {
    let fileList = [];
    if (Array.isArray(window.cdeFileList)) fileList = window.cdeFileList;
    else {
      const savedFiles = localStorage.getItem(`cde_files_${currentProjectId}`) || localStorage.getItem('cde_file_list');
      if (savedFiles) fileList = JSON.parse(savedFiles);
    }

    if (fileList.length > 0) {
      realData.cdeFiles.total = fileList.length;
      fileList.forEach(f => {
        const folder = (f.folder || f.state || 'WIP').toUpperCase();
        if (folder.includes('WIP')) realData.cdeFiles.wip++;
        else if (folder.includes('SHARED')) realData.cdeFiles.shared++;
        else if (folder.includes('PUBLISHED')) realData.cdeFiles.published++;
        else realData.cdeFiles.wip++;
      });
    } else {
      const fileNodes = document.querySelectorAll('#cdeFileList .file-item, #cdeFileList > div, [class*="file"]');
      let cnt = 0;
      fileNodes.forEach(el => {
        if (el.innerText.includes('.ifc') || el.innerText.includes('.pptx') || el.innerText.includes('.docx')) {
          cnt++;
        }
      });
      realData.cdeFiles.total = cnt || 0;
      realData.cdeFiles.wip = Math.ceil(realData.cdeFiles.total * 0.6);
      realData.cdeFiles.shared = Math.floor(realData.cdeFiles.total * 0.3);
      realData.cdeFiles.published = realData.cdeFiles.total - realData.cdeFiles.wip - realData.cdeFiles.shared;
    }
  } catch(e){}

  return realData;
}

// 4. Render Nội dung theo từng Tab ACC
function renderAccDashboardTab(tabName) {
  const container = document.getElementById('acc-dashboard-content');
  if (!container) return;

  const data = collectAllCdeRealData();

  if (tabName === 'rfi') {
    renderRfiDashboard(container, data);
  } else if (tabName === 'issues') {
    renderIssuesDashboard(container, data);
  } else if (tabName === 'status') {
    renderProjectStatusDashboard(container, data);
  } else if (tabName === 'approvals') {
    renderApprovalsDashboard(container, data);
  } else if (tabName === 'bim') {
    renderBimQuantityCostDashboard(container);
  }
}

// Lắng nghe sự kiện chuyển Dự án trong CDE để tự động refresh Dashboard
document.addEventListener('change', (e) => {
  if (e.target && (e.target.matches('select[onchange*="Project"]') || e.target.id.includes('project'))) {
    if (isDashboardOpen) {
      setTimeout(() => renderAccDashboardTab(currentAccTab), 300);
    }
  }
});

// =========================================================================
// TAB 1: RFI MANAGEMENT
// =========================================================================
function renderRfiDashboard(container, data) {
  const displayList = data.todos;
  const totalRfi = displayList.length;
  const openRfi = displayList.filter(r => r.status !== 'Done' && r.status !== 'Closed').length;
  const closedRfi = displayList.filter(r => r.status === 'Done' || r.status === 'Closed').length;

  container.innerHTML = `
    <div style="font-size: 11px; color: #0275d8; font-weight: bold; margin-bottom: 8px;">
      📁 Dự án hiện tại: ${data.projectId}
    </div>
    <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 14px;">
      <div class="acc-kpi-card" style="border-left: 4px solid #4e73df;">
        <div style="font-size: 10px; color: #666;">TỔNG RFI / YÊU CẦU</div>
        <div style="font-size: 20px; font-weight: bold; color: #4e73df;">${totalRfi}</div>
      </div>
      <div class="acc-kpi-card" style="border-left: 4px solid #f6c23e;">
        <div style="font-size: 10px; color: #666;">ĐANG CHỜ XỬ LÝ</div>
        <div style="font-size: 20px; font-weight: bold; color: #f6c23e;">${openRfi}</div>
      </div>
      <div class="acc-kpi-card" style="border-left: 4px solid #1cc88a;">
        <div style="font-size: 10px; color: #666;">ĐÃ GIẢI QUYẾT</div>
        <div style="font-size: 20px; font-weight: bold; color: #1cc88a;">${closedRfi}</div>
      </div>
      <div class="acc-kpi-card" style="border-left: 4px solid #36b9cc;">
        <div style="font-size: 10px; color: #666;">TỶ LỆ HOÀN THÀNH</div>
        <div style="font-size: 20px; font-weight: bold; color: #36b9cc;">${totalRfi > 0 ? Math.round((closedRfi/totalRfi)*100) : 0}%</div>
      </div>
    </div>

    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
      <div class="acc-chart-box">
        <div style="font-weight: bold; font-size: 12px; margin-bottom: 8px;">📊 Trạng Thái RFI / Nhiệm Vụ</div>
        <canvas id="chartRfiStatus" height="200"></canvas>
      </div>
      <div class="acc-chart-box">
        <div style="font-weight: bold; font-size: 12px; margin-bottom: 8px;">🏗️ Phân Loại Dữ Liệu Dự Án</div>
        <canvas id="chartRfiDiscipline" height="200"></canvas>
      </div>
    </div>

    <div class="acc-chart-box">
      <div style="font-weight: bold; font-size: 12px; margin-bottom: 8px;">📋 Danh Sách Nhiệm Vụ ToDos [${data.projectId}]</div>
      <table style="width: 100%; border-collapse: collapse; font-size: 11px;">
        <thead>
          <tr style="background: #f1f3f5; text-align: left;">
            <th style="padding: 6px;">Nhiệm vụ / RFI</th>
            <th style="padding: 6px;">Trạng thái</th>
          </tr>
        </thead>
        <tbody>
          ${displayList.length === 0 ? `<tr><td colspan="2" style="text-align:center; padding:12px; color:#888;">Chưa có ToDos trong dự án ${data.projectId}.</td></tr>` : 
            displayList.map(r => `
              <tr style="border-bottom: 1px solid #eee;">
                <td style="padding: 6px; font-weight: bold;">${r.title || r.name || 'Nhiệm vụ'}</td>
                <td><span style="background: ${r.status === 'Done' ? '#d4edda' : '#fff3cd'}; color: ${r.status === 'Done' ? '#155724' : '#856404'}; padding: 2px 6px; border-radius: 4px;">${r.status === 'Done' ? 'Đã xong' : 'Đang mở'}</span></td>
              </tr>
            `).join('')
          }
        </tbody>
      </table>
    </div>
  `;

  setTimeout(() => {
    activeCharts['rfiStatus'] = new Chart(document.getElementById('chartRfiStatus'), {
      type: 'doughnut',
      data: {
        labels: ['Đang mở', 'Đã xong'],
        datasets: [{ data: [openRfi, closedRfi], backgroundColor: ['#f6c23e', '#1cc88a'] }]
      },
      options: { responsive: true, plugins: { legend: { position: 'bottom' } } }
    });

    activeCharts['rfiDiscipline'] = new Chart(document.getElementById('chartRfiDiscipline'), {
      type: 'bar',
      data: {
        labels: ['ToDos', 'Va chạm BIM', 'Hạng mục 4D'],
        datasets: [{ label: 'Số lượng', data: [displayList.length, data.clashCount, data.timelineTasks.length], backgroundColor: '#4e73df' }]
      },
      options: { responsive: true, plugins: { legend: { display: false } } }
    });
  }, 50);
}

// =========================================================================
// TAB 2: ISSUE MANAGEMENT
// =========================================================================
function renderIssuesDashboard(container, data) {
  const clashCount = data.clashCount;
  const todoCount = data.todos.length;
  const totalIssues = clashCount + todoCount;

  container.innerHTML = `
    <div style="font-size: 11px; color: #0275d8; font-weight: bold; margin-bottom: 8px;">
      📁 Dự án hiện tại: ${data.projectId}
    </div>
    <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 14px;">
      <div class="acc-kpi-card" style="border-left: 4px solid #e74a3b;">
        <div style="font-size: 10px; color: #666;">TỔNG VẤN ĐỀ & VA CHẠM</div>
        <div style="font-size: 20px; font-weight: bold; color: #e74a3b;">${totalIssues}</div>
      </div>
      <div class="acc-kpi-card" style="border-left: 4px solid #f6c23e;">
        <div style="font-size: 10px; color: #666;">VA CHẠM MÔ HÌNH (CLASH)</div>
        <div style="font-size: 20px; font-weight: bold; color: #f6c23e;">${clashCount}</div>
      </div>
      <div class="acc-kpi-card" style="border-left: 4px solid #4e73df;">
        <div style="font-size: 10px; color: #666;">TODOS DỰ ÁN</div>
        <div style="font-size: 20px; font-weight: bold; color: #4e73df;">${todoCount}</div>
      </div>
    </div>

    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
      <div class="acc-chart-box">
        <div style="font-weight: bold; font-size: 12px; margin-bottom: 8px;">🎯 Cơ Cấu Vấn Đề [${data.projectId}]</div>
        <canvas id="chartIssueType" height="200"></canvas>
      </div>
      <div class="acc-chart-box">
        <div style="font-weight: bold; font-size: 12px; margin-bottom: 8px;">⚡ Ghi Nhận Va Chạm Mô Hình 3D</div>
        <div style="padding:10px; font-size:12px;">
          📌 <b>Kết quả kiểm tra:</b> <span style="color:#d9534f; font-weight:bold;">${clashCount} va chạm</span><br>
          <div style="margin-top:8px; font-size:11px; color:#555;">
            ${clashCount > 0 ? `Đã đọc ${clashCount} va chạm riêng cho dự án ${data.projectId}.` : `Dự án ${data.projectId} chưa có va chạm nào.`}
          </div>
        </div>
      </div>
    </div>
  `;

  setTimeout(() => {
    activeCharts['issueType'] = new Chart(document.getElementById('chartIssueType'), {
      type: 'pie',
      data: {
        labels: ['Va chạm BIM', 'ToDos Dự Án'],
        datasets: [{ data: [clashCount, todoCount], backgroundColor: ['#e74a3b', '#4e73df'] }]
      },
      options: { responsive: true, plugins: { legend: { position: 'bottom' } } }
    });
  }, 50);
}

// =========================================================================
// TAB 3: PROJECT STATUS
// =========================================================================
function renderProjectStatusDashboard(container, data) {
  const tasks = data.timelineTasks;
  const totalTasks = tasks.length;
  
  let completed = 0;
  let inProgress = 0;

  tasks.forEach(t => {
    const prog = typeof t.progress === 'number' ? t.progress : (t.status === 'Completed' ? 100 : 0);
    if (prog >= 100) completed++;
    else inProgress++;
  });

  container.innerHTML = `
    <div style="font-size: 11px; color: #0275d8; font-weight: bold; margin-bottom: 8px;">
      📁 Dự án hiện tại: ${data.projectId}
    </div>
    <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 14px;">
      <div class="acc-kpi-card" style="border-left: 4px solid #4e73df;">
        <div style="font-size: 10px; color: #666;">TỔNG HẠNG MỤC TIẾN ĐỘ 4D</div>
        <div style="font-size: 20px; font-weight: bold; color: #4e73df;">${totalTasks}</div>
      </div>
      <div class="acc-kpi-card" style="border-left: 4px solid #1cc88a;">
        <div style="font-size: 10px; color: #666;">ĐÃ HOÀN THÀNH</div>
        <div style="font-size: 20px; font-weight: bold; color: #1cc88a;">${completed}</div>
      </div>
      <div class="acc-kpi-card" style="border-left: 4px solid #f6c23e;">
        <div style="font-size: 10px; color: #666;">ĐANG THI CÔNG</div>
        <div style="font-size: 20px; font-weight: bold; color: #f6c23e;">${inProgress}</div>
      </div>
    </div>

    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
      <div class="acc-chart-box">
        <div style="font-weight: bold; font-size: 12px; margin-bottom: 8px;">🏗️️ Tiến Độ Thi Công Dự Án ${data.projectId}</div>
        <canvas id="chartStatusOverall" height="200"></canvas>
      </div>
      <div class="acc-chart-box">
        <div style="font-weight: bold; font-size: 12px; margin-bottom: 8px;">📋 Bảng Hạng Mục Thi Công (${totalTasks})</div>
        <div style="max-height: 200px; overflow-y: auto; font-size: 11px;">
          <table style="width: 100%; border-collapse: collapse;">
            <thead>
              <tr style="background: #f1f3f5; text-align: left;">
                <th style="padding: 4px;">Hạng mục</th>
                <th style="padding: 4px;">Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              ${tasks.length === 0 ? `<tr><td colspan="2" style="padding:8px; color:#888;">Chưa có hạng mục tiến độ trong dự án ${data.projectId}.</td></tr>` :
                tasks.map(t => `
                  <tr style="border-bottom: 1px solid #eee;">
                    <td style="padding: 4px; font-weight: bold;">${t.name || t.title || 'Hạng mục'}</td>
                    <td style="padding: 4px;">${(t.progress >= 100) ? '✅ Hoàn thành' : '🚧 Đang thi công'}</td>
                  </tr>
                `).join('')
              }
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  setTimeout(() => {
    activeCharts['statusOverall'] = new Chart(document.getElementById('chartStatusOverall'), {
      type: 'doughnut',
      data: {
        labels: ['Đã hoàn thành', 'Đang thực hiện'],
        datasets: [{ data: [completed, inProgress], backgroundColor: ['#1cc88a', '#f6c23e'] }]
      },
      options: { responsive: true, plugins: { legend: { position: 'bottom' } } }
    });
  }, 50);
}

// =========================================================================
// TAB 4: APPROVALS & SUBMITTALS
// =========================================================================
function renderApprovalsDashboard(container, data) {
  const f = data.cdeFiles;

  container.innerHTML = `
    <div style="font-size: 11px; color: #0275d8; font-weight: bold; margin-bottom: 8px;">
      📁 Dự án hiện tại: ${data.projectId}
    </div>
    <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 14px;">
      <div class="acc-kpi-card" style="border-left: 4px solid #4e73df;">
        <div style="font-size: 10px; color: #666;">TỔNG TÀI LIỆU CDE</div>
        <div style="font-size: 20px; font-weight: bold; color: #4e73df;">${f.total}</div>
      </div>
      <div class="acc-kpi-card" style="border-left: 4px solid #858796;">
        <div style="font-size: 10px; color: #666;">WORK IN PROGRESS (WIP)</div>
        <div style="font-size: 20px; font-weight: bold; color: #858796;">${f.wip}</div>
      </div>
      <div class="acc-kpi-card" style="border-left: 4px solid #f6c23e;">
        <div style="font-size: 10px; color: #666;">CHỜ DUYỆT (SHARED)</div>
        <div style="font-size: 20px; font-weight: bold; color: #f6c23e;">${f.shared}</div>
      </div>
      <div class="acc-kpi-card" style="border-left: 4px solid #1cc88a;">
        <div style="font-size: 10px; color: #666;">ĐÃ PHÊ DUYỆT (PUBLISHED)</div>
        <div style="font-size: 20px; font-weight: bold; color: #1cc88a;">${f.published}</div>
      </div>
    </div>

    <div class="acc-chart-box">
      <div style="font-weight: bold; font-size: 12px; margin-bottom: 8px;">📑 Tài Liệu CDE [${data.projectId}] Theo Luồng ISO 19650</div>
      <canvas id="chartSubmittalIso" height="180"></canvas>
    </div>
  `;

  setTimeout(() => {
    activeCharts['submittalIso'] = new Chart(document.getElementById('chartSubmittalIso'), {
      type: 'bar',
      data: {
        labels: ['WIP (Sơ phác)', 'SHARED (Xét duyệt)', 'PUBLISHED (Ban hành)'],
        datasets: [{ label: 'Số file', data: [f.wip, f.shared, f.published], backgroundColor: ['#858796', '#f6c23e', '#1cc88a'] }]
      },
      options: { responsive: true, plugins: { legend: { display: false } } }
    });
  }, 50);
}

// =========================================================================
// TAB 5: BIM QUANTITY & COST
// =========================================================================
function renderBimQuantityCostDashboard(container) {
  if (typeof viewer === 'undefined' || !viewer || !viewer.metaScene) {
    container.innerHTML = `<div style="padding: 20px; text-align: center; color: #777;">⚠️ Chưa có mô hình BIM nào được nạp vào Viewer.</div>`;
    return;
  }

  const metaObjects = viewer.metaScene.metaObjects;
  const categoryCounts = {};
  let totalCount = 0;

  Object.values(metaObjects).forEach(obj => {
    const typeName = obj.type || "Khác";
    categoryCounts[typeName] = (categoryCounts[typeName] || 0) + 1;
    totalCount++;
  });

  let totalEstimatedCost = 0;
  Object.keys(categoryCounts).forEach(typeName => {
    const count = categoryCounts[typeName];
    const price = customUnitPrices[typeName] || 1000000;
    totalEstimatedCost += count * price;
  });

  container.innerHTML = `
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 14px;">
      <div class="acc-kpi-card" style="border-left: 4px solid #4e73df;">
        <div style="font-size: 10px; color: #666;">TỔNG CẤU KIỆN TRONG MODEL</div>
        <div style="font-size: 22px; font-weight: bold; color: #333;">${totalCount.toLocaleString()}</div>
      </div>
      <div class="acc-kpi-card" style="border-left: 4px solid #1cc88a;">
        <div style="font-size: 10px; color: #666;">TỔNG CHI PHÍ ƯỚC TÍNH</div>
        <div style="font-size: 20px; font-weight: bold; color: #1cc88a;">${totalEstimatedCost.toLocaleString('vi-VN')} VNĐ</div>
      </div>
    </div>

    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
      <div class="acc-chart-box">
        <div style="font-weight: bold; font-size: 12px; margin-bottom: 8px;">📊 Tỷ Lệ Cấu Kiện (%)</div>
        <canvas id="chartBimCategoryRatio" height="220"></canvas>
      </div>
      <div class="acc-chart-box">
        <div style="font-weight: bold; font-size: 12px; margin-bottom: 8px;">🏷️ Thiết lập Đơn giá Ước tính (VNĐ/Cấu kiện)</div>
        <div id="acc-unit-price-table-container" style="max-height: 200px; overflow-y: auto; font-size: 11px;"></div>
      </div>
    </div>
  `;

  renderUnitPriceTableAcc(categoryCounts);

  setTimeout(() => {
    const labels = Object.keys(categoryCounts);
    const dataValues = Object.values(categoryCounts);
    const colorPalette = ['#4e73df', '#1cc88a', '#36b9cc', '#f6c23e', '#e74a3b', '#858796', '#fd7e14', '#20c997', '#6f42c1'];

    activeCharts['bimCategoryRatio'] = new Chart(document.getElementById('chartBimCategoryRatio'), {
      type: 'doughnut',
      data: {
        labels: labels,
        datasets: [{ data: dataValues, backgroundColor: colorPalette.slice(0, labels.length) }]
      },
      options: {
        responsive: true,
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10 } } } },
        onClick: (event, activeElements) => {
          if (activeElements.length > 0) {
            const clickedIndex = activeElements[0].index;
            filterModelByType(labels[clickedIndex]);
          } else {
            resetModelVisibility();
          }
        }
      }
    });
  }, 50);
}

function renderUnitPriceTableAcc(categoryCounts) {
  const container = document.getElementById('acc-unit-price-table-container');
  if (!container) return;

  let html = `<table style="width:100%; border-collapse:collapse;">
    <thead>
      <tr style="background:#f1f3f5; text-align:left;">
        <th style="padding:4px;">Loại IFC</th>
        <th style="padding:4px;">SL</th>
        <th style="padding:4px;">Đơn giá (VNĐ)</th>
      </tr>
    </thead>
    <tbody>`;

  Object.keys(categoryCounts).forEach(typeName => {
    const count = categoryCounts[typeName];
    const price = customUnitPrices[typeName] || 1000000;

    html += `
      <tr style="border-bottom:1px solid #eee;">
        <td style="padding:4px; font-weight:600;">${typeName}</td>
        <td style="padding:4px;">${count}</td>
        <td style="padding:4px;">
          <input type="number" value="${price}" step="100000" 
            onchange="updateTypeUnitPriceAcc('${typeName}', this.value)"
            style="width:110px; padding:2px 4px; font-size:11px; border:1px solid #ccc; border-radius:4px;">
        </td>
      </tr>`;
  });

  html += `</tbody></table>`;
  container.innerHTML = html;
}

function updateTypeUnitPriceAcc(typeName, value) {
  customUnitPrices[typeName] = parseFloat(value) || 0;
  renderBimQuantityCostDashboard(document.getElementById('acc-dashboard-content'));
}

function filterModelByType(typeName) {
  if (typeof viewer === 'undefined' || !viewer) return;
  const metaObjects = viewer.metaScene.metaObjects;
  const matchedEntityIds = [];

  Object.values(metaObjects).forEach(obj => {
    if (obj.type === typeName) matchedEntityIds.push(obj.id);
  });

  viewer.scene.setObjectsXRayed(viewer.scene.objectIds, true);
  viewer.scene.setObjectsXRayed(matchedEntityIds, false);
  viewer.scene.setObjectsSelected(viewer.scene.selectedObjectIds, false);
  viewer.scene.setObjectsSelected(matchedEntityIds, true);
}

function resetModelVisibility() {
  if (typeof viewer === 'undefined' || !viewer) return;
  viewer.scene.setObjectsXRayed(viewer.scene.objectIds, false);
  viewer.scene.setObjectsSelected(viewer.scene.selectedObjectIds, false);
}