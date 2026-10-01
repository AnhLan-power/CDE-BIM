// cde-dashboard.js - Quản lý biểu đồ %, chỉ số & tính toán chi phí BIM

let bimCategoryChart = null;
let isDashboardOpen = false;

// Đơn giá mặc định cho từng loại cấu kiện (Đơn vị: VNĐ / Cấu kiện)
const defaultUnitPrices = {
  "IfcWall": 5000000,
  "IfcWallStandardCase": 4500000,
  "IfcSlab": 8000000,
  "IfcBeam": 3500000,
  "IfcColumn": 4000000,
  "IfcDoor": 2500000,
  "IfcWindow": 3000000,
  "IfcFooting": 12000000,
  "IfcBuildingElementProxy": 1500000
};

// Dữ liệu đơn giá hiện tại
let customUnitPrices = { ...defaultUnitPrices };

// 1. Bật / Tắt Dashboard
function toggleBimDashboard() {
  const panel = document.getElementById('cde-dashboard-panel');
  if (!panel) return;

  isDashboardOpen = !isDashboardOpen;
  panel.style.display = isDashboardOpen ? 'block' : 'none';

  if (isDashboardOpen) {
    updateBimDashboardData();
  }
}

// 2. Trích xuất dữ liệu, vẽ Biểu đồ % và Tính Chi Phí
function updateBimDashboardData() {
  if (typeof viewer === 'undefined' || !viewer || !viewer.metaScene) {
    console.warn("Chưa tải xong mô hình xeokit.");
    return;
  }

  const metaObjects = viewer.metaScene.metaObjects;
  const categoryCounts = {};
  let totalCount = 0;

  // Thống kê số lượng từng loại IFC
  Object.values(metaObjects).forEach(obj => {
    const typeName = obj.type || "Khác";
    categoryCounts[typeName] = (categoryCounts[typeName] || 0) + 1;
    totalCount++;
  });

  // Tính tổng chi phí
  let totalEstimatedCost = 0;
  Object.keys(categoryCounts).forEach(typeName => {
    const count = categoryCounts[typeName];
    const price = customUnitPrices[typeName] || 1000000; // Mặc định 1.000.000 VNĐ nếu chưa gán
    totalEstimatedCost += count * price;
  });

  // Cập nhật thẻ KPI
  const kpiTotalObj = document.getElementById('kpi-total-objects');
  const kpiTotalCost = document.getElementById('kpi-total-cost');
  if (kpiTotalObj) kpiTotalObj.innerText = totalCount.toLocaleString();
  if (kpiTotalCost) kpiTotalCost.innerText = totalEstimatedCost.toLocaleString('vi-VN') + " VNĐ";

  // Hiển thị bảng nhập đơn giá
  renderUnitPriceTable(categoryCounts);

  // Chuẩn bị dữ liệu vẽ Biểu đồ
  const labels = Object.keys(categoryCounts);
  const dataValues = Object.values(categoryCounts);
  const colorPalette = [
    '#4e73df', '#1cc88a', '#36b9cc', '#f6c23e', '#e74a3b', 
    '#858796', '#f6c23e', '#fd7e14', '#20c997', '#6f42c1'
  ];

  const ctx = document.getElementById('chartCategories').getContext('2d');

  if (bimCategoryChart) {
    bimCategoryChart.destroy();
  }

  // Đăng ký Plugin Datalabels nếu có
  const pluginsList = [];
  if (typeof ChartDataLabels !== 'undefined') {
    pluginsList.push(ChartDataLabels);
  }

  // Khởi tạo Biểu đồ Doughnut kèm %
  bimCategoryChart = new Chart(ctx, {
    type: 'doughnut',
    plugins: pluginsList,
    data: {
      labels: labels,
      datasets: [{
        data: dataValues,
        backgroundColor: colorPalette.slice(0, labels.length),
        borderWidth: 1
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { 
          position: 'bottom', 
          labels: { boxWidth: 10, font: { size: 10 } } 
        },
        title: { 
          display: true, 
          text: 'Tỷ lệ Cấu Kiện (%) & Chi Phí' 
        },
        // Cấu hình hiển thị % trực tiếp trên lát cắt biểu đồ
        datalabels: {
          color: '#ffffff',
          font: { weight: 'bold', size: 11 },
          formatter: (value) => {
            if (totalCount === 0) return '0%';
            const percentage = ((value / totalCount) * 100).toFixed(1);
            return percentage > 3 ? percentage + '%' : ''; // Chỉ hiện % nếu lớn hơn 3% để tránh đè chữ
          }
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              const label = context.label || '';
              const val = context.raw || 0;
              const pct = ((val / totalCount) * 100).toFixed(1);
              const price = customUnitPrices[label] || 1000000;
              const cost = val * price;
              return `${label}: ${val} cái (${pct}%) - Est: ${cost.toLocaleString('vi-VN')} VNĐ`;
            }
          }
        }
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
}

// 3. Tạo Bảng nhập Đơn giá tương tác
function renderUnitPriceTable(categoryCounts) {
  const container = document.getElementById('unit-price-table-container');
  if (!container) return;

  let html = `<table style="width:100%; border-collapse:collapse;">
    <thead>
      <tr style="background:#f1f3f5; text-align:left;">
        <th style="padding:4px;">Loại</th>
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
            onchange="updateTypeUnitPrice('${typeName}', this.value)"
            style="width:100px; padding:2px 4px; font-size:11px; border:1px solid #ccc; border-radius:4px;">
        </td>
      </tr>`;
  });

  html += `</tbody></table>`;
  container.innerHTML = html;
}

// 4. Cập nhật đơn giá khi người dùng thay đổi
function updateTypeUnitPrice(typeName, value) {
  customUnitPrices[typeName] = parseFloat(value) || 0;
  updateBimDashboardData(); // Cập nhật lại tổng chi phí & biểu đồ
}

// 5. Highlight cấu kiện trên Mô hình 3D
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