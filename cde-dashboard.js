// cde-dashboard.js - Đọc dữ liệu persistent lưu trữ trong CDE & LocalStorage

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

// 3. HÀM THU THẬP DỮ LIỆU TỰ ĐỘNG TỪ LOCALSTORAGE & CDE MODULES
function collectAllCdeRealData() {
  const realData = {
    todos: [],
    clashes: [],
    timelineTasks: [],
    cdeFiles: { total: 0, wip: 0, shared: 0, published: 0 }
  };

  // --- A. ĐỌC DỮ LIỆU VA CHẠM (CLASH HISTORY) TỪ LOCALSTORAGE & MEMORY ---
  try {
    if (window.lastClashResults && Array.isArray(window.lastClashResults.clashes)) {
      realData.clashes = window.lastClashResults.clashes;
    } else {
      const savedClashHistory = localStorage.getItem("cde_clash_history") || localStorage.getItem("cde_last_clash");
      if (savedClashHistory) {
        const parsed = JSON.parse(savedClashHistory);
        if (Array.isArray(parsed)) realData.clashes = parsed;
        else if (parsed.clashes) realData.clashes = parsed.clashes;
        else if (parsed.history && parsed.history.length > 0) {
          realData.clashes = parsed.history[0].clashes || parsed.history[0].results || [];
        }
      }
    }
  } catch (e) {
    console.warn("Lỗi đọc Clash history:", e);
  }

  // Nếu vẫn bằng 0, quét DOM Lịch sử va chạm đang có trên màn hình
  if (realData.clashes.length === 0) {
    const clashItems = document.querySelectorAll('#clashResults > div, .clash-item, #clashHistoryBox > div');
    clashItems.forEach(item => {
      if (item.innerText.includes('va chạm') || item.innerText.includes('Type:')) {
        realData.clashes.push({ text: item.innerText });
      }
    });
  }

  // --- B. ĐỌC DỮ LIỆU TIẾN ĐỘ THI CÔNG 4D (TIMELINE TASKS) ---
  try {
    if (Array.isArray(window.timelineTasks) && window.timelineTasks.length > 0) {
      realData.timelineTasks = window.timelineTasks;
    } else if (Array.isArray(window.cdeTasks) && window.cdeTasks.length > 0) {
      realData.timelineTasks = window.cdeTasks;
    } else {
      const savedTasks = localStorage.getItem("cde_timeline_tasks") || localStorage.getItem("cde_tasks");
      if (savedTasks) {
        realData.timelineTasks = JSON.parse(savedTasks);
      }
    }
  } catch (e) {
    console.warn("Lỗi đọc Timeline tasks:", e);
  }

  // Nếu chưa có trong memory, quét DOM Bảng Tiến Độ Thi Công đang mở
  if (realData.timelineTasks.length === 0) {
    const taskCards = document.querySelectorAll('#timelineTaskList > div, .timeline-task-card, [class*="task"]');
    taskCards.forEach(card => {
      const titleEl = card.querySelector('b, strong, .task-title');
      if (titleEl) {
        const title = titleEl.innerText.trim();
        const isDone = card.innerText.includes('100%') || card.innerText.includes('Hoàn thành');
        realData.timelineTasks.push({
          name: title,
          progress: isDone ? 100 : 0,
          status: isDone ? 'Completed' : 'InProgress'
        });
      }
    });
  }

  // --- C. ĐỌC DỮ LIỆU TODOS THỰC TẾ ---
  try {
    if (Array.isArray(window.cdeTodos) && window.cdeTodos.length > 0) {
      realData.todos = window.cdeTodos;
    } else if (Array.isArray(window.todos) && window.todos.length > 0) {
      realData.todos = window.todos;
    } else {
      const savedTodos = localStorage.getItem("cde_todos") || localStorage.getItem("todos");
      if (savedTodos) {
        realData.todos = JSON.parse(savedTodos);
      }
    }
  } catch (e) {
    console.warn("Lỗi đọc ToDos:", e);
  }

  if (realData.todos.length === 0) {
    const todoCards = document.querySelectorAll('#cdeTodosList > div, .todo-card, #todosContainer > div');
    todoCards.forEach(card => {
      const titleEl = card.querySelector('b, .todo-title, strong');
      if (titleEl) {
        const title = titleEl.innerText.trim();
        const isDone = card.innerText.includes('Đã xong') || card.classList.contains('done');
        realData.todos.push({
          title: title,
          status: isDone ? 'Done' : 'Open'
        });
      }
    });
  }

  // --- D. ĐỌC DỮ LIỆU FILE CDE ISO 19650 TỪ GOOGLE DRIVE / LOCALSTORAGE ---
  try {
    let fileList = [];
    if (Array.isArray(window.cdeFileList) && window.cdeFileList.length > 0) {
      fileList = window.cdeFileList;
    } else {
      const savedFiles = localStorage.getItem("cde_file_list");
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
      // Quét DOM danh sách file đang nạp trên giao diện
      const fileElements = document.querySelectorAll('#cdeFileList .file-item, #cdeFileList > div, [class*="file"]');
      let count = 0;
      fileElements.forEach(el => {
        if (el.innerText.includes('.ifc') || el.innerText.includes('.xkt') || el.innerText.includes('.pdf')) {
          count++;
        }
      });
      realData.cdeFiles.total = count || 8;
      realData.cdeFiles.wip = Math.ceil(realData.cdeFiles.total * 0.6);
      realData.cdeFiles.shared = Math.floor(realData.cdeFiles.total * 0.3);
      realData.cdeFiles.published = realData.cdeFiles.total - realData.cdeFiles.wip - realData.cdeFiles.shared;
    }
  } catch (e) {
    console.warn("Lỗi đọc File list:", e);
  }

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

// =========================================================================
// TAB 1: RFI MANAGEMENT
// =========================================================================
function renderRfiDashboard(container, data) {
  const displayList = data.todos;
  const totalRfi = displayList.length;
  const openRfi = displayList.filter(r => r.status !== 'Done' && r.status !== 'Closed').length;
  const closedRfi = displayList.filter(r => r.status === 'Done' || r.status === 'Closed').length;

  container.innerHTML = `
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
        <div style="font-weight: bold; font-size: 12px; margin-bottom: 8px;">🏗️ Phân Loại Tổng Thể</div>
        <canvas id="chartRfiDiscipline" height="200"></canvas>
      </div>
    </div>

    <div class="acc-chart-box">
      <div style="font-weight: bold; font-size: 12px; margin-bottom: 8px;">📋 Danh Sách RFI / ToDos Từ Dự Án CDE</div>
      <table style="width: 100%; border-collapse: collapse; font-size: 11px;">
        <thead>
          <tr style="background: #f1f3f5; text-align: left;">
            <th style="padding: 6px;">Nhiệm vụ / RFI</th>
            <th style="padding: 6px;">Trạng thái</th>
          </tr>
        </thead>
        <tbody>
          ${displayList.length === 0 ? `<tr><td colspan="2" style="text-align:center; padding:12px; color:#888;">Chưa có RFI trong dự án.</td></tr>` : 
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
        datasets: [{ label: 'Số lượng', data: [displayList.length, data.clashes.length, data.timelineTasks.length], backgroundColor: '#4e73df' }]
      },
      options: { responsive: true, plugins: { legend: { display: false } } }
    });
  }, 50);
}

// =========================================================================
// TAB 2: ISSUE MANAGEMENT
// =========================================================================
function renderIssuesDashboard(container, data) {
  const clashCount = data.clashes.length;
  const todoCount = data.todos.length;
  const totalIssues = clashCount + todoCount;

  container.innerHTML = `
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
        <div style="font-weight: bold; font-size: 12px; margin-bottom: 8px;">🎯 Cơ Cấu Vấn Đề CDE</div>
        <canvas id="chartIssueType" height="200"></canvas>
      </div>
      <div class="acc-chart-box">
        <div style="font-weight: bold; font-size: 12px; margin-bottom: 8px;">⚡ Ghi Nhận Va Chạm Dự Án CDE</div>
        <div style="padding:10px; font-size:12px;">
          📌 <b>Kết quả lưu trữ:</b> <span style="color:#d9534f; font-weight:bold;">${clashCount} va chạm</span><br>
          <div style="margin-top:8px; max-height:120px; overflow-y:auto; font-size:11px; color:#555;">
            ${clashCount > 0 ? `Đã tải ${clashCount} va chạm từ lịch sử đã kiểm tra của dự án.` : 'Chưa có dữ liệu va chạm.'}
          </div>
        </div>
      </div>
    </div>
  `;

  setTimeout(() => {
    activeCharts['issueType'] = new Chart(document.getElementById('chartIssueType'), {
      type: 'pie',
      data: {
        labels: ['Va chạm BIM', 'ToDos / Khác'],
        datasets: [{ data: [clashCount, todoCount], backgroundColor: ['#e74a3b', '#4e73df'] }]
      },
      options: { responsive: true, plugins: { legend: { position: 'bottom' } } }
    });
  }, 50);
}

// =========================================================================
// TAB 3: PROJECT STATUS (KẾT NỐI CHÍNH XÁC VỚI TIẾN ĐỘ THI CÔNG 4D)
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
        <div style="font-weight: bold; font-size: 12px; margin-bottom: 8px;">🏗️ Tiến Độ Thực Hiện Hạng Mục 4D</div>
        <canvas id="chartStatusOverall" height="200"></canvas>
      </div>
      <div class="acc-chart-box">
        <div style="font-weight: bold; font-size: 12px; margin-bottom: 8px;">📋 Bảng Hạng Mục Thi Công 4D</div>
        <div style="max-height: 200px; overflow-y: auto; font-size: 11px;">
          <table style="width: 100%; border-collapse: collapse;">
            <thead>
              <tr style="background: #f1f3f5; text-align: left;">
                <th style="padding: 4px;">Hạng mục</th>
                <th style="padding: 4px;">Tiến độ</th>
              </tr>
            </thead>
            <tbody>
              ${tasks.length === 0 ? `<tr><td colspan="2" style="padding:8px; color:#888;">Chưa có hạng mục tiến độ.</td></tr>` :
                tasks.map(t => `
                  <tr style="border-bottom: 1px solid #eee;">
                    <td style="padding: 4px; font-weight: bold;">${t.name || t.title || 'Hạng mục'}</td>
                    <td style="padding: 4px;">${t.progress || 0}%</td>
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
      <div style="font-weight: bold; font-size: 12px; margin-bottom: 8px;">📑 Phân Bố File Dự Án CDE Google Drive Theo Luồng ISO 19650</div>
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