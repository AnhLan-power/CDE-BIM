// =========================================================================
// --- MODULE QUẢN LÝ TÀI SẢN DIGITAL TWIN, SYSTEM TRACE & GIS (CESIUMJS) ---
// =========================================================================

const DT_SUPABASE_URL = window.SUPABASE_URL || 'https://znzakqzdezxzqzfplmgv.supabase.co'; 
const DT_SUPABASE_KEY = window.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpuemFrcXpkZXp4enF6ZnBsbWd2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc4MTQyNzAsImV4cCI6MjEwMzM5NDI3MH0.aV5YaOLxTySiB26ror4CRzJvQsjANNI1DwbtbxcNe4A';

// 🔑 TOKEN CESIUM ION DỰ ÁN
const CESIUM_ION_TOKEN = window.CESIUM_ION_TOKEN || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJub25jZSI6ImZLMTdQbWRPVkRpYTViUWYiLCJqdGkiOiJiY2FhNGU4Zi03YTA3LTQzMjYtOWNhZS04NzUxZDk4MDIzOTQiLCJpZCI6NTIxMzkwLCJpc3MiOiJodHRwczovL2FwaS5jZXNpdW0uY29tIiwiYXVkIjoidW5kZWZpbmVkX2RlZmF1bHQiLCJpYXQiOjE3OTE3OTA4NTF9.QisNEv7dqeOWD6duLTVxISgUHWWOp96tUWKEkd-CTys'; 

const STATUS_COLORS = {
  OPERATIONAL: [0.1, 0.8, 0.3], // 🟢 Xanh lá
  MAINTENANCE: [1.0, 0.75, 0.0], // 🟡 Vàng
  FAULT:       [0.9, 0.1, 0.1]  // 🔴 Đỏ
};

let isColorCodingActive = false; 
let activeMarkerElements = [];   
let markerTickListener = null;   

// --- SYSTEM TRACE MULTI-SELECTION VARIABLES ---
let activeTraceCanvas = null;
let traceAnimFrameId = null;
let currentTraceGraph = null; 
let isTraceActive = false;
let traceDashOffset = 0;

let selectedSourceEntity = null;        
let selectedBranchEntities = [];        
let currentPickMode = null;              

// --- CESIUM GIS VIEWER & MULTI-MODEL MANAGER ---
let cesiumViewerInstance = null;
let managedCesiumModels = []; // 📦 Mảng quản lý cấu hình chi tiết & hiệu chỉnh độc lập từng mô hình[cite: 19]

function cleanId(val) {
  if (val === null || val === undefined) return '';
  const s = String(val).trim();
  if (s === 'null' || s === 'undefined' || s === '0') return '';
  return s;
}

// Escape mọi dữ liệu từ DB / thuộc tính mô hình IFC trước khi đưa vào innerHTML
// (tên file, mô tả nhật ký, tên thiết bị... do người dùng/đối tác nhập -> nếu
// không escape thì có thể chèn mã chạy trong phiên của người khác).
function esc(v) {
  return String(v === null || v === undefined ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Chỉ cho phép liên kết http(s) — chặn javascript: / data: trong file_url.
function safeUrl(u) {
  const t = String(u || '').trim();
  return /^https?:\/\//i.test(t) ? t : '#';
}

// Dự án đang chọn trong panel CDE (cde-auth.js đặt window.activeProjectId).
// Bản cũ đọc window.currentProjectId (không tồn tại) nên mọi tài sản đều bị
// lưu vào project_id = 'DEFAULT_PROJ'.
function dtProjectId() {
  return window.activeProjectId || window.currentProjectId || null;
}

// Chỉ Author trở lên được ghi dữ liệu (RLS ở DB mới là chốt chặn thật sự).
function dtCanWrite() {
  try {
    return ['author', 'task_team_manager', 'bim_manager'].includes(activeRole);
  } catch (e) { return false; }
}

// Thông báo không chặn thao tác (thay cho alert mỗi lần click chọn nguồn/nhánh).
function dtNotify(msg) {
  if (typeof window.showToast === 'function') window.showToast(msg, 'success');
  else alert(msg);
}

function isValidAABB(aabb) {
  if (!aabb || (!Array.isArray(aabb) && !ArrayBuffer.isView(aabb)) || aabb.length !== 6) return false;
  if (!isFinite(aabb[0]) || !isFinite(aabb[1]) || !isFinite(aabb[2]) ||
      !isFinite(aabb[3]) || !isFinite(aabb[4]) || !isFinite(aabb[5])) return false;
  if (aabb[0] > aabb[3] || aabb[1] > aabb[4] || aabb[2] > aabb[5]) return false;
  return true;
}

function getAABBCenter(aabb) {
  return [
    (aabb[0] + aabb[3]) / 2,
    (aabb[1] + aabb[4]) / 2,
    (aabb[2] + aabb[5]) / 2
  ];
}

// Trả về toạ độ theo VIEWPORT (cửa sổ trình duyệt), không phải toạ độ trong
// canvas: các lớp phủ (marker, canvas System Trace) là position:fixed phủ cả
// cửa sổ, trong khi khung 3D có thể bị đẩy lệch khi ghim panel trái/phải/dưới
// (cde-docking.js). Phải cộng vị trí canvas (rect.left/top) thì marker và
// đường dòng mới khớp đúng cấu kiện.
function projectWorldToCanvas(viewer, worldPos) {
  if (!viewer || !viewer.scene) return null;
  const scene = viewer.scene;
  const canvasEl = scene.canvas && scene.canvas.canvas;
  if (!canvasEl) return null;
  const rect = canvasEl.getBoundingClientRect();

  if (typeof scene.canvas.worldToCanvas === 'function') {
    const out = [0, 0];
    scene.canvas.worldToCanvas(worldPos, out);
    return [out[0] + rect.left, out[1] + rect.top];
  }

  const camera = scene.camera;
  if (!camera || !camera.viewMatrix || !camera.projMatrix) return null;

  const viewMat = camera.viewMatrix;
  const projMat = camera.projMatrix;

  let vx = viewMat[0]*worldPos[0] + viewMat[4]*worldPos[1] + viewMat[8]*worldPos[2] + viewMat[12];
  let vy = viewMat[1]*worldPos[0] + viewMat[5]*worldPos[1] + viewMat[9]*worldPos[2] + viewMat[13];
  let vz = viewMat[2]*worldPos[0] + viewMat[6]*worldPos[1] + viewMat[10]*worldPos[2] + viewMat[14];

  let px = projMat[0]*vx + projMat[4]*vy + projMat[8]*vz + projMat[12];
  let py = projMat[1]*vx + projMat[5]*vy + projMat[9]*vz + projMat[13];
  let pw = projMat[3]*vx + projMat[7]*vy + projMat[11]*vz + projMat[15];

  if (pw <= 0) return null;

  let nx = px / pw;
  let ny = py / pw;

  let x = (nx + 1) * 0.5 * rect.width;
  let y = (1 - ny) * 0.5 * rect.height;

  return [rect.left + x, rect.top + y];
}

// Điểm (toạ độ viewport) có nằm trong khung 3D không — để ẩn marker khi nó
// rơi ra ngoài khung (vd bị panel ghim che) thay vì vẽ đè lên panel.
function dtInsideCanvas(viewer, p) {
  const el = viewer && viewer.scene && viewer.scene.canvas && viewer.scene.canvas.canvas;
  if (!el || !p) return false;
  const r = el.getBoundingClientRect();
  return p[0] >= r.left && p[0] <= r.right && p[1] >= r.top && p[1] <= r.bottom;
}

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

    #dt-trace-toolbar {
      position: fixed !important;
      top: 25px !important;
      left: 50% !important;
      transform: translateX(-50%) !important;
      background: rgba(18, 24, 38, 0.96) !important;
      backdrop-filter: blur(10px) !important;
      border: 1px solid rgba(0, 242, 255, 0.5) !important;
      border-radius: 8px !important;
      padding: 8px 18px !important;
      display: flex !important;
      align-items: center !important;
      gap: 10px !important;
      color: #fff !important;
      font-size: 12px !important;
      font-family: sans-serif !important;
      z-index: 999999 !important;
      pointer-events: auto !important;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6) !important;
    }
    #dt-trace-toolbar button {
      padding: 6px 12px !important;
      border-radius: 4px !important;
      border: none !important;
      font-weight: bold !important;
      font-size: 11px !important;
      cursor: pointer !important;
      transition: all 0.2s;
      display: flex !important;
      align-items: center !important;
      gap: 4px !important;
    }
    #dt-trace-toolbar button:hover {
      opacity: 0.9;
      transform: translateY(-1px);
    }
    #dt-sys-dropdown-container {
      position: relative !important;
      display: inline-block !important;
    }
    #dt-sys-dropdown-btn {
      background: #222c3d !important;
      color: #00f2ff !important;
      border: 1px solid #3b4c66 !important;
      padding: 6px 12px !important;
      border-radius: 4px !important;
      font-size: 12px !important;
      font-weight: bold !important;
      cursor: pointer !important;
      display: flex !important;
      align-items: center !important;
      gap: 6px !important;
    }
    #dt-sys-dropdown-menu {
      display: none;
      position: absolute;
      top: 100% !important;
      left: 0 !important;
      background: #1a2332 !important;
      border: 1px solid #00f2ff !important;
      border-radius: 6px !important;
      padding: 10px !important;
      min-width: 200px !important;
      max-height: 250px !important;
      overflow-y: auto !important;
      z-index: 1000000 !important;
      box-shadow: 0 6px 20px rgba(0,0,0,0.5) !important;
    }
    #dt-sys-dropdown-menu label {
      display: flex !important;
      align-items: center !important;
      gap: 8px !important;
      padding: 5px 0 !important;
      color: #fff !important;
      font-size: 11px !important;
      cursor: pointer !important;
    }
    #dt-sys-dropdown-menu label:hover {
      color: #00f2ff !important;
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

function findEntityByAsset(viewer, asset) {
  if (!viewer || !viewer.scene || !viewer.scene.objects) return null;
  const objects = viewer.scene.objects;
  
  let targetGId = cleanId(asset.global_id || asset.globalID || asset.globalId);
  let targetEId = cleanId(asset.express_id || asset.expressID || asset.expressId);

  if (!targetEId && asset.asset_name) {
    const text = (asset.asset_name || '') + ' ' + (asset.asset_code || '');
    const match = text.match(/[:#\s-](\d{4,})/);
    if (match) targetEId = match[1];
  }

  if (targetGId && objects[targetGId]) return objects[targetGId];
  if (targetEId && objects[targetEId]) return objects[targetEId];
  if (targetEId && objects['#' + targetEId]) return objects['#' + targetEId];
  if (targetEId && objects['0#' + targetEId]) return objects['0#' + targetEId];

  for (const id in objects) {
    const obj = objects[id];
    if (!obj) continue;
    
    const objId = String(obj.id || id || '');
    const objGId = String(obj.globalId || obj.originalSystemId || '');

    if (targetGId) {
      if (
        objId === targetGId ||
        objGId === targetGId ||
        objId.endsWith('#' + targetGId) ||
        objId.endsWith(':' + targetGId) ||
        objId.includes(targetGId) ||
        objGId.includes(targetGId)
      ) {
        return obj;
      }
    }

    if (targetEId) {
      const parts = objId.split(/[:#]/);
      if (
        parts.includes(targetEId) ||
        objId === targetEId ||
        objId.endsWith('#' + targetEId) ||
        objId.endsWith(':' + targetEId)
      ) {
        return obj;
      }
    }
  }

  const targetName = (asset.asset_name || asset.assetName || '').trim().toLowerCase();
  if (targetName) {
    for (const id in objects) {
      const obj = objects[id];
      if (!obj) continue;
      const name = String(obj.name || '').toLowerCase();
      if (name && (name === targetName || name.includes(targetName))) {
        return obj;
      }
    }
  }

  return null;
}

function focusCameraOnEntity(globalId, expressId, assetName = '') {
  const viewer = window.xeokitViewer || window.viewer;
  if (!viewer || !viewer.scene) return;

  const pseudoAsset = { global_id: globalId, express_id: expressId, asset_name: assetName };
  const entity = findEntityByAsset(viewer, pseudoAsset);
  if (!entity) return;

  entity.visible = true; 
  if (typeof entity.culled !== 'undefined') entity.culled = false;

  window.selectedEntity = entity;
  entity.highlighted = true; 
  setTimeout(() => { if (entity) entity.highlighted = false; }, 3500);

  const aabb = entity.aabb;
  if (!isValidAABB(aabb)) return;
  const center = getAABBCenter(aabb);

  if (viewer.cameraControl) viewer.cameraControl.pivotPos = center;

  if (viewer.cameraFlight && typeof viewer.cameraFlight.flyTo === 'function') {
    try {
      viewer.cameraFlight.flyTo({ aabb: aabb, fitFOV: 20, duration: 0.8 });
      return;
    } catch (e) {}
  }
}

window.focusAndOpenAssetFromDashboard = function(expressId, globalId, assetName) {
  closeDigitalTwinDashboard();
  setTimeout(() => { openDigitalTwinPanel(expressId, globalId, assetName); }, 120);
};

// =========================================================================
// --- TÍCH HỢP BẢN ĐỒ GIS 3D & CÔNG CỤ HIỆU CHỈNH ĐỘC LẬP TỪNG MÔ HÌNH ---
// =========================================================================

function loadCesiumScripts(callback) {
  if (window.Cesium) {
    callback();
    return;
  }

  if (!document.getElementById('cesium-stylesheet')) {
    const css = document.createElement('link');
    css.id = 'cesium-stylesheet';
    css.rel = 'stylesheet';
    css.href = 'https://cesium.com/downloads/cesiumjs/releases/1.114/Build/Cesium/Widgets/widgets.css';
    document.head.appendChild(css);
  }

  if (!document.getElementById('cesium-script')) {
    const script = document.createElement('script');
    script.id = 'cesium-script';
    script.src = 'https://cesium.com/downloads/cesiumjs/releases/1.114/Build/Cesium/Cesium.js';
    script.onload = () => { callback(); };
    document.head.appendChild(script);
  } else {
    const checkCesium = setInterval(() => {
      if (window.Cesium) {
        clearInterval(checkCesium);
        callback();
      }
    }, 100);
  }
}

function loadProj4AndOpenCesium() {
  if (window.proj4) {
    createOrShowCesiumModal();
    return;
  }

  const script = document.createElement('script');
  script.src = 'https://cdnjs.cloudflare.com/ajax/libs/proj4js/2.9.0/proj4.js';
  script.onload = () => {
    createOrShowCesiumModal();
  };
  document.head.appendChild(script);
}

function createOrShowCesiumModal() {
  let modal = document.getElementById('dt-cesium-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'dt-cesium-modal';
    modal.style.cssText = 'position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.85); z-index:999999; display:flex; flex-direction:column; font-family:sans-serif;';
    modal.innerHTML = `
      <div style="background:#121826; color:#00f2ff; padding:12px 20px; display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #3b4c66;">
        <h3 style="margin:0; font-size:15px;">🌍 Bản Đồ GIS 3D - Cấu Hình & Hiệu Chỉnh Độc Lập Đa Mô Hình</h3>
        <button type="button" onclick="closeCesiumGisMap()" style="background:#dc3545; color:#fff; border:none; padding:6px 12px; border-radius:4px; font-weight:bold; cursor:pointer;">✕ Đóng Bản Đồ</button>
      </div>

      <div style="background:#1a2332; padding:10px 20px; display:flex; align-items:center; gap:10px; flex-wrap:wrap; border-bottom:1px solid #3b4c66; color:#fff; font-size:12px;">
        <div>
          <label style="font-weight:bold; color:#00f2ff;">📍 Tỉnh:</label>
          <select id="dt-province-select" style="padding:4px 6px; border-radius:4px; background:#222c3d; color:#fff; border:1px solid #3b4c66; cursor:pointer;">
            <option value="104.75">An Giang</option>
            <option value="107">Bắc Ninh</option>
            <option value="104.5">Cà Mau</option>
            <option value="105.75">Cao Bằng</option>
            <option value="108.5">Đắk Lắk</option>
            <option value="103">Điện Biên</option>
            <option value="107.75">Đồng Nai</option>
            <option value="105">Đồng Tháp</option>
            <option value="108.25" selected>Gia Lai – vùng Bình Định cũ (108°15')</option>
            <option value="108.5">Gia Lai – vùng Gia Lai cũ (108°30')</option>
            <option value="105.5">Hà Tĩnh</option>
            <option value="105.5">Hưng Yên</option>
            <option value="108.25">Khánh Hòa</option>
            <option value="104.75">Lai Châu</option>
            <option value="107.25">Lạng Sơn</option>
            <option value="104.75">Lào Cai</option>
            <option value="107.75">Lâm Đồng</option>
            <option value="104.75">Nghệ An</option>
            <option value="105">Ninh Bình</option>
            <option value="104.75">Phú Thọ</option>
            <option value="108">Quảng Ngãi</option>
            <option value="107.75">Quảng Ninh</option>
            <option value="106">Quảng Trị</option>
            <option value="104">Sơn La</option>
            <option value="105.75">Tây Ninh</option>
            <option value="106.5">Thái Nguyên</option>
            <option value="105">Thanh Hóa</option>
            <option value="105">Cần Thơ</option>
            <option value="107.75">Đà Nẵng</option>
            <option value="105">Hà Nội</option>
            <option value="105.75">Hải Phòng</option>
            <option value="105.75">Hồ Chí Minh</option>
            <option value="107">Huế</option>
            <option value="106">Tuyên Quang</option>
            <option value="105.5">Vĩnh Long</option>
          </select>
        </div>

        <div>
          <label style="font-weight:bold;">Gốc X (m):</label>
          <input type="number" id="dt-vn2000-x" value="604083.56" style="width:85px; padding:4px; border-radius:4px; border:1px solid #3b4c66; background:#222c3d; color:#fff; text-align:center;" />
        </div>

        <div>
          <label style="font-weight:bold;">Gốc Y (m):</label>
          <input type="number" id="dt-vn2000-y" value="1528409.13" style="width:85px; padding:4px; border-radius:4px; border:1px solid #3b4c66; background:#222c3d; color:#fff; text-align:center;" />
        </div>

        <div style="flex: 1; min-width: 220px;">
          <label style="font-weight:bold; color:#00f2ff;">📦 Asset IDs (Cách dấu phẩy):</label>
          <input type="text" id="dt-model-url" value="6018479, 6022034" placeholder="VD: 6018479, 6022034" style="width:100%; padding:4px; border-radius:4px; border:1px solid #3b4c66; background:#222c3d; color:#fff; box-sizing:border-box;" />
        </div>

        <button type="button" onclick="updateCesiumPositionFromVN2000()" style="background:#00f2ff; color:#121826; border:none; padding:6px 14px; border-radius:4px; font-weight:bold; cursor:pointer;">
          🚀 Tải Lại Hàng Loạt
        </button>

        <label style="display:flex; align-items:center; gap:5px; cursor:pointer; color:#9fe8ff;" title="Áp dụng 7 tham số chuyển datum VN-2000 → WGS84 theo EPSG. Tắt nếu cậu đã tự bù lệch bằng Độ lệch X/Y.">
          <input type="checkbox" id="dt-use-towgs84" ${dtUseTowgs84() ? 'checked' : ''} onchange="dtToggleTowgs84(this.checked)" />
          Chuyển datum VN-2000→WGS84 (chuẩn EPSG)
        </label>
      </div>

      <!-- 🛠 BẢNG ĐIỀU KHIỂN TINH CHỈNH CHÍNH XÁC X, Y, Z VÀ GÓC XOAY CHO TỪNG MODEL -->
      <div style="background:#111622; padding:8px 20px; display:flex; align-items:center; gap:12px; flex-wrap:wrap; border-bottom:1px solid #283348; color:#fff; font-size:11px;">
        <span style="color:#f39c12; font-weight:bold;">🎛️ Hiệu Chỉnh Độc Lập:</span>
        <div>
          <label>Model:</label>
          <select id="dt-inspect-select" onchange="loadSelectedModelConfigToUI()" style="padding:3px 6px; background:#1a2332; color:#fff; border:1px solid #3b4c66; border-radius:4px; cursor:pointer;"></select>
        </div>
        <div>
          <label>Độ lệch X (m):</label>
          <input type="number" id="dt-adj-dx" value="0" step="0.1" style="width:65px; padding:3px; background:#1a2332; color:#fff; border:1px solid #3b4c66; text-align:center;" />
        </div>
        <div>
          <label>Độ lệch Y (m):</label>
          <input type="number" id="dt-adj-dy" value="0" step="0.1" style="width:65px; padding:3px; background:#1a2332; color:#fff; border:1px solid #3b4c66; text-align:center;" />
        </div>
        <div>
          <label>Cao độ Z (m):</label>
          <input type="number" id="dt-adj-dz" value="0" step="0.5" style="width:60px; padding:3px; background:#1a2332; color:#fff; border:1px solid #3b4c66; text-align:center;" />
        </div>
        <div>
          <label>Góc xoay (°):</label>
          <input type="number" id="dt-adj-heading" value="0" step="1" style="width:55px; padding:3px; background:#1a2332; color:#fff; border:1px solid #3b4c66; text-align:center;" />
        </div>
        <button type="button" onclick="applyTransformToActiveModel()" style="background:#28a745; color:#fff; border:none; padding:5px 12px; border-radius:4px; font-weight:bold; cursor:pointer;">
          💾 Cập Nhật & Zoom
        </button>
      </div>

      <div id="cesiumContainer" style="flex:1; width:100%; height:100%;"></div>
    `;
    document.body.appendChild(modal);
  } else {
    modal.style.display = 'flex';
  }

  loadCesiumScripts(() => {
    if (window.Cesium && CESIUM_ION_TOKEN) {
      Cesium.Ion.defaultAccessToken = CESIUM_ION_TOKEN;
    }

    if (!cesiumViewerInstance) {
      // Cesium 1.114 (đang nạp ở trên): từ 1.107 đã GỠ tuỳ chọn Viewer
      // `imageryProvider` và constructor ArcGisMapServerImageryProvider({url})
      // (gọi kiểu cũ sẽ ném lỗi làm bản đồ trống). Dùng `baseLayer` +
      // `.fromUrl`; baseLayer chỉ hợp lệ khi baseLayerPicker = false.
      const viewerOptions = { geocoder: true, animation: false, timeline: false, baseLayerPicker: false };
      try {
        viewerOptions.baseLayer = Cesium.ImageryLayer.fromProviderAsync(
          Cesium.ArcGisMapServerImageryProvider.fromUrl(
            'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer'
          )
        );
      } catch (e) {
        console.warn('Không tạo được lớp ảnh vệ tinh ArcGIS, dùng ảnh nền mặc định:', e);
        viewerOptions.baseLayerPicker = true;
      }
      cesiumViewerInstance = new Cesium.Viewer('cesiumContainer', viewerOptions);
    }
    updateCesiumPositionFromVN2000();
  });
}

/**
 * 🟢 TÍNH TOÁN MA TRẬN CHUẨN XÁC DỰA TRÊN TỌA ĐỘ VN-2000 CỘNG ĐỘ LỆCH MÉT (X, Y, Z) VÀ QUAY (HEADING)
 */
// Tham số chuyển VN-2000 -> WGS84 theo đăng ký EPSG (Helmert 7 thông số, nguồn
// Cục Đo đạc & Bản đồ). Bỏ qua tham số này làm mô hình trên bản đồ vệ tinh lệch
// ~225 m tại khu vực Quy Nhơn (≈194 m Đông-Tây, 115 m Bắc-Nam).
const DT_VN2000_TOWGS84 = '+towgs84=-191.90441429,-39.30318279,-111.45032835,-0.00928836,0.01975479,-0.00427372,0.252906278';

function dtUseTowgs84() {
  const el = document.getElementById('dt-use-towgs84');
  if (el) return el.checked;
  try { return localStorage.getItem('dt_use_towgs84') !== '0'; } catch (e) { return true; }
}

function dtRegisterVn2000(lon0) {
  if (!window.proj4) return;
  proj4.defs("VN2000_CUSTOM", `+proj=tmerc +lat_0=0 +lon_0=${lon0} +k=0.9999 +x_0=500000 +y_0=0 +ellps=WGS84 ${dtUseTowgs84() ? DT_VN2000_TOWGS84 : ''} +units=m +no_defs`);
}

window.dtToggleTowgs84 = function (on) {
  try { localStorage.setItem('dt_use_towgs84', on ? '1' : '0'); } catch (e) { /* bỏ qua */ }
  updateCesiumPositionFromVN2000();
};

function updateModelMatrix(modelObj) {
  if (!cesiumViewerInstance || !modelObj || !modelObj.tileset) return;

  const tileset = modelObj.tileset;

  const xInput = document.getElementById('dt-vn2000-x');
  const yInput = document.getElementById('dt-vn2000-y');
  const selectEl = document.getElementById('dt-province-select');

  const baseX = parseFloat(xInput ? xInput.value : '604083.56');
  const baseY = parseFloat(yInput ? yInput.value : '1528409.13');
  const lon0 = parseFloat(selectEl ? selectEl.value : '108.25');

  dtRegisterVn2000(lon0);

  // Cộng trực tiếp độ lệch mét (dx, dy) vào tọa độ VN-2000 gốc để đảm bảo độ chính xác tuyệt đối
  const finalX = baseX + (modelObj.dx || 0);
  const finalY = baseY + (modelObj.dy || 0);

  let targetLng = 108.25;
  let targetLat = 14.0;

  if (window.proj4) {
    let latLon = proj4("VN2000_CUSTOM", "EPSG:4326", [finalX, finalY]);
    targetLng = latLon[0];
    targetLat = latLon[1];
  }

  // Cao độ Z (mét) so với mặt đất
  const surfacePosition = Cesium.Cartesian3.fromDegrees(targetLng, targetLat, modelObj.dz || 0);

  const hpr = new Cesium.HeadingPitchRoll(
    Cesium.Math.toRadians(modelObj.heading || 0),
    Cesium.Math.toRadians(0.0),
    Cesium.Math.toRadians(0.0)
  );
  
  const targetMatrix = Cesium.Transforms.headingPitchRollToFixedFrame(surfacePosition, hpr);

  if (tileset.boundingSphere) {
    const center = tileset.boundingSphere.center;
    const inverseModelMatrix = Cesium.Matrix4.inverse(
      Cesium.Transforms.eastNorthUpToFixedFrame(center),
      new Cesium.Matrix4()
    );
    const finalMatrix = new Cesium.Matrix4();
    Cesium.Matrix4.multiply(targetMatrix, inverseModelMatrix, finalMatrix);
    tileset.modelMatrix = finalMatrix;
  } else {
    tileset.modelMatrix = targetMatrix;
  }
}

/**
 * 🧹 XÓA TOÀN BỘ MÔ HÌNH VÀ ENTITY TRÊN BẢN ĐỒ
 */
function clearAllCesiumModels() {
  if (!cesiumViewerInstance) return;
  managedCesiumModels.forEach(m => {
    cesiumViewerInstance.scene.primitives.remove(m.tileset);
  });
  managedCesiumModels = [];
  cesiumViewerInstance.entities.removeAll();
}

/**
 * 🚀 NẠP HÀNG LOẠT VÀ KHỞI TẠO BẢNG ĐIỀU KHIỂN
 */
async function loadMultipleInfrastructureModels() {
  if (!cesiumViewerInstance) return;

  clearAllCesiumModels();

  const rawInput = document.getElementById('dt-model-url') ? document.getElementById('dt-model-url').value.trim() : '6018479';
  const assetIds = rawInput.split(',').map(s => s.trim()).filter(Boolean);

  const xInput = document.getElementById('dt-vn2000-x');
  const yInput = document.getElementById('dt-vn2000-y');
  const selectEl = document.getElementById('dt-province-select');

  const baseX = parseFloat(xInput ? xInput.value : '604083.56');
  const baseY = parseFloat(yInput ? yInput.value : '1528409.13');
  const lon0 = parseFloat(selectEl ? selectEl.value : '108.25');

  dtRegisterVn2000(lon0);

  let baseLng = 108.25;
  let baseLat = 14.0;

  if (window.proj4) {
    let latLon = proj4("VN2000_CUSTOM", "EPSG:4326", [baseX, baseY]);
    baseLng = latLon[0];
    baseLat = latLon[1];
  }

  for (let i = 0; i < assetIds.length; i++) {
    const assetId = assetIds[i];
    try {
      let tileset;
      if (!isNaN(assetId)) {
        tileset = await Cesium.Cesium3DTileset.fromIonAssetId(parseInt(assetId));
      } else {
        tileset = await Cesium.Cesium3DTileset.fromUrl(assetId);
      }

      cesiumViewerInstance.scene.primitives.add(tileset);
      if (tileset.readyPromise) {
        await tileset.readyPromise;
      }

      const modelConfig = {
        id: assetId,
        tileset: tileset,
        dx: 0,
        dy: 0,
        dz: 0,
        heading: 0
      };

      managedCesiumModels.push(modelConfig);
      updateModelMatrix(modelConfig);

      cesiumViewerInstance.entities.add({
        name: `Model ID: ${assetId}`,
        position: Cesium.Cartesian3.fromDegrees(baseLng, baseLat, 0),
        point: { pixelSize: 14, color: Cesium.Color.CYAN, outlineColor: Cesium.Color.WHITE, outlineWidth: 2 },
        label: {
          text: `ID: ${assetId}`,
          font: '11pt sans-serif',
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          pixelOffset: new Cesium.Cartesian2(0, -25)
        }
      });
    } catch (err) {
      console.warn(`Lỗi tải model ID ${assetId}:`, err);
    }
  }

  updateInspectorDropdown();

  if (managedCesiumModels.length > 0 && cesiumViewerInstance.zoomTo) {
    cesiumViewerInstance.zoomTo(managedCesiumModels[0].tileset, new Cesium.HeadingPitchRange(
      Cesium.Math.toRadians(0.0),
      Cesium.Math.toRadians(-45.0),
      300.0
    ));
  }
}

function updateInspectorDropdown() {
  const select = document.getElementById('dt-inspect-select');
  if (!select) return;
  select.innerHTML = '';
  managedCesiumModels.forEach((m) => {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.innerText = `Model [${m.id}]`;
    select.appendChild(opt);
  });
  if (managedCesiumModels.length > 0) {
    loadSelectedModelConfigToUI();
  }
}

function loadSelectedModelConfigToUI() {
  const select = document.getElementById('dt-inspect-select');
  if (!select) return;
  const targetId = select.value;
  const found = managedCesiumModels.find(m => m.id === targetId);
  if (!found) return;

  document.getElementById('dt-adj-dx').value = found.dx;
  document.getElementById('dt-adj-dy').value = found.dy;
  document.getElementById('dt-adj-dz').value = found.dz;
  document.getElementById('dt-adj-heading').value = found.heading;
}

function applyTransformToActiveModel() {
  const select = document.getElementById('dt-inspect-select');
  if (!select) return;
  const targetId = select.value;
  const found = managedCesiumModels.find(m => m.id === targetId);
  if (!found) return;

  found.dx = parseFloat(document.getElementById('dt-adj-dx').value) || 0;
  found.dy = parseFloat(document.getElementById('dt-adj-dy').value) || 0;
  found.dz = parseFloat(document.getElementById('dt-adj-dz').value) || 0;
  found.heading = parseFloat(document.getElementById('dt-adj-heading').value) || 0;

  updateModelMatrix(found);

  if (cesiumViewerInstance && found.tileset) {
    cesiumViewerInstance.zoomTo(found.tileset, new Cesium.HeadingPitchRange(
      Cesium.Math.toRadians(0.0),
      Cesium.Math.toRadians(-45.0),
      250.0
    ));
  }

  alert(`✅ Đã cập nhật & zoom tới Model [${found.id}] thành công!`);
}

function updateCesiumPositionFromVN2000() {
  loadMultipleInfrastructureModels();
}

function openCesiumGisMap() {
  loadProj4AndOpenCesium();
}

function closeCesiumGisMap() {
  const modal = document.getElementById('dt-cesium-modal');
  if (modal) modal.style.display = 'none';
}

// =========================================================================
// --- SYSTEM TRACE & UI PANELS ---
// =========================================================================

function discoverAllPipeSystems() {
  const viewer = window.xeokitViewer || window.viewer;
  if (!viewer) return ['Tất cả hệ thống (All)'];

  const systems = new Set();
  systems.add('Tất cả hệ thống (All)');

  if (viewer.metaScene && viewer.metaScene.metaObjects) {
    Object.values(viewer.metaScene.metaObjects).forEach(metaObj => {
      if (metaObj.propertySets) {
        const psets = Array.isArray(metaObj.propertySets) ? metaObj.propertySets : Object.values(metaObj.propertySets);
        psets.forEach(pset => {
          if (pset && pset.properties) {
            const props = Array.isArray(pset.properties) ? pset.properties : Object.values(pset.properties);
            props.forEach(p => {
              if (p && (p.name === 'Reference' || p.name === 'SystemName' || p.name === 'System Type') && p.value) {
                const val = String(p.value).trim();
                if (val) systems.add(val);
              }
            });
          }
        });
      }
    });
  }

  if (viewer.scene && viewer.scene.objects) {
    Object.values(viewer.scene.objects).forEach(entity => {
      const name = String(entity.name || '');
      const pipeMatch = name.match(/(?:Pipe|Duct)\s*Types?[:\s]+([^#:\n]+)/i);
      if (pipeMatch && pipeMatch[1].trim()) {
        systems.add(pipeMatch[1].trim());
      } else if (name.includes('AP.') || name.includes('SUS304')) {
        systems.add('AP, SUS304');
      } else if (name.includes('HDPE')) {
        systems.add('AP, HDPE');
      } else if (name.includes('WP')) {
        systems.add('WP');
      }
    });
  }

  return Array.from(systems);
}

function getSelectedSystemKeys() {
  const checkboxes = document.querySelectorAll('.dt-sys-checkbox');
  const selected = [];
  checkboxes.forEach(cb => {
    if (cb.checked) selected.push(cb.value);
  });
  if (selected.length === 0 || selected.includes('Tất cả hệ thống (All)')) {
    return ['all'];
  }
  return selected;
}

function getEntitiesInSelectedSystems() {
  const viewer = window.xeokitViewer || window.viewer;
  if (!viewer || !viewer.scene) return [];

  const selectedKeys = getSelectedSystemKeys();
  const matchedEntities = [];

  Object.values(viewer.scene.objects).forEach(entity => {
    if (!isValidAABB(entity.aabb)) return;

    if (selectedKeys.includes('all')) {
      matchedEntities.push(entity);
      return;
    }

    const name = String(entity.name || '').toLowerCase();
    const id = String(entity.id || '').toLowerCase();

    let metaRef = '';
    if (viewer.metaScene && viewer.metaScene.metaObjects) {
      const metaObj = viewer.metaScene.metaObjects[entity.id] || viewer.metaScene.metaObjects[entity.originalSystemId];
      if (metaObj && metaObj.propertySets) {
        const psets = Array.isArray(metaObj.propertySets) ? metaObj.propertySets : Object.values(metaObj.propertySets);
        psets.forEach(pset => {
          if (pset && pset.properties) {
            const props = Array.isArray(pset.properties) ? pset.properties : Object.values(pset.properties);
            props.forEach(p => {
              if (p && p.name === 'Reference' && p.value) {
                metaRef += ' ' + String(p.value).toLowerCase();
              }
            });
          }
        });
      }
    }

    const matchFound = selectedKeys.some(sysKey => {
      const k = sysKey.toLowerCase();
      return name.includes(k) || id.includes(k) || metaRef.includes(k);
    });

    if (matchFound) {
      matchedEntities.push(entity);
    }
  });

  if (matchedEntities.length === 0) {
    Object.values(viewer.scene.objects).forEach(entity => {
      if (isValidAABB(entity.aabb)) matchedEntities.push(entity);
    });
  }

  if (selectedSourceEntity && !matchedEntities.includes(selectedSourceEntity)) {
    matchedEntities.push(selectedSourceEntity);
  }
  selectedBranchEntities.forEach(bEnt => {
    if (!matchedEntities.includes(bEnt)) matchedEntities.push(bEnt);
  });

  return matchedEntities;
}

function buildMultiBranchFlowGraph(sourceEntity, branchEntities, systemEntities) {
  if (!systemEntities || systemEntities.length === 0) return null;

  const nodes = systemEntities.map(entity => ({
    id: entity.id,
    entity: entity,
    center: getAABBCenter(entity.aabb)
  }));

  let sourceNode = null;
  if (sourceEntity && isValidAABB(sourceEntity.aabb)) {
    const sCenter = getAABBCenter(sourceEntity.aabb);
    let minDist = Infinity;
    nodes.forEach(node => {
      const d = Math.sqrt(Math.pow(node.center[0] - sCenter[0], 2) + Math.pow(node.center[1] - sCenter[1], 2) + Math.pow(node.center[2] - sCenter[2], 2));
      if (d < minDist) { minDist = d; sourceNode = node; }
    });
  }
  if (!sourceNode) sourceNode = nodes[0];

  const branchNodes = [];
  if (branchEntities && branchEntities.length > 0) {
    branchEntities.forEach(bEnt => {
      if (isValidAABB(bEnt.aabb)) {
        const bCenter = getAABBCenter(bEnt.aabb);
        let minDist = Infinity;
        let matched = null;
        nodes.forEach(node => {
          const d = Math.sqrt(Math.pow(node.center[0] - bCenter[0], 2) + Math.pow(node.center[1] - bCenter[1], 2) + Math.pow(node.center[2] - bCenter[2], 2));
          if (d < minDist) { minDist = d; matched = node; }
        });
        if (matched && !branchNodes.includes(matched) && matched !== sourceNode) {
          branchNodes.push(matched);
        }
      }
    });
  }

  const MAX_CONNECT_DIST = 15.0;
  const edges = [];
  const edgeSet = new Set();

  function findPathBetween(startNode, targetNode) {
    const distMap = new Map();
    const prevMap = new Map();
    const unvisited = new Set(nodes);

    nodes.forEach(n => distMap.set(n, Infinity));
    distMap.set(startNode, 0);

    while (unvisited.size > 0) {
      let current = null;
      let minD = Infinity;
      unvisited.forEach(n => {
        if (distMap.get(n) < minD) {
          minD = distMap.get(n);
          current = n;
        }
      });

      if (!current || current === targetNode || minD === Infinity) break;
      unvisited.delete(current);

      nodes.forEach(neighbor => {
        if (unvisited.has(neighbor)) {
          const d = Math.sqrt(
            Math.pow(current.center[0] - neighbor.center[0], 2) +
            Math.pow(current.center[1] - neighbor.center[1], 2) +
            Math.pow(current.center[2] - neighbor.center[2], 2)
          );
          if (d <= MAX_CONNECT_DIST) {
            const alt = distMap.get(current) + d;
            if (alt < distMap.get(neighbor)) {
              distMap.set(neighbor, alt);
              prevMap.set(neighbor, current);
            }
          }
        }
      });
    }

    const pathEdges = [];
    let curr = targetNode;
    while (prevMap.has(curr)) {
      const p = prevMap.get(curr);
      pathEdges.unshift({ from: p, to: curr });
      curr = p;
    }
    return pathEdges;
  }

  const connectedSet = new Set([sourceNode]);

  branchNodes.forEach(bNode => {
    let bestConnectFrom = sourceNode;
    let minDToTree = Infinity;

    connectedSet.forEach(cNode => {
      const d = Math.sqrt(
        Math.pow(cNode.center[0] - bNode.center[0], 2) +
        Math.pow(cNode.center[1] - bNode.center[1], 2) +
        Math.pow(cNode.center[2] - bNode.center[2], 2)
      );
      if (d < minDToTree) {
        minDToTree = d;
        bestConnectFrom = cNode;
      }
    });

    const subEdges = findPathBetween(bestConnectFrom, bNode);
    subEdges.forEach(e => {
      const key = `${e.from.id}->${e.to.id}`;
      if (!edgeSet.has(key)) {
        edgeSet.add(key);
        edges.push(e);
      }
      connectedSet.add(e.to);
    });
  });

  return { source: sourceNode, branches: branchNodes, edges };
}

function openSystemTraceToolbar() {
  injectSystemTraceToolbar();
  bind3DPickListener();
}

function executeSystemTraceSimulation() {
  const viewer = window.xeokitViewer || window.viewer;
  if (!viewer || !viewer.scene) return;

  const matchedEntities = getEntitiesInSelectedSystems();

  Object.values(viewer.scene.objects).forEach(obj => {
    obj.opacity = 0.08;
    obj.colorized = false;
  });

  matchedEntities.forEach(obj => {
    obj.opacity = 1.0;
    obj.colorize = [0.0, 0.9, 0.8]; 
    obj.colorized = true;
  });

  if (selectedSourceEntity) {
    selectedSourceEntity.opacity = 1.0;
    selectedSourceEntity.colorize = [0.1, 0.8, 0.3]; 
    selectedSourceEntity.colorized = true;
  }

  selectedBranchEntities.forEach(bEnt => {
    bEnt.opacity = 1.0;
    bEnt.colorize = [1.0, 0.75, 0.0]; 
    bEnt.colorized = true;
  });

  currentTraceGraph = buildMultiBranchFlowGraph(selectedSourceEntity, selectedBranchEntities, matchedEntities);

  let canvas = document.getElementById('dt-trace-canvas');
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.id = 'dt-trace-canvas';
    canvas.style.cssText = 'position:fixed !important; top:0 !important; left:0 !important; width:100vw !important; height:100vh !important; pointer-events:none !important; z-index:450 !important;';
    document.body.appendChild(canvas);
  }
  activeTraceCanvas = canvas;

  if (traceAnimFrameId) cancelAnimationFrame(traceAnimFrameId);
  isTraceActive = true;
  animateTraceLoop();
  
  viewer.scene._needUpdate = 1;
  if (typeof viewer.scene.render === 'function') viewer.scene.render();
}

function bind3DPickListener() {
  const viewer = window.xeokitViewer || window.viewer;
  if (!viewer || !viewer.scene || !viewer.scene.input) return;

  if (!viewer.scene.input._dtMultiBranchBound) {
    viewer.scene.input._dtMultiBranchBound = true;
    viewer.scene.input.on("mouseclicked", (coords) => {
      if (!currentPickMode) return;
      const hit = viewer.scene.pick({ canvasPos: coords });
      if (hit && hit.entity) {
        if (currentPickMode === 'source') {
          selectedSourceEntity = hit.entity;
          hit.entity.colorize = [0.1, 0.8, 0.3];
          hit.entity.colorized = true;
          dtNotify(`🟢 Đã nhận nguồn: ${hit.entity.name || hit.entity.id}`);
          currentPickMode = null;
        } else if (currentPickMode === 'branch') {
          if (!selectedBranchEntities.includes(hit.entity)) {
            selectedBranchEntities.push(hit.entity);
            hit.entity.colorize = [1.0, 0.75, 0.0];
            hit.entity.colorized = true;
          }
          dtNotify(`🎯 Đã thêm nhánh rẽ (${selectedBranchEntities.length}): ${hit.entity.name || hit.entity.id}`);
        }
        updateToolbarStatusText();
        if (viewer.scene) {
          viewer.scene._needUpdate = 1;
          if (typeof viewer.scene.render === 'function') viewer.scene.render();
        }
      }
    });
  }
}

function enablePickMode(mode) {
  currentPickMode = mode;
  if (mode === 'source') {
    dtNotify('👉 Chế độ chọn NGUỒN: click vào thiết bị nguồn trên 3D');
  } else if (mode === 'branch') {
    dtNotify('👉 Chế độ chọn NHÁNH RẼ: click vào các đoạn ống muốn mô phỏng');
  }
}

function resetTraceSelections() {
  selectedSourceEntity = null;
  selectedBranchEntities = [];
  currentPickMode = null;
  stopTandemSystemTrace();
  openSystemTraceToolbar();
}

function updateToolbarStatusText() {
  const btn = document.getElementById('dt-sys-dropdown-btn');
  if (btn) {
    const checkedBoxes = document.querySelectorAll('.dt-sys-checkbox:checked');
    let text = 'Chọn hệ thống...';
    if (checkedBoxes.length > 0) {
      const names = Array.from(checkedBoxes).map(cb => cb.value);
      text = names.join(', ');
      if (text.length > 25) text = names.length + ' hệ thống đã chọn';
    }
    const labelSpan = btn.querySelector('span');
    if (labelSpan) labelSpan.innerText = text;
  }
}

function animateTraceLoop() {
  if (!isTraceActive) return;
  renderTraceFlowLines();
  traceAnimFrameId = requestAnimationFrame(animateTraceLoop);
}

function renderTraceFlowLines() {
  if (!isTraceActive || !currentTraceGraph || !activeTraceCanvas) return;

  const viewer = window.xeokitViewer || window.viewer;
  if (!viewer || !viewer.scene) return;

  const canvas = activeTraceCanvas;
  const ctx = canvas.getContext('2d');
  
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Chỉ vẽ trong khung 3D (khi có panel ghim, khung 3D nhỏ hơn cửa sổ)
  const cr = viewer.scene.canvas.canvas.getBoundingClientRect();
  ctx.save();
  ctx.beginPath();
  ctx.rect(cr.left, cr.top, cr.width, cr.height);
  ctx.clip();

  traceDashOffset -= 0.8;

  ctx.lineWidth = 4;
  ctx.strokeStyle = '#00f2ff';
  ctx.setLineDash([10, 8]);
  ctx.lineDashOffset = traceDashOffset;
  ctx.shadowColor = '#00f2ff';
  ctx.shadowBlur = 10;

  if (currentTraceGraph.edges) {
    currentTraceGraph.edges.forEach(edge => {
      const p1 = projectWorldToCanvas(viewer, edge.from.center);
      const p2 = projectWorldToCanvas(viewer, edge.to.center);

      if (p1 && p2) {
        ctx.beginPath();
        ctx.moveTo(p1[0], p1[1]);
        ctx.lineTo(p2[0], p2[1]);
        ctx.stroke();
      }
    });
  }

  if (currentTraceGraph.source) {
    const sp = projectWorldToCanvas(viewer, currentTraceGraph.source.center);
    if (sp) {
      ctx.fillStyle = '#28a745';
      ctx.beginPath();
      ctx.arc(sp[0], sp[1], 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  if (currentTraceGraph.branches && currentTraceGraph.branches.length > 0) {
    currentTraceGraph.branches.forEach(bNode => {
      const bp = projectWorldToCanvas(viewer, bNode.center);
      if (bp) {
        ctx.fillStyle = '#f39c12';
        ctx.beginPath();
        ctx.arc(bp[0], bp[1], 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    });
  }
  ctx.restore();
}

function stopTandemSystemTrace() {
  isTraceActive = false;
  currentPickMode = null;

  if (traceAnimFrameId) {
    cancelAnimationFrame(traceAnimFrameId);
    traceAnimFrameId = null;
  }

  if (activeTraceCanvas && activeTraceCanvas.parentElement) {
    activeTraceCanvas.parentElement.removeChild(activeTraceCanvas);
    activeTraceCanvas = null;
  }

  const toolbar = document.getElementById('dt-trace-toolbar');
  if (toolbar) toolbar.parentElement.removeChild(toolbar);

  const viewer = window.xeokitViewer || window.viewer;
  if (viewer && viewer.scene) {
    Object.values(viewer.scene.objects).forEach(obj => {
      obj.opacity = 1.0;
      obj.colorize = null;
      obj.colorized = false;
    });
    viewer.scene._needUpdate = 1;
    if (typeof viewer.scene.render === 'function') viewer.scene.render();
  }
}

function injectSystemTraceToolbar() {
  injectMarkerStyles();
  let toolbar = document.getElementById('dt-trace-toolbar');
  if (!toolbar) {
    toolbar = document.createElement('div');
    toolbar.id = 'dt-trace-toolbar';
    document.body.appendChild(toolbar);
  }

  const detectedSystems = discoverAllPipeSystems();
  let checkboxesHtml = '';
  detectedSystems.forEach((sys, idx) => {
    const checked = (idx === 0) ? 'checked' : '';
    checkboxesHtml += `
      <label>
        <input type="checkbox" class="dt-sys-checkbox" value="${esc(sys)}" ${checked} onchange="updateToolbarStatusText()" />
        ${esc(sys)}
      </label>
    `;
  });

  toolbar.innerHTML = `
    <span>🌊 <b>System Trace:</b></span>
    <div id="dt-sys-dropdown-container">
      <button type="button" id="dt-sys-dropdown-btn" onclick="toggleSysDropdown()">
        <span>Chọn hệ thống...</span> ▾
      </button>
      <div id="dt-sys-dropdown-menu">
        ${checkboxesHtml}
      </div>
    </div>
    <button style="background:#28a745; color:#fff;" onclick="enablePickMode('source')">📍 Chọn Nguồn</button>
    <button style="background:#f39c12; color:#fff;" onclick="enablePickMode('branch')">🎯 Chọn Nhánh (+)</button>
    <button style="background:#0d6efd; color:#fff; font-size:12px;" onclick="executeSystemTraceSimulation()">▶ Chạy Mô Phỏng</button>
    <button style="background:#6c757d; color:#fff;" onclick="resetTraceSelections()">🔄 Xóa Chọn</button>
    <button style="background:#dc3545; color:#fff;" onclick="stopTandemSystemTrace()">✕ Đóng</button>
  `;

  setTimeout(updateToolbarStatusText, 50);
}

function toggleSysDropdown() {
  const menu = document.getElementById('dt-sys-dropdown-menu');
  if (menu) {
    menu.style.display = (menu.style.display === 'block') ? 'none' : 'block';
  }
}

window.addEventListener('click', function(e) {
  const container = document.getElementById('dt-sys-dropdown-container');
  const menu = document.getElementById('dt-sys-dropdown-menu');
  if (container && menu && !container.contains(e.target)) {
    menu.style.display = 'none';
  }
});

function startTandemSystemTrace() {
  openSystemTraceToolbar();
}

// =========================================================================
// --- UI PANELS & DATABASE INTEGRATION ---
// =========================================================================

function injectDigitalTwinPanel() {
  injectMarkerStyles();
  if (document.getElementById('dt-asset-panel')) return;

  const panelHtml = `
    <div id="dt-asset-panel" style="display:none; position:fixed; left:20px; top:80px; width:390px; max-height:88vh; overflow-y:auto; background:#fff; border-radius:10px; box-shadow: 0 4px 20px rgba(0,0,0,0.2); z-index:9999; padding:20px; font-family:sans-serif; user-select:none;">
      
      <div id="dt-panel-header" style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #eee; padding-bottom:10px; margin-bottom:15px; cursor:move; background:#f8f9fa; margin:-20px -20px 15px -20px; padding:15px 20px; border-radius:10px 10px 0 0;">
        <h3 style="margin:0; font-size:15px; color:#1a73e8; pointer-events:none;">🏷️ Quản Lý Tài Sản (Digital Twin)</h3>
        <button type="button" onclick="closeAssetPanel()" style="border:none; background:none; cursor:pointer; font-size:18px; font-weight:bold;">✕</button>
      </div>

      <div style="margin-bottom:15px; display:flex; gap:6px; flex-wrap:wrap;">
        <button type="button" id="dt-btn-toggle-color" onclick="toggleColorCodingMode(this)" 
                style="flex:1; padding:8px 6px; background:#f0f4f9; color:#1a73e8; border:1px solid #b6d4fe; border-radius:6px; font-weight:bold; cursor:pointer; font-size:11px; display:flex; align-items:center; justify-content:center;">
          🎨 Trạng Thái 3D
        </button>
        <button type="button" onclick="openDigitalTwinDashboard()" 
                style="flex:1; padding:8px 6px; background:#e8f0fe; color:#1a73e8; border:1px solid #b6d4fe; border-radius:6px; font-weight:bold; cursor:pointer; font-size:11px; display:flex; align-items:center; justify-content:center;">
          📊 Thống Kê
        </button>
        <button type="button" id="dt-btn-system-trace" onclick="openSystemTraceToolbar()" 
                style="flex:1.2; padding:8px 6px; background:#e8f0fe; color:#1a73e8; border:1px solid #b6d4fe; border-radius:6px; font-weight:bold; cursor:pointer; font-size:11px; display:flex; align-items:center; justify-content:center;">
          🌊 System Trace
        </button>
        <button type="button" onclick="openCesiumGisMap()" 
                style="flex:100%; padding:8px 6px; background:#10b981; color:#fff; border:none; border-radius:6px; font-weight:bold; cursor:pointer; font-size:11px; display:flex; align-items:center; justify-content:center; margin-top:4px;">
          🌍 Mở Bản Đồ GIS (Cesium 3D)
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

        <div style="margin-bottom:15px; border-top:1px dashed #ccc; padding-top:12px;">
          <label style="font-size:12px; font-weight:bold; color:#1a73e8; display:block; margin-bottom:8px;">📜 Nhật Ký & Lịch Sử Bảo Trì</label>

          <div style="background:#f8f9fa; padding:10px; border-radius:6px; border:1px solid #e0e0e0; margin-bottom:10px;">
            <div style="display:flex; gap:6px; margin-bottom:6px;">
              <select id="dt_new_log_type" style="flex:1; padding:4px; font-size:11px; border:1px solid #ccc; border-radius:4px;">
                <option value="Bảo trì">🔧 Bảo trì định kỳ</option>
                <option value="Sửa chữa">🚨 Sửa chữa sự cố</option>
                <option value="Kiểm tra">🔍 Kiểm tra / Giám sát</option>
                <option value="Thay thế">🔄 Thay thế linh kiện</option>
              </select>
              <input type="date" id="dt_new_log_date" style="flex:1; padding:4px; font-size:11px; border:1px solid #ccc; border-radius:4px;" />
            </div>
            <div style="margin-bottom:6px;">
              <input type="text" id="dt_new_log_performer" placeholder="Người thực hiện (Kỹ thuật viên...)" style="width:100%; padding:4px; font-size:11px; border:1px solid #ccc; border-radius:4px; box-sizing:border-box;" />
            </div>
            <div style="margin-bottom:6px;">
              <textarea id="dt_new_log_desc" rows="2" placeholder="Nội dung công việc sửa chữa/bảo trì..." style="width:100%; padding:4px; font-size:11px; border:1px solid #ccc; border-radius:4px; resize:vertical; box-sizing:border-box;"></textarea>
            </div>
            <button type="button" onclick="addMaintenanceLogRecord()" style="width:100%; padding:6px; background:#28a745; color:#fff; border:none; border-radius:4px; font-size:11px; font-weight:bold; cursor:pointer;">➕ Thêm Nhật Ký Mới</button>
          </div>

          <div style="font-size:11px; font-weight:bold; color:#555; margin-bottom:5px;">📋 Lịch sử các lần bảo trì:</div>
          <div id="dt_log_history_list" style="max-height:180px; overflow-y:auto; border:1px solid #e0e0e0; border-radius:6px; padding:6px; background:#fafafa;">
            <div style="font-size:11px; color:#888; font-style:italic; text-align:center;">Đang tải lịch sử...</div>
          </div>
        </div>

        <div style="margin-bottom:15px;" id="dt_docs_section">
          <label style="font-size:12px; font-weight:bold;">📎 Tài liệu thiết bị / HDSD <span style="font-weight:normal; color:#888;">(lưu trên Google Drive của dự án)</span></label>
          <div id="dt_drive_folder_cfg" style="margin:6px 0; font-size:11px;"></div>
          <div id="dt_upload_row" style="display:none; gap:6px; align-items:center;">
            <input type="file" id="dt_file_input" accept=".pdf,.docx,.xlsx,.png,.jpg,.jpeg" style="flex:1; min-width:0; font-size:12px;" />
            <button type="button" id="dt_upload_btn" data-dt-upload="1" style="padding:6px 10px; background:#1a73e8; color:#fff; border:none; border-radius:5px; font-size:12px; cursor:pointer; white-space:nowrap;">⬆️ Tải lên</button>
          </div>
          <div id="dt_upload_progress" style="font-size:11px; margin-top:4px; color:#1a73e8;"></div>
          <div id="dt_doc_list" style="margin-top:8px; font-size:12px;"></div>
        </div>

        <button type="button" onclick="saveAssetToDatabase()" style="width:100%; padding:10px; background:#1a73e8; color:#fff; border:none; border-radius:5px; font-weight:bold; cursor:pointer;">💾 Lưu Hồ Sơ Thiết Bị</button>
      </form>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', panelHtml);
  makePanelDraggable();
  dtBindDocsEvents();
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
  
  if (document.getElementById('dt_new_log_date')) {
    document.getElementById('dt_new_log_date').value = new Date().toISOString().split('T')[0];
  }

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
  focusCameraOnEntity(finalGlobalID, finalExpressID, assetName);

  dtLegacyDocs = [];
  document.getElementById('dt_upload_progress').textContent = '';
  dtLoadDriveFolderConfig().then(dtRefreshAssetDocs);

  const activeGlobalId = finalGlobalID || finalExpressID;
  if (activeGlobalId) loadMaintenanceHistory(activeGlobalId);

  const client = getDigitalTwinSupabaseClient();
  if (client && (finalGlobalID || finalExpressID)) {
    try {
      let query = client.from('project_assets').select('*, asset_documents(*)');
      const dtPid = dtProjectId();
      if (dtPid) query = query.eq('project_id', dtPid);
      if (finalGlobalID) query = query.eq('global_id', finalGlobalID);
      else if (finalExpressID && !isNaN(parseInt(finalExpressID))) query = query.eq('express_id', parseInt(finalExpressID));

      const { data: existingAsset } = await query.maybeSingle();
      if (existingAsset) {
        document.getElementById('dt_asset_code').value = existingAsset.asset_code || '';
        document.getElementById('dt_asset_name').value = existingAsset.asset_name || assetName;
        document.getElementById('dt_status').value = existingAsset.status || 'OPERATIONAL';
        document.getElementById('dt_install_date').value = existingAsset.installation_date || '';
        document.getElementById('dt_warranty_date').value = existingAsset.warranty_expiry || '';
        document.getElementById('dt_last_maint_date').value = existingAsset.last_maintenance_date || '';
        document.getElementById('dt_next_maint_date').value = existingAsset.next_maintenance_date || '';

        // Tài liệu kiểu cũ (chỉ có đường link) vẫn hiển thị cạnh tài liệu trên Drive
        dtLegacyDocs = existingAsset.asset_documents || [];
        dtRefreshAssetDocs();
      }
    } catch (e) {
      console.warn('Lỗi đọc thông tin tài sản từ CSDL:', e);
    }
  }
}

function closeAssetPanel() { 
  stopTandemSystemTrace(); 
  document.getElementById('dt-asset-panel').style.display = 'none'; 
}

async function loadMaintenanceHistory(globalId) {
  const container = document.getElementById('dt_log_history_list');
  if (!container) return;

  if (!globalId) {
    container.innerHTML = '<div style="font-size:11px; color:#888; font-style:italic; text-align:center;">Chưa chọn thiết bị.</div>';
    return;
  }

  container.innerHTML = '<div style="font-size:11px; color:#888; text-align:center; padding:8px;">⏳ Đang tải lịch sử...</div>';

  const client = getDigitalTwinSupabaseClient();
  if (!client) {
    container.innerHTML = '<div style="font-size:11px; color:red; text-align:center;">Chưa kết nối CSDL.</div>';
    return;
  }

  try {
    const { data: logs, error } = await client
      .from('asset_maintenance_logs')
      .select('*')
      .eq('global_id', globalId)
      .order('log_date', { ascending: false })
      .order('id', { ascending: false });

    if (error) throw error;

    if (!logs || logs.length === 0) {
      container.innerHTML = '<div style="font-size:11px; color:#888; font-style:italic; text-align:center; padding:8px;">Chưa có nhật ký bảo trì nào.</div>';
      return;
    }

    let html = '';
    logs.forEach(log => {
      let badgeBg = '#1a73e8';
      if (log.action_type === 'Sửa chữa') badgeBg = '#dc3545';
      if (log.action_type === 'Thay thế') badgeBg = '#e67e22';
      if (log.action_type === 'Kiểm tra') badgeBg = '#17a2b8';

      html += `
        <div style="border-left: 3px solid ${badgeBg}; padding: 6px 8px; margin-bottom: 6px; background: #ffffff; border-radius: 0 4px 4px 0; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
          <div style="display:flex; justify-content:space-between; align-items:center; font-size:10px; color:#666; margin-bottom:3px;">
            <span>📅 <b>${esc(log.log_date || '-')}</b></span>
            <span style="background:${badgeBg}; color:#fff; padding:1px 6px; border-radius:3px; font-weight:bold; font-size:9px;">${esc(log.action_type || 'Nhật ký')}</span>
          </div>
          <div style="font-size:11px; color:#333; word-break:break-word; white-space:pre-wrap;">${esc(log.description)}</div>
          ${log.performer ? `<div style="font-size:10px; color:#777; margin-top:3px;">👤 Người thực hiện: <i>${esc(log.performer)}</i></div>` : ''}
        </div>
      `;
    });

    container.innerHTML = html;
  } catch (err) {
    console.error('Lỗi tải lịch sử bảo trì:', err);
    container.innerHTML = '<div style="font-size:11px; color:red; text-align:center;">Lỗi tải dữ liệu nhật ký.</div>';
  }
}

async function addMaintenanceLogRecord() {
  const globalId = document.getElementById('dt_global_id').value;
  const actionType = document.getElementById('dt_new_log_type').value;
  const description = document.getElementById('dt_new_log_desc').value;
  const performer = document.getElementById('dt_new_log_performer').value;
  const logDate = document.getElementById('dt_new_log_date').value;

  if (!globalId) return alert('⚠️ Chưa chọn thiết bị!');
  if (!description.trim()) return alert('⚠️ Vui lòng nhập nội dung công việc!');
  if (!dtCanWrite()) return alert('⛔ Vai trò hiện tại không có quyền ghi nhật ký (cần Author trở lên).');

  const client = getDigitalTwinSupabaseClient();
  if (!client) return alert('⚠️ Chưa kết nối CSDL Supabase!');

  try {
    const payload = {
      global_id: globalId,
      action_type: actionType,
      description: description.trim(),
      performer: performer.trim(),
      log_date: logDate || new Date().toISOString().split('T')[0]
    };

    const { error } = await client.from('asset_maintenance_logs').insert([payload]);
    if (error) throw error;

    if (logDate && (actionType === 'Bảo trì' || actionType === 'Sửa chữa')) {
      document.getElementById('dt_last_maint_date').value = logDate;
    }

    document.getElementById('dt_new_log_desc').value = '';
    document.getElementById('dt_new_log_performer').value = '';
    loadMaintenanceHistory(globalId);

  } catch (err) {
    alert('❌ Lỗi thêm nhật ký: ' + err.message);
  }
}

async function applyAssetColorCoding() {
  const client = getDigitalTwinSupabaseClient();
  if (!client) return alert('Chưa kết nối CSDL Supabase!');

  try {
    const dtPid = dtProjectId();
    if (!dtPid) return dtNotify('Chọn dự án trong panel 📁 CDE trước khi tô màu trạng thái.');
    const { data: assets } = await client.from('project_assets').select('*').eq('project_id', dtPid);
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
    if (btn) { btn.innerText = '🎨 Trạng Thái 3D'; btn.style.backgroundColor = '#f0f4f9'; btn.style.color = '#1a73e8'; btn.style.borderColor = '#b6d4fe'; }
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
      const centerWorldPos = getAABBCenter(entity.aabb);

      let markerIcon = '🟢', markerClass = 'operational';
      if (asset.status === 'FAULT') { markerIcon = '🛑'; markerClass = 'fault'; } 
      else if (asset.status === 'MAINTENANCE') { markerIcon = '⚠️'; markerClass = 'maintenance'; }

      const markerDiv = document.createElement('div');
      markerDiv.className = `dt-3d-marker ${markerClass}`;
      markerDiv.style.display = 'none';
      markerDiv.innerHTML = `<span>${markerIcon}</span><span>${esc(asset.asset_code || asset.asset_name)}</span>`;

      markerDiv.onclick = (e) => {
        e.stopPropagation();
        openDigitalTwinPanel(cleanId(asset.express_id), cleanId(asset.global_id), asset.asset_name);
      };

      container.appendChild(markerDiv);
      activeMarkerElements.push(markerDiv);
      trackedItems.push({ element: markerDiv, worldPos: centerWorldPos });
    }
  });

  function updateMarkerPositions() {
    if (!isColorCodingActive || trackedItems.length === 0) return;
    const currentViewer = window.xeokitViewer || window.viewer;
    if (!currentViewer || !currentViewer.scene || !currentViewer.scene.camera) return;

    trackedItems.forEach(item => {
      const sp = projectWorldToCanvas(currentViewer, item.worldPos);
      if (sp && dtInsideCanvas(currentViewer, sp)) {
        item.element.style.display = 'flex';
        item.element.style.left = Math.round(sp[0]) + 'px';
        item.element.style.top = Math.round(sp[1]) + 'px';
      } else {
        item.element.style.display = 'none';
      }
    });
  }

  markerTickListener = viewer.scene.on("tick", updateMarkerPositions);
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

  const tbody = document.getElementById('dt-dash-table-body');
  if (tbody && !tbody.dataset.eventBound) {
    tbody.dataset.eventBound = 'true';
    tbody.addEventListener('click', function(e) {
      const btn = e.target.closest('.dt-btn-view-detail');
      if (btn) {
        window.focusAndOpenAssetFromDashboard(btn.getAttribute('data-express-id'), btn.getAttribute('data-global-id'), decodeURIComponent(btn.getAttribute('data-asset-name')));
      }
    });
  }
}

async function openDigitalTwinDashboard() {
  injectDigitalTwinDashboardModal();
  document.getElementById('dt-dashboard-modal').style.display = 'flex';

  const client = getDigitalTwinSupabaseClient();
  if (!client) return;

  try {
    const dtPid = dtProjectId();
    if (!dtPid) dtNotify('Chọn dự án trong panel 📁 CDE để xem thống kê đúng dự án.');
    const { data: assets } = dtPid
      ? await client.from('project_assets').select('*').eq('project_id', dtPid)
      : { data: [] };
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
          alertRowsHtml += `
            <tr style="border-bottom:1px solid #eee;">
              <td style="padding:8px; font-weight:bold;">${esc(asset.asset_code || '-')}</td>
              <td style="padding:8px;">${esc(asset.asset_name || '-')}</td>
              <td style="padding:8px;">${badge}</td>
              <td style="padding:8px; color:#1a73e8; font-weight:bold;">${esc(asset.next_maintenance_date || '-')}</td>
              <td style="padding:8px; text-align:center;">
                <button type="button" class="dt-btn-view-detail" data-express-id="${esc(cleanId(asset.express_id))}" data-global-id="${esc(cleanId(asset.global_id))}" data-asset-name="${encodeURIComponent(asset.asset_name || '')}" style="padding:4px 8px; background:#1a73e8; color:#fff; border:none; border-radius:4px; font-size:11px; cursor:pointer;">🔎 Xem Chi Tiết</button>
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
  } catch (err) {
    console.error('Lỗi khi mở Dashboard:', err);
  }
}

function closeDigitalTwinDashboard() {
  const modal = document.getElementById('dt-dashboard-modal');
  if (modal) modal.style.display = 'none';
}

async function saveAssetToDatabase() {
  const globalId = document.getElementById('dt_global_id').value;
  const expressId = document.getElementById('dt_express_id').value;
  const assetCode = document.getElementById('dt_asset_code').value;
  const assetName = document.getElementById('dt_asset_name').value;
  const status = document.getElementById('dt_status').value;

  if (!assetCode || !assetName) return alert('Vui lòng nhập Mã Tài Sản và Tên Thiết Bị!');

  const dtPid = dtProjectId();
  if (!dtPid) return alert('⚠️ Chưa chọn dự án. Vào panel 📁 CDE, chọn dự án rồi lưu lại.');
  if (!dtCanWrite()) return alert('⛔ Vai trò hiện tại không có quyền ghi hồ sơ thiết bị (cần Author trở lên).');
  // Thiếu GlobalId thì mọi thiết bị sẽ cùng ghi đè lên 1 dòng (global_id rỗng).
  if (!cleanId(globalId)) return alert('⚠️ Thiết bị chưa có GlobalId — hãy chọn lại cấu kiện trên mô hình 3D.');

  const client = getDigitalTwinSupabaseClient();
  if (!client) return alert('Chưa kết nối CSDL Supabase!');

  try {
    const { error } = await client.from('project_assets').upsert({
      project_id: dtPid,
      global_id: globalId,
      express_id: parseInt(expressId) || 0,
      asset_code: assetCode,
      asset_name: assetName,
      status: status,
      installation_date: document.getElementById('dt_install_date').value || null,
      warranty_expiry: document.getElementById('dt_warranty_date').value || null,
      last_maintenance_date: document.getElementById('dt_last_maint_date').value || null,
      next_maintenance_date: document.getElementById('dt_next_maint_date').value || null,
      updated_at: new Date()
    }, { onConflict: 'global_id' });

    if (error) throw error;
    if (isColorCodingActive) applyAssetColorCoding();
    alert('✅ Lưu hồ sơ thiết bị thành công!');
    closeAssetPanel();
  } catch (err) {
    alert('Lỗi: ' + err.message);
  }
}

// =========================================================================
// --- ĐĂNG KÝ HÀM TOÀN CỤC CHO GIAO DIỆN HTML (ONCLICK) ---
// =========================================================================
/* =====================================================================
   TÀI LIỆU THIẾT BỊ TRÊN GOOGLE DRIVE CỦA DỰ ÁN
   - File nằm trong thư mục Drive do BIM Manager chỉ định (projects.drive_assets_url)
   - Frontend KHÔNG giữ khoá Google: mọi thao tác đi qua Edge Function drive-proxy,
     function kiểm tra vai trò rồi dùng refresh token của BIM Manager.
   - Upload cắt khúc 4 MiB (giao thức resumable của Drive), đứt mạng thì hỏi lại
     vị trí Drive đã nhận rồi tiếp tục.
   - Metadata (tên, loại, dung lượng, drive_file_id) lưu ở bảng asset_files.
   ===================================================================== */
const DT_DRIVE_CHUNK = 4 * 1024 * 1024;   // phải là bội số của 256 KiB (yêu cầu của Drive)
const DT_MAX_FILE = 25 * 1024 * 1024;
const DT_ALLOWED_TYPES = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
};

let dtLegacyDocs = [];       // asset_documents kiểu cũ (chỉ có file_url)
let dtDocRows = [];          // bản ghi asset_files đang hiển thị
let dtDriveFolderReady = false;
let dtUploadBusy = false;

function dtApiBase() {
  const url = (typeof SUPABASE_URL !== 'undefined' && SUPABASE_URL) ? SUPABASE_URL : DT_SUPABASE_URL;
  const key = (typeof SUPABASE_ANON_KEY !== 'undefined' && SUPABASE_ANON_KEY) ? SUPABASE_ANON_KEY : DT_SUPABASE_KEY;
  return { fn: `${url}/functions/v1/drive-proxy`, key };
}

async function dtAuth() {
  const client = getDigitalTwinSupabaseClient();
  const { data } = client ? await client.auth.getSession() : { data: null };
  const session = data && data.session;
  if (!session || !session.access_token) throw new Error('Phiên đăng nhập đã hết hạn, hãy đăng nhập lại.');
  return { token: session.access_token, userId: session.user && session.user.id, client };
}

async function dtDriveCall(body) {
  const { token } = await dtAuth();
  const api = dtApiBase();
  const res = await fetch(api.fn, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, apikey: api.key },
    body: JSON.stringify(body)
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error) throw new Error(j.error || `Lỗi máy chủ (HTTP ${res.status})`);
  return j;
}

// Khúc dữ liệu & truy vấn trạng thái upload gửi nhị phân -> tham số đi theo query string
async function dtDriveBinary(action, extraQuery, blob) {
  const { token } = await dtAuth();
  const api = dtApiBase();
  const q = new URLSearchParams({ action, projectId: dtProjectId(), ...extraQuery });
  const res = await fetch(`${api.fn}?${q}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', Authorization: `Bearer ${token}`, apikey: api.key },
    body: blob
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error) throw new Error(j.error || `Lỗi máy chủ (HTTP ${res.status})`);
  return j;
}

function dtFmtSize(n) {
  n = Number(n) || 0;
  if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
  if (n >= 1024) return Math.round(n / 1024) + ' KB';
  return n + ' B';
}

function dtSleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Tải 1 file lên thư mục tài liệu thiết bị. Trả về {id, name, mimeType, size} của Drive.
async function dtUploadFileToDrive(file, namePrefix, onProgress) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const mimeType = DT_ALLOWED_TYPES[ext];
  if (!mimeType) throw new Error('Chỉ nhận file PDF, DOCX, XLSX, PNG, JPG.');
  if (file.size <= 0) throw new Error('File rỗng.');
  if (file.size > DT_MAX_FILE) throw new Error(`File quá lớn (${dtFmtSize(file.size)}), tối đa ${DT_MAX_FILE / 1048576} MB.`);

  const pid = dtProjectId();
  const init = await dtDriveCall({
    action: 'asset_upload_init', projectId: pid,
    fileName: `${namePrefix}__${file.name}`, mimeType, size: file.size
  });

  let offset = 0, failures = 0, stalls = 0, result = null;
  while (offset < file.size) {
    const end = Math.min(offset + DT_DRIVE_CHUNK, file.size);
    try {
      const j = await dtDriveBinary('asset_upload_chunk',
        { sessionUri: init.sessionUri, start: String(offset), total: String(file.size) },
        file.slice(offset, end));
      if (j.done) { result = j.file; break; }
      stalls = (j.received <= offset) ? stalls + 1 : 0;
      if (stalls >= 3) throw new Error('Drive không nhận thêm dữ liệu, hãy thử tải lên lại.');
      offset = j.received;
      failures = 0;
    } catch (e) {
      if (++failures > 3) throw e;
      await dtSleep(700 * failures);
      // Hỏi Drive đã nhận tới đâu rồi tiếp tục từ đó (tránh gửi lại từ đầu / gửi trùng)
      const st = await dtDriveBinary('asset_upload_status', { sessionUri: init.sessionUri, total: String(file.size) });
      if (st.done) { result = st.file; break; }
      offset = st.received;
    }
    if (onProgress) onProgress(Math.min(100, Math.round(offset / file.size * 100)));
  }
  if (!result || !result.id) throw new Error('Upload không hoàn tất.');
  return result;
}

function dtDriveFolderIdFromUrl(url) {
  const m = String(url || '').match(/folders\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

function dtIsManager() {
  try { return activeRole === 'bim_manager'; } catch (e) { return false; }
}

function dtApplyUploadVisibility() {
  const row = document.getElementById('dt_upload_row');
  if (row) row.style.display = (dtCanWrite() && dtDriveFolderReady) ? 'flex' : 'none';
}

// Hiển thị cấu hình thư mục Drive của dự án (BIM Manager nhập link, người khác chỉ xem)
async function dtLoadDriveFolderConfig(editMode) {
  const el = document.getElementById('dt_drive_folder_cfg');
  if (!el) return;
  dtDriveFolderReady = false;
  const pid = dtProjectId();
  const client = getDigitalTwinSupabaseClient();

  if (!pid || !client) {
    el.innerHTML = '<span style="color:#d93025;">Chọn dự án trong panel 📁 CDE để dùng tài liệu thiết bị.</span>';
    dtApplyUploadVisibility();
    return;
  }

  const { data, error } = await client.from('projects').select('drive_assets_url').eq('id', pid).maybeSingle();
  if (pid !== dtProjectId()) return;   // đã đổi dự án trong lúc chờ
  if (error) {
    el.innerHTML = `<span style="color:#d93025;">Không đọc được cấu hình thư mục: ${esc(error.message)} (đã chạy SQL thêm cột drive_assets_url chưa?)</span>`;
    dtApplyUploadVisibility();
    return;
  }

  const url = data && data.drive_assets_url;
  const folderId = dtDriveFolderIdFromUrl(url);
  dtDriveFolderReady = !!folderId;

  if (folderId && !editMode) {
    el.innerHTML = `📁 Thư mục Drive: <a href="${esc(safeUrl(url))}" target="_blank" rel="noopener noreferrer" style="color:#1a73e8;">mở thư mục</a>` +
      (dtIsManager() ? ` · <a href="#" data-dt-cfg="edit" style="color:#888;">đổi link</a>` : '');
  } else if (dtIsManager()) {
    el.innerHTML = `
      <div style="color:#555; margin-bottom:4px;">Dán link thư mục Google Drive dùng chứa tài liệu thiết bị (thư mục BIM Manager đã kết nối Drive có quyền ghi):</div>
      <div style="display:flex; gap:6px;">
        <input type="text" id="dt_drive_url_input" value="${esc(url || '')}" placeholder="https://drive.google.com/drive/folders/..." style="flex:1; min-width:0; font-size:11px; padding:5px;" />
        <button type="button" data-dt-cfg="save" style="padding:5px 10px; background:#1a73e8; color:#fff; border:none; border-radius:5px; font-size:11px; cursor:pointer;">Lưu</button>
      </div>`;
  } else {
    el.innerHTML = '<span style="color:#e37400;">BIM Manager chưa cấu hình thư mục Drive cho tài liệu thiết bị của dự án này.</span>';
  }
  dtApplyUploadVisibility();
}

async function dtSaveDriveFolderUrl() {
  const input = document.getElementById('dt_drive_url_input');
  const url = input ? input.value.trim() : '';
  if (!dtDriveFolderIdFromUrl(url)) return alert('Link phải có dạng https://drive.google.com/drive/folders/<mã thư mục>');
  const client = getDigitalTwinSupabaseClient();
  const pid = dtProjectId();
  if (!client || !pid) return alert('Chọn dự án trong panel 📁 CDE trước.');
  const { data, error } = await client.from('projects').update({ drive_assets_url: url }).eq('id', pid).select('id');
  if (error) return alert('Lỗi lưu link: ' + error.message);
  if (!data || data.length === 0) return alert('⛔ Không cập nhật được — chỉ BIM Manager của dự án được đổi link thư mục.');
  dtNotify('✅ Đã lưu thư mục Drive cho tài liệu thiết bị');
  await dtLoadDriveFolderConfig();
  dtRefreshAssetDocs();
}

// Danh sách tài liệu của thiết bị đang mở (asset_files + tài liệu kiểu cũ)
async function dtRefreshAssetDocs() {
  const listEl = document.getElementById('dt_doc_list');
  if (!listEl) return;
  dtApplyUploadVisibility();
  const gidEl = document.getElementById('dt_global_id');
  const gid = cleanId(gidEl && gidEl.value);
  const pid = dtProjectId();
  const client = getDigitalTwinSupabaseClient();

  let rows = [];
  if (pid && gid && client) {
    const { data, error } = await client.from('asset_files').select('*')
      .eq('project_id', pid).eq('global_id', gid).order('created_at', { ascending: false });
    if (cleanId(document.getElementById('dt_global_id').value) !== gid) return;   // đã chuyển sang thiết bị khác
    if (error) {
      listEl.innerHTML = `<div style="color:#d93025;">Không đọc được danh sách tài liệu: ${esc(error.message)} (đã chạy SQL bảng asset_files chưa?)</div>`;
      return;
    }
    rows = data || [];
  }
  dtDocRows = rows;

  const canWrite = dtCanWrite();
  const btn = (act, idx, label, title) =>
    `<button type="button" data-dt-doc="${act}" data-idx="${idx}" title="${title}" style="padding:2px 7px; border:1px solid #ccc; background:#f8f9fa; border-radius:4px; cursor:pointer; font-size:12px;">${label}</button>`;

  let html = rows.map((r, i) => `
    <div style="display:flex; align-items:center; gap:6px; padding:5px 0; border-bottom:1px solid #eee;">
      <span style="flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${esc(r.file_name)}">
        📄 ${esc(r.file_name)} <span style="color:#999;">(${esc(dtFmtSize(r.size_bytes))})</span>
      </span>
      ${btn('view', i, '👁', 'Xem')}${btn('download', i, '⬇️', 'Tải về')}${canWrite ? btn('delete', i, '🗑', 'Xoá') : ''}
    </div>`).join('');

  dtLegacyDocs.forEach(doc => {
    html += `<div style="padding:5px 0; border-bottom:1px solid #eee;">📄 <a href="${esc(safeUrl(doc.file_url))}" target="_blank" rel="noopener noreferrer" style="color:#1a73e8;">${esc(doc.file_name)}</a> <span style="color:#999;">(tài liệu cũ)</span></div>`;
  });

  listEl.innerHTML = html || '<div style="color:#888; font-style:italic;">Chưa có tài liệu nào.</div>';
}

async function dtUploadSelectedFile() {
  if (dtUploadBusy) return;
  const input = document.getElementById('dt_file_input');
  const progress = document.getElementById('dt_upload_progress');
  const btn = document.getElementById('dt_upload_btn');
  const file = input && input.files && input.files[0];
  const pid = dtProjectId();
  const gid = cleanId(document.getElementById('dt_global_id').value);

  if (!file) return alert('Chọn file cần tải lên trước.');
  if (!pid) return alert('⚠️ Chưa chọn dự án. Vào panel 📁 CDE, chọn dự án rồi thử lại.');
  if (!dtCanWrite()) return alert('⛔ Vai trò hiện tại không được tải tài liệu lên (cần Author trở lên).');
  if (!dtDriveFolderReady) return alert('BIM Manager chưa cấu hình thư mục Drive cho tài liệu thiết bị.');
  if (!gid) return alert('⚠️ Thiết bị chưa có GlobalId — hãy chọn lại cấu kiện trên mô hình 3D.');

  dtUploadBusy = true;
  if (btn) btn.disabled = true;
  // Xoá ngay thông báo của lần trước (nếu không, lỗi cũ vẫn hiện tới khi khúc đầu xong)
  progress.style.color = '#1a73e8';
  progress.textContent = '⏳ Đang chuẩn bị tải lên…';
  try {
    const assetCode = (document.getElementById('dt_asset_code').value || '').trim();
    const uploaded = await dtUploadFileToDrive(file, assetCode || gid.slice(0, 8),
      pct => { progress.style.color = '#1a73e8'; progress.textContent = `⏳ Đang tải lên Google Drive… ${pct}%`; });

    const { client, userId } = await dtAuth();
    const { error } = await client.from('asset_files').insert({
      project_id: pid, global_id: gid, asset_code: assetCode || null,
      file_name: file.name, mime_type: DT_ALLOWED_TYPES[(file.name.split('.').pop() || '').toLowerCase()],
      size_bytes: file.size, drive_file_id: uploaded.id, uploaded_by: userId
    });
    if (error) {
      // Dọn file mồ côi vừa tạo trên Drive (nếu được)
      await dtDriveCall({ action: 'asset_delete', projectId: pid, fileId: uploaded.id }).catch(() => {});
      throw new Error('Đã tải lên Drive nhưng không ghi được vào CSDL: ' + error.message + ' (đã chạy SQL bảng asset_files chưa?)');
    }
    progress.style.color = '#188038';
    progress.textContent = '✅ Đã tải lên Google Drive của dự án';
    input.value = '';
    await dtRefreshAssetDocs();
  } catch (e) {
    progress.style.color = '#d93025';
    progress.textContent = '❌ ' + e.message;
  } finally {
    dtUploadBusy = false;
    if (btn) btn.disabled = false;
  }
}

async function dtFetchAssetBlob(row) {
  const { token } = await dtAuth();
  const api = dtApiBase();
  const res = await fetch(api.fn, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, apikey: api.key },
    body: JSON.stringify({ action: 'asset_download', projectId: dtProjectId(), fileId: row.drive_file_id })
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error || `Lỗi tải file (HTTP ${res.status})`);
  }
  return res.blob();
}

async function dtViewAssetDoc(row, btn) {
  const old = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = '⏳'; }
  try {
    const blob = await dtFetchAssetBlob(row);
    if (typeof renderPreviewBlob === 'function') {
      await renderPreviewBlob(row.file_name, blob);   // dùng chung khung xem trước của app
      const ov = document.getElementById('cdePreviewOverlay');
      if (ov) ov.style.zIndex = '10050';              // panel Digital Twin có z-index 9999
    } else {
      window.open(URL.createObjectURL(blob), '_blank');   // cde-auth.js bản cũ: mở tab mới
    }
  } catch (e) { alert(e.message); }
  finally { if (btn) { btn.disabled = false; btn.textContent = old; } }
}

async function dtDownloadAssetDoc(row, btn) {
  const old = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = '⏳'; }
  try {
    const blob = await dtFetchAssetBlob(row);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = row.file_name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch (e) { alert(e.message); }
  finally { if (btn) { btn.disabled = false; btn.textContent = old; } }
}

async function dtDeleteAssetDoc(row) {
  if (!dtCanWrite()) return alert('⛔ Vai trò hiện tại không được xoá tài liệu (cần Author trở lên).');
  if (!confirm(`Xoá tài liệu "${row.file_name}"?\n(File được chuyển vào thùng rác Google Drive, khôi phục được.)`)) return;
  try {
    try {
      await dtDriveCall({ action: 'asset_delete', projectId: dtProjectId(), fileId: row.drive_file_id });
    } catch (e) {
      // File đã bị xoá thủ công trên Drive -> vẫn dọn bản ghi trong CSDL
      if (!/đã bị xoá|Không tìm thấy file/.test(e.message)) throw e;
    }
    const { client } = await dtAuth();
    const { data, error } = await client.from('asset_files').delete().eq('id', row.id).select('id');
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) throw new Error('Không xoá được bản ghi (không đủ quyền).');
    await dtRefreshAssetDocs();
  } catch (e) { alert('Lỗi xoá tài liệu: ' + e.message); }
}

// Một lần duy nhất khi dựng panel: uỷ quyền sự kiện cho các nút được vẽ lại liên tục
function dtBindDocsEvents() {
  const section = document.getElementById('dt_docs_section');
  if (!section || section.dataset.bound === '1') return;
  section.dataset.bound = '1';
  section.addEventListener('click', (e) => {
    const t = e.target.closest ? e.target.closest('[data-dt-doc],[data-dt-cfg],[data-dt-upload]') : null;
    if (!t) return;
    if (t.dataset.dtUpload) { e.preventDefault(); return dtUploadSelectedFile(); }
    if (t.dataset.dtCfg === 'save') { e.preventDefault(); return dtSaveDriveFolderUrl(); }
    if (t.dataset.dtCfg === 'edit') { e.preventDefault(); return dtLoadDriveFolderConfig(true); }
    const row = dtDocRows[Number(t.dataset.idx)];
    if (!row) return;
    if (t.dataset.dtDoc === 'view') return dtViewAssetDoc(row, t);
    if (t.dataset.dtDoc === 'download') return dtDownloadAssetDoc(row, t);
    if (t.dataset.dtDoc === 'delete') return dtDeleteAssetDoc(row);
  });
}

window.toggleDigitalTwinPanelFromMenu = toggleDigitalTwinPanelFromMenu;
window.openDigitalTwinPanel = openDigitalTwinPanel;
window.closeAssetPanel = closeAssetPanel;
window.openCesiumGisMap = openCesiumGisMap;
window.closeCesiumGisMap = closeCesiumGisMap;
window.updateCesiumPositionFromVN2000 = updateCesiumPositionFromVN2000;
window.loadMultipleInfrastructureModels = loadMultipleInfrastructureModels;
window.loadSelectedModelConfigToUI = loadSelectedModelConfigToUI;
window.applyTransformToActiveModel = applyTransformToActiveModel;