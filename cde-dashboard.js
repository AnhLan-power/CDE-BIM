// cde-dashboard.js - Tự động đồng bộ và lưu vĩnh viễn số lượng Va Chạm chuẩn theo Dự Án

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

// 3. TÌM TÊN / ID DỰ ÁN DƯỚI DROPDOWN QUẢN LÝ FILE CDE
function getActiveProjectInfo() {
  let projId = window.activeProjectId || null;
  let projName = "PHUOCSON (BIM Manager)";

  const selects = document.querySelectorAll('select');
  for (let s of selects) {
    if (s.value && (s.value.includes('Manager') || s.value.includes('BIM') || s.innerText.includes('Manager') || s.innerText.includes('Task'))) {
      const opt = s.options[s.selectedIndex];
      projName = opt ? opt.text.trim() : s.value.trim();
      break;
    }
  }

  return { id: projId, name: projName };
}

// 4. HÀM BÓC TÁCH DỮ LIỆU CHÍNH XÁC & BỔ SUNG LƯU LOCALSTORAGE VĨNH VIỄN
async function collectAllCdeRealDataAsync() {
  const proj = getActiveProjectInfo();

  const realData = {
    projectId: proj.id,
    projectName: proj.name,
    todos: [],
    clashCount: 0,
    timelineTasks: [],
    cdeFiles: { total: 0, wip: 0, shared: 0, published: 0 }
  };

  const client = window.sb || window.supabaseClient;

  // --- A. LẤY TODOS TỪ SUPABASE (project_todos) ---
  let clashFromTodosCount = 0;
  if (client && proj.id) {
    try {
      const { data: todosData } = await client
        .from("project_todos")
        .select("*")
        .eq("project_id", proj.id);

      if (todosData && todosData.length > 0) {
        realData.todos = todosData.map(t => ({
          title: t.title || "Nhiệm vụ CDE",
          status: t.status === "closed" ? "Done" : "Open",
          priority: t.priority || "normal",
          type: t.todo_type || "task"
        }));

        const clashTodos = todosData.filter(t => t.todo_type === 'clash' || (t.title && t.title.toLowerCase().includes('va chạm')));
        clashFromTodosCount = clashTodos.length;
      }
    } catch (e) {
      console.warn("Lỗi đọc project_todos:", e);
    }
  }

  if (realData.todos.length === 0 && Array.isArray(window.cdeTodos) && window.cdeTodos.length > 0) {
    realData.todos = window.cdeTodos.map(t => ({
      title: t.title || "Nhiệm vụ CDE",
      status: t.status === "closed" ? "Done" : "Open"
    }));
  }

  // --- B. LẤY TIẾN ĐỘ THI CÔNG 4D TỪ SUPABASE (project_tasks) ---
  if (client && proj.id) {
    try {
      const { data: tasksData } = await client
        .from("project_tasks")
        .select("*")
        .eq("project_id", proj.id);

      if (tasksData && tasksData.length > 0) {
        realData.timelineTasks = tasksData.map(t => ({
          name: t.name || "Công việc thi công",
          type: t.task_type || "construction",
          start: t.planned_start,
          end: t.planned_end,
          progress: new Date(t.planned_end) <= new Date() ? 100 : 0
        }));
      }
    } catch (e) {
      console.warn("Lỗi đọc project_tasks:", e);
    }
  }

  if (realData.timelineTasks.length === 0 && Array.isArray(window.timelineTasks) && window.timelineTasks.length > 0) {
    realData.timelineTasks = window.timelineTasks.map(t => ({
      name: t.name || "Công việc thi công",
      progress: new Date(t.planned_end) <= new Date() ? 100 : 0
    }));
  }

  // --- C. ĐẾM VA CHẠM (CLASH) TRUY XUẤT ĐA NGUỒN ---
  let detectedClashCount = 0;

  // 1. Quét từ DOM nếu bảng va chạm đang mở
  const allElements = document.querySelectorAll('div, span, p, b');
  for (let el of allElements) {
    const txt = el.innerText || "";
    if (txt.includes('Tổng:') && txt.includes('va chạm')) {
      const match = txt.match(/Tổng:\s*(\d+)\s*va chạm/i);
      if (match) {
        detectedClashCount = parseInt(match[1], 10);
        break;
      }
    } else if (txt.includes('va chạm (') && txt.includes('đâm xuyên')) {
      const match = txt.match(/(\d+)\s*va chạm/i);
      if (match) {
        detectedClashCount = parseInt(match[1], 10);
        break;
      }
    }
  }

  // 2. Quét từ Bộ nhớ JS / Window
  if (detectedClashCount === 0) {
    if (window.lastClashResults && Array.isArray(window.lastClashResults.clashes)) {
      detectedClashCount = window.lastClashResults.clashes.length;
    } else if (Array.isArray(window.clashList) && window.clashList.length > 0) {
      detectedClashCount = window.clashList.length;
    } else if (Array.isArray(window.cdeClashes) && window.cdeClashes.length > 0) {
      detectedClashCount = window.cdeClashes.length;
    } else if (window.clashResultsHistory && Array.isArray(window.clashResultsHistory) && window.clashResultsHistory.length > 0) {
      const latest = window.clashResultsHistory[0];
      detectedClashCount = latest.count || (latest.clashes ? latest.clashes.length : 0);
    }
  }

  // 3. Đọc từ LocalStorage theo dự án (Nếu đã từng quét 1 lần)
  const storageKey = `clash_count_${proj.name.replace(/[^a-zA-Z0-9]/g, '_')}`;
  if (detectedClashCount > 0) {
    // Lưu lại cho các lần mở sau ngay cả khi đóng khung va chạm
    localStorage.setItem(storageKey, detectedClashCount);
  } else {
    const savedCount = localStorage.getItem(storageKey);
    if (savedCount && parseInt(savedCount, 10) > 0) {
      detectedClashCount = parseInt(savedCount, 10);
    }
  }

  // 4. Quét tổng quát LocalStorage
  if (detectedClashCount === 0) {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.toLowerCase().includes('clash') || key.toLowerCase().includes('va_cham'))) {
          const raw = localStorage.getItem(key);
          if (!raw) continue;
          try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed) && parsed.length > 0) {
              detectedClashCount = parsed.length;
              break;
            } else if (parsed.clashes && Array.isArray(parsed.clashes)) {
              detectedClashCount = parsed.clashes.length;
              break;
            }
          } catch(e) {
            const match = raw.match(/(\d+)\s*va chạm/i) || raw.match(/Tổng:\s*(\d+)/i);
            if (match) {
              detectedClashCount = parseInt(match[1], 10);
              break;
            }
          }
        }
      }
    } catch(e) {}
  }

  // Gán kết quả va chạm
  realData.clashCount = detectedClashCount > 0 ? detectedClashCount : clashFromTodosCount;

  // --- D. TRUY VẤN TÀI LIỆU CDE ---
  if (client && proj.id) {
    try {
      const { data: filesData } = await client
        .from("project_files")
        .select("*")
        .eq("project_id", proj.id);

      if (filesData && filesData.length > 0) {
        realData.cdeFiles.total = filesData.length;
        filesData.forEach(f => {
          const folder = (f.folder_type || f.state || 'WIP').toUpperCase();
          if (folder.includes('WIP')) realData.cdeFiles.wip++;
          else if (folder.includes('SHARED')) realData.cdeFiles.shared++;
          else if (folder.includes('PUBLISHED')) realData.cdeFiles.published++;
          else realData.cdeFiles.wip++;
        });
      }
    } catch (e) {}
  }

  if (realData.cdeFiles.total === 0) {
    const fileItems = document.querySelectorAll('#cdeFileList .file-item, #cdeFileList > div, [class*="file"]');
    let wip = 0, shared = 0, published = 0;
    fileItems.forEach(el => {
      const txt = el.innerText || "";
      if (txt.includes('.ifc') || txt.includes('.pptx') || txt.includes('.docx') || txt.includes('.pdf')) {
        if (txt.includes('SHARED') || txt.includes('Shared')) shared++;
        else if (txt.includes('PUBLISHED') || txt.includes('Published')) published++;
        else wip++;
      }
    });

    realData.cdeFiles.wip = wip || (fileItems.length > 0 ? fileItems.length : 0);
    realData.cdeFiles.shared = shared;
    realData.cdeFiles.published = published;
    realData.cdeFiles.total = realData.cdeFiles.wip + realData.cdeFiles.shared + realData.cdeFiles.published;
  }

  return realData;
}

// 5. Render Nội dung từng Tab ACC
async function renderAccDashboardTab(tabName) {
  const container = document.getElementById('acc-dashboard-content');
  if (!container) return;

  container.innerHTML = `<div style="padding: 20px; text-align: center; color: #0275d8;">🔄 Đang nạp dữ liệu từ CDE...</div>`;

  const data = await collectAllCdeRealDataAsync();

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

// LẮNG NGHE SỰ KIỆN ĐỔI DỰ ÁN DƯỚI DROPDOWN
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
            Đã tự động tổng hợp ${clashCount} va chạm cho dự án ${data.projectName}.
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