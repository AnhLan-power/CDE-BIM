// =========================================================================
// --- MODULE QUẢN LÝ TÀI SẢN DIGITAL TWIN, SYSTEM TRACE & GIS (CESIUMJS) ---
// =========================================================================

const DT_SUPABASE_URL = window.SUPABASE_URL || 'https://znzakqzdezxzqzfplmgv.supabase.co';[cite: 14]
const DT_SUPABASE_KEY = window.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInRefiI6InpuemFrcXpkZXp4enF6ZnBsbWd2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc4MTQyNzAsImV4cCI6ZB03Mzk0MjcwfQ.aV5YaOLxTySiB26ror4CRzJvQsjANNI1DwbtbxcNe4A';[cite: 14]

const STATUS_COLORS = {[cite: 14]
  OPERATIONAL: [0.1, 0.8, 0.3], // 🟢 Xanh lá[cite: 14]
  MAINTENANCE: [1.0, 0.75, 0.0], // 🟡 Vàng[cite: 14]
  FAULT:       [0.9, 0.1, 0.1]  // 🔴 Đỏ[cite: 14]
};[cite: 14]

let isColorCodingActive = false;[cite: 14]
let activeMarkerElements = [];  [cite: 14]
let markerTickListener = null;  [cite: 14]

// --- SYSTEM TRACE MULTI-SELECTION VARIABLES ---
let activeTraceCanvas = null;[cite: 14]
let traceAnimFrameId = null;[cite: 14]
let currentTraceGraph = null;[cite: 14]
let isTraceActive = false;[cite: 14]
let traceDashOffset = 0;[cite: 14]

let selectedSourceEntity = null;       [cite: 14]
let selectedBranchEntities = [];       [cite: 14]
let currentPickMode = null;             [cite: 14]

// --- CESIUM GIS VIEWER INSTANCE ---
let cesiumViewerInstance = null;[cite: 14]

function cleanId(val) {[cite: 14]
  if (val === null || val === undefined) return '';[cite: 14]
  const s = String(val).trim();[cite: 14]
  if (s === 'null' || s === 'undefined' || s === '0') return '';[cite: 14]
  return s;[cite: 14]
}

function isValidAABB(aabb) {[cite: 14]
  if (!aabb || (!Array.isArray(aabb) && !ArrayBuffer.isView(aabb)) || aabb.length !== 6) return false;[cite: 14]
  if (!isFinite(aabb[0]) || !isFinite(aabb[1]) || !isFinite(aabb[2]) ||[cite: 14]
      !isFinite(aabb[3]) || !isFinite(aabb[4]) || !isFinite(aabb[5])) return false;[cite: 14]
  if (aabb[0] > aabb[3] || aabb[1] > aabb[4] || aabb[2] > aabb[5]) return false;[cite: 14]
  return true;[cite: 14]
}

function getAABBCenter(aabb) {[cite: 14]
  return [[cite: 14]
    (aabb[0] + aabb[3]) / 2,[cite: 14]
    (aabb[1] + aabb[4]) / 2,[cite: 14]
    (aabb[2] + aabb[5]) / 2[cite: 14]
  ];[cite: 14]
}

function projectWorldToCanvas(viewer, worldPos) {[cite: 14]
  if (!viewer || !viewer.scene) return null;[cite: 14]
  const scene = viewer.scene;[cite: 14]

  if (scene.canvas && typeof scene.canvas.worldToCanvas === 'function') {[cite: 14]
    const out = [0, 0];[cite: 14]
    scene.canvas.worldToCanvas(worldPos, out);[cite: 14]
    return out;[cite: 14]
  }

  const camera = scene.camera;[cite: 14]
  if (!camera || !camera.viewMatrix || !camera.projMatrix) return null;[cite: 14]

  const canvasEl = scene.canvas.canvas;[cite: 14]
  if (!canvasEl) return null;[cite: 14]

  const viewMat = camera.viewMatrix;[cite: 14]
  const projMat = camera.projMatrix;[cite: 14]

  let vx = viewMat[0]*worldPos[0] + viewMat[4]*worldPos[1] + viewMat[8]*worldPos[2] + viewMat[12];[cite: 14]
  let vy = viewMat[1]*worldPos[0] + viewMat[5]*worldPos[1] + viewMat[9]*worldPos[2] + viewMat[13];[cite: 14]
  let vz = viewMat[2]*worldPos[0] + viewMat[6]*worldPos[1] + viewMat[10]*worldPos[2] + viewMat[14];[cite: 14]

  let px = projMat[0]*vx + projMat[4]*vy + projMat[8]*vz + projMat[12];[cite: 14]
  let py = projMat[1]*vx + projMat[5]*vy + projMat[9]*vz + projMat[13];[cite: 14]
  let pw = projMat[3]*vx + projMat[7]*vy + projMat[11]*vz + projMat[15];[cite: 14]

  if (pw <= 0) return null;[cite: 14]

  let nx = px / pw;[cite: 14]
  let ny = py / pw;[cite: 14]

  const rect = canvasEl.getBoundingClientRect();[cite: 14]
  let x = (nx + 1) * 0.5 * rect.width;[cite: 14]
  let y = (1 - ny) * 0.5 * rect.height;[cite: 14]

  return [x, y];[cite: 14]
}

function injectMarkerStyles() {[cite: 14]
  if (document.getElementById('dt-marker-styles')) return;[cite: 14]
  const style = document.createElement('style');[cite: 14]
  style.id = 'dt-marker-styles';[cite: 14]
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

    /* SYSTEM TRACE FLOATING TOOLBAR */
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
    /* MULTI-SYSTEM DROPDOWN POPUP */
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
  `;[cite: 14]
  document.head.appendChild(style);[cite: 14]
}

function getDigitalTwinSupabaseClient() {[cite: 14]
  if (window.sb && typeof window.sb.from === 'function') return window.sb;[cite: 14]
  if (window.supabaseClient && typeof window.supabaseClient.from === 'function') return window.supabaseClient;[cite: 14]
  if (window.supabase && typeof window.supabase.from === 'function') return window.supabase;[cite: 14]
  if (window.supabase && typeof window.supabase.createClient === 'function') {[cite: 14]
    if (!window._dtSupabaseInstance) {[cite: 14]
      window._dtSupabaseInstance = window.supabase.createClient(DT_SUPABASE_URL, DT_SUPABASE_KEY);[cite: 14]
    }
    return window._dtSupabaseInstance;[cite: 14]
  }
  return null;[cite: 14]
}

function findEntityByAsset(viewer, asset) {[cite: 14]
  if (!viewer || !viewer.scene || !viewer.scene.objects) return null;[cite: 14]
  const objects = viewer.scene.objects;[cite: 14]
  
  let targetGId = cleanId(asset.global_id || asset.globalID || asset.globalId);[cite: 14]
  let targetEId = cleanId(asset.express_id || asset.expressID || asset.expressId);[cite: 14]

  if (!targetEId && asset.asset_name) {[cite: 14]
    const text = (asset.asset_name || '') + ' ' + (asset.asset_code || '');[cite: 14]
    const match = text.match(/[:#\s-](\d{4,})/);[cite: 14]
    if (match) targetEId = match[1];[cite: 14]
  }

  if (targetGId && objects[targetGId]) return objects[targetGId];[cite: 14]
  if (targetEId && objects[targetEId]) return objects[targetEId];[cite: 14]
  if (targetEId && objects['#' + targetEId]) return objects['#' + targetEId];[cite: 14]
  if (targetEId && objects['0#' + targetEId]) return objects['0#' + targetEId];[cite: 14]

  for (const id in objects) {[cite: 14]
    const obj = objects[id];[cite: 14]
    if (!obj) continue;[cite: 14]
    
    const objId = String(obj.id || id || '');[cite: 14]
    const objGId = String(obj.globalId || obj.originalSystemId || '');[cite: 14]

    if (targetGId) {[cite: 14]
      if ([cite: 14]
        objId === targetGId ||[cite: 14]
        objGId === targetGId ||[cite: 14]
        objId.endsWith('#' + targetGId) ||[cite: 14]
        objId.endsWith(':' + targetGId) ||[cite: 14]
        objId.includes(targetGId) ||[cite: 14]
        objGId.includes(targetGId)[cite: 14]
      ) {
        return obj;[cite: 14]
      }
    }

    if (targetEId) {[cite: 14]
      const parts = objId.split(/[:#]/);[cite: 14]
      if ([cite: 14]
        parts.includes(targetEId) ||[cite: 14]
        objId === targetEId ||[cite: 14]
        objId.endsWith('#' + targetEId) ||[cite: 14]
        objId.endsWith(':' + targetEId)[cite: 14]
      ) {
        return obj;[cite: 14]
      }
    }
  }

  const targetName = (asset.asset_name || asset.assetName || '').trim().toLowerCase();[cite: 14]
  if (targetName) {[cite: 14]
    for (const id in objects) {[cite: 14]
      const obj = objects[id];[cite: 14]
      if (!obj) continue;[cite: 14]
      const name = String(obj.name || '').toLowerCase();[cite: 14]
      if (name && (name === targetName || name.includes(targetName))) {[cite: 14]
        return obj;[cite: 14]
      }
    }
  }

  return null;[cite: 14]
}

function focusCameraOnEntity(globalId, expressId, assetName = '') {[cite: 14]
  const viewer = window.xeokitViewer || window.viewer;[cite: 14]
  if (!viewer || !viewer.scene) return;[cite: 14]

  const pseudoAsset = { global_id: globalId, express_id: expressId, asset_name: assetName };[cite: 14]
  const entity = findEntityByAsset(viewer, pseudoAsset);[cite: 14]
  if (!entity) return;[cite: 14]

  entity.visible = true; [cite: 14]
  if (typeof entity.culled !== 'undefined') entity.culled = false;[cite: 14]

  window.selectedEntity = entity;[cite: 14]
  entity.highlighted = true; [cite: 14]
  setTimeout(() => { if (entity) entity.highlighted = false; }, 3500);[cite: 14]

  const aabb = entity.aabb;[cite: 14]
  if (!isValidAABB(aabb)) return;[cite: 14]
  const center = getAABBCenter(aabb);[cite: 14]

  if (viewer.cameraControl) viewer.cameraControl.pivotPos = center;[cite: 14]

  if (viewer.cameraFlight && typeof viewer.cameraFlight.flyTo === 'function') {[cite: 14]
    try {[cite: 14]
      viewer.cameraFlight.flyTo({ aabb: aabb, fitFOV: 20, duration: 0.8 });[cite: 14]
      return;[cite: 14]
    } catch (e) {}[cite: 14]
  }
}

window.focusAndOpenAssetFromDashboard = function(expressId, globalId, assetName) {[cite: 14]
  closeDigitalTwinDashboard();[cite: 14]
  setTimeout(() => { openDigitalTwinPanel(expressId, globalId, assetName); }, 120);[cite: 14]
};

// =========================================================================
// --- TÍCH HỢP BẢN ĐỒ GIS 3D (CESIUMJS + PROJ4 VN-2000 DROPDOWN) ---
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
        <h3 style="margin:0; font-size:15px;">🌍 Bản Đồ GIS 3D - Quy Đổi Tọa Độ VN-2000 & Kinh Tuyến Trục</h3>
        <button type="button" onclick="closeCesiumGisMap()" style="background:#dc3545; color:#fff; border:none; padding:6px 12px; border-radius:4px; font-weight:bold; cursor:pointer;">✕ Đóng Bản Đồ</button>
      </div>

      <!-- THANH CÔNG CỤ CẤU HÌNH VN-2000 & CHỌN TỈNH THÀNH -->
      <div style="background:#1a2332; padding:10px 20px; display:flex; align-items:center; gap:15px; flex-wrap:wrap; border-bottom:1px solid #3b4c66; color:#fff; font-size:12px;">
        <div>
          <label style="font-weight:bold; color:#00f2ff;">📍 Tỉnh / Thành Phố (VN-2000):</label>
          <select id="dt-province-select" style="padding:5px 8px; border-radius:4px; background:#222c3d; color:#fff; border:1px solid #3b4c66; margin-left:6px; cursor:pointer;">
            <option value="105.75">TP. Hồ Chí Minh (KTTrực: 105°45')</option>
            <option value="105.00">Hà Nội (KTTrực: 105°00')</option>
            <option value="107.75">Đà Nẵng / Quảng Nam (KTTrực: 107°45')</option>
            <option value="108.50">Gia Lai / Đắk Lắk (KTTrực: 108°30')</option>
            <option value="105.75">Bình Dương (KTTrực: 105°45')</option>
            <option value="107.75">Đồng Nai / Vũng Tàu (KTTrực: 107°45')</option>
            <option value="105.00">Cần Thơ (KTTrực: 105°00')</option>
            <option value="106.25">Hải Phòng / Quảng Ninh (KTTrực: 106°15')</option>
          </select>
        </div>

        <div>
          <label style="font-weight:bold;">Tọa độ X (m):</label>
          <input type="number" id="dt-vn2000-x" value="684123.45" style="width:95px; padding:4px; border-radius:4px; border:1px solid #3b4c66; background:#222c3d; color:#fff; text-align:center;" />
        </div>

        <div>
          <label style="font-weight:bold;">Tọa độ Y (m):</label>
          <input type="number" id="dt-vn2000-y" value="1184567.89" style="width:95px; padding:4px; border-radius:4px; border:1px solid #3b4c66; background:#222c3d; color:#fff; text-align:center;" />
        </div>

        <button type="button" onclick="updateCesiumPositionFromVN2000()" style="background:#00f2ff; color:#121826; border:none; padding:6px 14px; border-radius:4px; font-weight:bold; cursor:pointer;">
          🚀 Định Vị Lại Trên Bản Đồ
        </button>
      </div>

      <div id="cesiumContainer" style="flex:1; width:100%; height:100%;"></div>
    `;
    document.body.appendChild(modal);
  } else {
    modal.style.display = 'flex';
  }

  loadCesiumScripts(() => {
    if (!cesiumViewerInstance) {
      cesiumViewerInstance = new Cesium.Viewer('cesiumContainer', {
        geocoder: true,
        animation: false,
        timeline: false
      });
    }
    updateCesiumPositionFromVN2000();
  });
}

function updateCesiumPositionFromVN2000() {
  if (!window.proj4 || !cesiumViewerInstance) return;

  const selectEl = document.getElementById('dt-province-select');
  const xInput = document.getElementById('dt-vn2000-x');
  const yInput = document.getElementById('dt-vn2000-y');

  const lon0 = parseFloat(selectEl ? selectEl.value : '105.75');
  const xVal = parseFloat(xInput ? xInput.value : '684123.45');
  const yVal = parseFloat(yInput ? yInput.value : '1184567.89');

  // Khai báo phép chiếu VN-2000 động theo kinh tuyến trục được chọn
  proj4.defs("VN2000_CUSTOM", `+proj=tmerc +lat_0=0 +lon_0=${lon0} +k=0.9999 +x_0=500000 +y_0=0 +ellps=WGS84 +units=m +no_defs`);

  // Chuyển đổi từ VN-2000 (X, Y) sang WGS84 (Kinh độ, Vĩ độ)
  let latLon = proj4("VN2000_CUSTOM", "EPSG:4326", [xVal, yVal]);
  let targetLng = latLon[0];
  let targetLat = latLon[1];

  // Xóa entity cũ nếu có để cập nhật vị trí mới
  cesiumViewerInstance.entities.removeAll();

  const targetPosition = Cesium.Cartesian3.fromDegrees(targetLng, targetLat, 0);

  // Thêm Marker định vị công trình
  cesiumViewerInstance.entities.add({
    name: 'Vị Trí Công Trình (VN-2000)',
    position: targetPosition,
    point: {
      pixelSize: 18,
      color: Cesium.Color.CYAN,
      outlineColor: Cesium.Color.WHITE,
      outlineWidth: 2
    },
    label: {
      text: 'Vị trí công trình theo VN-2000',
      font: '13pt sans-serif',
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      fillColor: Cesium.Color.WHITE,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 2,
      pixelOffset: new Cesium.Cartesian2(0, -30)
    },
    description: `<h3>Thông Tin Định Vị</h3><p><b>Kinh tuyến trục:</b> ${lon0}°</p><p><b>Tọa độ X:</b> ${xVal} m</p><p><b>Tọa độ Y:</b> ${yVal} m</p>`
  });

  // --- NẠP MÔ HÌNH 3D CẦU ---
  const bridgeModelUrl = 'https://cesium.com/public/CesiumAir/CesiumAir.gltf'; // Thay bằng file .glb của cậu nếu có
  const hpr = new Cesium.HeadingPitchRoll(Cesium.Math.toRadians(45.0), 0, 0);
  const transform = Cesium.Transforms.headingPitchRollToFixedFrame(targetPosition, hpr);

  Cesium.Model.fromGltfAsync({
    url: bridgeModelUrl,
    modelMatrix: transform,
    scale: 2.0
  }).then(function(model) {
    cesiumViewerInstance.scene.primitives.removeAll();
    cesiumViewerInstance.scene.primitives.add(model);
  }).catch(function(err){
    console.warn('Lỗi nạp mô hình 3D:', err);
  });

  // Camera bay sát xuống vị trí tọa độ vừa quy đổi
  cesiumViewerInstance.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(targetLng, targetLat, 400),
    orientation: {
      heading: Cesium.Math.toRadians(0.0),
      pitch: Cesium.Math.toRadians(-45.0),
      roll: 0.0
    }
  });
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

function discoverAllPipeSystems() {[cite: 14]
  const viewer = window.xeokitViewer || window.viewer;[cite: 14]
  if (!viewer) return ['Tất cả hệ thống (All)'];[cite: 14]

  const systems = new Set();[cite: 14]
  systems.add('Tất cả hệ thống (All)');[cite: 14]

  if (viewer.metaScene && viewer.metaScene.metaObjects) {[cite: 14]
    Object.values(viewer.metaScene.metaObjects).forEach(metaObj => {[cite: 14]
      if (metaObj.propertySets) {[cite: 14]
        const psets = Array.isArray(metaObj.propertySets) ? metaObj.propertySets : Object.values(metaObj.propertySets);[cite: 14]
        psets.forEach(pset => {[cite: 14]
          if (pset && pset.properties) {[cite: 14]
            const props = Array.isArray(pset.properties) ? pset.properties : Object.values(pset.properties);[cite: 14]
            props.forEach(p => {[cite: 14]
              if (p && (p.name === 'Reference' || p.name === 'SystemName' || p.name === 'System Type') && p.value) {[cite: 14]
                const val = String(p.value).trim();[cite: 14]
                if (val) systems.add(val);[cite: 14]
              }
            });
          }
        });
      }
    });
  }

  if (viewer.scene && viewer.scene.objects) {[cite: 14]
    Object.values(viewer.scene.objects).forEach(entity => {[cite: 14]
      const name = String(entity.name || '');[cite: 14]
      const pipeMatch = name.match(/(?:Pipe|Duct)\s*Types?[:\s]+([^#:\n]+)/i);[cite: 14]
      if (pipeMatch && pipeMatch[1].trim()) {[cite: 14]
        systems.add(pipeMatch[1].trim());[cite: 14]
      } else if (name.includes('AP.') || name.includes('SUS304')) {[cite: 14]
        systems.add('AP, SUS304');[cite: 14]
      } else if (name.includes('HDPE')) {[cite: 14]
        systems.add('AP, HDPE');[cite: 14]
      } else if (name.includes('WP')) {[cite: 14]
        systems.add('WP');[cite: 14]
      }
    });
  }

  return Array.from(systems);[cite: 14]
}

function getSelectedSystemKeys() {[cite: 14]
  const checkboxes = document.querySelectorAll('.dt-sys-checkbox');[cite: 14]
  const selected = [];[cite: 14]
  checkboxes.forEach(cb => {[cite: 14]
    if (cb.checked) selected.push(cb.value);[cite: 14]
  });
  if (selected.length === 0 || selected.includes('Tất cả hệ thống (All)')) {[cite: 14]
    return ['all'];[cite: 14]
  }
  return selected;[cite: 14]
}

function getEntitiesInSelectedSystems() {[cite: 14]
  const viewer = window.xeokitViewer || window.viewer;[cite: 14]
  if (!viewer || !viewer.scene) return [];[cite: 14]

  const selectedKeys = getSelectedSystemKeys();[cite: 14]
  const matchedEntities = [];[cite: 14]

  Object.values(viewer.scene.objects).forEach(entity => {[cite: 14]
    if (!isValidAABB(entity.aabb)) return;[cite: 14]

    if (selectedKeys.includes('all')) {[cite: 14]
      matchedEntities.push(entity);[cite: 14]
      return;[cite: 14]
    }

    const name = String(entity.name || '').toLowerCase();[cite: 14]
    const id = String(entity.id || '').toLowerCase();[cite: 14]

    let metaRef = '';[cite: 14]
    if (viewer.metaScene && viewer.metaScene.metaObjects) {[cite: 14]
      const metaObj = viewer.metaScene.metaObjects[entity.id] || viewer.metaScene.metaObjects[entity.originalSystemId];[cite: 14]
      if (metaObj && metaObj.propertySets) {[cite: 14]
        const psets = Array.isArray(metaObj.propertySets) ? metaObj.propertySets : Object.values(metaObj.propertySets);[cite: 14]
        psets.forEach(pset => {[cite: 14]
          if (pset && pset.properties) {[cite: 14]
            const props = Array.isArray(pset.properties) ? pset.properties : Object.values(pset.properties);[cite: 14]
            props.forEach(p => {[cite: 14]
              if (p && p.name === 'Reference' && p.value) {[cite: 14]
                metaRef += ' ' + String(p.value).toLowerCase();[cite: 14]
              }
            });
          }
        });
      }
    }

    const matchFound = selectedKeys.some(sysKey => {[cite: 14]
      const k = sysKey.toLowerCase();[cite: 14]
      return name.includes(k) || id.includes(k) || metaRef.includes(k);[cite: 14]
    });

    if (matchFound) {[cite: 14]
      matchedEntities.push(entity);[cite: 14]
    }
  });

  if (matchedEntities.length === 0) {[cite: 14]
    Object.values(viewer.scene.objects).forEach(entity => {[cite: 14]
      if (isValidAABB(entity.aabb)) matchedEntities.push(entity);[cite: 14]
    });
  }

  if (selectedSourceEntity && !matchedEntities.includes(selectedSourceEntity)) {[cite: 14]
    matchedEntities.push(selectedSourceEntity);[cite: 14]
  }
  selectedBranchEntities.forEach(bEnt => {[cite: 14]
    if (!matchedEntities.includes(bEnt)) matchedEntities.push(bEnt);[cite: 14]
  });

  return matchedEntities;[cite: 14]
}

function buildMultiBranchFlowGraph(sourceEntity, branchEntities, systemEntities) {[cite: 14]
  if (!systemEntities || systemEntities.length === 0) return null;[cite: 14]

  const nodes = systemEntities.map(entity => ({[cite: 14]
    id: entity.id,[cite: 14]
    entity: entity,[cite: 14]
    center: getAABBCenter(entity.aabb)[cite: 14]
  }));[cite: 14]

  let sourceNode = null;[cite: 14]
  if (sourceEntity && isValidAABB(sourceEntity.aabb)) {[cite: 14]
    const sCenter = getAABBCenter(sourceEntity.aabb);[cite: 14]
    let minDist = Infinity;[cite: 14]
    nodes.forEach(node => {[cite: 14]
      const d = Math.sqrt(Math.pow(node.center[0] - sCenter[0], 2) + Math.pow(node.center[1] - sCenter[1], 2) + Math.pow(node.center[2] - sCenter[2], 2));[cite: 14]
      if (d < minDist) { minDist = d; sourceNode = node; }[cite: 14]
    });
  }
  if (!sourceNode) sourceNode = nodes[0];[cite: 14]

  const branchNodes = [];[cite: 14]
  if (branchEntities && branchEntities.length > 0) {[cite: 14]
    branchEntities.forEach(bEnt => {[cite: 14]
      if (isValidAABB(bEnt.aabb)) {[cite: 14]
        const bCenter = getAABBCenter(bEnt.aabb);[cite: 14]
        let minDist = Infinity;[cite: 14]
        let matched = null;[cite: 14]
        nodes.forEach(node => {[cite: 14]
          const d = Math.sqrt(Math.pow(node.center[0] - bCenter[0], 2) + Math.pow(node.center[1] - bCenter[1], 2) + Math.pow(node.center[2] - bCenter[2], 2));[cite: 14]
          if (d < minDist) { minDist = d; matched = node; }[cite: 14]
        });
        if (matched && !branchNodes.includes(matched) && matched !== sourceNode) {[cite: 14]
          branchNodes.push(matched);[cite: 14]
        }
      }
    });
  }

  const MAX_CONNECT_DIST = 15.0;[cite: 14]
  const edges = [];[cite: 14]
  const edgeSet = new Set();[cite: 14]

  function findPathBetween(startNode, targetNode) {[cite: 14]
    const distMap = new Map();[cite: 14]
    const prevMap = new Map();[cite: 14]
    const unvisited = new Set(nodes);[cite: 14]

    nodes.forEach(n => distMap.set(n, Infinity));[cite: 14]
    distMap.set(startNode, 0);[cite: 14]

    while (unvisited.size > 0) {[cite: 14]
      let current = null;[cite: 14]
      let minD = Infinity;[cite: 14]
      unvisited.forEach(n => {[cite: 14]
        if (distMap.get(n) < minD) {[cite: 14]
          minD = distMap.get(n);[cite: 14]
          current = n;[cite: 14]
        }
      });

      if (!current || current === targetNode || minD === Infinity) break;[cite: 14]
      unvisited.delete(current);[cite: 14]

      nodes.forEach(neighbor => {[cite: 14]
        if (unvisited.has(neighbor)) {[cite: 14]
          const d = Math.sqrt([cite: 14]
            Math.pow(current.center[0] - neighbor.center[0], 2) +[cite: 14]
            Math.pow(current.center[1] - neighbor.center[1], 2) +[cite: 14]
            Math.pow(current.center[2] - neighbor.center[2], 2)[cite: 14]
          );[cite: 14]
          if (d <= MAX_CONNECT_DIST) {[cite: 14]
            const alt = distMap.get(current) + d;[cite: 14]
            if (alt < distMap.get(neighbor)) {[cite: 14]
              distMap.set(neighbor, alt);[cite: 14]
              prevMap.set(neighbor, current);[cite: 14]
            }
          }
        }
      });
    }

    const pathEdges = [];[cite: 14]
    let curr = targetNode;[cite: 14]
    while (prevMap.has(curr)) {[cite: 14]
      const p = prevMap.get(curr);[cite: 14]
      pathEdges.unshift({ from: p, to: curr });[cite: 14]
      curr = p;[cite: 14]
    }
    return pathEdges;[cite: 14]
  }

  const connectedSet = new Set([sourceNode]);[cite: 14]

  branchNodes.forEach(bNode => {[cite: 14]
    let bestConnectFrom = sourceNode;[cite: 14]
    let minDToTree = Infinity;[cite: 14]

    connectedSet.forEach(cNode => {[cite: 14]
      const d = Math.sqrt([cite: 14]
        Math.pow(cNode.center[0] - bNode.center[0], 2) +[cite: 14]
        Math.pow(cNode.center[1] - bNode.center[1], 2) +[cite: 14]
        Math.pow(cNode.center[2] - bNode.center[2], 2)[cite: 14]
      );[cite: 14]
      if (d < minDToTree) {[cite: 14]
        minDToTree = d;[cite: 14]
        bestConnectFrom = cNode;[cite: 14]
      }
    });

    const subEdges = findPathBetween(bestConnectFrom, bNode);[cite: 14]
    subEdges.forEach(e => {[cite: 14]
      const key = `${e.from.id}->${e.to.id}`;[cite: 14]
      if (!edgeSet.has(key)) {[cite: 14]
        edgeSet.add(key);[cite: 14]
        edges.push(e);[cite: 14]
      }
      connectedSet.add(e.to);[cite: 14]
    });
  });

  return { source: sourceNode, branches: branchNodes, edges };[cite: 14]
}

function openSystemTraceToolbar() {[cite: 14]
  injectSystemTraceToolbar();[cite: 14]
  bind3DPickListener();[cite: 14]
}

function executeSystemTraceSimulation() {[cite: 14]
  const viewer = window.xeokitViewer || window.viewer;[cite: 14]
  if (!viewer || !viewer.scene) return;[cite: 14]

  const matchedEntities = getEntitiesInSelectedSystems();[cite: 14]

  Object.values(viewer.scene.objects).forEach(obj => {[cite: 14]
    obj.opacity = 0.08;[cite: 14]
    obj.colorized = false;[cite: 14]
  });

  matchedEntities.forEach(obj => {[cite: 14]
    obj.opacity = 1.0;[cite: 14]
    obj.colorize = [0.0, 0.9, 0.8]; [cite: 14]
    obj.colorized = true;[cite: 14]
  });

  if (selectedSourceEntity) {[cite: 14]
    selectedSourceEntity.opacity = 1.0;[cite: 14]
    selectedSourceEntity.colorize = [0.1, 0.8, 0.3];  [cite: 14]
    selectedSourceEntity.colorized = true;[cite: 14]
  }

  selectedBranchEntities.forEach(bEnt => {[cite: 14]
    bEnt.opacity = 1.0;[cite: 14]
    bEnt.colorize = [1.0, 0.75, 0.0]; [cite: 14]
    bEnt.colorized = true;[cite: 14]
  });

  currentTraceGraph = buildMultiBranchFlowGraph(selectedSourceEntity, selectedBranchEntities, matchedEntities);[cite: 14]

  let canvas = document.getElementById('dt-trace-canvas');[cite: 14]
  if (!canvas) {[cite: 14]
    canvas = document.createElement('canvas');[cite: 14]
    canvas.id = 'dt-trace-canvas';[cite: 14]
    canvas.style.cssText = 'position:fixed !important; top:0 !important; left:0 !important; width:100vw !important; height:100vh !important; pointer-events:none !important; z-index:450 !important;';[cite: 14]
    document.body.appendChild(canvas);[cite: 14]
  }
  activeTraceCanvas = canvas;[cite: 14]

  if (traceAnimFrameId) cancelAnimationFrame(traceAnimFrameId);[cite: 14]
  isTraceActive = true;[cite: 14]
  animateTraceLoop();[cite: 14]
  
  viewer.scene._needUpdate = 1;[cite: 14]
  if (typeof viewer.scene.render === 'function') viewer.scene.render();[cite: 14]
}

function bind3DPickListener() {[cite: 14]
  const viewer = window.xeokitViewer || window.viewer;[cite: 14]
  if (!viewer || !viewer.scene || !viewer.scene.input) return;[cite: 14]

  if (!viewer.scene.input._dtMultiBranchBound) {[cite: 14]
    viewer.scene.input._dtMultiBranchBound = true;[cite: 14]
    viewer.scene.input.on("mouseclicked", (coords) => {[cite: 14]
      if (!currentPickMode) return;[cite: 14]
      const hit = viewer.scene.pick({ canvasPos: coords });[cite: 14]
      if (hit && hit.entity) {[cite: 14]
        if (currentPickMode === 'source') {[cite: 14]
          selectedSourceEntity = hit.entity;[cite: 14]
          hit.entity.colorize = [0.1, 0.8, 0.3];[cite: 14]
          hit.entity.colorized = true;[cite: 14]
          alert(`🟢 ĐÃ NHẬN NGUỒN: ${hit.entity.name || hit.entity.id}`);[cite: 14]
          currentPickMode = null;[cite: 14]
        } else if (currentPickMode === 'branch') {[cite: 14]
          if (!selectedBranchEntities.includes(hit.entity)) {[cite: 14]
            selectedBranchEntities.push(hit.entity);[cite: 14]
            hit.entity.colorize = [1.0, 0.75, 0.0];[cite: 14]
            hit.entity.colorized = true;[cite: 14]
          }[cite: 14]
          alert(`🎯 ĐÃ THÊM NHÁNH RẼ (${selectedBranchEntities.length}): ${hit.entity.name || hit.entity.id}`);[cite: 14]
        }
        updateToolbarStatusText();[cite: 14]
        if (viewer.scene) {[cite: 14]
          viewer.scene._needUpdate = 1;[cite: 14]
          if (typeof viewer.scene.render === 'function') viewer.scene.render();[cite: 14]
        }
      }
    });
  }
}

function enablePickMode(mode) {[cite: 14]
  currentPickMode = mode;[cite: 14]
  if (mode === 'source') {[cite: 14]
    alert('👉 Đang ở chế độ chọn NGUỒN: Hãy click chuột vào Máy thổi khí hoặc Bơm trên 3D!');[cite: 14]
  } else if (mode === 'branch') {[cite: 14]
    alert('👉 Đang ở chế độ chọn NHÁNH RẼ: Hãy click vào các đầu nhánh xả muốn tỏa ra từ dòng chính!');[cite: 14]
  }
}

function resetTraceSelections() {[cite: 14]
  selectedSourceEntity = null;[cite: 14]
  selectedBranchEntities = [];[cite: 14]
  currentPickMode = null;[cite: 14]
  stopTandemSystemTrace();[cite: 14]
  openSystemTraceToolbar();[cite: 14]
}

function updateToolbarStatusText() {[cite: 14]
  const btn = document.getElementById('dt-sys-dropdown-btn');[cite: 14]
  if (btn) {[cite: 14]
    const checkedBoxes = document.querySelectorAll('.dt-sys-checkbox:checked');[cite: 14]
    let text = 'Chọn hệ thống...';[cite: 14]
    if (checkedBoxes.length > 0) {[cite: 14]
      const names = Array.from(checkedBoxes).map(cb => cb.value);[cite: 14]
      text = names.join(', ');[cite: 14]
      if (text.length > 25) text = names.length + ' hệ thống đã chọn';[cite: 14]
    }
    const labelSpan = btn.querySelector('span');[cite: 14]
    if (labelSpan) labelSpan.innerText = text;[cite: 14]
  }
}

function animateTraceLoop() {[cite: 14]
  if (!isTraceActive) return;[cite: 14]
  renderTraceFlowLines();[cite: 14]
  traceAnimFrameId = requestAnimationFrame(animateTraceLoop);[cite: 14]
}

function renderTraceFlowLines() {[cite: 14]
  if (!isTraceActive || !currentTraceGraph || !activeTraceCanvas) return;[cite: 14]

  const viewer = window.xeokitViewer || window.viewer;[cite: 14]
  if (!viewer || !viewer.scene) return;[cite: 14]

  const canvas = activeTraceCanvas;[cite: 14]
  const ctx = canvas.getContext('2d');[cite: 14]
  
  canvas.width = window.innerWidth;[cite: 14]
  canvas.height = window.innerHeight;[cite: 14]
  ctx.clearRect(0, 0, canvas.width, canvas.height);[cite: 14]

  traceDashOffset -= 0.8;[cite: 14]

  ctx.lineWidth = 4;[cite: 14]
  ctx.strokeStyle = '#00f2ff';[cite: 14]
  ctx.setLineDash([10, 8]);[cite: 14]
  ctx.lineDashOffset = traceDashOffset;[cite: 14]
  ctx.shadowColor = '#00f2ff';[cite: 14]
  ctx.shadowBlur = 10;[cite: 14]

  if (currentTraceGraph.edges) {[cite: 14]
    currentTraceGraph.edges.forEach(edge => {[cite: 14]
      const p1 = projectWorldToCanvas(viewer, edge.from.center);[cite: 14]
      const p2 = projectWorldToCanvas(viewer, edge.to.center);[cite: 14]

      if (p1 && p2) {[cite: 14]
        ctx.beginPath();[cite: 14]
        ctx.moveTo(p1[0], p1[1]);[cite: 14]
        ctx.lineTo(p2[0], p2[1]);[cite: 14]
        ctx.stroke();[cite: 14]
      }
    });
  }

  if (currentTraceGraph.source) {[cite: 14]
    const sp = projectWorldToCanvas(viewer, currentTraceGraph.source.center);[cite: 14]
    if (sp) {[cite: 14]
      ctx.fillStyle = '#28a745';[cite: 14]
      ctx.beginPath();[cite: 14]
      ctx.arc(sp[0], sp[1], 8, 0, Math.PI * 2);[cite: 14]
      ctx.fill();[cite: 14]
      ctx.strokeStyle = '#ffffff';[cite: 14]
      ctx.lineWidth = 2;[cite: 14]
      ctx.stroke();[cite: 14]
    }
  }

  if (currentTraceGraph.branches && currentTraceGraph.branches.length > 0) {[cite: 14]
    currentTraceGraph.branches.forEach(bNode => {[cite: 14]
      const bp = projectWorldToCanvas(viewer, bNode.center);[cite: 14]
      if (bp) {[cite: 14]
        ctx.fillStyle = '#f39c12';[cite: 14]
        ctx.beginPath();[cite: 14]
        ctx.arc(bp[0], bp[1], 7, 0, Math.PI * 2);[cite: 14]
        ctx.fill();[cite: 14]
        ctx.strokeStyle = '#ffffff';[cite: 14]
        ctx.lineWidth = 2;[cite: 14]
        ctx.stroke();[cite: 14]
      }
    });
  }
}

function stopTandemSystemTrace() {[cite: 14]
  isTraceActive = false;[cite: 14]
  currentPickMode = null;[cite: 14]

  if (traceAnimFrameId) {[cite: 14]
    cancelAnimationFrame(traceAnimFrameId);[cite: 14]
    traceAnimFrameId = null;[cite: 14]
  }

  if (activeTraceCanvas && activeTraceCanvas.parentElement) {[cite: 14]
    activeTraceCanvas.parentElement.removeChild(activeTraceCanvas);[cite: 14]
    activeTraceCanvas = null;[cite: 14]
  }

  const toolbar = document.getElementById('dt-trace-toolbar');[cite: 14]
  if (toolbar) toolbar.parentElement.removeChild(toolbar);[cite: 14]

  const viewer = window.xeokitViewer || window.viewer;[cite: 14]
  if (viewer && viewer.scene) {[cite: 14]
    Object.values(viewer.scene.objects).forEach(obj => {[cite: 14]
      obj.opacity = 1.0;[cite: 14]
      obj.colorize = null;[cite: 14]
      obj.colorized = false;[cite: 14]
    });
    viewer.scene._needUpdate = 1;[cite: 14]
    if (typeof viewer.scene.render === 'function') viewer.scene.render();[cite: 14]
  }
}

function injectSystemTraceToolbar() {[cite: 14]
  injectMarkerStyles();[cite: 14]
  let toolbar = document.getElementById('dt-trace-toolbar');[cite: 14]
  if (!toolbar) {[cite: 14]
    toolbar = document.createElement('div');[cite: 14]
    toolbar.id = 'dt-trace-toolbar';[cite: 14]
    document.body.appendChild(toolbar);[cite: 14]
  }

  const detectedSystems = discoverAllPipeSystems();[cite: 14]
  let checkboxesHtml = '';[cite: 14]
  detectedSystems.forEach((sys, idx) => {[cite: 14]
    const checked = (idx === 0) ? 'checked' : '';[cite: 14]
    checkboxesHtml += `
      <label>
        <input type="checkbox" class="dt-sys-checkbox" value="${sys}" ${checked} onchange="updateToolbarStatusText()" />
        ${sys}
      </label>
    `;[cite: 14]
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
  `;[cite: 14]

  setTimeout(updateToolbarStatusText, 50);[cite: 14]
}

function toggleSysDropdown() {[cite: 14]
  const menu = document.getElementById('dt-sys-dropdown-menu');[cite: 14]
  if (menu) {[cite: 14]
    menu.style.display = (menu.style.display === 'block') ? 'none' : 'block';[cite: 14]
  }
}

window.addEventListener('click', function(e) {[cite: 14]
  const container = document.getElementById('dt-sys-dropdown-container');[cite: 14]
  const menu = document.getElementById('dt-sys-dropdown-menu');[cite: 14]
  if (container && menu && !container.contains(e.target)) {[cite: 14]
    menu.style.display = 'none';[cite: 14]
  }
});

function startTandemSystemTrace() {[cite: 14]
  openSystemTraceToolbar();[cite: 14]
}

// =========================================================================
// --- UI PANELS ---
// =========================================================================

function injectDigitalTwinPanel() {[cite: 14]
  injectMarkerStyles();[cite: 14]
  if (document.getElementById('dt-asset-panel')) return;[cite: 14]

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

        <div style="margin-bottom:15px;">
          <label style="font-size:12px;">Đính kèm Tài Liệu / HDSD (PDF):</label>
          <input type="file" id="dt_file_input" accept=".pdf,.docx,.png,.jpg" style="width:100%; font-size:12px;" />
          <div id="dt_doc_list" style="margin-top:8px; font-size:12px; color:#1a73e8;"></div>
        </div>

        <button type="button" onclick="saveAssetToDatabase()" style="width:100%; padding:10px; background:#1a73e8; color:#fff; border:none; border-radius:5px; font-weight:bold; cursor:pointer;">💾 Lưu Hồ Sơ Thiết Bị</button>
      </form>
    </div>
  `;[cite: 14]
  document.body.insertAdjacentHTML('beforeend', panelHtml);[cite: 14]
  makePanelDraggable();[cite: 14]
}

function makePanelDraggable() {[cite: 14]
  const panel = document.getElementById('dt-asset-panel');[cite: 14]
  const header = document.getElementById('dt-panel-header');[cite: 14]
  if (!panel || !header || panel.dataset.draggable === 'true') return;[cite: 14]
  panel.dataset.draggable = 'true';[cite: 14]

  let posX = 0, posY = 0, mouseX = 0, mouseY = 0;[cite: 14]
  header.onmousedown = (e) => {[cite: 14]
    e.preventDefault();[cite: 14]
    mouseX = e.clientX; mouseY = e.clientY;[cite: 14]
    document.onmouseup = () => { document.onmouseup = null; document.onmousemove = null; };[cite: 14]
    document.onmousemove = (ev) => {[cite: 14]
      ev.preventDefault();[cite: 14]
      posX = mouseX - ev.clientX; posY = mouseY - ev.clientY;[cite: 14]
      mouseX = ev.clientX; mouseY = ev.clientY;[cite: 14]
      panel.style.top = (panel.offsetTop - posY) + 'px';[cite: 14]
      panel.style.left = (panel.offsetLeft - posX) + 'px';[cite: 14]
    };[cite: 14]
  };[cite: 14]
}

function toggleDigitalTwinPanelFromMenu() {[cite: 14]
  injectDigitalTwinPanel();[cite: 14]
  const panel = document.getElementById('dt-asset-panel');[cite: 14]
  if (panel.style.display === 'none' || panel.style.display === '') {[cite: 14]
    const entity = window.selectedEntity;[cite: 14]
    const metaObject = window.selectedMetaObject;[cite: 14]
    let expressID = entity ? entity.id : '';[cite: 14]
    let globalID = '';[cite: 14]
    let assetName = (metaObject && metaObject.name) ? metaObject.name : '';[cite: 14]

    if (metaObject) {[cite: 14]
      if (metaObject.originalSystemId) globalID = metaObject.originalSystemId;[cite: 14]
      else if (metaObject.globalId) globalID = metaObject.globalId;[cite: 14]
      else if (metaObject.id && String(metaObject.id).includes('-')) globalID = metaObject.id;[cite: 14]
    }
    if (!globalID && entity && entity.globalId) globalID = entity.globalId;[cite: 14]

    openDigitalTwinPanel(expressID, globalID, assetName);[cite: 14]
  } else {
    panel.style.display = 'none';[cite: 14]
  }
}

async function openDigitalTwinPanel(expressID, globalID, assetName = '') {[cite: 14]
  injectDigitalTwinPanel();[cite: 14]
  const panel = document.getElementById('dt-asset-panel');[cite: 14]
  panel.style.display = 'block';[cite: 14]

  document.getElementById('dt-asset-form').reset();[cite: 14]
  document.getElementById('dt_doc_list').innerHTML = '';[cite: 14]
  
  if (document.getElementById('dt_new_log_date')) {[cite: 14]
    document.getElementById('dt_new_log_date').value = new Date().toISOString().split('T')[0];[cite: 14]
  }

  let finalExpressID = cleanId(expressID);[cite: 14]
  let finalGlobalID = cleanId(globalID);[cite: 14]

  function getIfcGlobalIdFromDOM() {[cite: 14]
    const elements = Array.from(document.querySelectorAll('tr, div, td, span'));[cite: 14]
    for (const el of elements) {[cite: 14]
      if (el.innerText && el.innerText.trim() === 'ID Cấu Kiện') {[cite: 14]
        const parentRow = el.closest('tr') || el.parentElement;[cite: 14]
        if (parentRow) {[cite: 14]
          const cells = parentRow.querySelectorAll('td, span, div');[cite: 14]
          if (cells.length > 1) return cells[1].innerText.trim();[cite: 14]
        }
      }
    }
    return '';[cite: 14]
  }

  if (!finalGlobalID) {[cite: 14]
    const domId = getIfcGlobalIdFromDOM();[cite: 14]
    if (domId && domId !== 'ID Cấu Kiện') finalGlobalID = domId;[cite: 14]
  }

  const applyValues = (gId, eId, aName) => {[cite: 14]
    document.getElementById('dt_global_id').value = gId || eId || '';[cite: 14]
    document.getElementById('dt_express_id').value = eId || '';[cite: 14]
    document.getElementById('dt_display_global_id').value = gId || eId || '';[cite: 14]
    if (aName) document.getElementById('dt_asset_name').value = aName;[cite: 14]
  };

  applyValues(finalGlobalID, finalExpressID, assetName);[cite: 14]
  focusCameraOnEntity(finalGlobalID, finalExpressID, assetName);[cite: 14]

  const activeGlobalId = finalGlobalID || finalExpressID;[cite: 14]
  if (activeGlobalId) loadMaintenanceHistory(activeGlobalId);[cite: 14]

  const client = getDigitalTwinSupabaseClient();[cite: 14]
  if (client && (finalGlobalID || finalExpressID)) {[cite: 14]
    try {[cite: 14]
      let query = client.from('project_assets').select('*, asset_documents(*)');[cite: 14]
      if (finalGlobalID) query = query.eq('global_id', finalGlobalID);[cite: 14]
      else if (finalExpressID && !isNaN(parseInt(finalExpressID))) query = query.eq('express_id', parseInt(finalExpressID));[cite: 14]

      const { data: existingAsset } = await query.maybeSingle();[cite: 14]
      if (existingAsset) {[cite: 14]
        document.getElementById('dt_asset_code').value = existingAsset.asset_code || '';[cite: 14]
        document.getElementById('dt_asset_name').value = existingAsset.asset_name || assetName;[cite: 14]
        document.getElementById('dt_status').value = existingAsset.status || 'OPERATIONAL';[cite: 14]
        document.getElementById('dt_install_date').value = existingAsset.installation_date || '';[cite: 14]
        document.getElementById('dt_warranty_date').value = existingAsset.warranty_expiry || '';[cite: 14]
        document.getElementById('dt_last_maint_date').value = existingAsset.last_maintenance_date || '';[cite: 14]
        document.getElementById('dt_next_maint_date').value = existingAsset.next_maintenance_date || '';[cite: 14]

        if (existingAsset.asset_documents?.length > 0) {[cite: 14]
          let docsHtml = '<b>Tài liệu đã đính kèm:</b><br>';[cite: 14]
          existingAsset.asset_documents.forEach(doc => {[cite: 14]
            docsHtml += `📄 <a href="${doc.file_url}" target="_blank" style="color:#1a73e8;">${doc.file_name}</a><br>`;[cite: 14]
          });[cite: 14]
          document.getElementById('dt_doc_list').innerHTML = docsHtml;[cite: 14]
        }
      }
    } catch (e) {[cite: 14]
      console.warn('Lỗi đọc thông tin tài sản từ CSDL:', e);[cite: 14]
    }
  }
}

function closeAssetPanel() {[cite: 14] 
  stopTandemSystemTrace();[cite: 14] 
  document.getElementById('dt-asset-panel').style.display = 'none';[cite: 14] 
}

async function loadMaintenanceHistory(globalId) {[cite: 14]
  const container = document.getElementById('dt_log_history_list');[cite: 14]
  if (!container) return;[cite: 14]

  if (!globalId) {[cite: 14]
    container.innerHTML = '<div style="font-size:11px; color:#888; font-style:italic; text-align:center;">Chưa chọn thiết bị.</div>';[cite: 14]
    return;[cite: 14]
  }

  container.innerHTML = '<div style="font-size:11px; color:#888; text-align:center; padding:8px;">⏳ Đang tải lịch sử...</div>';[cite: 14]

  const client = getDigitalTwinSupabaseClient();[cite: 14]
  if (!client) {[cite: 14]
    container.innerHTML = '<div style="font-size:11px; color:red; text-align:center;">Chưa kết nối CSDL.</div>';[cite: 14]
    return;[cite: 14]
  }

  try {
    const { data: logs, error } = await client[cite: 14]
      .from('asset_maintenance_logs')[cite: 14]
      .select('*')[cite: 14]
      .eq('global_id', globalId)[cite: 14]
      .order('log_date', { ascending: false })[cite: 14]
      .order('id', { ascending: false });[cite: 14]

    if (error) throw error;[cite: 14]

    if (!logs || logs.length === 0) {[cite: 14]
      container.innerHTML = '<div style="font-size:11px; color:#888; font-style:italic; text-align:center; padding:8px;">Chưa có nhật ký bảo trì nào.</div>';[cite: 14]
      return;[cite: 14]
    }

    let html = '';[cite: 14]
    logs.forEach(log => {[cite: 14]
      let badgeBg = '#1a73e8';[cite: 14]
      if (log.action_type === 'Sửa chữa') badgeBg = '#dc3545';[cite: 14]
      if (log.action_type === 'Thay thế') badgeBg = '#e67e22';[cite: 14]
      if (log.action_type === 'Kiểm tra') badgeBg = '#17a2b8';[cite: 14]

      html += `
        <div style="border-left: 3px solid ${badgeBg}; padding: 6px 8px; margin-bottom: 6px; background: #ffffff; border-radius: 0 4px 4px 0; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
          <div style="display:flex; justify-content:space-between; align-items:center; font-size:10px; color:#666; margin-bottom:3px;">
            <span>📅 <b>${log.log_date || '-'}</b></span>
            <span style="background:${badgeBg}; color:#fff; padding:1px 6px; border-radius:3px; font-weight:bold; font-size:9px;">${log.action_type || 'Nhật ký'}</span>
          </div>
          <div style="font-size:11px; color:#333; word-break:break-word; white-space:pre-wrap;">${log.description}</div>
          ${log.performer ? `<div style="font-size:10px; color:#777; margin-top:3px;">👤 Người thực hiện: <i>${log.performer}</i></div>` : ''}
        </div>
      `;[cite: 14]
    });

    container.innerHTML = html;[cite: 14]
  } catch (err) {[cite: 14]
    console.error('Lỗi tải lịch sử bảo trì:', err);[cite: 14]
    container.innerHTML = '<div style="font-size:11px; color:red; text-align:center;">Lỗi tải dữ liệu nhật ký.</div>';[cite: 14]
  }
}

async function addMaintenanceLogRecord() {[cite: 14]
  const globalId = document.getElementById('dt_global_id').value;[cite: 14]
  const actionType = document.getElementById('dt_new_log_type').value;[cite: 14]
  const description = document.getElementById('dt_new_log_desc').value;[cite: 14]
  const performer = document.getElementById('dt_new_log_performer').value;[cite: 14]
  const logDate = document.getElementById('dt_new_log_date').value;[cite: 14]

  if (!globalId) return alert('⚠️ Chưa chọn thiết bị!');[cite: 14]
  if (!description.trim()) return alert('⚠️ Vui lòng nhập nội dung công việc!');[cite: 14]

  const client = getDigitalTwinSupabaseClient();[cite: 14]
  if (!client) return alert('⚠️ Chưa kết nối CSDL Supabase!');[cite: 14]

  try {
    const payload = {[cite: 14]
      global_id: globalId,[cite: 14]
      action_type: actionType,[cite: 14]
      description: description.trim(),[cite: 14]
      performer: performer.trim(),[cite: 14]
      log_date: logDate || new Date().toISOString().split('T')[0][cite: 14]
    };

    const { error } = await client.from('asset_maintenance_logs').insert([payload]);[cite: 14]
    if (error) throw error;[cite: 14]

    if (logDate && (actionType === 'Bảo trì' || actionType === 'Sửa chữa')) {[cite: 14]
      document.getElementById('dt_last_maint_date').value = logDate;[cite: 14]
    }

    document.getElementById('dt_new_log_desc').value = '';[cite: 14]
    document.getElementById('dt_new_log_performer').value = '';[cite: 14]
    loadMaintenanceHistory(globalId);[cite: 14]

  } catch (err) {[cite: 14]
    alert('❌ Lỗi thêm nhật ký: ' + err.message);[cite: 14]
  }
}

async function applyAssetColorCoding() {[cite: 14]
  const client = getDigitalTwinSupabaseClient();[cite: 14]
  if (!client) return alert('Chưa kết nối CSDL Supabase!');[cite: 14]

  try {
    const { data: assets } = await client.from('project_assets').select('*');[cite: 14]
    if (!assets || assets.length === 0) return;[cite: 14]

    const viewer = window.xeokitViewer || window.viewer;[cite: 14]
    if (!viewer || !viewer.scene) return;[cite: 14]

    assets.forEach(asset => {[cite: 14]
      const rgbColor = STATUS_COLORS[asset.status] || STATUS_COLORS.OPERATIONAL;[cite: 14]
      const entity = findEntityByAsset(viewer, asset);[cite: 14]
      if (entity) {[cite: 14]
        entity.colorize = rgbColor;[cite: 14]
        entity.colorized = true;[cite: 14]
        entity.opacity = 1.0;[cite: 14]
      }
    });

    viewer.scene._needUpdate = 1;[cite: 14]
    if (typeof viewer.scene.render === 'function') viewer.scene.render();[cite: 14]

    isColorCodingActive = true;[cite: 14]
    render3DMarkers(assets);[cite: 14]
  } catch (err) {[cite: 14]
    console.error('Lỗi áp dụng màu 3D:', err);[cite: 14]
  }
}

function resetModelColors() {[cite: 14]
  const viewer = window.xeokitViewer || window.viewer;[cite: 14]
  if (viewer && viewer.scene) {[cite: 14]
    Object.values(viewer.scene.objects).forEach(entity => {[cite: 14]
      entity.colorize = null;[cite: 14]
      entity.colorized = false;[cite: 14]
    });
    viewer.scene._needUpdate = 1;[cite: 14]
    if (typeof viewer.scene.render === 'function') viewer.scene.render();[cite: 14]
  }
  clear3DMarkers();[cite: 14]
  isColorCodingActive = false;[cite: 14]
}

function toggleColorCodingMode(btn) {[cite: 14]
  if (!isColorCodingActive) {[cite: 14]
    applyAssetColorCoding();[cite: 14]
    if (btn) { btn.innerText = '🔄 Khôi Phục Màu Mặc Định'; btn.style.backgroundColor = '#28a745'; btn.style.color = '#fff'; btn.style.borderColor = '#28a745'; }[cite: 14]
  } else {
    resetModelColors();[cite: 14]
    if (btn) { btn.innerText = '🎨 Trạng Thái 3D'; btn.style.backgroundColor = '#f0f4f9'; btn.style.color = '#1a73e8'; btn.style.borderColor = '#b6d4fe'; }[cite: 14]
  }
}

function getOrCreateMarkerContainer() {[cite: 14]
  injectMarkerStyles();[cite: 14]
  let container = document.getElementById('dt-marker-overlay-container');[cite: 14]
  if (!container) {[cite: 14]
    container = document.createElement('div');[cite: 14]
    container.id = 'dt-marker-overlay-container';[cite: 14]
    document.body.appendChild(container);[cite: 14]
  }
  return container;[cite: 14]
}

function render3DMarkers(assets) {[cite: 14]
  clear3DMarkers();[cite: 14]
  const viewer = window.xeokitViewer || window.viewer;[cite: 14]
  if (!viewer || !viewer.scene || !viewer.scene.canvas) return;[cite: 14]

  const container = getOrCreateMarkerContainer();[cite: 14]
  const trackedItems = [];[cite: 14]

  assets.forEach(asset => {[cite: 14]
    const entity = findEntityByAsset(viewer, asset);[cite: 14]
    if (entity && isValidAABB(entity.aabb)) {[cite: 14]
      const centerWorldPos = getAABBCenter(entity.aabb);[cite: 14]

      let markerIcon = '🟢', markerClass = 'operational';[cite: 14]
      if (asset.status === 'FAULT') { markerIcon = '🛑'; markerClass = 'fault'; } [cite: 14]
      else if (asset.status === 'MAINTENANCE') { markerIcon = '⚠️'; markerClass = 'maintenance'; }[cite: 14]

      const markerDiv = document.createElement('div');[cite: 14]
      markerDiv.className = `dt-3d-marker ${markerClass}`;[cite: 14]
      markerDiv.style.display = 'none';[cite: 14]
      markerDiv.innerHTML = `<span>${markerIcon}</span><span>${asset.asset_code || asset.asset_name}</span>`;[cite: 14]

      markerDiv.onclick = (e) => {[cite: 14]
        e.stopPropagation();[cite: 14]
        openDigitalTwinPanel(cleanId(asset.express_id), cleanId(asset.global_id), asset.asset_name);[cite: 14]
      };[cite: 14]

      container.appendChild(markerDiv);[cite: 14]
      activeMarkerElements.push(markerDiv);[cite: 14]
      trackedItems.push({ element: markerDiv, worldPos: centerWorldPos });[cite: 14]
    }
  });

  function updateMarkerPositions() {[cite: 14]
    if (!isColorCodingActive || trackedItems.length === 0) return;[cite: 14]
    const currentViewer = window.xeokitViewer || window.viewer;[cite: 14]
    if (!currentViewer || !currentViewer.scene || !currentViewer.scene.camera) return;[cite: 14]

    trackedItems.forEach(item => {[cite: 14]
      const sp = projectWorldToCanvas(currentViewer, item.worldPos);[cite: 14]
      if (sp) {[cite: 14]
        item.element.style.display = 'flex';[cite: 14]
        item.element.style.left = Math.round(sp[0]) + 'px';[cite: 14]
        item.element.style.top = Math.round(sp[1]) + 'px';[cite: 14]
      } else {
        item.element.style.display = 'none';[cite: 14]
      }
    });
  }

  markerTickListener = viewer.scene.on("tick", updateMarkerPositions);[cite: 14]
  setTimeout(updateMarkerPositions, 50);[cite: 14]
}

function clear3DMarkers() {[cite: 14]
  const viewer = window.xeokitViewer || window.viewer;[cite: 14]
  if (viewer && viewer.scene && markerTickListener) {[cite: 14]
    try { viewer.scene.off(markerTickListener); } catch (e) {}[cite: 14]
    markerTickListener = null;[cite: 14]
  }
  activeMarkerElements.forEach(el => { if (el && el.parentElement) el.parentElement.removeChild(el); });[cite: 14]
  activeMarkerElements = [];[cite: 14]
  const container = document.getElementById('dt-marker-overlay-container');[cite: 14]
  if (container) container.innerHTML = '';[cite: 14]
}

function injectDigitalTwinDashboardModal() {[cite: 14]
  if (document.getElementById('dt-dashboard-modal')) return;[cite: 14]
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
  `;[cite: 14]
  document.body.insertAdjacentHTML('beforeend', modalHtml);[cite: 14]

  const tbody = document.getElementById('dt-dash-table-body');[cite: 14]
  if (tbody && !tbody.dataset.eventBound) {[cite: 14]
    tbody.dataset.eventBound = 'true';[cite: 14]
    tbody.addEventListener('click', function(e) {[cite: 14]
      const btn = e.target.closest('.dt-btn-view-detail');[cite: 14]
      if (btn) {[cite: 14]
        window.focusAndOpenAssetFromDashboard(btn.getAttribute('data-express-id'), btn.getAttribute('data-global-id'), decodeURIComponent(btn.getAttribute('data-asset-name')));[cite: 14]
      }
    });
  }
}

async function openDigitalTwinDashboard() {[cite: 14]
  injectDigitalTwinDashboardModal();[cite: 14]
  document.getElementById('dt-dashboard-modal').style.display = 'flex';[cite: 14]

  const client = getDigitalTwinSupabaseClient();[cite: 14]
  if (!client) return;[cite: 14]

  try {
    const { data: assets } = await client.from('project_assets').select('*');[cite: 14]
    let total = assets ? assets.length : 0;[cite: 14]
    let op = 0, maint = 0, fault = 0;[cite: 14]
    let alertRowsHtml = '';[cite: 14]

    if (assets) {
      assets.forEach(asset => {[cite: 14]
        if (asset.status === 'OPERATIONAL') op++;[cite: 14]
        else if (asset.status === 'MAINTENANCE') maint++;[cite: 14]
        else if (asset.status === 'FAULT') fault++;[cite: 14]

        if (asset.status !== 'OPERATIONAL') {[cite: 14]
          const badge = asset.status === 'FAULT' ? '<span style="color:#dc3545; font-weight:bold;">🔴 Sự cố</span>' : '<span style="color:#f39c12; font-weight:bold;">🟡 Bảo trì</span>';[cite: 14]
          alertRowsHtml += `
            <tr style="border-bottom:1px solid #eee;">
              <td style="padding:8px; font-weight:bold;">${asset.asset_code || '-'}</td>
              <td style="padding:8px;">${asset.asset_name || '-'}</td>
              <td style="padding:8px;">${badge}</td>
              <td style="padding:8px; color:#1a73e8; font-weight:bold;">${asset.next_maintenance_date || '-'}</td>
              <td style="padding:8px; text-align:center;">
                <button type="button" class="dt-btn-view-detail" data-express-id="${cleanId(asset.express_id)}" data-global-id="${cleanId(asset.global_id)}" data-asset-name="${encodeURIComponent(asset.asset_name || '')}" style="padding:4px 8px; background:#1a73e8; color:#fff; border:none; border-radius:4px; font-size:11px; cursor:pointer;">🔎 Xem Chi Tiết</button>
              </td>
            </tr>
          `;[cite: 14]
        }
      });
    }

    document.getElementById('dt-dash-total').innerText = total;[cite: 14]
    document.getElementById('dt-dash-op').innerText = op;[cite: 14]
    document.getElementById('dt-dash-maint').innerText = maint;[cite: 14]
    document.getElementById('dt-dash-fault').innerText = fault;[cite: 14]
    document.getElementById('dt-dash-table-body').innerHTML = alertRowsHtml || '<tr><td colspan="5" style="text-align:center; padding:15px; color:#28a745;">🎉 Tất cả thiết bị bình thường!</td></tr>';[cite: 14]
  } catch (err) {[cite: 14]
    console.error('Lỗi khi mở Dashboard:', err);[cite: 14]
  }
}

function closeDigitalTwinDashboard() {[cite: 14]
  const modal = document.getElementById('dt-dashboard-modal');[cite: 14]
  if (modal) modal.style.display = 'none';[cite: 14]
}

async function saveAssetToDatabase() {[cite: 14]
  const globalId = document.getElementById('dt_global_id').value;[cite: 14]
  const expressId = document.getElementById('dt_express_id').value;[cite: 14]
  const assetCode = document.getElementById('dt_asset_code').value;[cite: 14]
  const assetName = document.getElementById('dt_asset_name').value;[cite: 14]
  const status = document.getElementById('dt_status').value;[cite: 14]

  if (!assetCode || !assetName) return alert('Vui lòng nhập Mã Tài Sản và Tên Thiết Bị!');[cite: 14]

  const client = getDigitalTwinSupabaseClient();[cite: 14]
  if (!client) return alert('Chưa kết nối CSDL Supabase!');[cite: 14]

  try {
    const { error } = await client.from('project_assets').upsert({[cite: 14]
      project_id: window.currentProjectId || 'DEFAULT_PROJ',[cite: 14]
      global_id: globalId,[cite: 14]
      express_id: parseInt(expressId) || 0,[cite: 14]
      asset_code: assetCode,[cite: 14]
      asset_name: assetName,[cite: 14]
      status: status,[cite: 14]
      installation_date: document.getElementById('dt_install_date').value || null,[cite: 14]
      warranty_expiry: document.getElementById('dt_warranty_date').value || null,[cite: 14]
      last_maintenance_date: document.getElementById('dt_last_maint_date').value || null,[cite: 14]
      next_maintenance_date: document.getElementById('dt_next_maint_date').value || null,[cite: 14]
      updated_at: new Date()[cite: 14]
    }, { onConflict: 'global_id' });[cite: 14]

    if (error) throw error;[cite: 14]
    if (isColorCodingActive) applyAssetColorCoding();[cite: 14]
    alert('✅ Lưu hồ sơ thiết bị thành công!');[cite: 14]
    closeAssetPanel();[cite: 14]
  } catch (err) {[cite: 14]
    alert('Lỗi: ' + err.message);[cite: 14]
  }
}