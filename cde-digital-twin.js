// --- MODULE QUẢN LÝ TÀI SẢN DIGITAL TWIN (FA/AM) ---

const DT_SUPABASE_URL = window.SUPABASE_URL || 'https://znzakqzdezxzqzfplmgv.supabase.co'; 
const DT_SUPABASE_KEY = window.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInRefiI6InpuemFrcXpkZXp4enF6ZnBsbWd2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc4MTQyNzAsImV4cCI6MjEwMzM5MDI3MH0.aV5YaOLxTySiB26ror4CRzJvQsjANNI1DwbtbxcNe4A';

const STATUS_COLORS = {
  OPERATIONAL: [0.1, 0.8, 0.3], // 🟢 Xanh lá
  MAINTENANCE: [1.0, 0.75, 0.0], // 🟡 Vàng
  FAULT:       [0.9, 0.1, 0.1]  // 🔴 Đỏ
};

let isColorCodingActive = false; 
let activeMarkerElements = [];   
let markerTickListener = null;   

/**
 * Style Marker 3D
 */
function injectMarkerStyles() {
  if (document.getElementById('dt-marker-styles')) return;
  const style = document.createElement('style');
  style.id = 'dt-marker-styles';
  style.innerHTML = `
    #dt-marker-container {
      position: fixed !important;
      top: 0 !important;
      left: 0 !important;
      width: 100vw !important;
      height: 100vh !important;
      pointer-events: none !important; /* KHÔNG BẮT SỰ KIỆN CHUỘT -> HOÀN TOÀN TỰ DO XOAY MÔ HÌNH */
      z-index: 998 !important;
      overflow: hidden !important;
    }
    .dt-3d-marker {
      position: absolute !important;
      padding: 6px 12px !important;
      border-radius: 16px !important;
      font-size: 11px !important;
      font-weight: bold !important;
      color: #ffffff !important;
      box-shadow: 0 4px 10px rgba(0,0,0,0.4) !important;
      pointer-events: auto !important; /* Chỉ nhận click khi bấm đúng vào Pin */
      cursor: pointer !important;
      transform: translate(-50%, -100%) !important;
      white-space: nowrap !important;
      user-select: none !important;
      display: flex !important;
      align-items: center !important;
      gap: 6px !important;
      z-index: 999 !important;
      transition: transform 0.1s ease-out;
    }
    .dt-3d-marker:hover {
      transform: translate(-50%, -110%) scale(1.08) !important;
    }
    .dt-3d-marker.operational {
      background: #28a745 !important;
      border: 1.5px solid #ffffff !important;
    }
    .dt-3d-marker.maintenance {
      background: #f39c12 !important;
      border: 1.5px solid #ffffff !important;
    }
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
  if (window.dbClient && typeof window.dbClient.from === 'function') return window.dbClient;

  if (window.supabase && typeof window.supabase.createClient === 'function') {
    if (!window._dtSupabaseInstance && DT_SUPABASE_URL.includes('http')) {
      window._dtSupabaseInstance = window.supabase.createClient(DT_SUPABASE_URL, DT_SUPABASE_KEY);
    }
    return window._dtSupabaseInstance || null;
  }
  return null;
}

/**
 * Panel Quản Lý Tài Sản
 */
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
                style="flex:1; padding:8px 10px; background:#f0f4f9; color:#1a73e8; border:1px solid #b6d4fe; border-radius:6px; font-weight:bold; cursor:pointer; font-size:11px; display:flex; align-items:center; justify-content:center; gap:4px; transition:0.2s;">
          🎨 Xem Trạng Thái 3D
        </button>
        <button type="button" onclick="openDigitalTwinDashboard()" 
                style="flex:1; padding:8px 10px; background:#e8f0fe; color:#1a73e8; border:1px solid #b6d4fe; border-radius:6px; font-weight:bold; cursor:pointer; font-size:11px; display:flex; align-items:center; justify-content:center; gap:4px;">
          📊 Dashboard Thống Kê
        </button>
      </div>

      <form id="dt-asset-form">
        <input type="hidden" id="dt_global_id" />
        <input type="hidden" id="dt_express_id" />

        <div style="margin-bottom:10px;">
          <label style="font-size:12px; font-weight:bold; color:#333;">GlobalID IFC:</label>
          <input type="text" id="dt_display_global_id" readonly style="width:100%; padding:8px; background:#eef3fc; border:1px solid #b6d4fe; border-radius:4px; font-size:12px; color:#0d6efd; font-weight:bold;" />
        </div>

        <div style="margin-bottom:10px;">
          <label style="font-size:12px; font-weight:bold;">Mã Tài Sản (Asset Tag) <span style="color:red">*</span>:</label>
          <input type="text" id="dt_asset_code" placeholder="VD: AB01-A" required style="width:100%; padding:6px; border:1px solid #ccc; border-radius:4px;" />
        </div>

        <div style="margin-bottom:10px;">
          <label style="font-size:12px; font-weight:bold;">Tên Thiết Bị <span style="color:red">*</span>:</label>
          <input type="text" id="dt_asset_name" placeholder="VD: Máy thổi khí" required style="width:100%; padding:6px; border:1px solid #ccc; border-radius:4px;" />
        </div>

        <div style="margin-bottom:10px;">
          <label style="font-size:12px; font-weight:bold;">Trạng Thái Vận Hành:</label>
          <select id="dt_status" style="width:100%; padding:6px; border:1px solid #ccc; border-radius:4px;">
            <option value="OPERATIONAL">🟢 Đang hoạt động bình thường</option>
            <option value="MAINTENANCE">🟡 Đang bảo trì / Kiểm tra</option>
            <option value="FAULT">🔴 Có sự cố / Hỏng hóc</option>
          </select>
        </div>

        <div style="display:flex; gap:10px; margin-bottom:10px;">
          <div style="flex:1;">
            <label style="font-size:11px;">Ngày Lắp Đặt:</label>
            <input type="date" id="dt_install_date" style="width:100%; padding:4px; border:1px solid #ccc; border-radius:4px;" />
          </div>
          <div style="flex:1;">
            <label style="font-size:11px;">Hạn Bảo Hành:</label>
            <input type="date" id="dt_warranty_date" style="width:100%; padding:4px; border:1px solid #ccc; border-radius:4px;" />
          </div>
        </div>

        <div style="display:flex; gap:10px; margin-bottom:10px;">
          <div style="flex:1;">
            <label style="font-size:11px; font-weight:bold; color:#d93025;">🔧 Bảo Trì Gần Nhất:</label>
            <input type="date" id="dt_last_maint_date" style="width:100%; padding:4px; border:1px solid #ccc; border-radius:4px;" />
          </div>
          <div style="flex:1;">
            <label style="font-size:11px; font-weight:bold; color:#1a73e8;">📅 Lịch Bảo Trì Kế:</label>
            <input type="date" id="dt_next_maint_date" style="width:100%; padding:4px; border:1px solid #ccc; border-radius:4px;" />
          </div>
        </div>

        <div style="margin-bottom:10px;">
          <label style="font-size:12px; font-weight:bold;">📝 Nhật Ký Vận Hành / Bảo Trì:</label>
          <textarea id="dt_maint_log" rows="3" placeholder="Nhập ghi chú bảo trì..." style="width:100%; padding:6px; border:1px solid #ccc; border-radius:4px; font-size:12px; resize:vertical;"></textarea>
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
    e = e || window.event;
    e.preventDefault();
    mouseX = e.clientX;
    mouseY = e.clientY;
    document.onmouseup = () => { document.onmouseup = null; document.onmousemove = null; };
    document.onmousemove = (ev) => {
      ev = ev || window.event;
      ev.preventDefault();
      posX = mouseX - ev.clientX;
      posY = mouseY - ev.clientY;
      mouseX = ev.clientX;
      mouseY = ev.clientY;
      panel.style.top = (panel.offsetTop - posY) + 'px';
      panel.style.left = (panel.offsetLeft - posX) + 'px';
      panel.style.right = 'auto';
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
    if (!globalID && entity && entity.globalId) {
      globalID = entity.globalId;
    }

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

  function getIfcGlobalIdFromDOM() {
    const elements = Array.from(document.querySelectorAll('tr, div, td, span'));
    for (const el of elements) {
      if (el.innerText && el.innerText.trim() === 'ID Cấu Kiện') {
        const parentRow = el.closest('tr') || el.parentElement;
        if (parentRow) {
          const cells = parentRow.querySelectorAll('td, span, div');
          if (cells.length > 1) {
            const val = cells[1].innerText.trim();
            if (val && val !== 'ID Cấu Kiện') return val;
          }
        }
      }
    }
    return '';
  }

  let finalGlobalID = globalID;
  if (!finalGlobalID || String(finalGlobalID) === String(expressID)) {
    const domId = getIfcGlobalIdFromDOM();
    if (domId) finalGlobalID = domId;
  }

  const applyValuesToForm = (gId, eId, aName) => {
    document.getElementById('dt_global_id').value = gId || eId || '';
    document.getElementById('dt_express_id').value = eId || '';
    document.getElementById('dt_display_global_id').value = gId || eId || '';
    if (aName) document.getElementById('dt_asset_name').value = aName;
  };

  applyValuesToForm(finalGlobalID, expressID, assetName);

  setTimeout(() => {
    const delayedId = getIfcGlobalIdFromDOM();
    if (delayedId) applyValuesToForm(delayedId, expressID, assetName);
  }, 150);

  const client = getDigitalTwinSupabaseClient();
  const searchId = finalGlobalID || expressID;

  if (client && searchId) {
    try {
      const { data: existingAsset, error } = await client
        .from('project_assets')
        .select('*, asset_documents(*)')
        .filter('global_id', 'ilike', `%${searchId}%`)
        .maybeSingle();

      if (error) return;

      if (existingAsset) {
        document.getElementById('dt_asset_code').value = existingAsset.asset_code || '';
        document.getElementById('dt_asset_name').value = existingAsset.asset_name || assetName;
        document.getElementById('dt_status').value = existingAsset.status || 'OPERATIONAL';
        document.getElementById('dt_install_date').value = existingAsset.installation_date || '';
        document.getElementById('dt_warranty_date').value = existingAsset.warranty_expiry || '';
        document.getElementById('dt_last_maint_date').value = existingAsset.last_maintenance_date || '';
        document.getElementById('dt_next_maint_date').value = existingAsset.next_maintenance_date || '';
        document.getElementById('dt_maint_log').value = existingAsset.maintenance_log || '';

        if (existingAsset.asset_documents && existingAsset.asset_documents.length > 0) {
          let docsHtml = '<b>Tài liệu đã đính kèm:</b><br>';
          existingAsset.asset_documents.forEach(doc => {
            docsHtml += `📄 <a href="${doc.file_url}" target="_blank" style="color:#1a73e8; text-decoration:none;">${doc.file_name}</a><br>`;
          });
          document.getElementById('dt_doc_list').innerHTML = docsHtml;
        }
      }
    } catch (e) {
      console.warn('Lỗi đọc CSDL:', e);
    }
  }
}

function closeAssetPanel() {
  const panel = document.getElementById('dt-asset-panel');
  if (panel) panel.style.display = 'none';
}

// =========================================================================
// --- TÔ MÀU MÔ HÌNH 3D & HIỆN MARKER PIN ---
// =========================================================================

async function applyAssetColorCoding() {
  const client = getDigitalTwinSupabaseClient();
  if (!client) {
    alert('Chưa kết nối CSDL Supabase!');
    return;
  }

  try {
    const { data: assets, error } = await client
      .from('project_assets')
      .select('express_id, global_id, status, asset_code, asset_name');

    if (error || !assets || assets.length === 0) {
      console.warn('Không lấy được dữ liệu tài sản từ CSDL:', error);
      return;
    }

    const viewer = window.xeokitViewer || window.viewer;
    if (!viewer || !viewer.scene) {
      console.warn('Chưa tìm thấy Viewer 3D!');
      return;
    }

    const allObjects = Object.values(viewer.scene.objects);

    assets.forEach(asset => {
      const rgbColor = STATUS_COLORS[asset.status] || STATUS_COLORS.OPERATIONAL;
      const targetGId = String(asset.global_id || '').trim();

      const matchedEntity = allObjects.find(obj => {
        const objId = String(obj.id || '');
        return targetGId && objId.includes(targetGId);
      });

      if (matchedEntity) {
        matchedEntity.colorize = rgbColor;
        matchedEntity.colorized = true;
        matchedEntity.opacity = 1.0;
      }
    });

    viewer.scene._needUpdate = 1;
    if (typeof viewer.scene.render === 'function') {
      viewer.scene.render();
    }

    // Hiển thị Pin Cảnh báo 3D
    render3DMarkers(assets);

    isColorCodingActive = true;
  } catch (err) {
    console.error('Lỗi tô màu 3D:', err);
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
    if (typeof viewer.scene.render === 'function') {
      viewer.scene.render();
    }
  }

  clear3DMarkers();
  isColorCodingActive = false;
}

function toggleColorCodingMode(buttonEl) {
  const btn = buttonEl || document.getElementById('dt-btn-toggle-color');
  if (!isColorCodingActive) {
    applyAssetColorCoding();
    if (btn) {
      btn.innerText = '🔄 Khôi Phục Màu Mặc Định';
      btn.style.backgroundColor = '#28a745';
      btn.style.color = '#fff';
      btn.style.borderColor = '#28a745';
    }
  } else {
    resetModelColors();
    if (btn) {
      btn.innerText = '🎨 Xem Trạng Thái 3D';
      btn.style.backgroundColor = '#f0f4f9';
      btn.style.color = '#1a73e8';
      btn.style.borderColor = '#b6d4fe';
    }
  }
}

// =========================================================================
// --- THỂ HIỆN VÀ CẬP NHẬT TỌA ĐỘ MARKER PIN 3D ---
// =========================================================================

function getEntityAABB(viewer, entity) {
  if (entity.aabb && !isNaN(entity.aabb[0])) return entity.aabb;
  if (typeof viewer.scene.getAABB === 'function') {
    const box = viewer.scene.getAABB([entity.id]);
    if (box && !isNaN(box[0])) return box;
  }
  return null;
}

function render3DMarkers(assets) {
  clear3DMarkers();

  const viewer = window.xeokitViewer || window.viewer;
  if (!viewer || !viewer.scene) return;

  // Tạo Container Marker trực tiếp trong Body để không chặn chuột Canvas
  let container = document.getElementById('dt-marker-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'dt-marker-container';
    document.body.appendChild(container);
  }

  const allObjects = Object.values(viewer.scene.objects);
  const trackedItems = [];

  assets.forEach(asset => {
    const targetGId = String(asset.global_id || '').trim();

    const entity = allObjects.find(obj => {
      const objId = String(obj.id || '');
      return targetGId && objId.includes(targetGId);
    });

    if (entity) {
      const aabb = getEntityAABB(viewer, entity);
      if (aabb) {
        const topCenterWorldPos = [
          (aabb[0] + aabb[3]) / 2, // Mid X
          aabb[4],                 // Top Y
          (aabb[2] + aabb[5]) / 2  // Mid Z
        ];

        let markerIcon = '🟢';
        let markerClass = 'operational';

        if (asset.status === 'FAULT') {
          markerIcon = '🛑';
          markerClass = 'fault';
        } else if (asset.status === 'MAINTENANCE') {
          markerIcon = '⚠️';
          markerClass = 'maintenance';
        }

        const markerDiv = document.createElement('div');
        markerDiv.className = `dt-3d-marker ${markerClass}`;
        markerDiv.style.display = 'none';
        markerDiv.innerHTML = `<span>${markerIcon}</span><span>${asset.asset_code || asset.asset_name}</span>`;

        markerDiv.onclick = (e) => {
          e.stopPropagation();
          openDigitalTwinPanel(asset.express_id, asset.global_id, asset.asset_name);
        };

        container.appendChild(markerDiv);
        activeMarkerElements.push(markerDiv);

        trackedItems.push({
          element: markerDiv,
          worldPos: topCenterWorldPos
        });
      }
    }
  });

  // Cập nhật vị trí Marker theo chuyển động Camera
  function updateMarkerPositions() {
    if (!isColorCodingActive || trackedItems.length === 0) return;

    const camera = viewer.scene.camera;
    const canvas = viewer.scene.canvas.canvas;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();

    trackedItems.forEach(item => {
      const canvasPos = camera.projectWorldPosToCanvas(item.worldPos);

      if (canvasPos && !isNaN(canvasPos[0]) && !isNaN(canvasPos[1])) {
        // Tọa độ thực tế theo Màn hình
        const screenX = rect.left + canvasPos[0];
        const screenY = rect.top + canvasPos[1];
        const isVisible = canvasPos[2] < 1.0;

        if (isVisible && screenX >= rect.left && screenX <= rect.right && screenY >= rect.top && screenY <= rect.bottom) {
          item.element.style.display = 'flex';
          item.element.style.left = `${screenX}px`;
          item.element.style.top = `${screenY}px`;
        } else {
          item.element.style.display = 'none';
        }
      } else {
        item.element.style.display = 'none';
      }
    });
  }

  markerTickListener = viewer.scene.on("tick", updateMarkerPositions);
  updateMarkerPositions();
}

function clear3DMarkers() {
  const viewer = window.xeokitViewer || window.viewer;
  if (viewer && viewer.scene && markerTickListener) {
    viewer.scene.off(markerTickListener);
    markerTickListener = null;
  }

  const container = document.getElementById('dt-marker-container');
  if (container) {
    container.innerHTML = '';
  }
  activeMarkerElements = [];
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
          <h2 style="margin:0; font-size:16px; display:flex; align-items:center; gap:8px;">📊 Báo Cáo & Thống Kê Vận Hành Tài Sản (Digital Twin)</h2>
          <button type="button" onclick="closeDigitalTwinDashboard()" style="background:none; border:none; color:#fff; font-size:20px; cursor:pointer; font-weight:bold;">✕</button>
        </div>

        <div style="padding:20px; overflow-y:auto; flex:1; background:#f8f9fa;">
          <div style="display:grid; grid-template-columns: repeat(4, 1fr); gap:15px; margin-bottom:20px;">
            <div style="background:#fff; padding:15px; border-radius:8px; border-left:4px solid #1a73e8; box-shadow:0 2px 4px rgba(0,0,0,0.05);">
              <div style="font-size:12px; color:#666; font-weight:bold;">TỔNG THIẾT BỊ</div>
              <div id="dt-dash-total" style="font-size:24px; font-weight:bold; color:#1a73e8; margin-top:5px;">0</div>
            </div>
            <div style="background:#fff; padding:15px; border-radius:8px; border-left:4px solid #28a745; box-shadow:0 2px 4px rgba(0,0,0,0.05);">
              <div style="font-size:12px; color:#666; font-weight:bold;">🟢 HOẠT ĐỘNG BÌNH THƯỜNG</div>
              <div id="dt-dash-op" style="font-size:24px; font-weight:bold; color:#28a745; margin-top:5px;">0</div>
            </div>
            <div style="background:#fff; padding:15px; border-radius:8px; border-left:4px solid #f39c12; box-shadow:0 2px 4px rgba(0,0,0,0.05);">
              <div style="font-size:12px; color:#666; font-weight:bold;">🟡 ĐANG BẢO TRÌ / KIỂM TRA</div>
              <div id="dt-dash-maint" style="font-size:24px; font-weight:bold; color:#f39c12; margin-top:5px;">0</div>
            </div>
            <div style="background:#fff; padding:15px; border-radius:8px; border-left:4px solid #dc3545; box-shadow:0 2px 4px rgba(0,0,0,0.05);">
              <div style="font-size:12px; color:#666; font-weight:bold;">🔴 SỰ CỐ / HỎNG HÓC</div>
              <div id="dt-dash-fault" style="font-size:24px; font-weight:bold; color:#dc3545; margin-top:5px;">0</div>
            </div>
          </div>

          <div style="background:#fff; padding:15px; border-radius:8px; box-shadow:0 2px 4px rgba(0,0,0,0.05);">
            <h3 style="margin-top:0; font-size:14px; color:#333; border-bottom:1px solid #eee; padding-bottom:10px;">⚠️ Danh Sách Thiết Bị Cần Bảo Trì & Sự Cố</h3>
            <table style="width:100%; border-collapse:collapse; font-size:12px; text-align:left;">
              <thead>
                <tr style="background:#f1f3f4; color:#5f6368;">
                  <th style="padding:8px; border-bottom:1px solid #ddd;">Mã Tài Sản</th>
                  <th style="padding:8px; border-bottom:1px solid #ddd;">Tên Thiết Bị</th>
                  <th style="padding:8px; border-bottom:1px solid #ddd;">Trạng Thái</th>
                  <th style="padding:8px; border-bottom:1px solid #ddd;">Bảo Trì Gần Nhất</th>
                  <th style="padding:8px; border-bottom:1px solid #ddd;">Lịch Bảo Trì Kế</th>
                  <th style="padding:8px; border-bottom:1px solid #ddd; text-align:center;">Thao Tác</th>
                </tr>
              </thead>
              <tbody id="dt-dash-table-body">
                <tr><td colspan="6" style="text-align:center; padding:15px; color:#777;">Đang tải dữ liệu...</td></tr>
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
  modal.style.display = 'flex';

  const client = getDigitalTwinSupabaseClient();
  if (!client) return;

  try {
    const { data: assets, error } = await client.from('project_assets').select('*');
    if (error) throw error;

    let total = assets ? assets.length : 0;
    let op = 0, maint = 0, fault = 0;
    let alertRowsHtml = '';

    if (assets) {
      assets.forEach(asset => {
        if (asset.status === 'OPERATIONAL') op++;
        else if (asset.status === 'MAINTENANCE') maint++;
        else if (asset.status === 'FAULT') fault++;

        if (asset.status !== 'OPERATIONAL') {
          const statusBadge = asset.status === 'FAULT' 
            ? '<span style="color:#dc3545; font-weight:bold;">🔴 Sự cố</span>' 
            : '<span style="color:#f39c12; font-weight:bold;">🟡 Bảo trì</span>';

          alertRowsHtml += `
            <tr style="border-bottom:1px solid #eee;">
              <td style="padding:8px; font-weight:bold;">${asset.asset_code || '-'}</td>
              <td style="padding:8px;">${asset.asset_name || '-'}</td>
              <td style="padding:8px;">${statusBadge}</td>
              <td style="padding:8px;">${asset.last_maintenance_date || '-'}</td>
              <td style="padding:8px; color:#1a73e8; font-weight:bold;">${asset.next_maintenance_date || '-'}</td>
              <td style="padding:8px; text-align:center;">
                <button type="button" onclick="closeDigitalTwinDashboard(); openDigitalTwinPanel('${asset.express_id}', '${asset.global_id}', '${asset.asset_name}');" 
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

    const tbody = document.getElementById('dt-dash-table-body');
    if (alertRowsHtml) {
      tbody.innerHTML = alertRowsHtml;
    } else {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:15px; color:#28a745; font-weight:bold;">🎉 Tất cả thiết bị đều đang hoạt động bình thường!</td></tr>';
    }

  } catch (err) {
    console.error('Lỗi nạp Dashboard:', err);
  }
}

function closeDigitalTwinDashboard() {
  const modal = document.getElementById('dt-dashboard-modal');
  if (modal) modal.style.display = 'none';
}

// =========================================================================
// --- LƯU DỮ LIỆU TÀI SẢN VÀO SUPABASE ---
// =========================================================================

async function saveAssetToDatabase() {
  const globalId = document.getElementById('dt_global_id').value;
  const expressId = document.getElementById('dt_express_id').value;
  const assetCode = document.getElementById('dt_asset_code').value;
  const assetName = document.getElementById('dt_asset_name').value;
  const status = document.getElementById('dt_status').value;
  const installDate = document.getElementById('dt_install_date').value || null;
  const warrantyDate = document.getElementById('dt_warranty_date').value || null;
  const lastMaintDate = document.getElementById('dt_last_maint_date').value || null;
  const nextMaintDate = document.getElementById('dt_next_maint_date').value || null;
  const maintLog = document.getElementById('dt_maint_log').value || '';
  const fileInput = document.getElementById('dt_file_input');

  if (!assetCode || !assetName) {
    alert('Vui lòng nhập Mã Tài Sản và Tên Thiết Bị!');
    return;
  }

  const client = getDigitalTwinSupabaseClient();
  const projectId = window.currentProjectId || 'DEFAULT_PROJ';

  if (!client) {
    alert('Chưa kết nối CSDL Supabase!');
    return;
  }

  try {
    const { data: assetData, error: assetErr } = await client
      .from('project_assets')
      .upsert({
        project_id: projectId,
        global_id: globalId,
        express_id: parseInt(expressId) || 0,
        asset_code: assetCode,
        asset_name: assetName,
        status: status,
        installation_date: installDate,
        warranty_expiry: warrantyDate,
        last_maintenance_date: lastMaintDate,
        next_maintenance_date: nextMaintDate,
        maintenance_log: maintLog,
        updated_at: new Date()
      }, { onConflict: 'global_id' })
      .select()
      .single();

    if (assetErr) throw assetErr;

    if (fileInput.files.length > 0 && assetData) {
      const file = fileInput.files[0];
      const safeFileName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
      const filePath = `assets/${assetData.id}/${Date.now()}_${safeFileName}`;

      const { error: uploadErr } = await client.storage.from('asset-docs').upload(filePath, file, { cacheControl: '3600', upsert: true });
      if (!uploadErr) {
        const { data: publicUrlData } = client.storage.from('asset-docs').getPublicUrl(filePath);
        await client.from('asset_documents').insert({ asset_id: assetData.id, file_name: file.name, file_url: publicUrlData.publicUrl });
      }
    }

    if (isColorCodingActive) {
      applyAssetColorCoding();
    }

    alert('✅ Đã lưu hồ sơ thiết bị thành công!');
    closeAssetPanel();
  } catch (err) {
    console.error('Lỗi lưu tài sản:', err);
    alert('Có lỗi xảy ra: ' + err.message);
  }
}