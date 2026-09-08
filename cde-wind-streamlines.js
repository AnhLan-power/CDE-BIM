/* =====================================================================
   CDE WIND STREAMLINES MODULE — Đường dòng gió động kiểu SimScale
   ===================================================================== */

const WIND_BACKEND_URL = "https://wind-backend-yey0.onrender.com";

let windStreamlineRibbons = [];   // các Mesh dải ruy băng tĩnh (đường đi)
let windStreamlineParticles = []; // các Mesh hạt nhỏ animate chạy dọc đường
let windStreamlineRAF = null;
let windStreamlineData = null;

function injectWindStreamlineBox() {
  const panel = document.getElementById("windPanel");
  if (!panel) { console.warn("Chưa thấy #windPanel — cde-wind-analysis.js cần load trước file này."); return; }

  const box = document.createElement("div");
  box.className = "cde-file-card";
  box.id = "windStreamlineBox";
  box.innerHTML = `
    <div class="fname">🌊 Đường dòng động (thử nghiệm hiển thị)</div>
    <div class="meta">
      Bước 1+2 của lộ trình: dữ liệu bên dưới là DỮ LIỆU MẪU dựng sẵn (chưa phải kết quả tính toán vật lý thật) — dùng để kiểm tra cách hiển thị/animate trước khi nối với backend tính toán thật (Bước 3).
    </div>
    <button class="btn btn-primary" style="width:100%;margin-top:6px;" id="windStreamlineDemoBtn">🧪 Tạo dữ liệu mẫu & xem thử</button>
    <button class="btn" style="width:100%;margin-top:6px;background:#e8f5e9;" id="windRealSimBtn">🚀 Chạy mô phỏng THẬT (backend Python)</button>
    <div id="windRealSimStatus" style="font-size:10px;color:#0275d8;margin-top:4px;"></div>
    <button class="btn" style="width:100%;margin-top:6px;" id="windStreamlineLoadJsonBtn">📂 Tải file JSON đường dòng (thủ công)</button>
    <input type="file" id="windStreamlineFileInput" accept=".json" style="display:none;">
    <button class="btn" style="width:100%;margin-top:6px;" id="windStreamlineClearBtn">↺ Xoá đường dòng</button>`;
  panel.appendChild(box);

  document.getElementById("windStreamlineDemoBtn").addEventListener("click", generateDemoStreamlines);
  document.getElementById("windRealSimBtn").addEventListener("click", runRealWindSimulation);
  document.getElementById("windStreamlineClearBtn").addEventListener("click", clearWindStreamlines);
  document.getElementById("windStreamlineLoadJsonBtn").addEventListener("click", () => {
    document.getElementById("windStreamlineFileInput").click();
  });
  document.getElementById("windStreamlineFileInput").addEventListener("change", handleStreamlineJsonUpload);
}

/* ---------------------------------------------------------------------
   1. DỮ LIỆU MẪU CỨNG
   --------------------------------------------------------------------- */
function generateDemoStreamlines() {
  let minX = -10, maxX = 10, minZ = -10, maxZ = 10, baseY = 0;
  if (typeof windAreaPoints !== "undefined" && windAreaPoints.length === 2) {
    const [p1, p2] = windAreaPoints;
    minX = Math.min(p1[0], p2[0]); maxX = Math.max(p1[0], p2[0]);
    minZ = Math.min(p1[2], p2[2]); maxZ = Math.max(p1[2], p2[2]);
    baseY = (p1[1] + p2[1]) / 2 + 1.5;
  } else if (typeof viewer !== "undefined" && viewer.scene.aabb) {
    const aabb = viewer.scene.aabb;
    minX = aabb[0]; maxX = aabb[3]; minZ = aabb[2]; maxZ = aabb[5];
    baseY = aabb[4] + 1.5;
  }

  const lines = [];
  const lineCount = 5;
  const pointsPerLine = 24;
  for (let l = 0; l < lineCount; l++) {
    const startZ = minZ + (maxZ - minZ) * ((l + 0.5) / lineCount);
    const points = [], velocities = [];
    for (let k = 0; k <= pointsPerLine; k++) {
      const t = k / pointsPerLine;
      const x = minX + (maxX - minX) * t;
      const wiggle = Math.sin(t * Math.PI * 2 + l) * (maxZ - minZ) * 0.08;
      const z = startZ + wiggle;
      const y = baseY + Math.sin(t * Math.PI * 3 + l) * 0.3;
      points.push([x, y, z]);
      const v = 3 + 4 * Math.abs(Math.sin(t * Math.PI));
      velocities.push(v);
    }
    lines.push({ id: l + 1, points, velocities });
  }

  windStreamlineData = { lines };
  renderWindStreamlines(windStreamlineData);
}

/* ---------------------------------------------------------------------
   2. TẢI FILE JSON THẬT
   --------------------------------------------------------------------- */
function handleStreamlineJsonUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const lines = JSON.parse(ev.target.result);
      windStreamlineData = { lines };
      renderWindStreamlines(windStreamlineData);
    } catch (err) {
      alert("File JSON không đúng định dạng: " + err.message);
    }
  };
  reader.readAsText(file);
}

/* ---------------------------------------------------------------------
   3. DỰNG HÌNH: Dải ruy băng + Hạt động
   --------------------------------------------------------------------- */
function velocityToColor(v, maxV) {
  const t = Math.min(1, Math.max(0, v / maxV));
  if (t < 0.5) { const k = t / 0.5; return [0.1, 0.3 + k * 0.5, 0.9 - k * 0.4]; }
  const k = (t - 0.5) / 0.5;
  return [0.5 + k * 0.5, 0.8 - k * 0.7, 0.1];
}

function renderWindStreamlines(data) {
  clearWindStreamlines();
  if (!data || !data.lines || data.lines.length === 0) return;

  const maxV = Math.max(0.001, ...data.lines.flatMap(l => l.velocities));
  const width = 0.12; 

  // Tạo dữ liệu hình cầu 1 lần để tái sử dụng hiệu quả
  const sharedSphereData = buildSphereGeometryData(0.18);

  data.lines.forEach(line => {
    const { points, velocities } = line;
    if (points.length < 2) return;

    const positions = [], colors = [], indices = [];
    for (let i = 0; i < points.length; i++) {
      const [x, y, z] = points[i];
      const c = velocityToColor(velocities[i] ?? velocities[velocities.length - 1], maxV);
      positions.push(x, y - width / 2, z, x, y + width / 2, z);
      colors.push(...c, 1, ...c, 1);
    }
    for (let i = 0; i < points.length - 1; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      indices.push(a, c, b, b, c, d);
    }

    const mesh = new window.XeokitMesh(window.viewer.scene, {
      geometry: new window.XeokitReadableGeometry(window.viewer.scene, {
        primitive: "triangles", positions, indices, colors, normals: null
      }),
      material: new window.XeokitPhongMaterial(window.viewer.scene, {
        diffuse: [1, 1, 1], backfaces: true, emissive: [0.3, 0.3, 0.3]
      }),
      pickable: false, collidable: false
    });
    windStreamlineRibbons.push(mesh);

    for (let p = 0; p < 3; p++) {
      const particle = new window.XeokitMesh(window.viewer.scene, {
        geometry: new window.XeokitReadableGeometry(window.viewer.scene, sharedSphereData),
        material: new window.XeokitPhongMaterial(window.viewer.scene, { diffuse: [1, 1, 0.4], emissive: [0.6, 0.6, 0.2] }),
        position: points[0], pickable: false, collidable: false
      });
      windStreamlineParticles.push({ mesh: particle, points, offset: p / 3, speed: 0.15 });
    }
  });

  startWindStreamlineAnimation();
}

function buildSphereGeometryData(radius) {
  const positions = [], indices = [];
  const latBands = 8, longBands = 8;
  for (let lat = 0; lat <= latBands; lat++) {
    const theta = lat * Math.PI / latBands;
    for (let lon = 0; lon <= longBands; lon++) {
      const phi = lon * 2 * Math.PI / longBands;
      positions.push(
        radius * Math.sin(theta) * Math.cos(phi),
        radius * Math.cos(theta),
        radius * Math.sin(theta) * Math.sin(phi)
      );
    }
  }
  for (let lat = 0; lat < latBands; lat++) {
    for (let lon = 0; lon < longBands; lon++) {
      const first = lat * (longBands + 1) + lon;
      const second = first + longBands + 1;
      indices.push(first, second, first + 1, second, second + 1, first + 1);
    }
  }
  return { primitive: "triangles", positions, indices };
}

/* ---------------------------------------------------------------------
   4. ANIMATE HẠT & GIẢI PHÓNG BỘ NHỚ
   --------------------------------------------------------------------- */
function pointAtArcFraction(points, frac) {
  const n = points.length - 1;
  const pos = frac * n;
  const i0 = Math.floor(pos) % (n + 1);
  const i1 = (i0 + 1) % (n + 1);
  const t = pos - Math.floor(pos);
  const a = points[i0], b = points[i1];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function startWindStreamlineAnimation() {
  let t = 0;
  const step = () => {
    t += 0.004;
    windStreamlineParticles.forEach(p => {
      const frac = (t * p.speed * 10 + p.offset) % 1;
      p.mesh.position = pointAtArcFraction(p.points, frac);
    });
    windStreamlineRAF = requestAnimationFrame(step);
  };
  windStreamlineRAF = requestAnimationFrame(step);
}

function clearWindStreamlines() {
  if (windStreamlineRAF) { cancelAnimationFrame(windStreamlineRAF); windStreamlineRAF = null; }
  
  // Dọn dẹp triệt để geometry và material tránh memory leak WebGL
  windStreamlineRibbons.forEach(m => {
    if (m.geometry) m.geometry.destroy();
    if (m.material) m.material.destroy();
    m.destroy();
  });
  windStreamlineParticles.forEach(p => {
    if (p.mesh.geometry) p.mesh.geometry.destroy();
    if (p.mesh.material) p.mesh.material.destroy();
    p.mesh.destroy();
  });

  windStreamlineRibbons = [];
  windStreamlineParticles = [];
}

injectWindStreamlineBox();

/* ---------------------------------------------------------------------
   5. GỌI BACKEND PYTHON THẬT
   --------------------------------------------------------------------- */
async function runRealWindSimulation() {
  const statusEl = document.getElementById("windRealSimStatus");
  const btn = document.getElementById("windRealSimBtn");

  if (WIND_BACKEND_URL.includes("DIEN-URL-RENDER-CUA-CAU")) {
    alert("Chưa điền URL backend thật vào WIND_BACKEND_URL trong file cde-wind-streamlines.js.");
    return;
  }
  if (typeof multiSelectedIds === "undefined" || multiSelectedIds.size === 0) {
    alert("Bấm 'Chọn Nhiều' và chọn cấu kiện (công trình + khối lân cận) trước.");
    return;
  }
  if (!window.extractIdsMeshForGLB) { alert("Thiếu hàm đọc hình học (extractIdsMeshForGLB)."); return; }

  btn.disabled = true;
  try {
    statusEl.innerText = "⏳ Đang đọc hình học...";
    const { positions, indices } = await window.extractIdsMeshForGLB([...multiSelectedIds], (done, total) => {
      statusEl.innerText = `⏳ Đang đọc model ${done}/${total}...`;
    });
    if (!indices || indices.length === 0) throw new Error("Không đọc được tam giác nào (có thể thuộc model .xkt, chưa hỗ trợ).");

    statusEl.innerText = "⏳ Đang dựng file STL...";
    const stlBuffer = buildBinarySTLForWind(positions, indices);
    const stlBlob = new Blob([stlBuffer], { type: "model/stl" });

    const dirDeg = document.getElementById("windDirDeg") ? document.getElementById("windDirDeg").value : 0;

    const formData = new FormData();
    formData.append("stl", stlBlob, "model.stl");
    formData.append("dirDeg", dirDeg);
    formData.append("speed", "5");
    formData.append("resolution", "24");
    formData.append("iterations", "60");
    formData.append("seedCount", "5");

    statusEl.innerText = "⏳ Đang gửi lên backend, chờ khởi động (có thể mất 30-60s nếu server đang ngủ)...";
    const submitRes = await fetch(`${WIND_BACKEND_URL}/simulate`, { method: "POST", body: formData });
    if (!submitRes.ok) throw new Error("Gửi thất bại: HTTP " + submitRes.status);
    const { job_id } = await submitRes.json();

    // Vòng lặp Polling an toàn
    while (true) {
      await new Promise(r => setTimeout(r, 3000));
      const statusRes = await fetch(`${WIND_BACKEND_URL}/status/${job_id}`);
      if (!statusRes.ok) throw new Error(`Không thể lấy trạng thái job (HTTP ${statusRes.status})`);

      const statusData = await statusRes.json();
      if (statusData.error || statusData.status === "error") {
        throw new Error(statusData.error || "Lỗi tính toán từ server backend.");
      }

      const stageLabels = {
        queued: "Đang chờ...", 
        reading_stl: "Đang đọc STL...",
        voxelizing: "Đang chia lưới vật cản...", 
        solving: "Đang giải phương trình dòng chảy",
        tracing_streamlines: "Đang dò đường dòng...", 
        done: "Xong!"
      };

      let label = stageLabels[statusData.status] || statusData.status;
      if (statusData.status === "solving" && statusData.progress) {
        label += ` (${statusData.progress})`;
      }
      statusEl.innerText = "⏳ " + label;

      if (statusData.status === "done") {
        const resultRes = await fetch(`${WIND_BACKEND_URL}/result/${job_id}`);
        if (!resultRes.ok) throw new Error("Không thể tải file kết quả JSON.");
        
        const lines = await resultRes.json();
        windStreamlineData = { lines };
        renderWindStreamlines(windStreamlineData);
        statusEl.innerText = "✅ Đã có kết quả mô phỏng thật!";
        break;
      }
    }
  } catch (e) {
    statusEl.innerText = "";
    alert("Lỗi chạy mô phỏng thật: " + e.message);
  } finally {
    btn.disabled = false;
  }
}

function buildBinarySTLForWind(positions, indices) {
  const triCount = indices.length / 3;
  const buffer = new ArrayBuffer(84 + triCount * 50);
  const view = new DataView(buffer);
  view.setUint32(80, triCount, true);
  let offset = 84;
  for (let t = 0; t < triCount; t++) {
    const ia = indices[t * 3], ib = indices[t * 3 + 1], ic = indices[t * 3 + 2];
    const ax = positions[ia * 3], ay = positions[ia * 3 + 1], az = positions[ia * 3 + 2];
    const bx = positions[ib * 3], by = positions[ib * 3 + 1], bz = positions[ib * 3 + 2];
    const cx = positions[ic * 3], cy = positions[ic * 3 + 1], cz = positions[ic * 3 + 2];
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    nx /= len; ny /= len; nz /= len;
    view.setFloat32(offset, nx, true); view.setFloat32(offset + 4, ny, true); view.setFloat32(offset + 8, nz, true);
    view.setFloat32(offset + 12, ax, true); view.setFloat32(offset + 16, ay, true); view.setFloat32(offset + 20, az, true);
    view.setFloat32(offset + 24, bx, true); view.setFloat32(offset + 28, by, true); view.setFloat32(offset + 32, bz, true);
    view.setFloat32(offset + 36, cx, true); view.setFloat32(offset + 40, cy, true); view.setFloat32(offset + 44, cz, true);
    view.setUint16(offset + 48, 0, true);
    offset += 50;
  }
  return buffer;
}