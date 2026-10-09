// =========================================================================
// --- MODULE QUẢN LÝ TÀI SẢN DIGITAL TWIN & SYSTEM TRACE (AUTODESK TANDEM STYLE) ---
// =========================================================================

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

// --- TANDEM SYSTEM TRACE VARIABLES ---
let activeTraceCanvas = null;
let traceAnimFrameId = null;
let traceTickListener = null;
let currentTraceGraph = null; // Cấu trúc cây tuyến ống { source, nodes, edges }
let isTraceActive = false;
let traceDashOffset = 0;

/**
 * Làm sạch giá trị ID
 */
function cleanId(val) {
  if (val === null || val === undefined) return '';
  const s = String(val).trim();
  if (s === 'null' || s === 'undefined' || s === '0') return '';
  return s;
}

/**
 * Kiểm tra Bounding Box (AABB) hợp lệ
 */
function isValidAABB(aabb) {
  if (!aabb || (!Array.isArray(aabb) && !ArrayBuffer.isView(aabb)) || aabb.length !== 6) return false;
  if (!isFinite(aabb[0]) || !isFinite(aabb[1]) || !isFinite(aabb[2]) ||
      !isFinite(aabb[3]) || !isFinite(aabb[4]) || !isFinite(aabb[5])) return false;
  if (aabb[0] > aabb[3] || aabb[1] > aabb[4] || aabb[2] > aabb[5]) return false;
  return true;
}

/**
 * Lấy tọa độ tâm 3D từ AABB
 */
function getAABBCenter(aabb) {
  return [
    (aabb[0] + aabb[3]) / 2,
    (aabb[1] + aabb[4]) / 2,
    (aabb[2] + aabb[5]) / 2
  ];
}

/**
 * Inject Style Marker & Trace Bar
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

    /* SYSTEM TRACE FLOATING TOOLBAR (TANDEM STYLE) */
    #dt-trace-toolbar {
      position: fixed !important;
      top: 20px !important;
      left: 50% !important;
      transform: translateX(-50%) !important;
      background: rgba(20, 24, 33, 0.92) !important;
      backdrop-filter: blur(8px) !important;
      border: 1px solid rgba(255, 255, 255, 0.15) !important;
      border-radius: 8px !important;
      padding: 8px 16px !important;
      display: flex !important;
      align-items: center !important;
      gap: 12px !important;
      color: #fff !important;
      font-size: 12px !important;
      font-family: sans-serif !important;
      z-index: 99999 !important;
      box-shadow: 0 8px 24px rgba(0,0,0,0.4) !important;
    }
    #dt-trace-toolbar select {
      background: #2a3142 !important;
      color: #00f2ff !important;
      border: 1px solid #404b61 !important;
      padding: 4px 8px !important;
      border-radius: 4px !important;
      font-size: 11px !important;
      font-weight: bold !important;
      outline: none !important;
    }
    #dt-trace-toolbar button {
      padding: 4px 10px !important;
      border-radius: 4px !important;
      border: none !important;
      font-weight: bold !important;
      font-size: 11px !important;
      cursor: pointer !important;
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
// --- THUẬT TOÁN TÌM KIẾM THIẾT BỊ TRONG MÔ HÌNH 3D ---
// =========================================================================

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

// =========================================================================
// --- CAMERA ZOOM CẬN CẢNH ---
// =========================================================================

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

  if (viewer.cameraControl) {
    viewer.cameraControl.pivotPos = center;
  }

  if (viewer.cameraFlight && typeof viewer.cameraFlight.flyTo === 'function') {
    try {
      viewer.cameraFlight.flyTo({
        aabb: aabb,
        fitFOV: 20,
        duration: 0.8
      });
      return;
    } catch (e) {}
  }

  const dx = aabb[3] - aabb[0];
  const dy = aabb[4] - aabb[1];
  const dz = aabb[5] - aabb[2];
  const diagonal = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const fitDist = Math.max(diagonal * 0.9, 0.8);

  const camera = viewer.scene.camera;
  if (camera) {
    const startEye = camera.eye ? [...camera.eye] : [0, 10, 10];
    const startLook = camera.look ? [...camera.look] : [0, 0, 0];

    let dir = [startEye[0] - startLook[0], startEye[1] - startLook[1], startEye[2] - startLook[2]];
    let len = Math.sqrt(dir[0] * dir[0] + dir[1] * dir[1] + dir[2] * dir[2]);
    if (len === 0 || isNaN(len)) { dir = [1, 1, 1]; len = Math.sqrt(3); }
    dir = [dir[0] / len, dir[1] / len, dir[2] / len];

    const endLook = center;
    const endEye = [
      center[0] + dir[0] * fitDist,
      center[1] + dir[1] * fitDist,
      center[2] + dir[2] * fitDist
    ];

    const duration = 700;
    const startTime = performance.now();

    function animateCamera(now) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1.0);
      const ease = 1 - Math.pow(1 - progress, 3);

      camera.look = [
        startLook[0] + (endLook[0] - startLook[0]) * ease,
        startLook[1] + (endLook[1] - startLook[1]) * ease,
        startLook[2] + (endLook[2] - startLook[2]) * ease
      ];

      camera.eye = [
        startEye[0] + (endEye[0] - startEye[0]) * ease,
        startEye[1] + (endEye[1] - startEye[1]) * ease,
        startEye[2] + (endEye[2] - startEye[2]) * ease
      ];

      if (viewer.scene) {
        viewer.scene._needUpdate = 1;
        if (typeof viewer.scene.render === 'function') viewer.scene.render();
      }

      if (progress < 1.0) {
        requestAnimationFrame(animateCamera);
      }
    }

    requestAnimationFrame(animateCamera);
  }
}

window.focusAndOpenAssetFromDashboard = function(expressId, globalId, assetName) {
  closeDigitalTwinDashboard();
  setTimeout(() => {
    openDigitalTwinPanel(expressId, globalId, assetName);
  }, 120);
};

// =========================================================================
// --- CƠ CHẾ SYSTEM TRACE CHUẨN AUTODESK TANDEM (TRUY VẾT & DÒNG CHẢY 3D) ---
// =========================================================================

/**
 * 1. Tự động thu thập toàn bộ thuộc tính SystemType / Reference từ IFC
 */
function discoverAllPipeSystems() {
  const viewer = window.xeokitViewer || window.viewer;
  if (!viewer || !viewer.scene) return [];

  const systems = new Set();
  const objects = viewer.scene.objects;

  Object.values(objects).forEach(entity => {
    const name = String(entity.name || '');
    const id = String(entity.id || '');

    // Đọc tên đường ống từ IFC Properties (VD: AP. SUS304, Supply Air, Chilled Water)
    if (name.toLowerCase().includes('pipe') || name.toLowerCase().includes('duct') || name.includes('AP.') || name.includes('TS-')) {
      let sysName = name.split(/[:#]/)[0].trim();
      if (sysName) systems.add(sysName);
    }
  });

  return Array.from(systems);
}

/**
 * 2. Tìm danh sách tất cả các cấu kiện thuộc cùng 1 Hệ thống
 */
function getEntitiesInSystem(systemKey) {
  const viewer = window.xeokitViewer || window.viewer;
  if (!viewer || !viewer.scene) return [];

  const key = systemKey.toLowerCase().trim();
  const matchedEntities = [];

  Object.values(viewer.scene.objects).forEach(entity => {
    const name = String(entity.name || '').toLowerCase();
    const id = String(entity.id || '').toLowerCase();

    if (key === '' || name.includes(key) || id.includes(key) || (key.includes('pipe') && name.includes('pipe'))) {
      if (isValidAABB(entity.aabb)) {
        matchedEntities.push(entity);
      }
    }
  });

  return matchedEntities;
}

/**
 * 3. Dựng ma trận liên kết đồ thị (Spatial Connection Graph) từ Nguồn -> Nhánh
 */
function buildFlowGraph(sourceEntity, systemEntities) {
  if (!sourceEntity || systemEntities.length === 0) return null;

  const nodes = systemEntities.map(entity => ({
    id: entity.id,
    entity: entity,
    center: getAABBCenter(entity.aabb),
    visited: false
  }));

  const sourceNode = nodes.find(n => n.id === sourceEntity.id) || nodes[0];
  sourceNode.visited = true;

  const edges = [];
  let currentFrontier = [sourceNode];

  // Thuật toán BFS tìm các đoạn ống lân cận kế tiếp
  while (currentFrontier.length > 0) {
    const nextFrontier = [];

    currentFrontier.forEach(curr => {
      // Tìm các node gần nhất về mặt không gian (khoảng cách tâm giữa 2 đoạn ống)
      nodes.forEach(target => {
        if (!target.visited) {
          const dx = curr.center[0] - target.center[0];
          const dy = curr.center[1] - target.center[1];
          const dz = curr.center[2] - target.center[2];
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

          // Nếu 2 đoạn ống nằm sát nhau (< 4.5m)
          if (dist < 4.5) {
            target.visited = true;
            edges.push({ from: curr, to: target });
            nextFrontier.push(target);
          }
        }
      });
    });

    currentFrontier = nextFrontier;
  }

  // Nối các node chưa visit vào sơ đồ cây
  nodes.forEach(n => {
    if (!n.visited) {
      let minDist = Infinity;
      let nearest = null;
      nodes.forEach(other => {
        if (other.visited && other.id !== n.id) {
          const d = Math.sqrt(
            Math.pow(n.center[0] - other.center[0], 2) +
            Math.pow(n.center[1] - other.center[1], 2) +
            Math.pow(n.center[2] - other.center[2], 2)
          );
          if (d < minDist) { minDist = d; nearest = other; }
        }
      });
      if (nearest) {
        edges.push({ from: nearest, to: n });
        n.visited = true;
      }
    }
  });

  return { source: sourceNode, nodes, edges };
}

/**
 * 4. Khởi chạy System Trace chuẩn Autodesk Tandem
 */
function startTandemSystemTrace(systemKey = '') {
  stopTandemSystemTrace();

  const viewer = window.xeokitViewer || window.viewer;
  if (!viewer || !viewer.scene) return;

  const matchedEntities = getEntitiesInSystem(systemKey);
  if (matchedEntities.length === 0) {
    alert('⚠️ Không tìm thấy đường ống thuộc hệ thống này!');
    return;
  }

  // Đặt Ghost Mode (Xuyên thấu) toàn bộ mô hình ngoài hệ thống
  Object.values(viewer.scene.objects).forEach(obj => {
    obj.opacity = 0.08;
    obj.colorized = false;
  });

  // Tô màu Xanh Ngọc Nổi Bật cho hệ thống ống được chọn
  matchedEntities.forEach(obj => {
    obj.opacity = 1.0;
    obj.colorize = [0.0, 0.9, 0.8]; // Aqua Cyan
    obj.colorized = true;
  });

  // Xác định Nguồn (Source): Ưu tiên thiết bị được chọn hoặc đoạn ống đầu tiên
  const sourceEntity = window.selectedEntity || matchedEntities[0];
  currentTraceGraph = buildFlowGraph(sourceEntity, matchedEntities);

  // Tạo Canvas Overlay để vẽ đường dòng chảy động
  let canvas = document.getElementById('dt-trace-canvas');
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.id = 'dt-trace-canvas';
    canvas.style.cssText = 'position:fixed; top:0; left:0; width:100vw; height:100vh; pointer-events:none; z-index:502;';
    document.body.appendChild(canvas);
  }
  activeTraceCanvas = canvas;

  // Lắng nghe sự kiện di chuyển Camera để cập nhật nét vẽ 3D -> 2D Canvas
  traceTickListener = viewer.scene.on('tick', renderTraceFlowLines);
  
  isTraceActive = true;
  injectSystemTraceToolbar(systemKey);
  renderTraceFlowLines();
}

/**
 * 5. Render đường nét đứt chuyển động (Flow Lines Animation) trên Canvas
 */
function renderTraceFlowLines() {
  if (!isTraceActive || !currentTraceGraph || !activeTraceCanvas) return;

  const viewer = window.xeokitViewer || window.viewer;
  if (!viewer || !viewer.scene || !viewer.scene.canvas) return;

  const canvas = activeTraceCanvas;
  const ctx = canvas.getContext('2d');
  
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const xeokitCanvas = viewer.scene.canvas;
  const rect = xeokitCanvas.canvas.getBoundingClientRect();

  // Tăng dashOffset tạo hiệu ứng chất lỏng cuộn chảy
  traceDashOffset -= 0.8;

  ctx.lineWidth = 4;
  ctx.strokeStyle = '#00f2ff'; // Màu xanh dạ quang
  ctx.setLineDash([8, 6]); // Đường nét đứt
  ctx.lineDashOffset = traceDashOffset;
  ctx.shadowColor = '#00f2ff';
  ctx.shadowBlur = 10;

  const p1 = [0, 0];
  const p2 = [0, 0];

  currentTraceGraph.edges.forEach(edge => {
    xeokitCanvas.worldToCanvas(edge.from.center, p1);
    xeokitCanvas.worldToCanvas(edge.to.center, p2);

    const x1 = rect.left + p1[0];
    const y1 = rect.top + p1[1];
    const x2 = rect.left + p2[0];
    const y2 = rect.top + p2[1];

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  });

  // Vẽ Marker Nguồn (Green Source Pin)
  if (currentTraceGraph.source) {
    xeokitCanvas.worldToCanvas(currentTraceGraph.source.center, p1);
    const sx = rect.left + p1[0];
    const sy = rect.top + p1[1];

    ctx.fillStyle = '#28a745';
    ctx.beginPath();
    ctx.arc(sx, sy, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  traceAnimFrameId = requestAnimationFrame(renderTraceFlowLines);
}

/**
 * 6. Tắt System Trace & Khôi phục màu gốc
 */
function stopTandemSystemTrace() {
  isTraceActive = false;
  if (traceAnimFrameId) cancelAnimationFrame(traceAnimFrameId);

  const viewer = window.xeokitViewer || window.viewer;
  if (viewer && viewer.scene && traceTickListener) {
    try { viewer.scene.off(traceTickListener); } catch (e) {}
    traceTickListener = null;
  }

  if (activeTraceCanvas && activeTraceCanvas.parentElement) {
    activeTraceCanvas.parentElement.removeChild(activeTraceCanvas);
    activeTraceCanvas = null;
  }

  const toolbar = document.getElementById('dt-trace-toolbar');
  if (toolbar) toolbar.parentElement.removeChild(toolbar);

  // Khôi phục màu sắc mô hình
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

/**
 * 7. Inject Floating Toolbar chuẩn Autodesk Tandem
 */
function injectSystemTraceToolbar(selectedSys = '') {
  injectMarkerStyles();
  let toolbar = document.getElementById('dt-trace-toolbar');
  if (!toolbar) {
    toolbar = document.createElement('div');
    toolbar.id = 'dt-trace-toolbar';
    document.body.appendChild(toolbar);
  }

  const detectedSystems = discoverAllPipeSystems();
  let optionsHtml = `<option value="">-- Tất cả hệ thống --</option>`;
  detectedSystems.forEach(sys => {
    const sel = sys.toLowerCase().includes(selectedSys.toLowerCase()) ? 'selected' : '';
    optionsHtml += `<option value="${sys}" ${sel}>${sys}</option>`;
  });

  toolbar.innerHTML = `
    <span>🌊 <b>System Trace:</b></span>
    <select onchange="startTandemSystemTrace(this.value)">${optionsHtml}</select>
    <button style="background:#1a73e8; color:#fff;" onclick="selectSourceElementPrompt()">📍 Chọn Nguồn</button>
    <button style="background:#dc3545; color:#fff;" onclick="stopTandemSystemTrace()">✕ Đóng</button>
  `;
}

function selectSourceElementPrompt() {
  alert('👉 Hãy click trực tiếp vào thiết bị hoặc đoạn ống 3D để đặt làm Nguồn (Source), sau đó bấm "Mô phỏng lại".');
}

// =========================================================================
// --- UI PANELS ---
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

      <div style="margin-bottom:15px; display:flex; gap:6px;">
        <button type="button" id="dt-btn-toggle-color" onclick="toggleColorCodingMode(this)" 
                style="flex:1; padding:8px 6px; background:#f0f4f9; color:#1a73e8; border:1px solid #b6d4fe; border-radius:6px; font-weight:bold; cursor:pointer; font-size:11px; display:flex; align-items:center; justify-content:center;">
          🎨 Trạng Thái 3D
        </button>
        <button type="button" onclick="openDigitalTwinDashboard()" 
                style="flex:1; padding:8px 6px; background:#e8f0fe; color:#1a73e8; border:1px solid #b6d4fe; border-radius:6px; font-weight:bold; cursor:pointer; font-size:11px; display:flex; align-items:center; justify-content:center;">
          📊 Thống Kê
        </button>
        <button type="button" id="dt-btn-system-trace" onclick="startTandemSystemTrace(document.getElementById('dt_asset_name')?.value || '')" 
                style="flex:1.2; padding:8px 6px; background:#e8f0fe; color:#1a73e8; border:1px solid #b6d4fe; border-radius:6px; font-weight:bold; cursor:pointer; font-size:11px; display:flex; align-items:center; justify-content:center;">
          🌊 System Trace 3D
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

        <!-- =================================================================== -->
        <!-- MODULE NHẬT KÝ VẬN HÀNH / BẢO TRÌ NÂNG CAO (TIMELINE HISTORY) -->
        <!-- =================================================================== -->
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

  const activeGlobalId = finalGlobalID || finalExpressID;
  if (activeGlobalId) {
    loadMaintenanceHistory(activeGlobalId);
  }

  const client = getDigitalTwinSupabaseClient();

  if (client && (finalGlobalID || finalExpressID)) {
    try {
      let query = client.from('project_assets').select('*, asset_documents(*)');
      if (finalGlobalID) {
        query = query.eq('global_id', finalGlobalID);
      } else if (finalExpressID && !isNaN(parseInt(finalExpressID))) {
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

function closeAssetPanel() { 
  stopTandemSystemTrace(); 
  document.getElementById('dt-asset-panel').style.display = 'none'; 
}

// =========================================================================
// --- TÍNH NĂNG NHẬT KÝ BẢO TRÌ NÂNG CAO (TIMELINE HISTORY) ---
// =========================================================================

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
            <span>📅 <b>${log.log_date || '-'}</b></span>
            <span style="background:${badgeBg}; color:#fff; padding:1px 6px; border-radius:3px; font-weight:bold; font-size:9px;">${log.action_type || 'Nhật ký'}</span>
          </div>
          <div style="font-size:11px; color:#333; word-break:break-word; white-space:pre-wrap;">${log.description}</div>
          ${log.performer ? `<div style="font-size:10px; color:#777; margin-top:3px;">👤 Người thực hiện: <i>${log.performer}</i></div>` : ''}
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

// =========================================================================
// --- TÔ MÀU 3D & HIỂN THỊ MARKER 3D ---
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

  function updateMarkerPositions() {
    if (!isColorCodingActive || trackedItems.length === 0) return;
    const currentViewer = window.xeokitViewer || window.viewer;
    if (!currentViewer || !currentViewer.scene || !currentViewer.scene.camera) return;

    const camera = currentViewer.scene.camera;
    const canvas = currentViewer.scene.canvas.canvas;
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();

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

    const viewMat = camera.viewMatrix;
    const projMat = camera.projMatrix || (camera.project && camera.project.projMatrix);

    if (!viewMat || !projMat) return;

    trackedItems.forEach(item => {
      const pos = item.worldPos;
      
      let vx = viewMat[0]*pos[0] + viewMat[4]*pos[1] + viewMat[8]*pos[2] + viewMat[12];
      let vy = viewMat[1]*pos[0] + viewMat[5]*pos[1] + viewMat[9]*pos[2] + viewMat[13];
      let vz = viewMat[2]*pos[0] + viewMat[6]*pos[1] + viewMat[10]*pos[2] + viewMat[14];
      
      let px = projMat[0]*vx + projMat[4]*vy + projMat[8]*vz + projMat[12];
      let py = projMat[1]*vx + projMat[5]*vy + projMat[9]*vz + projMat[13];
      let pw = projMat[3]*vx + projMat[7]*vy + projMat[11]*vz + projMat[15];

      if (pw <= 0) {
        item.element.style.display = 'none';
        return;
      }

      let nx = px / pw;
      let ny = py / pw;
      
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

  markerTickListener = viewer.scene.on("tick", updateMarkerPositions);
  if (viewer.scene.camera && typeof viewer.scene.camera.on === 'function') {
    viewer.scene.camera.on("matrix", updateMarkerPositions);
  }
  
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

  const tbody = document.getElementById('dt-dash-table-body');
  if (tbody && !tbody.dataset.eventBound) {
    tbody.dataset.eventBound = 'true';
    tbody.addEventListener('click', function(e) {
      const btn = e.target.closest('.dt-btn-view-detail');
      if (btn) {
        const eId = btn.getAttribute('data-express-id') || '';
        const gId = btn.getAttribute('data-global-id') || '';
        const aName = decodeURIComponent(btn.getAttribute('data-asset-name') || '');
        window.focusAndOpenAssetFromDashboard(eId, gId, aName);
      }
    });
  }
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
          const encodedName = encodeURIComponent(asset.asset_name || '');

          alertRowsHtml += `
            <tr style="border-bottom:1px solid #eee;">
              <td style="padding:8px; font-weight:bold;">${asset.asset_code || '-'}</td>
              <td style="padding:8px;">${asset.asset_name || '-'}</td>
              <td style="padding:8px;">${badge}</td>
              <td style="padding:8px; color:#1a73e8; font-weight:bold;">${asset.next_maintenance_date || '-'}</td>
              <td style="padding:8px; text-align:center;">
                <button type="button" class="dt-btn-view-detail" 
                        data-express-id="${safeEId}" 
                        data-global-id="${safeGId}" 
                        data-asset-name="${encodedName}"
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
  } catch (err) {
    console.error('Lỗi khi mở Dashboard:', err);
  }
}

function closeDigitalTwinDashboard() {
  const modal = document.getElementById('dt-dashboard-modal');
  if (modal) modal.style.display = 'none';
}

// =========================================================================
// --- LƯU DỮ LIỆU TÀI SẢN ---
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