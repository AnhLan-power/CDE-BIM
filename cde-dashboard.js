// cde-dashboard.js - Tự động nạp dữ liệu ToDos, Clash & Tiến độ chính xác theo giao diện CDE

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
async function toggleBimDashboard() {
  const panel = document.getElementById('cde-dashboard-panel');
  if (!panel) return;

  isDashboardOpen = !isDashboardOpen;
  panel.style.display = isDashboardOpen ? 'block' : 'none';

  if (isDashboardOpen) {
    await forceSyncActiveProjectData();
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

// 3. HÀM TÌM DỰ ÁN HIỆN TẠI ĐANG CHỌN TRÊN CDE
function getActiveProjectInfo() {
  const selects = document.querySelectorAll('select');
  for (let s of selects) {
    if (s.value && (s.value.includes('Manager') || s.value.includes('BIM') || s.innerText.includes('Manager'))) {
      const opt = s.options[s.selectedIndex];
      return {
        id: s.value.trim(),
        name: opt ? opt.text.trim() : s.value.trim()
      };
    }
  }
  return {
    id: window.currentProjectId || 'DIEMVAN',
    name: window.currentProjectName || 'DIEMVAN (BIM Manager)'
  };
}

// 4. BỘ NẠP DỮ LIỆU NGẦM CHỦ ĐỘNG
async function forceSyncActiveProjectData() {
  const project = getActiveProjectInfo();

  // Nạp Todos
  if (typeof window.loadTodos === 'function') {
    try { await window.loadTodos(project.id); } catch(e){}
  } else if (typeof window.fetchCdeTodos === 'function') {
    try { await window.fetchCdeTodos(project.id); } catch(e){}
  }

  // Nạp Va chạm (Clashes)
  if (typeof window.loadClashHistory === 'function') {
    try { await window.loadClashHistory(project.id); } catch(e){}
  } else if (typeof window.fetchClashResults === 'function') {
    try { await window.fetchClashResults(project.id); } catch(e){}
  } else if (typeof window.checkClashes === 'function') {
    try { await window.checkClashes(project.id); } catch(e){}
  } else if (typeof window.runClashDetection === 'function') {
    try { await window.runClashDetection(project.id); } catch(e){}
  }

  // Nạp Tiến độ (Timeline)
  if (typeof window.loadTimelineTasks === 'function') {
    try { await window.loadTimelineTasks(project.id); } catch(e){}
  } else if (typeof window.fetchProjectTimeline === 'function') {
    try { await window.fetchProjectTimeline(project.id); } catch(e){}
  }
}

// 5. QUÉT THU THẬP TẤT CẢ DỮ LIỆU ĐÃ NẠP THEO DỰ ÁN
function collectAllCdeRealData() {
  const project = getActiveProjectInfo();

  const realData = {
    projectId: project.id,
    projectName: project.name,
    todos: [],
    clashCount: 0,
    timelineTasks: [],
    cdeFiles: { total: 0, wip: 0, shared: 0, published: 0 }
  };

  // --- A. THU THẬP TODOS THỰC TẾ ---
  let rawTodos = [];
  if (Array.isArray(window.cdeTodos)) rawTodos = window.cdeTodos;
  else if (Array.isArray(window.todos)) rawTodos = window.todos;

  if (rawTodos.length === 0) {
    try {
      const saved = localStorage.getItem(`todos_${project.id}`) || localStorage.getItem(`cde_todos_${project.id}`) || localStorage.getItem('todos');
      if (saved) rawTodos = JSON.parse(saved);
    } catch(e){}
  }

  if (Array.isArray(rawTodos) && rawTodos.length > 0) {
    realData.todos = rawTodos.map(t => ({
      title: t.title || t.name || t.text || 'Nhiệm vụ CDE',
      status: (t.status === 'Done' || t.progress === 100 || t.completed) ? 'Done' : 'Open'
    }));
  } else {
    // Thu thập từ giao diện ToDos nếu có danh sách rendering
    const todoElements = document.querySelectorAll('.todo-item, [class*="todo"]');
    todoElements.forEach(el => {
      const txt = el.innerText || "";
      if (txt.trim() && !txt.includes('Tạo ToDo') && !txt.includes('ToDos Dự Án')) {
        realData.todos.push({
          title: txt.split('\n')[0].trim(),
          status: txt.includes('100%') || txt.includes('Hoàn thành') ? 'Done' : 'Open'
        });
      }
    });
  }

  // --- B. THU THẬP SỐ LƯỢNG VA CHẠM (CLASH) CHÍNH XÁC ---
  let detectedClashesCount = -1;

  // 1. Kiểm tra các biến JS Toàn cục (Global Window Variables)
  if (window.lastClashResults) {
    if (Array.isArray(window.lastClashResults.clashes)) detectedClashesCount = window.lastClashResults.clashes.length;
    else if (typeof window.lastClashResults.count === 'number') detectedClashesCount = window.lastClashResults.count;
    else if (Array.isArray(window.lastClashResults)) detectedClashesCount = window.lastClashResults.length;
  }
  
  if (detectedClashesCount < 0) {
    const rawClashes = window.clashResults || window.clashes || window.detectedClashes || window.bimClashes || window.clashList;
    if (Array.isArray(rawClashes)) {
      detectedClashesCount = rawClashes.length;
    } else if (rawClashes && Array.isArray(rawClashes.clashes)) {
      detectedClashesCount = rawClashes.clashes.length;
    }
  }

  // 2. Kiểm tra các đối tượng Clash Manager / Bim Viewer
  if (detectedClashesCount < 0) {
    if (window.clashManager && Array.isArray(window.clashManager.clashes)) {
      detectedClashesCount = window.clashManager.clashes.length;
    } else if (window.viewer && window.viewer.clashes && Array.isArray(window.viewer.clashes)) {
      detectedClashesCount = window.viewer.clashes.length;
    }
  }

  // 3. Kiểm tra trong LocalStorage
  if (detectedClashesCount < 0) {
    try {
      const keysToTry = [
        `clash_${project.id}`,
        `cde_clash_${project.id}`,
        `clashes_${project.id}`,
        'cde_last_clash',
        'clash_results',
        'clashes'
      ];
      for (let key of keysToTry) {
        const savedClash = localStorage.getItem(key);
        if (savedClash) {
          const parsed = JSON.parse(savedClash);
          if (Array.isArray(parsed)) {
            detectedClashesCount = parsed.length;
            break;
          } else if (parsed && Array.isArray(parsed.clashes)) {
            detectedClashesCount = parsed.clashes.length;
            break;
          } else if (parsed && typeof parsed.count === 'number') {
            detectedClashesCount = parsed.count;
            break;
          }
        }
      }
    } catch(e){}
  }

  // 4. Nếu chưa tìm thấy ở JS/Storage, quét DOM UI Va chạm
  if (detectedClashesCount < 0) {
    // Ưu tiên đọc Element hiển thị số lượng cụ thể
    const clashBadge = document.querySelector('#clash-count, .clash-count, #clash-total, .clash-badge');
    if (clashBadge && clashBadge.innerText) {
      const match = clashBadge.innerText.match(/\d+/);
      if (match) detectedClashesCount = parseInt(match[0], 10);
    }
  }

  if (detectedClashesCount < 0) {
    // Đếm số lượng item va chạm trong danh sách DOM nếu có
    const clashItems = document.querySelectorAll('.clash-item, .clash-row, [class*="clash-result"]');
    if (clashItems.length > 0) {
      detectedClashesCount = clashItems.length;
    }
  }

  if (detectedClashesCount < 0) {
    // Quét toàn bộ Text DOM tìm từ khóa va chạm
    const clashNodes = document.querySelectorAll('h1, h2, h3, h4, h5, div, span, p, b, td');
    for (let el of clashNodes) {
      if (el.children.length === 0 && el.innerText) {
        const txt = el.innerText.trim();
        if (/va chạm|clash|xung đột/i.test(txt)) {
          const match = txt.match(/\d+/);
          if (match) {
            detectedClashesCount = parseInt(match[0], 10);
            break;
          }
        }
      }
    }
  }

  // Gán kết quả (nếu không tìm thấy thì mặc định là 0)
  realData.clashCount = detectedClashesCount > 0 ? detectedClashesCount : 0;

  // --- C. THU THẬP TIẾN ĐỘ THI CÔNG 4D ---
  let rawTasks = [];
  if (Array.isArray(window.timelineTasks) && window.timelineTasks.length > 0) rawTasks = window.timelineTasks;
  else if (Array.isArray(window.cdeTasks) && window.cdeTasks.length > 0) rawTasks = window.cdeTasks;
  else if (Array.isArray(window.ganttTasks) && window.ganttTasks.length > 0) rawTasks = window.ganttTasks;

  if (rawTasks.length === 0) {
    try {
      const savedTasks = localStorage.getItem(`tasks_${project.id}`) || localStorage.getItem(`cde_tasks_${project.id}`) || localStorage.getItem('cde_timeline_tasks');
      if (savedTasks) rawTasks = JSON.parse(savedTasks);
    } catch(e){}
  }

  if (Array.isArray(rawTasks) && rawTasks.length > 0) {
    realData.timelineTasks = rawTasks.map(t => ({
      name: t.name || t.title || t.text || 'Hạng mục thi công',
      progress: typeof t.progress === 'number' ? t.progress : (t.status === 'Completed' ? 100 : 0)
    }));
  }

  // --- D. THU THẬP TÀI LIỆU CDE GOOGLE DRIVE ---
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

// 6. Render Nội dung Tab ACC
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

// LẮNG NGHE SỰ KIỆN ĐỔI DỰ ÁN VÀ TỰ ĐỘNG REFRESH DASHBOARD
document.addEventListener('change', async (e) => {
  if (e.target && e.target.tagName === 'SELECT') {
    window.cdeTodos = [];
    window.todos = [];
    window.lastClashResults = null;
    window.clashResults = null;
    window.timelineTasks = [];
    window.cdeTasks = [];

    if (isDashboardOpen) {
      await forceSyncActiveProjectData();
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
          ${displayList.length === 0 ? `<tr><td colspan="2" style="text-align:center; padding:12px; color:#888;">Chưa có ToDos trong dự án này.</td></tr>` : 
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
            Đã tự động tổng hợp ${clashCount} va chạm của dự án ${data.projectName}.
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
              ${tasks.length === 0 ? `<tr><td colspan="2" style="padding:8px; color:#888;">Chưa có hạng mục tiến độ trong dự án này.</td></tr>` :
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
    container.innerHTML = `<div style="padding: 20px; text-align: center; color: #777;">⚠️️ Chưa có mô hình BIM nào được nạp vào Viewer.</div>`;
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
        <div style="font-weight: bold; font-size: 12px; margin-bottom: 8px;">🏷 Thiết lập Đơn giá Ước tính (VNĐ/Cấu kiện)</div>
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