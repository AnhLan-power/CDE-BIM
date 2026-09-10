/* =====================================================================
   CDE WIND STREAMLINES MODULE — Khối 1: Khởi tạo UI bảo vệ an toàn
   ===================================================================== */

const WIND_BACKEND_URL = "https://wind-backend-yey0.onrender.com";

let windStreamlineRibbons = [];   
let windStreamlineParticles = []; 
let windStreamlineRAF = null;
let windStreamlineData = null;

function injectWindStreamlineBox() {
  // 1. Tự động dò tìm Panel dựa theo nội dung hiển thị trên ảnh của cậu
  let panel = document.getElementById("windPanel");
  
  if (!panel) {
    const allCards = document.querySelectorAll(".cde-file-card, div");
    for (let c of allCards) {
      if (c.innerHTML && (c.innerHTML.includes("Mô Phỏng Gió") || c.innerHTML.includes("Thông số gió"))) {
        panel = c;
        break;
      }
    }
  }
  
  // 2. Nếu cấu trúc web bị đóng băng, tự tạo menu nổi ở góc màn hình để cứu nút bấm
  if (!panel) {
    panel = document.createElement("div");
    panel.id = "windPanelFallback";
    panel.style = "position:absolute; top:120px; left:20px; z-index:9999; width:260px; background:#fff; padding:10px; border-radius:8px; box-shadow:0 2px 10px rgba(0,0,0,0.15);";
    document.body.appendChild(panel);
  }

  // Tránh tạo trùng lặp khi F5 hoặc nạp lại script
  if (document.getElementById("windStreamlineBox")) return;

  const box = document.createElement("div");
  box.className = "cde-file-card";
  box.id = "windStreamlineBox";
  box.style.marginTop = "15px";
  box.style.borderTop = "2px dashed #2ecc71";
  box.style.paddingTop = "10px";
  box.innerHTML = `
    <div class="fname" style="font-weight:bold; color:#2c3e50; margin-bottom:8px;">🌊 Đường dòng gió động</div>
    <button class="btn" style="width:100%;margin-top:6px;background:#e8f5e9;border:1px solid #2ecc71;color:#27ae60;font-weight:bold;cursor:pointer;padding:8px;border-radius:4px;" id="windRealSimBtn">🚀 Chạy mô phỏng THẬT (backend Python)</button>
    <div id="windRealSimStatus" style="font-size:11px;color:#0275d8;margin-top:4px;font-style:italic;"></div>
    <button class="btn" style="width:100%;margin-top:6px;cursor:pointer;padding:6px;border-radius:4px;" id="windStreamlineLoadJsonBtn">📂 Tải file JSON đường dòng (thủ công)</button>
    <input type="file" id="windStreamlineFileInput" accept=".json" style="display:none;">
    <button class="btn" style="width:100%;margin-top:6px;cursor:pointer;padding:6px;border-radius:4px;background:#fdf2f2;color:#ec5b5b;border:1px solid #f5c2c2;" id="windStreamlineClearBtn">↺ Xoá đường dòng</button>
    <div id="windLegendBarBox"></div>
    <div id="windConvergenceBox"></div>`;
  panel.appendChild(box);

  document.getElementById("windRealSimBtn").addEventListener("click", runRealWindSimulation);
  document.getElementById("windStreamlineClearBtn").addEventListener("click", clearWindStreamlines);
  document.getElementById("windStreamlineLoadJsonBtn").addEventListener("click", () => {
    document.getElementById("windStreamlineFileInput").click();
  });
  document.getElementById("windStreamlineFileInput").addEventListener("change", handleStreamlineJsonUpload);
}

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
function velocityToColor(v, maxV) {
  const t = Math.min(1, Math.max(0, v / maxV));
  const r = Math.max(0, Math.min(1, 1.5 - Math.abs(4 * t - 3)));
  const g = Math.max(0, Math.min(1, 1.5 - Math.abs(4 * t - 2)));
  const b = Math.max(0, Math.min(1, 1.5 - Math.abs(4 * t - 1)));
  return [r, g, b];
}

function renderWindStreamlines(data) {
  clearWindStreamlines();
  if (!data || !data.lines || data.lines.length === 0) return;

  const maxV = Math.max(0.001, ...data.lines.flatMap(l => l.velocities));
  const width = 0.35; 

  renderVelocityLegendBar(maxV);

  data.lines.forEach(line => {
    const { points, velocities } = line;
    if (points.length < 2) return;

    const positions = [], colors = [], normals = [], indices = [];
    for (let i = 0; i < points.length; i++) {
      const [x, y, z] = points[i];
      const vVal = velocities[i] !== undefined ? velocities[i] : velocities[velocities.length - 1];
      const c = velocityToColor(vVal, maxV);
      
      positions.push(x, y - width / 2, z, x, y + width / 2, z);
      colors.push(c[0], c[1], c[2], 1, c[0], c[1], c[2], 1);

      const next = points[Math.min(i + 1, points.length - 1)];
      const prev = points[Math.max(i - 1, 0)];
      const dx = next[0] - prev[0], dz = next[2] - prev[2];
      const len = Math.sqrt(dx * dx + dz * dz) || 1;
      const nx = -dz / len, nz = dx / len; 
      normals.push(nx, 0, nz, nx, 0, nz);
    }
    for (let i = 0; i < points.length - 1; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      indices.push(a, c, b, b, c, d);
    }

    const mesh = new window.XeokitMesh(window.viewer.scene, {
      geometry: new window.XeokitReadableGeometry(window.viewer.scene, {
        primitive: "triangles", positions: positions, indices: indices, colors: colors, normals: normals
      }),
      material: new window.XeokitPhongMaterial(window.viewer.scene, {
        diffuse:, backfaces: true, emissive: [0.15, 0.15, 0.15], ambient: [0.35, 0.35, 0.35]
      }),
      pickable: false, collidable: false
    });
    windStreamlineRibbons.push(mesh);

    for (let p = 0; p < 3; p++) {
      const particle = new window.XeokitMesh(window.viewer.scene, {
        geometry: new window.XeokitReadableGeometry(window.viewer.scene, buildSphereGeometryData(0.18)),
        material: new window.XeokitPhongMaterial(window.viewer.scene, { diffuse: [1, 1, 0.4], emissive: [0.6, 0.6, 0.2] }),
        position: points[0], pickable: false, collidable: false
      });
      windStreamlineParticles.push({ mesh: particle, points: points, offset: p / 3, speed: 0.15 });
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
  return { primitive: "triangles", positions: positions, indices: indices };
}
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
  windStreamlineRibbons.forEach(m => m.destroy());
  windStreamlineParticles.forEach(p => p.mesh.destroy());
  windStreamlineRibbons = [];
  windStreamlineParticles = [];
  const lb = document.getElementById("windLegendBarBox");
  if (lb) lb.innerHTML = "";
}

function renderVelocityLegendBar(maxV) {
  const box = document.getElementById("windLegendBarBox");
  if (!box) return;
  box.innerHTML = `
    <div class="cde-file-card" style="margin-top:8px; padding:8px; background:#fff; border:1px solid #e0e0e0;">
      <div style="font-size:11px;font-weight:bold;margin-bottom:4px;">📊 Thang vận tốc gió (Velocity Magnitude - m/s)</div>
      <div style="display:flex;align-items:center;height:14px;background:linear-gradient(to right, #00008f, #0000ff, #00ffff, #ffff00, #ff0000, #800000);border-radius:3px;"></div>
      <div style="display:flex;justify-content:space-between;font-size:9px;color:#555;margin-top:2px;">
        <span>0.00</span>
        <span>${(maxV * 0.25).toFixed(2)}</span>
        <span>${(maxV * 0.5).toFixed(2)}</span>
        <span>${(maxV * 0.75).toFixed(2)}</span>
        <span>${maxV.toFixed(2)}</span>
      </div>
    </div>`;
}

function renderConvergenceChart(residuals) {
  const box = document.getElementById("windConvergenceBox");
  if (!box || !residuals || residuals.length === 0) { if (box) box.innerHTML = ""; return; }

  box.innerHTML = `
    <div class="cde-file-card" style="margin-top:8px; background:#fff; border:1px solid #e0e0e0; padding:8px;">
      <div class="fname" style="font-weight:bold; font-size:11px;">📉 Biểu đồ hội tụ (Residual Convergence)</div>
      <div class="meta" style="margin-bottom:4px; font-size:10px; color:#666;">Hội tụ đa thành phần chuẩn solver CFD thương mại.</div>
      <div style="display:flex; gap:12px; font-size:9px; font-weight:bold; margin-bottom:6px;">
        <span style="color:#e67e22;">── u (trục X)</span>
        <span style="color:#2ecc71;">── v (trục Y)</span>
        <span style="color:#3498db;">── w (trục Z)</span>
      </div>
      <canvas id="windConvergenceCanvas" width="330" height="160" style="width:100%;background:#fff;border-radius:6px; border:1px solid #f0f0f0;"></canvas>
    </div>`;

  const canvas = document.getElementById("windConvergenceCanvas");
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  const padL = 42, padB = 18, padT = 12, padR = 8;

  const maxLog = 0;   
  const minLog = -4;  
  const range = maxLog - minLog;

  const isMultiComponent = Array.isArray(residuals);

  const logLines = { u: [], v: [], w: [] };
  residuals.forEach(r => {
    if (isMultiComponent && r.length === 3) {
      logLines.u.push(Math.min(maxLog, Math.max(minLog, Math.log10(Math.max(r[0], 1e-8)))));
      logLines.v.push(Math.min(maxLog, Math.max(minLog, Math.log10(Math.max(r[1], 1e-8)))));
      logLines.w.push(Math.min(maxLog, Math.max(minLog, Math.log10(Math.max(r[2], 1e-8)))));
    } else {
      const val = Math.min(maxLog, Math.max(minLog, Math.log10(Math.max(r, 1e-8))));
      logLines.u.push(val); logLines.v.push(val); logLines.w.push(val);
    }
  });

  ctx.clearRect(0, 0, W, H);
  ctx.strokeStyle = "#ddd"; ctx.fillStyle = "#999"; ctx.font = "9px sans-serif";
  ctx.beginPath(); ctx.moveTo(padL, padT); ctx.lineTo(padL, H - padB); ctx.lineTo(W - padR, H - padB); ctx.stroke();

  [0, -1, -2, -3, -4].forEach(power => {
    const f = (maxLog - power) / range;
    const y = padT + f * (H - padT - padB);
    ctx.fillText(Math.pow(10, power).toExponential(1), 2, y + 3);
    ctx.strokeStyle = "#f0f0f0"; ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
  });

  function drawComponentLine(logVals, color) {
    if (logVals.length === 0) return;
    ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.beginPath();
    logVals.forEach((lv, i) => {
      const x = padL + (i / (logVals.length - 1 || 1)) * (W - padL - padR);
      const y = padT + ((maxLog - lv) / range) * (H - padT - padB);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  drawComponentLine(logLines.u, "#e67e22"); 
  drawComponentLine(logLines.v, "#2ecc71"); 
  drawComponentLine(logLines.w, "#3498db"); 

  ctx.fillStyle = "#666"; ctx.fillText("Vòng lặp →", W - 50, H - 4);
}

async function runRealWindSimulation() {
  const statusEl = document.getElementById("windRealSimStatus");
  const btn = document.getElementById("windRealSimBtn");

  if (WIND_BACKEND_URL.includes("DIEN-URL-RENDER-CUA-CAU")) {
    alert("Chưa điền URL backend.");
    return;
  }
  if (typeof multiSelectedIds === "undefined" || multiSelectedIds.size === 0) {
    alert("Bấm 'Chọn Nhiều' và chọn cấu kiện trước.");
    return;
  }
  if (!window.extractIdsMeshForGLB) { alert("Thiếu hàm đọc hình học."); return; }

  btn.disabled = true;
  try {
    statusEl.innerText = "⏳ Đang đọc hình học...";
    const { positions, indices, dimensions } = await window.extractIdsMeshForGLB([...multiSelectedIds], (done, total) => {
      statusEl.innerText = `⏳ Đang đọc model ${done}/${total}...`;
    });
    if (!indices || indices.length === 0) throw new Error("Không đọc được tam giác nào.");

    const worldOffset = (dimensions && dimensions.center) ? dimensions.center :;

    statusEl.innerText = "⏳ Đang dựng file STL...";
    const stlBuffer = buildBinarySTLForWind(positions, indices);
    const stlBlob = new Blob([stlBuffer], { type: "model/stl" });

    const dirDeg = document.getElementById("windDirDeg") ? document.getElementById("windDirDeg").value : 0;

    const formData = new FormData();
    formData.append("stl", stlBlob, "model.stl");
    formData.append("dirDeg", dirDeg);
    formData.append("speed", "5");
    formData.append("resolution", "36");
    formData.append("iterations", "90");
    formData.append("seedCount", "14");

    statusEl.innerText = "⏳ Đang gửi lên backend, chờ khởi động...";
    const submitRes = await fetch(`${WIND_BACKEND_URL}/simulate`, { method: "POST", body: formData });
    if (!submitRes.ok) throw new Error("Gửi thất bại: HTTP " + submitRes.status);
    const { job_id } = await submitRes.json();

    while (true) {
      await new Promise(r => setTimeout(r, 3000));
      const statusRes = await fetch(`${WIND_BACKEND_URL}/status/${job_id}`);
      const statusData = await statusRes.json();
      if (statusData.error) throw new Error(statusData.error);

      const stageLabels = {
        queued: "Đang chờ...", reading_stl: "Đang đọc STL...",
        voxelizing: "Đang chia lưới vật cản...", solving: "Đang giải phương trình dòng chảy",
        tracing_streamlines: "Đang dò đường dòng...", done: "Xong!"
      };
      let label = stageLabels[statusData.status] || statusData.status;
      if (statusData.status === "solving" && statusData.progress) label += ` (${statusData.progress})`;
      statusEl.innerText = "⏳ " + label;

      if (statusData.status === "done") {
        const resultRes = await fetch(`${WIND_BACKEND_URL}/result/${job_id}`);
        const data = await resultRes.json();
        const lines = data.lines || [];
        lines.forEach(line => {
          line.points = line.points.map(p => [
            p[0] + worldOffset[0], p[1] + worldOffset[1], p[2] + worldOffset[2]
          ]);
        });
        windStreamlineData = { lines };
        renderWindStreamlines(windStreamlineData);
        renderConvergenceChart(data.residuals || []);
        statusEl.innerText = "✅ Đã có kết quả mô phỏng thật!";
        break;
      }
      if (statusData.status === "error") throw new Error("Lỗi tính toán ở backend.");
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
    view.setFloat32(offset + 36, cx, true); view.setFloat32(offset + 40, cy, true);
    view.setFloat32(offset + 44, cz, true);
    view.setUint16(offset + 48, 0, true);
    offset += 50;
    }
    return buffer;
    }

    // Gọi hàm tiêm UI chạy tự động
    injectWindStreamlineBox();