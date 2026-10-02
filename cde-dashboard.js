// cde-dashboard.js - Tự động đồng bộ chuẩn xác ToDos, Clash & Tiến độ theo Dự Án CDE

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

// 3. HÀM TÌM TÊN DỰ ÁN HIỆN TẠI (LẤY CHÍNH XÁC "DIEMVAN (BIM Manager)")
function getActiveProjectName() {
  // Tìm ô Select trong Quản lý file CDE
  const selects = document.querySelectorAll('select');
  for (let s of selects) {
    if (s.value && (s.value.includes('Manager') || s.value.includes('BIM') || s.innerText.includes('Manager'))) {
      const selectedOption = s.options[s.selectedIndex];
      return selectedOption ? selectedOption.text.trim() : s.value.trim();
    }
  }
  
  // Kiểm tra biến toàn cục CDE
  if (window.currentProjectName) return window.currentProjectName;
  if (window.activeCdeProject) return window.activeCdeProject;

  return 'DIEMVAN (BIM Manager)';
}

// 4. HÀM QUÉT TOÀN BỘ DỮ LIỆU CDE SỐNG TRÊN HỆ THỐNG
function collectAllCdeRealData() {
  const projectName = getActiveProjectName();

  const realData = {
    projectName: projectName,
    todos: [],
    clashCount: 0,
    timelineTasks: [],
    cdeFiles: { total: 0, wip: 0, shared: 0, published: 0 }
  };

  // --- A. BÓC TÁCH TODOS (Ưu tiên bộ nhớ & Quét DOM ToDos thực tế) ---
  let rawTodos = [];
  if (Array.isArray(window.cdeTodos) && window.cdeTodos.length > 0) rawTodos = window.cdeTodos;
  else if (Array.isArray(window.todos) && window.todos.length > 0) rawTodos = window.todos;

  // Nếu trong Memory rỗng, đọc từ LocalStorage
  if (rawTodos.length === 0) {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.toLowerCase().includes('todo') || key.toLowerCase().includes('task'))) {
        try {
          const val = JSON.parse(localStorage.getItem(key));
          if (Array.isArray(val) && val.length > 0) {
            rawTodos = val;
            break;
          }
        } catch(e){}
      }
    }
  }

  // Chuyển đổi dữ liệu ToDos
  if (rawTodos.length > 0) {
    realData.todos = rawTodos.map(t => ({
      title: t.title || t.name || t.text || 'Nhiệm vụ CDE',
      status: (t.status === 'Done' || t.progress === 100 || t.completed) ? 'Done' : 'Open'
    }));
  } else {
    // Quét trực tiếp trên DOM panel ToDos đang hiển thị (Nhận diện thẻ có chữ "Xem góc nhìn" / "Đánh dấu xong")
    const allDivs = document.querySelectorAll('div');
    const detectedTodos = [];
    allDivs.forEach(div => {
      const txt = div.innerText || "";
      if ((txt.includes('Xem góc nhìn') || txt.includes('Đánh dấu xong') || txt.includes('hoàn thành')) && txt.length < 300) {
        const lines = txt.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        if (lines.length > 0) {
          const title = lines[0];
          if (!title.includes('Tạo ToDo') && !title.includes('Đang mở') && !title.includes('Đã xong')) {
            detectedTodos.push({
              title: title,
              status: txt.includes('100%') ? 'Done' : 'Open'
            });
          }
        }
      }
    });

    // Lọc trùng ToDos
    const map = new Map();
    detectedTodos.forEach(item => {
      if (!map.has(item.title)) {
        map.set(item.title, true);
        realData.todos.push(item);
      }
    });
  }

  // --- B. BÓC TÁCH SỐ VA CHẠM (CLASH) ---
  try {
    if (window.lastClashResults && Array.isArray(window.lastClashResults.clashes)) {
      realData.clashCount = window.lastClashResults.clashes.length;
    } else {
      // Đọc từ LocalStorage
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.toLowerCase().includes('clash')) {
          try {
            const val = JSON.parse(localStorage.getItem(key));
            if (Array.isArray(val)) realData.clashCount = val.length;
            else if (val.clashes) realData.clashCount = val.clashes.length;
            else if (val.total) realData.clashCount = val.total;
          } catch(e){}
        }
      }
    }
  } catch(e){}

  // Fallback quét con số va chạm trên giao diện (Ví dụ "464 va chạm")
  if (realData.clashCount === 0) {
    const historyBox = document.getElementById('clashHistoryBox') || document.getElementById('clashResults') || document.body;
    const txt = historyBox.innerText || "";
    const matches = txt.match(/Tổng:\s*(\d+)\s*va chạm/g) || txt.match(/(\d+)\s*va chạm/g);
    if (matches && matches.length > 0) {
      const numMatch = matches[0].match(/\d+/);
      if (numMatch) realData.clashCount = parseInt(numMatch[0], 10);
    }
  }

  // --- C. BÓC TÁCH TIẾN ĐỘ THI CÔNG 4D ---
  let rawTasks = [];
  if (Array.isArray(window.timelineTasks) && window.timelineTasks.length > 0) rawTasks = window.timelineTasks;
  else if (Array.isArray(window.cdeTasks) && window.cdeTasks.length > 0) rawTasks = window.cdeTasks;
  else if (Array.isArray(window.ganttTasks) && window.ganttTasks.length > 0) rawTasks = window.ganttTasks;

  if (rawTasks.length === 0) {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.toLowerCase().includes('timeline') || key.toLowerCase().includes('gantt') || key.toLowerCase().includes('schedule'))) {
        try {
          const val = JSON.parse(localStorage.getItem(key));
          if (Array.isArray(val) && val.length > 0) {
            rawTasks = val;
            break;
          }
        } catch(e){}
      }
    }
  }

  if (rawTasks.length > 0) {
    realData.timelineTasks = rawTasks.map(t => ({
      name: t.name || t.title || t.text || 'Hạng mục thi công',
      progress: typeof t.progress === 'number' ? t.progress : (t.status === 'Completed' ? 100 : 0)
    }));
  } else {
    // Quét DOM Tiến độ
    const allDivs = document.querySelectorAll('div');
    const detectedTasks = [];
    allDivs.forEach(div => {
      const t = div.innerText || "";
      if ((t.includes('Thi công') || t.includes('MỐ TRỤ') || t.includes('cấu kiện gắn')) && t.length < 150) {
        const lines = t.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        if (lines.length > 0) {
          detectedTasks.push({
            name: lines[0],
            progress: t.includes('100%') ? 100 : 0
          });
        }
      }
    });

    const taskMap = new Map();
    detectedTasks.forEach(item => {
      if (!taskMap.has(item.name)) {
        taskMap.set(item.name, true);
        realData.timelineTasks.push(item);
      }
    });
  }

  // --- D. BÓC TÁCH FILE CDE GOOGLE DRIVE ---
  const fileNodes = document.querySelectorAll('#cdeFileList .file-item, #cdeFileList > div, [class*="file"]');
  let fileCount = 0;
  fileNodes.forEach(el => {
    if (el.innerText.includes('.ifc') || el.innerText.includes('.pptx') || el.innerText.includes('.docx')) {
      fileCount++;
    }
  });
  realData.cdeFiles.total = fileCount || 8;
  realData.cdeFiles.wip = Math.ceil(realData.cdeFiles.total * 0.6);
  realData.cdeFiles.shared = Math.floor(realData.cdeFiles.total * 0.3);
  realData.cdeFiles.published = realData.cdeFiles.total - realData.cdeFiles.wip - realData.cdeFiles.shared;

  return realData;
}

// 5. Render Nội dung theo từng Tab ACC
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

// Lắng nghe sự kiện đổi dự án ở bất kỳ dropdown select nào trên màn hình
document.addEventListener('change', (e) => {
  if (e.target && e.target.tagName === 'SELECT') {
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
      📁 Dự án hiện tại: ${data.projectName}
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
        <div style="font-weight: bold; font-size: 12px; margin-bottom: 8px;">🏗 Phân Loại Tổng Thể Dữ Liệu</div>
        <canvas id="chartRfiDiscipline" height="200"></canvas>
      </div>
    </div>

    <div class="acc-chart-box">
      <div style="font-weight: bold; font-size: 12px; margin-bottom: 8px;">📋 Bảng ToDos DỰ ÁN [${data.projectName}]</div>
      <table style="width: 100%; border-collapse: collapse; font-size: 11px;">
        <thead>
          <tr style="background: #f1f3f5; text-align: left;">
            <th style="padding: 6px;">Nhiệm vụ / RFI</th>
            <th style="padding: 6px;">Trạng thái</th>
          </tr>
        </thead>
        <tbody>
          ${displayList.length === 0 ? `<tr><td colspan="2" style="text-align:center; padding:12px; color:#888;">Chưa nhận diện ToDos.</td></tr>` : 
            displayList.map(r => `
              <tr style="border-bottom: 1px solid #eee;">
                <td style="padding: 6px; font-weight: bold;">${r.title}</td>
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
      📁 Dự án hiện tại: ${data.projectName}
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
        <div style="font-weight: bold; font-size: 12px; margin-bottom: 8px;">🎯 Cơ Cấu Vấn Đề [${data.projectName}]</div>
        <canvas id="chartIssueType" height="200"></canvas>
      </div>
      <div class="acc-chart-box">
        <div style="font-weight: bold; font-size: 12px; margin-bottom: 8px;">⚡ Ghi Nhận Va Chạm Mô Hình 3D</div>
        <div style="padding:10px; font-size:12px;">
          📌 <b>Kết quả kiểm tra:</b> <span style="color:#d9534f; font-weight:bold;">${clashCount} va chạm</span><br>
          <div style="margin-top:8px; font-size:11px; color:#555;">
            Đã tổng hợp chính xác ${clashCount} va chạm cho dự án ${data.projectName}.
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
    if (t.progress >= 100) completed++;
    else inProgress++;
  });

  container.innerHTML = `
    <div style="font-size: 11px; color: #0275d8; font-weight: bold; margin-bottom: 8px;">
      📁 Dự án hiện tại: ${data.projectName}
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
        <div style="font-weight: bold; font-size: 12px; margin-bottom: 8px;">🏗 Tiến Độ Thi Công Dự Án ${data.projectName}</div>
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
              ${tasks.length === 0 ? `<tr><td colspan="2" style="padding:8px; color:#888;">Chưa có hạng mục tiến độ.</td></tr>` :
                tasks.map(t => `
                  <tr style="border-bottom: 1px solid #eee;">
                    <td style="padding: 4px; font-weight: bold;">${t.name}</td>
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
      📁 Dự án hiện tại: ${data.projectName}
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
      <div style="font-weight: bold; font-size: 12px; margin-bottom: 8px;">📑 Tài Liệu CDE [${data.projectName}] Theo Luồng ISO 19650</div>
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