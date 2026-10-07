// --- MODULE QUẢN LÝ TÀI SẢN DIGITAL TWIN (FA/AM) ---

const DT_SUPABASE_URL = window.SUPABASE_URL || 'https://znzakqzdezxzqzfplmgv.supabase.co'; 
const DT_SUPABASE_KEY = window.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInRefiI6InpuemFrcXpkZXp4enF6ZnBsbWd2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc4MTQyNzAsImV4cCI6ZB03Mzk0MjcwfQ.aV5YaOLxTySiB26ror4CRzJvQsjANNI1DwbtbxcNe4A';

const STATUS_COLORS = {
  OPERATIONAL: [0.1, 0.8, 0.3], // 🟢 Xanh lá
  MAINTENANCE: [1.0, 0.75, 0.0], // 🟡 Vàng
  FAULT:       [0.9, 0.1, 0.1]  // 🔴 Đỏ
};

let isColorCodingActive = false; 
let activeMarkerElements = [];   
let markerTickListener = null;   

/**
 * Làm sạch giá trị ID (loại bỏ null, undefined, 'null', 'undefined', '0')
 */
function cleanId(val) {
  if (val === null || val === undefined) return '';
  const s = String(val).trim();
  if (s === 'null' || s === 'undefined' || s === '0') return '';
  return s;
}

/**
 * Kiểm tra Bounding Box (AABB)
 */
function isValidAABB(aabb) {
  return Array.isArray(aabb) && aabb.length === 6 && !isNaN(aabb[0]);
}

/**
 * Inject Style Marker 3D
 */
function injectMarkerStyles() {
  if (document.getElementById('dt-marker-styles')) return;
  const style = document.createElement('style');
  style.id = 'dt-marker-styles';
  style.innerHTML = `
    #dt-marker-overlay-container {
      position: fixed !important;
      pointer-events: none !important;
      overflow: hidden !important;
      z-index: 500 !important;
      top: 0; left: 0; width: 100vw; height: 100vh;
    }
    .dt-3d-marker {
      position: absolute !important;
      padding: 4px 10px !important;
      border-radius: 12px !important;
      font-size: 11px !important;
      font-weight: bold !important;
      color: #ffffff !important;
      box-shadow: 0 4px 12px rgba(0,0,0,0.4) !important;
      pointer-events: auto !important;
      cursor: pointer !important;
      transform: translate(-50%, -50%) !important; 
      white-space: nowrap !important;
      user-select: none !important;
      display: flex !important;
      align-items: center !important;
      gap: 5px !important;
      z-index: 501 !important;
      transition: transform 0.15s ease-out;
    }
    .dt-3d-marker:hover {
      transform: translate(-50%, -60%) scale(1.15) !important;
      z-index: 510 !important;
    }
    .dt-3d-marker.operational { background: #28a745 !important; border: 1.5px solid #ffffff !important; }
    .dt-3d-marker.maintenance { background: #f39c12 !important; border: 1.5px solid #ffffff !important; }
    .dt-3d-marker.fault { 
      background: #dc3545 !important; 
      border: 1.5px solid #ffffff !important;
      animation: dt-pulse 1.5s infinite !important;
    }
    @keyframes dt-pulse {
      0% { box-shadow: 0 0 0 0 rgba(220, 53, 69, 0.8); }
      70% { box-shadow: 0 0 0 10px rgba(220, 53, 69, 0); }
      100% { box-shadow: 0 0 0 0 rgba(220, 53, 69, 0); }
    }
  `;
  document.head.appendChild(style);
}

function getDigitalTwinSupabaseClient() {
  if (window.sb && typeof window.sb.from === 'function') return window.sb;
  if (window.supabaseClient && typeof window.supabaseClient.from === 'function') return window.supabaseClient;
  if (window.supabase && typeof window.supabase.from === 'function') return window.supabase;
  if (window.supabase && typeof window.supabase.createClient === 'function') {
    if (!window._dtSupabaseInstance) {
      window._dtSupabaseInstance = window.supabase.createClient(DT_SUPABASE_URL, DT_SUPABASE_KEY);
    }
    return window._dtSupabaseInstance;
  }
  return null;
}

// =========================================================================
// --- THUẬT TOÁN TÌM KIẾM THIẾT BỊ LẮP GHÉP LẠI KHÔNG SÓT ---
// =========================================================================

function findEntityByAsset(viewer, asset) {
  if (!viewer || !viewer.scene || !viewer.scene.objects) return null;
  const objects = viewer.scene.objects;
  
  let targetGId = cleanId(asset.global_id || asset.globalID);
  let targetEId = cleanId(asset.express_id || asset.expressID);

  // Tự động tách Express ID từ tên hoặc mã tài sản nếu chưa có targetEId (VD: "...:4246714")
  if (!targetEId) {
    const text = (asset.asset_name || '') + ' ' + (asset.asset_code || '');
    const match = text.match(/[:#\s-](\d{4,})/);
    if (match) {
      targetEId = match[1];
    }
  }

  // 1. Khớp khóa trực tiếp trong dictionary objects
  if (targetGId && objects[targetGId]) return objects[targetGId];
  if (targetEId && objects[targetEId]) return objects[targetEId];
  if (targetEId && objects['#' + targetEId]) return objects['#' + targetEId];
  if (targetEId && objects['0#' + targetEId]) return objects['0#' + targetEId];

  const allObjects = Object.values(objects);

  // 2. Tìm theo Global ID (IFC)
  if (targetGId) {
    const match = allObjects.find(obj => 
      obj.id === targetGId || 
      obj.globalId === targetGId || 
      (obj.id && obj.id.includes(targetGId)) ||
      (obj.globalId && obj.globalId.includes(targetGId))
    );
    if (match) return match;
  }

  // 3. Tìm theo Express ID / ID rút gọn
  if (targetEId) {
    const match = allObjects.find(obj => {
      if (!obj.id) return false;
      const idStr = String(obj.id);
      const parts = idStr.split(/[:#]/);
      return parts.includes(targetEId) || idStr === targetEId || idStr.endsWith('#' + targetEId) || idStr.endsWith(':' + targetEId);
    });
    if (match) return match;
  }

  return null;
}

// =========================================================================
// --- CAMERA CONTROLS (ZOOM & HIGHLIGHT CHUẨN XÁC) ---
// =========================================================================

function focusCameraOnEntity(globalId, expressId, assetName = '') {
  const viewer = window.xeokitViewer || window.viewer;
  if (!viewer || !viewer.scene) return;

  const pseudoAsset = { global_id: globalId, express_id: expressId, asset_name: assetName };
  const entity = findEntityByAsset(viewer, pseudoAsset);

  if (!entity) {
    console.warn('⚠️ Không tìm thấy đối tượng 3D tương ứng với tài sản:', pseudoAsset);
    return;
  }

  if (!isValidAABB(entity.aabb)) {
    console.warn('⚠️ Đối tượng 3D không có Bounding Box (AABB) hợp lệ:', entity);
    return;
  }

  // Đánh dấu đối tượng được chọn
  window.selectedEntity = entity;

  // Ép hiển thị, mở ẩn và Highlight nổi bật thiết bị
  entity.visible = true; 
  if (typeof entity.culled !== 'undefined') entity.culled = false;
  entity.highlighted = true; 
  setTimeout(() => { if (entity) entity.highlighted = false; }, 3500);

  const aabb = entity.aabb;
  const center = [
    (aabb[0] + aabb[3]) / 2,
    (aabb[1] + aabb[4]) / 2,
    (aabb[2] + aabb[5]) / 2
  ];

  // 1. Ưu tiên sử dụng Camera Flight chuẩn của Xeokit (truyền aabb hoặc entity trực tiếp)
  if (viewer.cameraFlight && typeof viewer.cameraFlight.flyTo === 'function') {
    try {
      viewer.cameraFlight.flyTo({
        aabb: aabb,
        duration: 1.2
      });
      return;
    } catch (e1) {
      try {
        viewer.cameraFlight.flyTo(entity);
        return;
      } catch (e2) {
        console.warn('Chuyển sang phương án tự tính toán góc nhìn Camera:', e2);
      }
    }
  }

  // 2. Dự phòng: Tự tính toán vị trí Eye & Target để Zoom trực tiếp vào thiết bị
  const camera = viewer.scene.camera;
  if (camera) {
    const dx = aabb[3] - aabb[0];
    const dy = aabb[4] - aabb[1];
    const dz = aabb[5] - aabb[2];
    const radius = Math.max(Math.sqrt(dx * dx + dy * dy + dz * dz) * 0.5, 0.5);

    const eye = camera.eye || [0, 0, 0];
    const target = camera.target || [0, 0, 0];

    // Vector hướng nhìn hiện tại
    let dir = [eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]];
    let len = Math.sqrt(dir[0] * dir[0] + dir[1] * dir[1] + dir[2] * dir[2]);
    if (len === 0 || isNaN(len)) {
      dir = [1, 1, 1];
      len = Math.sqrt(3);
    }

    dir = [dir[0] / len, dir[1] / len, dir[2] / len];

    // Tính khoảng cách Zoom phù hợp với kích thước đối tượng
    const dist = Math.max(radius * 2.8, 2.0);
    const newEye = [
      center[0] + dir[0] * dist,
      center[1] + dir[1] * dist,
      center[2] + dir[2] * dist
    ];

    camera.target = center;
    camera.eye = newEye;
    if (viewer.scene) {
      viewer.scene._needUpdate = 1;
      if (typeof viewer.scene.render === 'function') viewer.scene.render();
    }
  }
}

// Kết nối từ Dashboard sang View Chi tiết
window.focusAndOpenAssetFromDashboard = function(expressId, globalId, assetName) {
  closeDigitalTwinDashboard();
  openDigitalTwinPanel(expressId, globalId, assetName);
};

// =========================================================================
// --- UI PANELS ---
// =========================================================================

function injectDigitalTwinPanel() {
  injectMarkerStyles();
  if (document.getElementById('dt-asset-panel')) return;

  const panelHtml = `
    <div id="dt-asset-panel" style="display:none; position:fixed; left:20px; top:80px; width:380px; max-height:85vh; overflow-y:auto; background:#fff; border-radius:10px; box-shadow: 0 4px 20px rgba(0,0,0,0.2); z-index:9999; padding:20px; font-family:sans-serif; user-select:none;">
      
      <div id="dt-panel-header" style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #eee; padding-bottom:10px; margin-bottom:15px; cursor:move; background:#f8f9fa; margin:-20px -20px 15px -20px; padding:15px 20px; border-radius:10px 10px 0 0;">
        <h3 style="margin:0; font-size:15px; color:#1a73e8; pointer-events:none;">🏷️ Quản Lý Tài Sản (Digital Twin)</h3>
        <button type="button" onclick="closeAssetPanel()" style="border:none; background:none; cursor:pointer; font-size:18px; font-weight:bold;">✕</button>
      </div>

      <div style="margin-bottom:15px; display:flex; gap:8px;">
        <button type="button" id="dt-btn-toggle-color" onclick="toggleColorCodingMode(this)" 
                style="flex:1; padding:8px 10px; background:#f0f4f9; color:#1a73e8; border:1px solid #b6d4fe; border-radius:6px; font-weight:bold; cursor:pointer; font-size:11px; display:flex; align-items:center; justify-content:center;">
          🎨 Xem Trạng Thái 3D
        </button>
        <button type="button" onclick="openDigitalTwinDashboard()" 
                style="flex:1; padding:8px 10px; background:#e8f0fe; color:#1a73e8; border:1px solid #b6d4fe; border-radius:6px; font-weight:bold; cursor:pointer; font-size:11px; display:flex; align-items:center; justify-content:center;">
          📊 Dashboard Thống Kê
        </button>
      </div>

      <form id="dt-asset-form">
        <input type="hidden" id="dt_global_id" />
        <input type="hidden" id="dt_express_id" />

        <div style="margin-bottom:10px;">
          <label style="font-size:12px; font-weight:bold; color:#333;">GlobalID IFC:</label>
          <input type="text" id="dt_display_global_id" readonly style="width:100%; padding:8px; background:#eef3fc; border:1px solid #b6d4fe; border-radius:4px; font-size:12px; color:#0d6efd; font-weight:bold; box-sizing:border-box;" />
        </div>

        <div style="margin-bottom:10px;">
          <label style="font-size:12px; font-weight:bold;">Mã Tài Sản (Asset Tag) <span style="color:red">*</span>:</label>
          <input type="text" id="dt_asset_code" required style="width:100%; padding:6px; border:1px solid #ccc; border-radius:4px; box-sizing:border-box;" />
        </div>

        <div style="margin-bottom:10px;">
          <label style="font-size:12px; font-weight:bold;">Tên Thiết Bị <span style="color:red">*</span>:</label>
          <input type="text" id="dt_asset_name" required style="width:100%; padding:6px; border:1px solid #ccc; border-radius:4px; box-sizing:border-box;" />
        </div>

        <div style="margin-bottom:10px;">
          <label style="font-size:12px; font-weight:bold;">Trạng Thái Vận Hành:</label>
          <select id="dt_status" style="width:100%; padding:6px; border:1px solid #ccc; border-radius:4px; box-sizing:border-box;">
            <option value="OPERATIONAL">🟢 Đang hoạt động bình thường</option>
            <option value="MAINTENANCE">🟡 Đang bảo trì / Kiểm tra</option>
            <option value="FAULT">🔴 Có sự cố / Hỏng hóc</option>
          </select>
        </div>

        <div style="display:flex; gap:10px; margin-bottom:10px;">
          <div style="flex:1;">
            <label style="font-size:11px;">Ngày Lắp Đặt:</label>
            <input type="date" id="dt_install_date" style="width:100%; padding:4px; border:1px solid #ccc; border-radius:4px; box-sizing:border-box;" />
          </div>
          <div style="flex:1;">
            <label style="font-size:11px;">Hạn Bảo Hành:</label>
            <input type="date" id="dt_warranty_date" style="width:100%; padding:4px; border:1px solid #ccc; border-radius:4px; box-sizing:border-box;" />
          </div>
        </div>

        <div style="display:flex; gap:10px; margin-bottom:10px;">
          <div style="flex:1;">
            <label style="font-size:11px; font-weight:bold; color:#d93025;">🔧 Bảo Trì Gần Nhất:</label>
            <input type="date" id="dt_last_maint_date" style="width:100%; padding:4px; border:1px solid #ccc; border-radius:4px; box-sizing:border-box;" />
          </div>
          <div style="flex:1;">
            <label style="font-size:11px; font-weight:bold; color:#1a73e8;">📅 Lịch Bảo Trì Kế:</label>
            <input type="date" id="dt_next_maint_date" style="width:100%; padding:4px; border:1px solid #ccc; border-radius:4px; box-sizing:border-box;" />
          </div>
        </div>

        <div style="margin-bottom:10px;">
          <label style="font-size:12px; font-weight:bold;">📝 Nhật Ký Vận Hành / Bảo Trì:</label>
          <textarea id="dt_maint_log" rows="3" style="width:100%; padding:6px; border:1px solid #ccc; border-radius:4px; font-size:12px; resize:vertical; box-sizing:border-box;"></textarea>
        </div>

        <div style="margin-bottom:15px;">
          <label style="font-size:12px;">Đính kèm Tài Liệu / HDSD (PDF):</label>
          <input type="file" id="dt_file_input" accept=".pdf,.docx,.png,.jpg" style="width:100%; font-size:12px;" />
          <div id="dt_doc_list" style="margin-top:8px; font-size:12px; color:#1a73e8;"></div>
        </div>

        <button type="button" onclick="saveAssetToDatabase()" style="width:100%; padding:10px; background:#1a73e8; color:#fff; border:none; border-radius:5px; font-weight:bold; cursor:pointer;">💾 Lưu Hồ Sơ Thiết Bị</button>
      </form>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', panelHtml);
  makePanelDraggable();
}

function makePanelDraggable() {
  const panel = document.getElementById('dt-asset-panel');
  const header = document.getElementById('dt-panel-header');
  if (!panel || !header || panel.dataset.draggable === 'true') return;
  panel.dataset.draggable = 'true';

  let posX = 0, posY = 0, mouseX = 0, mouseY = 0;
  header.onmousedown = (e) => {
    e.preventDefault();
    mouseX = e.clientX; mouseY = e.clientY;
    document.onmouseup = () => { document.onmouseup = null; document.onmousemove = null; };
    document.onmousemove = (ev) => {
      ev.preventDefault();
      posX = mouseX - ev.clientX; posY = mouseY - ev.clientY;
      mouseX = ev.clientX; mouseY = ev.clientY;
      panel.style.top = (panel.offsetTop - posY) + 'px';
      panel.style.left = (panel.offsetLeft - posX) + 'px';
    };
  };
}

function toggleDigitalTwinPanelFromMenu() {
  injectDigitalTwinPanel();
  const panel = document.getElementById('dt-asset-panel');
  if (panel.style.display === 'none' || panel.style.display === '') {
    const entity = window.selectedEntity;
    const metaObject = window.selectedMetaObject;
    let expressID = entity ? entity.id : '';
    let globalID = '';
    let assetName = (metaObject && metaObject.name) ? metaObject.name : '';

    if (metaObject) {
      if (metaObject.originalSystemId) globalID = metaObject.originalSystemId;
      else if (metaObject.globalId) globalID = metaObject.globalId;
      else if (metaObject.id && String(metaObject.id).includes('-')) globalID = metaObject.id;
    }
    if (!globalID && entity && entity.globalId) globalID = entity.globalId;

    openDigitalTwinPanel(expressID, globalID, assetName);
  } else {
    panel.style.display = 'none';
  }
}

async function openDigitalTwinPanel(expressID, globalID, assetName = '') {
  injectDigitalTwinPanel();
  const panel = document.getElementById('dt-asset-panel');
  panel.style.display = 'block';

  document.getElementById('dt-asset-form').reset();
  document.getElementById('dt_doc_list').innerHTML = '';

  let finalExpressID = cleanId(expressID);
  let finalGlobalID = cleanId(globalID);

  function getIfcGlobalIdFromDOM() {
    const elements = Array.from(document.querySelectorAll('tr, div, td, span'));
    for (const el of elements) {
      if (el.innerText && el.innerText.trim() === 'ID Cấu Kiện') {
        const parentRow = el.closest('tr') || el.parentElement;
        if (parentRow) {
          const cells = parentRow.querySelectorAll('td, span, div');
          if (cells.length > 1) return cells[1].innerText.trim();
        }
      }
    }
    return '';
  }

  if (!finalGlobalID) {
    const domId = getIfcGlobalIdFromDOM();
    if (domId && domId !== 'ID Cấu Kiện') finalGlobalID = domId;
  }

  const applyValues = (gId, eId, aName) => {
    document.getElementById('dt_global_id').value = gId || eId || '';
    document.getElementById('dt_express_id').value = eId || '';
    document.getElementById('dt_display_global_id').value = gId || eId || '';
    if (aName) document.getElementById('dt_asset_name').value = aName;
  };

  applyValues(finalGlobalID, finalExpressID, assetName);

  // Zoom tới thiết bị với ID chính xác nhất
  focusCameraOnEntity(finalGlobalID, finalExpressID, assetName);

  const client = getDigitalTwinSupabaseClient();

  if (client && (finalGlobalID || finalExpressID)) {
    try {
      let query = client.from('project_assets').select('*, asset_documents(*)');
      if (finalGlobalID) {
        query = query.eq('global_id', finalGlobalID);
      } else if (finalExpressID) {
        query = query.eq('express_id', parseInt(finalExpressID));
      }

      const { data: existingAsset } = await query.maybeSingle();

      if (existingAsset) {
        document.getElementById('dt_asset_code').value = existingAsset.asset_code || '';
        document.getElementById('dt_asset_name').value = existingAsset.asset_name || assetName;
        document.getElementById('dt_status').value = existingAsset.status || 'OPERATIONAL';
        document.getElementById('dt_install_date').value = existingAsset.installation_date || '';
        document.getElementById('dt_warranty_date').value = existingAsset.warranty_expiry || '';
        document.getElementById('dt_last_maint_date').value = existingAsset.last_maintenance_date || '';
        document.getElementById('dt_next_maint_date').value = existingAsset.next_maintenance_date || '';
        document.getElementById('dt_maint_log').value = existingAsset.maintenance_log || '';

        if (existingAsset.asset_documents?.length > 0) {
          let docsHtml = '<b>Tài liệu đã đính kèm:</b><br>';
          existingAsset.asset_documents.forEach(doc => {
            docsHtml += `📄 <a href="${doc.file_url}" target="_blank" style="color:#1a73e8;">${doc.file_name}</a><br>`;
          });
          document.getElementById('dt_doc_list').innerHTML = docsHtml;
        }
      }
    } catch (e) {
      console.warn('Lỗi đọc thông tin tài sản từ CSDL:', e);
    }
  }
}

function closeAssetPanel() { document.getElementById('dt-asset-panel').style.display = 'none'; }

// =========================================================================
// --- TÔ MÀU 3D & HIỂN THỊ MARKER 3D ĐÃ SỬA LỖI TÍNH TOÁN ---
// =========================================================================

async function applyAssetColorCoding() {
  const client = getDigitalTwinSupabaseClient();
  if (!client) return alert('Chưa kết nối CSDL Supabase!');

  try {
    const { data: assets } = await client.from('project_assets').select('*');
    if (!assets || assets.length === 0) return;

    const viewer = window.xeokitViewer || window.viewer;
    if (!viewer || !viewer.scene) return;

    assets.forEach(asset => {
      const rgbColor = STATUS_COLORS[asset.status] || STATUS_COLORS.OPERATIONAL;
      const entity = findEntityByAsset(viewer, asset);
      if (entity) {
        entity.colorize = rgbColor;
        entity.colorized = true;
        entity.opacity = 1.0;
      }
    });

    viewer.scene._needUpdate = 1;
    if (typeof viewer.scene.render === 'function') viewer.scene.render();

    // Đặt cờ trước khi render Marker để không bị cản
    isColorCodingActive = true;
    render3DMarkers(assets);
  } catch (err) {
    console.error('Lỗi áp dụng màu 3D:', err);
  }
}

function resetModelColors() {
  const viewer = window.xeokitViewer || window.viewer;
  if (viewer && viewer.scene) {
    Object.values(viewer.scene.objects).forEach(entity => {
      entity.colorize = null;
      entity.colorized = false;
    });
    viewer.scene._needUpdate = 1;
    if (typeof viewer.scene.render === 'function') viewer.scene.render();
  }
  clear3DMarkers();
  isColorCodingActive = false;
}

function toggleColorCodingMode(btn) {
  if (!isColorCodingActive) {
    applyAssetColorCoding();
    if (btn) { btn.innerText = '🔄 Khôi Phục Màu Mặc Định'; btn.style.backgroundColor = '#28a745'; btn.style.color = '#fff'; btn.style.borderColor = '#28a745'; }
  } else {
    resetModelColors();
    if (btn) { btn.innerText = '🎨 Xem Trạng Thái 3D'; btn.style.backgroundColor = '#f0f4f9'; btn.style.color = '#1a73e8'; btn.style.borderColor = '#b6d4fe'; }
  }
}

function getOrCreateMarkerContainer() {
  injectMarkerStyles();
  let container = document.getElementById('dt-marker-overlay-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'dt-marker-overlay-container';
    document.body.appendChild(container);
  }
  return container;
}

function render3DMarkers(assets) {
  clear3DMarkers();
  const viewer = window.xeokitViewer || window.viewer;
  if (!viewer || !viewer.scene || !viewer.scene.canvas) return;

  const container = getOrCreateMarkerContainer();
  const trackedItems = [];

  assets.forEach(asset => {
    const entity = findEntityByAsset(viewer, asset);
    if (entity && isValidAABB(entity.aabb)) {
      const aabb = entity.aabb;
      const centerWorldPos = [
        (aabb[0] + aabb[3]) / 2, 
        (aabb[1] + aabb[4]) / 2, 
        (aabb[2] + aabb[5]) / 2
      ];

      let markerIcon = '🟢', markerClass = 'operational';
      if (asset.status === 'FAULT') { markerIcon = '🛑'; markerClass = 'fault'; } 
      else if (asset.status === 'MAINTENANCE') { markerIcon = '⚠️'; markerClass = 'maintenance'; }

      const markerDiv = document.createElement('div');
      markerDiv.className = `dt-3d-marker ${markerClass}`;
      markerDiv.style.display = 'none';
      markerDiv.innerHTML = `<span>${markerIcon}</span><span>${asset.asset_code || asset.asset_name}</span>`;

      markerDiv.onclick = (e) => {
        e.stopPropagation();
        const safeEId = cleanId(asset.express_id);
        const safeGId = cleanId(asset.global_id);
        openDigitalTwinPanel(safeEId, safeGId, asset.asset_name);
      };

      container.appendChild(markerDiv);
      activeMarkerElements.push(markerDiv);
      trackedItems.push({ element: markerDiv, worldPos: centerWorldPos });
    }
  });

  // HÀM TÍNH TOÁN VỊ TRÍ MARKER
  function updateMarkerPositions() {
    if (!isColorCodingActive || trackedItems.length === 0) return;
    const currentViewer = window.xeokitViewer || window.viewer;
    if (!currentViewer || !currentViewer.scene || !currentViewer.scene.camera) return;

    const camera = currentViewer.scene.camera;
    const canvas = currentViewer.scene.canvas.canvas;
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();

    // 1. Kiểm tra nếu Xeokit hỗ trợ hàm chiếu worldToCanvas trực tiếp
    if (currentViewer.scene.canvas && typeof currentViewer.scene.canvas.worldToCanvas === 'function') {
      trackedItems.forEach(item => {
        const canvasPos = [0, 0];
        currentViewer.scene.canvas.worldToCanvas(item.worldPos, canvasPos);
        item.element.style.display = 'flex';
        item.element.style.left = Math.round(rect.left + canvasPos[0]) + 'px';
        item.element.style.top = Math.round(rect.top + canvasPos[1]) + 'px';
      });
      return;
    }

    // 2. Thuật toán nhân Ma Trận chuyển đổi 3D -> 2D
    const viewMat = camera.viewMatrix;
    const projMat = camera.projMatrix || (camera.project && camera.project.projMatrix);

    if (!viewMat || !projMat) return;

    trackedItems.forEach(item => {
      const pos = item.worldPos;
      
      // World -> View Space
      let vx = viewMat[0]*pos[0] + viewMat[4]*pos[1] + viewMat[8]*pos[2] + viewMat[12];
      let vy = viewMat[1]*pos[0] + viewMat[5]*pos[1] + viewMat[9]*pos[2] + viewMat[13];
      let vz = viewMat[2]*pos[0] + viewMat[6]*pos[1] + viewMat[10]*pos[2] + viewMat[14];
      
      // View -> Clip Space
      let px = projMat[0]*vx + projMat[4]*vy + projMat[8]*vz + projMat[12];
      let py = projMat[1]*vx + projMat[5]*vy + projMat[9]*vz + projMat[13];
      let pw = projMat[3]*vx + projMat[7]*vy + projMat[11]*vz + projMat[15];

      // Vật thể nằm phía sau Camera -> Ẩn Marker
      if (pw <= 0) {
        item.element.style.display = 'none';
        return;
      }

      // Tọa độ NDC (-1 đến 1)
      let nx = px / pw;
      let ny = py / pw;
      
      // Đổi sang Pixel trên Màn Hình
      let x = rect.left + (nx + 1) * 0.5 * rect.width;
      let y = rect.top + (1 - ny) * 0.5 * rect.height;

      const margin = 50;
      if (x >= rect.left - margin && x <= rect.left + rect.width + margin && 
          y >= rect.top - margin && y <= rect.top + rect.height + margin) {
        item.element.style.display = 'flex';
        item.element.style.left = Math.round(x) + 'px';
        item.element.style.top = Math.round(y) + 'px';
      } else {
        item.element.style.display = 'none';
      }
    });
  }

  // Đăng ký sự kiện cập nhật vị trí linh hoạt
  markerTickListener = viewer.scene.on("tick", updateMarkerPositions);
  if (viewer.scene.camera && typeof viewer.scene.camera.on === 'function') {
    viewer.scene.camera.on("matrix", updateMarkerPositions);
  }
  
  // Chạy ngay lần đầu
  setTimeout(updateMarkerPositions, 50);
}

function clear3DMarkers() {
  const viewer = window.xeokitViewer || window.viewer;
  if (viewer && viewer.scene && markerTickListener) {
    try { viewer.scene.off(markerTickListener); } catch (e) {}
    markerTickListener = null;
  }
  activeMarkerElements.forEach(el => { if (el && el.parentElement) el.parentElement.removeChild(el); });
  activeMarkerElements = [];
  const container = document.getElementById('dt-marker-overlay-container');
  if (container) container.innerHTML = '';
}

// =========================================================================
// --- DASHBOARD THỐNG KÊ VẬN HÀNH ---
// =========================================================================

function injectDigitalTwinDashboardModal() {
  if (document.getElementById('dt-dashboard-modal')) return;
  const modalHtml = `
    <div id="dt-dashboard-modal" style="display:none; position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.5); z-index:10000; align-items:center; justify-content:center; font-family:sans-serif;">
      <div style="background:#fff; width:85%; max-width:900px; max-height:90vh; border-radius:12px; overflow:hidden; display:flex; flex-direction:column; box-shadow:0 10px 30px rgba(0,0,0,0.3);">
        <div style="padding:15px 20px; background:#1a73e8; color:#fff; display:flex; justify-content:space-between; align-items:center;">
          <h2 style="margin:0; font-size:16px;">📊 Báo Cáo & Thống Kê Vận Hành Tài Sản</h2>
          <button type="button" onclick="closeDigitalTwinDashboard()" style="background:none; border:none; color:#fff; font-size:20px; cursor:pointer;">✕</button>
        </div>
        <div style="padding:20px; overflow-y:auto; flex:1; background:#f8f9fa;">
          <div style="display:grid; grid-template-columns: repeat(4, 1fr); gap:15px; margin-bottom:20px;">
            <div style="background:#fff; padding:15px; border-radius:8px; border-left:4px solid #1a73e8; box-shadow:0 2px 4px rgba(0,0,0,0.05);">
              <div style="font-size:12px; color:#666; font-weight:bold;">TỔNG THIẾT BỊ</div>
              <div id="dt-dash-total" style="font-size:24px; font-weight:bold; color:#1a73e8; margin-top:5px;">0</div>
            </div>
            <div style="background:#fff; padding:15px; border-radius:8px; border-left:4px solid #28a745;">
              <div style="font-size:12px; color:#666; font-weight:bold;">🟢 HOẠT ĐỘNG BÌNH THƯỜNG</div>
              <div id="dt-dash-op" style="font-size:24px; font-weight:bold; color:#28a745; margin-top:5px;">0</div>
            </div>
            <div style="background:#fff; padding:15px; border-radius:8px; border-left:4px solid #f39c12;">
              <div style="font-size:12px; color:#666; font-weight:bold;">🟡 ĐANG BẢO TRÌ</div>
              <div id="dt-dash-maint" style="font-size:24px; font-weight:bold; color:#f39c12; margin-top:5px;">0</div>
            </div>
            <div style="background:#fff; padding:15px; border-radius:8px; border-left:4px solid #dc3545;">
              <div style="font-size:12px; color:#666; font-weight:bold;">🔴 SỰ CỐ / HỎNG HÓC</div>
              <div id="dt-dash-fault" style="font-size:24px; font-weight:bold; color:#dc3545; margin-top:5px;">0</div>
            </div>
          </div>

          <div style="background:#fff; padding:15px; border-radius:8px; box-shadow:0 2px 4px rgba(0,0,0,0.05);">
            <h3 style="margin-top:0; font-size:14px; border-bottom:1px solid #eee; padding-bottom:10px;">⚠️ Thiết Bị Cần Xử Lý</h3>
            <table style="width:100%; border-collapse:collapse; font-size:12px; text-align:left;">
              <thead>
                <tr style="background:#f1f3f4; color:#5f6368;">
                  <th style="padding:8px; border-bottom:1px solid #ddd;">Mã Tài Sản</th>
                  <th style="padding:8px; border-bottom:1px solid #ddd;">Tên Thiết Bị</th>
                  <th style="padding:8px; border-bottom:1px solid #ddd;">Trạng Thái</th>
                  <th style="padding:8px; border-bottom:1px solid #ddd;">Lịch Bảo Trì Kế</th>
                  <th style="padding:8px; border-bottom:1px solid #ddd; text-align:center;">Thao Tác</th>
                </tr>
              </thead>
              <tbody id="dt-dash-table-body">
                <tr><td colspan="5" style="text-align:center; padding:15px;">Đang tải...</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', modalHtml);
}

async function openDigitalTwinDashboard() {
  injectDigitalTwinDashboardModal();
  const modal = document.getElementById('dt-dashboard-modal');
  if (modal) modal.style.display = 'flex';

  const client = getDigitalTwinSupabaseClient();
  if (!client) return;

  try {
    const { data: assets } = await client.from('project_assets').select('*');
    let total = assets ? assets.length : 0;
    let op = 0, maint = 0, fault = 0;
    let alertRowsHtml = '';

    if (assets) {
      assets.forEach(asset => {
        if (asset.status === 'OPERATIONAL') op++;
        else if (asset.status === 'MAINTENANCE') maint++;
        else if (asset.status === 'FAULT') fault++;

        if (asset.status !== 'OPERATIONAL') {
          const badge = asset.status === 'FAULT' ? '<span style="color:#dc3545; font-weight:bold;">🔴 Sự cố</span>' : '<span style="color:#f39c12; font-weight:bold;">🟡 Bảo trì</span>';
          
          const safeEId = cleanId(asset.express_id);
          const safeGId = cleanId(asset.global_id);
          const safeName = (asset.asset_name || '').replace(/'/g, "\\'").replace(/"/g, "&quot;");

          alertRowsHtml += `
            <tr style="border-bottom:1px solid #eee;">
              <td style="padding:8px; font-weight:bold;">${asset.asset_code || '-'}</td>
              <td style="padding:8px;">${asset.asset_name || '-'}</td>
              <td style="padding:8px;">${badge}</td>
              <td style="padding:8px; color:#1a73e8; font-weight:bold;">${asset.next_maintenance_date || '-'}</td>
              <td style="padding:8px; text-align:center;">
                <button type="button" onclick="focusAndOpenAssetFromDashboard('${safeEId}', '${safeGId}', '${safeName}')" 
                        style="padding:4px 8px; background:#1a73e8; color:#fff; border:none; border-radius:4px; font-size:11px; cursor:pointer;">
                  🔎 Xem Chi Tiết
                </button>
              </td>
            </tr>
          `;
        }
      });
    }

    document.getElementById('dt-dash-total').innerText = total;
    document.getElementById('dt-dash-op').innerText = op;
    document.getElementById('dt-dash-maint').innerText = maint;
    document.getElementById('dt-dash-fault').innerText = fault;
    document.getElementById('dt-dash-table-body').innerHTML = alertRowsHtml || '<tr><td colspan="5" style="text-align:center; padding:15px; color:#28a745;">🎉 Tất cả thiết bị bình thường!</td></tr>';
  } catch (err) {}
}

function closeDigitalTwinDashboard() {
  const modal = document.getElementById('dt-dashboard-modal');
  if (modal) modal.style.display = 'none';
}

// =========================================================================
// --- LƯU DỮ LIỆU ---
// =========================================================================

async function saveAssetToDatabase() {
  const globalId = document.getElementById('dt_global_id').value;
  const expressId = document.getElementById('dt_express_id').value;
  const assetCode = document.getElementById('dt_asset_code').value;
  const assetName = document.getElementById('dt_asset_name').value;
  const status = document.getElementById('dt_status').value;

  if (!assetCode || !assetName) return alert('Vui lòng nhập Mã Tài Sản và Tên Thiết Bị!');

  const client = getDigitalTwinSupabaseClient();
  if (!client) return alert('Chưa kết nối CSDL Supabase!');

  try {
    const { error } = await client.from('project_assets').upsert({
      project_id: window.currentProjectId || 'DEFAULT_PROJ',
      global_id: globalId,
      express_id: parseInt(expressId) || 0,
      asset_code: assetCode,
      asset_name: assetName,
      status: status,
      installation_date: document.getElementById('dt_install_date').value || null,
      warranty_expiry: document.getElementById('dt_warranty_date').value || null,
      last_maintenance_date: document.getElementById('dt_last_maint_date').value || null,
      next_maintenance_date: document.getElementById('dt_next_maint_date').value || null,
      maintenance_log: document.getElementById('dt_maint_log').value || '',
      updated_at: new Date()
    }, { onConflict: 'global_id' });

    if (error) throw error;
    if (isColorCodingActive) applyAssetColorCoding();
    alert('✅ Lưu hồ sơ thành công!');
    closeAssetPanel();
  } catch (err) {
    alert('Lỗi: ' + err.message);
  }
}