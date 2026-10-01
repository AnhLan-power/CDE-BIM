// cde-dashboard.js - Quản lý biểu đồ & phân tích dữ liệu xeokit

let bimCategoryChart = null;
let isDashboardOpen = false;

// 1. Hàm Bật/Tắt Cửa sổ Dashboard
function toggleBimDashboard() {
  const panel = document.getElementById('cde-dashboard-panel');
  if (!panel) return;

  isDashboardOpen = !isDashboardOpen;
  panel.style.display = isDashboardOpen ? 'block' : 'none';

  if (isDashboardOpen) {
    updateBimDashboardData();
  }
}

// 2. Hàm trích xuất dữ liệu từ xeokit Viewer & Cập nhật Biểu đồ
function updateBimDashboardData() {
  // Biến 'viewer' là đối tượng xeokit Viewer toàn cục trên ứng dụng của bạn
  if (typeof viewer === 'undefined' || !viewer || !viewer.metaScene) {
    console.warn("Chưa tải xong mô hình xeokit.");
    return;
  }

  const metaObjects = viewer.metaScene.metaObjects;
  const categoryCounts = {};
  let totalCount = 0;

  // Gom nhóm số lượng cấu kiện theo thuộc tính 'type'
  Object.values(metaObjects).forEach(obj => {
    const typeName = obj.type || "Khác";
    categoryCounts[typeName] = (categoryCounts[typeName] || 0) + 1;
    totalCount++;
  });

  // Cập nhật thẻ chỉ số KPI
  const kpiTotalObj = document.getElementById('kpi-total-objects');
  const kpiTotalTypes = document.getElementById('kpi-total-types');
  if (kpiTotalObj) kpiTotalObj.innerText = totalCount.toLocaleString();
  if (kpiTotalTypes) kpiTotalTypes.innerText = Object.keys(categoryCounts).length;

  // Chuẩn bị dữ liệu cho Chart.js
  const labels = Object.keys(categoryCounts);
  const dataValues = Object.values(categoryCounts);
  const colorPalette = [
    '#4e73df', '#1cc88a', '#36b9cc', '#f6c23e', '#e74a3b', 
    '#858796', '#5a5c69', '#f8f9fc', '#4e73df', '#2e59d9'
  ];

  const ctx = document.getElementById('chartCategories').getContext('2d');

  // Nếu biểu đồ đã tồn tại thì hủy để vẽ mới lại
  if (bimCategoryChart) {
    bimCategoryChart.destroy();
  }

  // Khởi tạo Biểu đồ Doughnut
  bimCategoryChart = new Chart(ctx, {
    type: 'doughnut',
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
        legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } },
        title: { display: true, text: 'Tỷ trọng cấu kiện theo Loại (Type)' }
      },
      // Sự kiện CLICK vào lát cắt biểu đồ -> Lọc đối tượng tương ứng trên Mô hình 3D
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

// 3. Hàm tương tác 3D: Highlight cấu kiện theo loại được chọn từ biểu đồ
function filterModelByType(typeName) {
  if (typeof viewer === 'undefined' || !viewer) return;

  const metaObjects = viewer.metaScene.metaObjects;
  const matchedEntityIds = [];

  Object.values(metaObjects).forEach(obj => {
    if (obj.type === typeName) {
      matchedEntityIds.push(obj.id);
    }
  });

  // Làm mờ toàn bộ mô hình và highlight loại được chọn
  viewer.scene.setObjectsXRayed(viewer.scene.objectIds, true);
  viewer.scene.setObjectsXRayed(matchedEntityIds, false);
  viewer.scene.setObjectsSelected(viewer.scene.selectedObjectIds, false);
  viewer.scene.setObjectsSelected(matchedEntityIds, true);
}

// 4. Hàm khôi phục lại hiển thị ban đầu
function resetModelVisibility() {
  if (typeof viewer === 'undefined' || !viewer) return;
  viewer.scene.setObjectsXRayed(viewer.scene.objectIds, false);
  viewer.scene.setObjectsSelected(viewer.scene.selectedObjectIds, false);
}