// cde-dashboard.js - Kết nối dữ liệu thực từ CDE Supabase & BIM Viewer

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

// Biến lưu Cache dữ liệu thực lấy từ CDE Supabase
let cdeRealData = {
  todos: [],
  files: [],
  timelineTasks: [],
  clashes: []
};

// 1. Hàm Bật / Tắt Khung Dashboard & Lấy dữ liệu CDE
async function toggleBimDashboard() {
  const panel = document.getElementById('cde-dashboard-panel');
  if (!panel) return;

  isDashboardOpen = !isDashboardOpen;
  panel.style.display = isDashboardOpen ? 'block' : 'none';

  if (isDashboardOpen) {
    await fetchCdeRealData(); // Tải dữ liệu thực từ CDE Supabase
    renderAccDashboardTab(currentAccTab);
  }
}

// 2. Hàm Tải Dữ Liệu Thực Từ CDE (Supabase / Local Modules)
async function fetchCdeRealData() {
  try {
    // 2.1. Lấy ToDos / Issues thực từ Supabase CDE
    if (window.supabaseClient) {
      const { data: todosData } = await window.supabaseClient.from('cde_todos').select('*');
      if (todosData) cdeRealData.todos = todosData;

      const { data: filesData } = await window.supabaseClient.from('cde_files').select('*');
      if (filesData) cdeRealData.files = filesData;

      const { data: tasksData } = await window.supabaseClient.from('cde_tasks').select('*');
      if (tasksData) cdeRealData.timelineTasks = tasksData;
    } else {
      // Tải từ bộ nhớ local/memory nếu không kết nối Supabase
      if (window.cdeTodos) cdeRealData.todos = window.cdeTodos;
      if (window.cdeFiles) cdeRealData.files = window.cdeFiles;
      if (window.cdeTimelineTasks) cdeRealData.timelineTasks = window.cdeTimelineTasks;
    }

    // 2.2. Lấy dữ liệu Va Chạm (Clash) thực tế vừa quét
    if (window.lastClashResults && window.lastClashResults.clashes) {
      cdeRealData.clashes = window.lastClashResults.clashes;
    }
  } catch (err) {
    console.warn("Chưa thể kết nối CDE Supabase, đang hiển thị dữ liệu từ dự án hiện tại:", err);
  }
}

// 3. Chuyển đổi Tab
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

// 4. Render Nội dung theo từng Tab ACC
function renderAccDashboardTab(tabName) {
  const container = document.getElementById('acc-dashboard-content');
  if (!container) return;

  if (tabName === 'rfi') {
    renderRfiDashboard(container);
  } else if (tabName === 'issues') {
    renderIssuesDashboard(container);
  } else if (tabName === 'status') {
    renderProjectStatusDashboard(container);
  } else if (tabName === 'approvals') {
    renderApprovalsDashboard(container);
  } else if (tabName === 'bim') {
    renderBimQuantityCostDashboard(container);
  }
}

// =========================================================================
// TAB 1: RFI MANAGEMENT (DỮ LIỆU THỰC TỪ CDE TODOS / BCF)
// =========================================================================
function renderRfiDashboard(container) {
  // Lọc danh sách RFI từ ToDos thực tế trong CDE
  const rfis = cdeRealData.todos.filter(t => t.type === 'RFI' || (t.title && t.title.toUpperCase().includes('RFI')));
  
  const totalRfi = rfis.length;
  const openRfi = rfis.filter(r => r.status === 'Open' || r.status === 'Pending').length;
  const closedRfi = rfis.filter(r => r.status === 'Closed' || r.status === 'Done').length;
  const overdueRfi = rfis.filter(r => r.due_date && new Date(r.due_date) < new Date() && r.status !== 'Closed').length;

  // Thống kê theo bộ môn
  const disciplineCounts = { 'Kiến Trúc': 0, 'Kết Cấu': 0, 'MEP': 0, 'Khác': 0 };
  rfis.forEach(r => {
    const disc = r.discipline || 'Khác';
    disciplineCounts[disc] = (disciplineCounts[disc] || 0) + 1;
  });

  container.innerHTML = `
    <!-- KPI Row -->
    <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 14px;">
      <div class="acc-kpi-card" style="border-left: 4px solid #4e73df;">
        <div style="font-size: 10px; color: #666;">TỔNG RFI DỰ ÁN</div>
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
      <div class="acc-kpi-card" style="border-left: 4px solid #e74a3b;">
        <div style="font-size: 10px; color: #666;">QUÁ HẠN (OVERDUE)</div>
        <div style="font-size: 20px; font-weight: bold; color: #e74a3b;">${overdueRfi}</div>
      </div>
    </div>

    <!-- Charts Row -->
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
      <div class="acc-chart-box">
        <div style="font-weight: bold; font-size: 12px; margin-bottom: 8px;">📊 Trạng Thái RFI Thực Tế</div>
        <canvas id="chartRfiStatus" height="200"></canvas>
      </div>
      <div class="acc-chart-box">
        <div style="font-weight: bold; font-size: 12px; margin-bottom: 8px;">🏗️ RFI Phân Theo Bộ Môn</div>
        <canvas id="chartRfiDiscipline" height="200"></canvas>
      </div>
    </div>

    <!-- Table -->
    <div class="acc-chart-box">
      <div style="font-weight: bold; font-size: 12px; margin-bottom: 8px;">📋 Bảng RFI Thực Từ CDE Project</div>
      <table style="width: 100%; border-collapse: collapse; font-size: 11px;">
        <thead>
          <tr style="background: #f1f3f5; text-align: left;">
            <th style="padding: 6px;">Tiêu đề RFI</th>
            <th style="padding: 6px;">Người giao</th>
            <th style="padding: 6px;">Bộ môn</th>
            <th style="padding: 6px;">Trạng thái</th>
            <th style="padding: 6px;">Hạn xử lý</th>
          </tr>
        </thead>
        <tbody>
          ${rfis.length === 0 ? `<tr><td colspan="5" style="text-align:center; padding:12px; color:#888;">Chưa có RFI nào trong CDE ToDos. Hãy vào mục "ToDos" để tạo RFI mới!</td></tr>` : 
            rfis.map(r => `
              <tr style="border-bottom: 1px solid #eee;">
                <td style="padding: 6px; font-weight: bold;">${r.title || 'RFI Không tên'}</td>
                <td>${r.assignee || 'CDE User'}</td>
                <td>${r.discipline || 'Chung'}</td>
                <td><span style="background: #e2e3e5; padding: 2px 6px; border-radius: 4px;">${r.status || 'Open'}</span></td>
                <td>${r.due_date || 'Chưa đặt'}</td>
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
        labels: ['Đang chờ', 'Đã xong', 'Quá hạn'],
        datasets: [{ data: [openRfi, closedRfi, overdueRfi], backgroundColor: ['#f6c23e', '#1cc88a', '#e74a3b'] }]
      },
      options: { responsive: true, plugins: { legend: { position: 'bottom' } } }
    });

    activeCharts['rfiDiscipline'] = new Chart(document.getElementById('chartRfiDiscipline'), {
      type: 'bar',
      data: {
        labels: Object.keys(disciplineCounts),
        datasets: [{ label: 'Số lượng', data: Object.values(disciplineCounts), backgroundColor: '#4e73df' }]
      },
      options: { responsive: true, plugins: { legend: { display: false } } }
    });
  }, 50);
}

// =========================================================================
// TAB 2: ISSUE MANAGEMENT (DỮ LIỆU THỰC TỪ CHECK VA CHẠM / TODOS)
// =========================================================================
function renderIssuesDashboard(container) {
  const issues = cdeRealData.todos.filter(t => t.type === 'Issue' || !t.type);
  const clashes = cdeRealData.clashes;

  const totalIssues = issues.length + clashes.length;
  const openIssues = issues.filter(i => i.status !== 'Closed').length + clashes.length;
  const closedIssues = issues.filter(i => i.status === 'Closed').length;

  container.innerHTML = `
    <!-- KPI Row -->
    <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 14px;">
      <div class="acc-kpi-card" style="border-left: 4px solid #e74a3b;">
        <div style="font-size: 10px; color: #666;">TỔNG VẤN ĐỀ & VA CHẠM</div>
        <div style="font-size: 20px; font-weight: bold; color: #e74a3b;">${totalIssues}</div>
      </div>
      <div class="acc-kpi-card" style="border-left: 4px solid #f6c23e;">
        <div style="font-size: 10px; color: #666;">ĐANG MỞ (CẦN XỬ LÝ)</div>
        <div style="font-size: 20px; font-weight: bold; color: #f6c23e;">${openIssues}</div>
      </div>
      <div class="acc-kpi-card" style="border-left: 4px solid #1cc88a;">
        <div style="font-size: 10px; color: #666;">ĐÃ ĐÓNG (HOÀN THÀNH)</div>
        <div style="font-size: 20px; font-weight: bold; color: #1cc88a;">${closedIssues}</div>
      </div>
    </div>

    <!-- Charts Row -->
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
      <div class="acc-chart-box">
        <div style="font-weight: bold; font-size: 12px; margin-bottom: 8px;">🎯 Phân Loại Vấn Đề Thực Tế</div>
        <canvas id="chartIssueType" height="200"></canvas>
      </div>
      <div class="acc-chart-box">
        <div style="font-weight: bold; font-size: 12px; margin-bottom: 8px;">⚡ Chi Tiết Quét Va Chạm Mô Hình</div>
        <div style="padding:10px; font-size:12px;">
          📌 <b>Kết quả Va chạm BIM:</b> <span style="color:#d9534f; font-weight:bold;">${clashes.length} va chạm</span><br>
          <span style="font-size:11px; color:#666;">Chạy "Check Va Chạm" ở Tab Kiểm Tra để tự động cập nhật danh sách va chạm mới nhất vào Dashboard.</span>
        </div>
      </div>
    </div>
  `;

  setTimeout(() => {
    activeCharts['issueType'] = new Chart(document.getElementById('chartIssueType'), {
      type: 'pie',
      data: {
        labels: ['Va chạm Mô hình (Clash)', 'Vấn đề Thi công', 'An toàn / Khác'],
        datasets: [{ data: [clashes.length, issues.length, 0], backgroundColor: ['#e74a3b', '#f6c23e', '#4e73df'] }]
      },
      options: { responsive: true, plugins: { legend: { position: 'bottom' } } }
    });
  }, 50);
}

// =========================================================================
// TAB 3: PROJECT STATUS (DỮ LIỆU THỰC TỪ CDE TIMELINE 4D)
// =========================================================================
function renderProjectStatusDashboard(container) {
  const tasks = cdeRealData.timelineTasks;

  const totalTasks = tasks.length;
  const completedTasks = tasks.filter(t => t.progress === 100 || t.status === 'Completed').length;
  const inProgressTasks = tasks.filter(t => t.progress > 0 && t.progress < 100).length;
  const notStartedTasks = totalTasks - completedTasks - inProgressTasks;

  container.innerHTML = `
    <!-- KPI Row -->
    <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 14px;">
      <div class="acc-kpi-card" style="border-left: 4px solid #4e73df;">
        <div style="font-size: 10px; color: #666;">TỔNG HẠNG MỤC TIẾN ĐỘ</div>
        <div style="font-size: 20px; font-weight: bold; color: #4e73df;">${totalTasks}</div>
      </div>
      <div class="acc-kpi-card" style="border-left: 4px solid #1cc88a;">
        <div style="font-size: 10px; color: #666;">ĐÃ HOÀN THÀNH</div>
        <div style="font-size: 20px; font-weight: bold; color: #1cc88a;">${completedTasks}</div>
      </div>
      <div class="acc-kpi-card" style="border-left: 4px solid #f6c23e;">
        <div style="font-size: 10px; color: #666;">ĐANG THI CÔNG</div>
        <div style="font-size: 20px; font-weight: bold; color: #f6c23e;">${inProgressTasks}</div>
      </div>
    </div>

    <div class="acc-chart-box">
      <div style="font-weight: bold; font-size: 12px; margin-bottom: 8px;">🏗️ Tỷ Lệ Tiến Độ Thi Công Thực Tế từ CDE Timeline 4D</div>
      <canvas id="chartStatusOverall" height="180"></canvas>
    </div>
  `;

  setTimeout(() => {
    activeCharts['statusOverall'] = new Chart(document.getElementById('chartStatusOverall'), {
      type: 'doughnut',
      data: {
        labels: ['Đã hoàn thành', 'Đang thực hiện', 'Chưa bắt đầu'],
        datasets: [{ data: [completedTasks, inProgressTasks, notStartedTasks], backgroundColor: ['#1cc88a', '#f6c23e', '#eaecf4'] }]
      },
      options: { responsive: true, plugins: { legend: { position: 'bottom' } } }
    });
  }, 50);
}

// =========================================================================
// TAB 4: APPROVALS & SUBMITTALS (DỮ LIỆU THỰC TỪ CDE FILES ISO 19650)
// =========================================================================
function renderApprovalsDashboard(container) {
  const files = cdeRealData.files;

  const totalFiles = files.length;
  const wipFiles = files.filter(f => f.state === 'WIP' || f.folder === 'WIP').length;
  const sharedFiles = files.filter(f => f.state === 'SHARED' || f.folder === 'SHARED').length;
  const publishedFiles = files.filter(f => f.state === 'PUBLISHED' || f.folder === 'PUBLISHED').length;

  container.innerHTML = `
    <!-- KPI Row -->
    <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 14px;">
      <div class="acc-kpi-card" style="border-left: 4px solid #4e73df;">
        <div style="font-size: 10px; color: #666;">TỔNG TÀI LIỆU CDE</div>
        <div style="font-size: 20px; font-weight: bold; color: #4e73df;">${totalFiles}</div>
      </div>
      <div class="acc-kpi-card" style="border-left: 4px solid #858796;">
        <div style="font-size: 10px; color: #666;">WORK IN PROGRESS (WIP)</div>
        <div style="font-size: 20px; font-weight: bold; color: #858796;">${wipFiles}</div>
      </div>
      <div class="acc-kpi-card" style="border-left: 4px solid #f6c23e;">
        <div style="font-size: 10px; color: #666;">CHỜ DUYỆT (SHARED)</div>
        <div style="font-size: 20px; font-weight: bold; color: #f6c23e;">${sharedFiles}</div>
      </div>
      <div class="acc-kpi-card" style="border-left: 4px solid #1cc88a;">
        <div style="font-size: 10px; color: #666;">ĐÃ PHÊ DUYỆT (PUBLISHED)</div>
        <div style="font-size: 20px; font-weight: bold; color: #1cc88a;">${publishedFiles}</div>
      </div>
    </div>

    <div class="acc-chart-box">
      <div style="font-weight: bold; font-size: 12px; margin-bottom: 8px;">📑 Trạng Thái Trình Duyệt Tài Liệu Theo Chuẩn ISO 19650</div>
      <canvas id="chartSubmittalIso" height="180"></canvas>
    </div>
  `;

  setTimeout(() => {
    activeCharts['submittalIso'] = new Chart(document.getElementById('chartSubmittalIso'), {
      type: 'bar',
      data: {
        labels: ['WIP (Đang soạn)', 'SHARED (Đang xét duyệt)', 'PUBLISHED (Đã duyệt/Phát hành)'],
        datasets: [{ label: 'Số lượng File', data: [wipFiles, sharedFiles, publishedFiles], backgroundColor: ['#858796', '#f6c23e', '#1cc88a'] }]
      },
      options: { responsive: true, plugins: { legend: { display: false } } }
    });
  }, 50);
}

// =========================================================================
// TAB 5: BIM QUANTITY & COST (BÓC TÁCH KHỐI LƯỢNG MÔ HÌNH 3D)
// =========================================================================
function renderBimQuantityCostDashboard(container) {
  if (typeof viewer === 'undefined' || !viewer || !viewer.metaScene) {
    container.innerHTML = `<div style="padding: 20px; text-align: center; color: #777;">⚠️ Chưa có mô hình BIM nào được nạp vào Viewer. Vui lòng nạp file .IFC hoặc .XKT từ CDE.</div>`;
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
    <!-- KPI Row -->
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

    <!-- Chart & Table -->
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