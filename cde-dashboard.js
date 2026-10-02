// cde-dashboard.js - Hệ thống Dashboard Quản lý Dự án Chuẩn ACC (Autodesk Construction Cloud)

let isDashboardOpen = false;
let currentAccTab = 'rfi';

// Biến lưu các đối tượng Biểu đồ Chart.js để destroy khi chuyển tab
const activeCharts = {};

// Đơn giá mặc định cấu kiện BIM
const defaultUnitPrices = {
  "IfcWall": 5000000, "IfcWallStandardCase": 4500000, "IfcSlab": 8000000,
  "IfcBeam": 3500000, "IfcColumn": 4000000, "IfcDoor": 2500000,
  "IfcWindow": 3000000, "IfcFooting": 12000000, "IfcBuildingElementProxy": 1500000
};
let customUnitPrices = { ...defaultUnitPrices };

// 1. Hàm Bật / Tắt Khung Dashboard
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

  // Hủy các biểu đồ cũ
  Object.keys(activeCharts).forEach(key => {
    if (activeCharts[key]) {
      activeCharts[key].destroy();
      delete activeCharts[key];
    }
  });

  renderAccDashboardTab(tabName);
}

// 3. Render Nội dung theo từng Tab ACC
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
// TAB 1: RFI MANAGEMENT (QUẢN LÝ YÊU CẦU THÔNG TIN)
// =========================================================================
function renderRfiDashboard(container) {
  container.innerHTML = `
    <!-- KPI Row -->
    <div style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; margin-bottom: 14px;">
      <div class="acc-kpi-card" style="border-left: 4px solid #4e73df;">
        <div style="font-size: 10px; color: #666;">TỔNG RFI</div>
        <div style="font-size: 20px; font-weight: bold; color: #4e73df;">1,529</div>
      </div>
      <div class="acc-kpi-card" style="border-left: 4px solid #f6c23e;">
        <div style="font-size: 10px; color: #666;">RFI ĐANG MỞ</div>
        <div style="font-size: 20px; font-weight: bold; color: #f6c23e;">485</div>
      </div>
      <div class="acc-kpi-card" style="border-left: 4px solid #1cc88a;">
        <div style="font-size: 10px; color: #666;">ĐÃ ĐÓNG</div>
        <div style="font-size: 20px; font-weight: bold; color: #1cc88a;">671</div>
      </div>
      <div class="acc-kpi-card" style="border-left: 4px solid #e74a3b;">
        <div style="font-size: 10px; color: #666;">QUÁ HẠN (OVERDUE)</div>
        <div style="font-size: 20px; font-weight: bold; color: #e74a3b;">195</div>
      </div>
      <div class="acc-kpi-card" style="border-left: 4px solid #36b9cc;">
        <div style="font-size: 10px; color: #666;">TB NGÀY PHẢN HỒI</div>
        <div style="font-size: 20px; font-weight: bold; color: #36b9cc;">15.3 Ngày</div>
      </div>
    </div>

    <!-- Charts Row 1 -->
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
      <div class="acc-chart-box">
        <div style="font-weight: bold; font-size: 12px; margin-bottom: 8px;">📊 RFI theo Trạng Thái (Status)</div>
        <canvas id="chartRfiStatus" height="200"></canvas>
      </div>
      <div class="acc-chart-box">
        <div style="font-weight: bold; font-size: 12px; margin-bottom: 8px;">🏗️ RFI theo Bộ Môn (Discipline)</div>
        <canvas id="chartRfiDiscipline" height="200"></canvas>
      </div>
    </div>

    <!-- RFI Log Table -->
    <div class="acc-chart-box">
      <div style="font-weight: bold; font-size: 12px; margin-bottom: 8px;">📋 Bảng Nhật Ký RFI Mới Nhất</div>
      <table style="width: 100%; border-collapse: collapse; font-size: 11px;">
        <thead>
          <tr style="background: #f1f3f5; text-align: left;">
            <th style="padding: 6px;">Mã RFI</th>
            <th style="padding: 6px;">Tiêu đề</th>
            <th style="padding: 6px;">Bộ môn</th>
            <th style="padding: 6px;">Trạng thái</th>
            <th style="padding: 6px;">Hạn phản hồi</th>
          </tr>
        </thead>
        <tbody>
          <tr style="border-bottom: 1px solid #eee;">
            <td style="padding: 6px; font-weight: bold;">RFI-2026-089</td>
            <td>Lệch vị trí ống MEP tầng 3</td>
            <td>MEP</td>
            <td><span style="background: #fff3cd; color: #856404; padding: 2px 6px; border-radius: 4px;">Pending</span></td>
            <td>05/10/2026</td>
          </tr>
          <tr style="border-bottom: 1px solid #eee;">
            <td style="padding: 6px; font-weight: bold;">RFI-2026-090</td>
            <td>Chi tiết xung đột dầm bê tông & Cột thép</td>
            <td>Kết cấu</td>
            <td><span style="background: #f8d7da; color: #721c24; padding: 2px 6px; border-radius: 4px;">Overdue</span></td>
            <td>28/09/2026</td>
          </tr>
          <tr style="border-bottom: 1px solid #eee;">
            <td style="padding: 6px; font-weight: bold;">RFI-2026-091</td>
            <td>Thay đổi vật liệu kính mặt đứng</td>
            <td>Kiến trúc</td>
            <td><span style="background: #d4edda; color: #155724; padding: 2px 6px; border-radius: 4px;">Closed</span></td>
            <td>01/10/2026</td>
          </tr>
        </tbody>
      </table>
    </div>
  `;

  // Draw Charts
  setTimeout(() => {
    activeCharts['rfiStatus'] = new Chart(document.getElementById('chartRfiStatus'), {
      type: 'doughnut',
      data: {
        labels: ['Open', 'Pending', 'Closed', 'Draft'],
        datasets: [{ data: [485, 312, 671, 61], backgroundColor: ['#f6c23e', '#36b9cc', '#1cc88a', '#858796'] }]
      },
      options: { responsive: true, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10 } } } }
    });

    activeCharts['rfiDiscipline'] = new Chart(document.getElementById('chartRfiDiscipline'), {
      type: 'bar',
      data: {
        labels: ['Kiến Trúc', 'Kết Cấu', 'MEP', 'Hạ Tầng', 'PCCC'],
        datasets: [{ label: 'Số lượng RFI', data: [420, 580, 310, 140, 79], backgroundColor: '#4e73df' }]
      },
      options: { responsive: true, plugins: { legend: { display: false } } }
    });
  }, 50);
}

// =========================================================================
// TAB 2: ISSUE MANAGEMENT (QUẢN LÝ VẤN ĐỀ & VA CHẠM)
// =========================================================================
function renderIssuesDashboard(container) {
  // Lấy dữ liệu va chạm thực tế từ Viewer nếu có
  const clashCount = window.lastClashResults ? window.lastClashResults.clashes.length : 122;

  container.innerHTML = `
    <!-- KPI Row -->
    <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 14px;">
      <div class="acc-kpi-card" style="border-left: 4px solid #e74a3b;">
        <div style="font-size: 10px; color: #666;">TỔNG VẤN ĐỀ / VA CHẠM</div>
        <div style="font-size: 20px; font-weight: bold; color: #e74a3b;">${clashCount}</div>
      </div>
      <div class="acc-kpi-card" style="border-left: 4px solid #f6c23e;">
        <div style="font-size: 10px; color: #666;">ĐANG XỬ LÝ (OPEN)</div>
        <div style="font-size: 20px; font-weight: bold; color: #f6c23e;">${Math.round(clashCount * 0.7)}</div>
      </div>
      <div class="acc-kpi-card" style="border-left: 4px solid #1cc88a;">
        <div style="font-size: 10px; color: #666;">ĐÃ GIẢI QUYẾT</div>
        <div style="font-size: 20px; font-weight: bold; color: #1cc88a;">${Math.round(clashCount * 0.3)}</div>
      </div>
      <div class="acc-kpi-card" style="border-left: 4px solid #4e73df;">
        <div style="font-size: 10px; color: #666;">TB NGÀY ĐÓNG VẤN ĐỀ</div>
        <div style="font-size: 20px; font-weight: bold; color: #4e73df;">43.5 Ngày</div>
      </div>
    </div>

    <!-- Charts Row -->
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
      <div class="acc-chart-box">
        <div style="font-weight: bold; font-size: 12px; margin-bottom: 8px;">🎯 Nguyên Nhân Gốc Rễ (Root Cause)</div>
        <canvas id="chartIssueRootCause" height="200"></canvas>
      </div>
      <div class="acc-chart-box">
        <div style="font-weight: bold; font-size: 12px; margin-bottom: 8px;">📈 Xu Hướng Phát Sinh Vấn Đề Theo Tháng</div>
        <canvas id="chartIssueTrend" height="200"></canvas>
      </div>
    </div>
  `;

  setTimeout(() => {
    activeCharts['issueRootCause'] = new Chart(document.getElementById('chartIssueRootCause'), {
      type: 'pie',
      data: {
        labels: ['Xung đột Thiết kế', 'Lỗi Thi công', 'An toàn Lao động', 'Sai khác Vật liệu', 'Khác'],
        datasets: [{ data: [45, 25, 15, 10, 5], backgroundColor: ['#e74a3b', '#f6c23e', '#4e73df', '#1cc88a', '#858796'] }]
      },
      options: { responsive: true, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10 } } } }
    });

    activeCharts['issueTrend'] = new Chart(document.getElementById('chartIssueTrend'), {
      type: 'line',
      data: {
        labels: ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10'],
        datasets: [{ label: 'Vấn đề mới', data: [12, 19, 15, 25, 22, 30, 28, 35, 40, 20], borderColor: '#e74a3b', fill: false, tension: 0.3 }]
      },
      options: { responsive: true, plugins: { legend: { display: false } } }
    });
  }, 50);
}

// =========================================================================
// TAB 3: PROJECT STATUS MANAGEMENT (TRẠNG THÁI DỰ ÁN & KIỂM ĐỊNH)
// =========================================================================
function renderProjectStatusDashboard(container) {
  container.innerHTML = `
    <!-- Charts Row -->
    <div style="display: grid; grid-template-columns: 1.2fr 0.8fr; gap: 12px;">
      <div class="acc-chart-box">
        <div style="font-weight: bold; font-size: 12px; margin-bottom: 8px;">🏢 Trạng Thái Tiến Độ Thi Công Theo Tầng (Location)</div>
        <canvas id="chartStatusLocation" height="200"></canvas>
      </div>
      <div class="acc-chart-box">
        <div style="font-weight: bold; font-size: 12px; margin-bottom: 8px;">📊 Tỷ Lệ Hoàn Thành Tổng Thể</div>
        <canvas id="chartStatusOverall" height="200"></canvas>
      </div>
    </div>
  `;

  setTimeout(() => {
    activeCharts['statusLocation'] = new Chart(document.getElementById('chartStatusLocation'), {
      type: 'bar',
      data: {
        labels: ['Tầng B1', 'Tầng 1', 'Tầng 2', 'Tầng 3', 'Tầng 4', 'Mái'],
        datasets: [
          { label: 'Hoàn thành', data: [100, 100, 85, 60, 30, 0], backgroundColor: '#1cc88a' },
          { label: 'Đang thi công', data: [0, 0, 15, 40, 50, 20], backgroundColor: '#f6c23e' },
          { label: 'Chưa bắt đầu', data: [0, 0, 0, 0, 20, 80], backgroundColor: '#eaecf4' }
        ]
      },
      options: { responsive: true, scales: { x: { stacked: true }, y: { stacked: true } } }
    });

    activeCharts['statusOverall'] = new Chart(document.getElementById('chartStatusOverall'), {
      type: 'doughnut',
      data: {
        labels: ['Hoàn thành', 'Đang thực hiện', 'Chậm tiến độ'],
        datasets: [{ data: [62, 28, 10], backgroundColor: ['#1cc88a', '#4e73df', '#e74a3b'] }]
      },
      options: { responsive: true, plugins: { legend: { position: 'bottom' } } }
    });
  }, 50);
}

// =========================================================================
// TAB 4: APPROVALS & SUBMITTALS (QUẢN LÝ TRÌNH DUYỆT)
// =========================================================================
function renderApprovalsDashboard(container) {
  container.innerHTML = `
    <!-- KPI Row -->
    <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 14px;">
      <div class="acc-kpi-card" style="border-left: 4px solid #4e73df;">
        <div style="font-size: 10px; color: #666;">TỔNG HỒ SƠ SUBMITTALS</div>
        <div style="font-size: 20px; font-weight: bold; color: #4e73df;">1,117</div>
      </div>
      <div class="acc-kpi-card" style="border-left: 4px solid #f6c23e;">
        <div style="font-size: 10px; color: #666;">ĐANG CHỜ DUYỆT</div>
        <div style="font-size: 20px; font-weight: bold; color: #f6c23e;">105</div>
      </div>
      <div class="acc-kpi-card" style="border-left: 4px solid #1cc88a;">
        <div style="font-size: 10px; color: #666;">ĐÃ PHÊ DUYỆT</div>
        <div style="font-size: 20px; font-weight: bold; color: #1cc88a;">904</div>
      </div>
      <div class="acc-kpi-card" style="border-left: 4px solid #e74a3b;">
        <div style="font-size: 10px; color: #666;">YÊU CẦU SỬA ĐỔI</div>
        <div style="font-size: 20px; font-weight: bold; color: #e74a3b;">60</div>
      </div>
    </div>

    <!-- Charts Row -->
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
      <div class="acc-chart-box">
        <div style="font-weight: bold; font-size: 12px; margin-bottom: 8px;">📄 Submittals theo Loại Hồ Sơ</div>
        <canvas id="chartSubmittalType" height="200"></canvas>
      </div>
      <div class="acc-chart-box">
        <div style="font-weight: bold; font-size: 12px; margin-bottom: 8px;">👷 Hồ Sơ Theo Nhà Thầu Phụ</div>
        <canvas id="chartSubmittalContractor" height="200"></canvas>
      </div>
    </div>
  `;

  setTimeout(() => {
    activeCharts['submittalType'] = new Chart(document.getElementById('chartSubmittalType'), {
      type: 'pie',
      data: {
        labels: ['Bản vẽ Shopdrawing', 'Tài liệu vật liệu (Material)', 'Mẫu sản phẩm (Sample)', 'Báo cáo kiểm định'],
        datasets: [{ data: [550, 320, 140, 107], backgroundColor: ['#4e73df', '#1cc88a', '#36b9cc', '#f6c23e'] }]
      },
      options: { responsive: true, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10 } } } }
    });

    activeCharts['submittalContractor'] = new Chart(document.getElementById('chartSubmittalContractor'), {
      type: 'bar',
      data: {
        labels: ['Nhà thầu Xây dựng A', 'Nhà thầu MEP B', 'Nhà thầu Nhôm kính C', 'Nhà thầu Nội thất D'],
        datasets: [{ label: 'Số hồ sơ', data: [450, 380, 180, 107], backgroundColor: '#36b9cc' }]
      },
      options: { responsive: true, indexAxis: 'y' }
    });
  }, 50);
}

// =========================================================================
// TAB 5: BIM QUANTITY & COST (BÓC TÁCH KHỐI LƯỢNG & CHI PHÍ BIM THỰC TẾ)
// =========================================================================
function renderBimQuantityCostDashboard(container) {
  if (typeof viewer === 'undefined' || !viewer || !viewer.metaScene) {
    container.innerHTML = `<div style="padding: 20px; text-align: center; color: #777;">⚠️ Chưa có mô hình BIM nào được nạp vào Viewer. Vui lòng nạp file .IFC hoặc .XKT trước.</div>`;
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
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10 } } }
        },
        onClick: (event, activeElements) => {
          if (activeElements.length > 0) {
            const clickedIndex = activeElements[0].index;
            const selectedType = labels[clickedIndex];
            filterModelByType(selectedType);
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

// 4. Highlight cấu kiện 3D
function filterModelByType(typeName) {
  if (typeof viewer === 'undefined' || !viewer) return;

  const metaObjects = viewer.metaScene.metaObjects;
  const matchedEntityIds = [];

  Object.values(metaObjects).forEach(obj => {
    if (obj.type === typeName) {
      matchedEntityIds.push(obj.id);
    }
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