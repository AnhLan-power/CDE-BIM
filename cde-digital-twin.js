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

// --- SYSTEM TRACE MULTI-SELECTION VARIABLES ---
let activeTraceCanvas = null;
let traceAnimFrameId = null;
let currentTraceGraph = null; 
let isTraceActive = false;
let traceDashOffset = 0;

let selectedSourceEntity = null;        // 1 Nguồn phát (Máy thổi khí / Bơm)
let selectedBranchEntities = [];        // Danh sách chọn NHIỀU Nhánh
let currentPickMode = null;              // 'source' | 'branch' | null

function cleanId(val) {
  if (val === null || val === undefined) return '';
  const s = String(val).trim();
  if (s === 'null' || s === 'undefined' || s === '0') return '';
  return s;
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

/**
 * Chuyển đổi an toàn Tọa độ 3D World -> 2D Screen Canvas
 */
function projectWorldToCanvas(viewer, worldPos) {
  if (!viewer || !viewer.scene) return null;
  const scene = viewer.scene;

  if (scene.canvas && typeof scene.canvas.worldToCanvas === 'function') {
    const out = [0, 0];
    scene.canvas.worldToCanvas(worldPos, out);
    return out;
  }

  const camera = scene.camera;
  if (!camera || !camera.viewMatrix || !camera.projMatrix) return null;

  const canvasEl = scene.canvas.canvas;
  if (!canvasEl) return null;

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

  const rect = canvasEl.getBoundingClientRect();
  let x = (nx + 1) * 0.5 * rect.width;
  let y = (1 - ny) * 0.5 * rect.height;

  return [x, y];
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
// --- SYSTEM TRACE CHUẨN AUTODESK TANDEM (WAYPOINT PATHING CHUẨN ĐƯỜNG CHỌN) ---
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

/**
 * Thuật toán Waypoint-Guided Pathing với khoảng cách kết nối tối ưu (15 mét)
 */
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

  const waypoints = [sourceNode];
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
        if (matched && !waypoints.includes(matched)) waypoints.push(matched);
      }
    });
  }

  const MAX_CONNECT_DIST = 15.0; // Tăng khoảng cách nối giữa các đoạn ống dài
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

  for (let i = 0; i < waypoints.length - 1; i++) {
    const subEdges = findPathBetween(waypoints[i], waypoints[i + 1]);
    subEdges.forEach(e => {
      const key = `${e.from.id}->${e.to.id}`;
      if (!edgeSet.has(key)) {
        edgeSet.add(key);
        edges.push(e);
      }
    });
  }

  return { source: sourceNode, branches: waypoints.slice(1), edges };
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
    obj.colorize = [0.0, 0.9, 0.8]; // Cyan
    obj.colorized = true;
  });

  if (selectedSourceEntity) {
    selectedSourceEntity.opacity = 1.0;
    selectedSourceEntity.colorize = [0.1, 0.8, 0.3]; // Green
    selectedSourceEntity.colorized = true;
  }

  selectedBranchEntities.forEach(bEnt => {
    bEnt.opacity = 1.0;
    bEnt.colorize = [1.0, 0.75, 0.0]; // Orange
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
          alert(`🟢 ĐÃ NHẬN NGUỒN: ${hit.entity.name || hit.entity.id}`);
          currentPickMode = null;
        } else if (currentPickMode === 'branch') {
          if (!selectedBranchEntities.includes(hit.entity)) {
            selectedBranchEntities.push(hit.entity);
            hit.entity.colorize = [1.0, 0.75, 0.0];
            hit.entity.colorized = true;
          }
          alert(`🎯 ĐÃ THÊM NHÁNH (${selectedBranchEntities.length}): ${hit.entity.name || hit.entity.id}`);
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
    alert('👉 Đang ở chế độ chọn NGUỒN: Hãy click chuột vào Máy thổi khí hoặc Bơm trên 3D!');
  } else if (mode === 'branch') {
    alert('👉 Đang ở chế độ chọn NHÁNH: Hãy click lần lượt theo đúng tuyến đường cậu muốn chảy qua!');
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
        <input type="checkbox" class="dt-sys-checkbox" value="${sys}" ${checked} onchange="updateToolbarStatusText()" />
        ${sys}
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
        <button type="button" id="dt-btn-system-trace" onclick="openSystemTraceToolbar()" 
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
  if (activeGlobalId) loadMaintenanceHistory(activeGlobalId);

  const client = getDigitalTwinSupabaseClient();
  if (client && (finalGlobalID || finalExpressID)) {
    try {
      let query = client.from('project_assets').select('*, asset_documents(*)');
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
      if (sp) {
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