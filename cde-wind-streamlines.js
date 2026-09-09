/* =====================================================================
   CDE WIND STREAMLINES MODULE — Đường dòng gió động kiểu SimScale
   Gọi backend Python thật (xem WIND_BACKEND_URL bên dưới) để tính toán,
   rồi vẽ lại bằng xeokit dạng dải ruy băng tô màu theo vận tốc + hạt bay
   động dọc theo đường dòng.

   Cấu trúc dữ liệu JSON nhận từ backend:
   [
     { "id": 1, "points": [[x,y,z], ...], "velocities": [v0, v1, ...] },
     ...
   ]
   ===================================================================== */

// !!! ĐIỀN URL BACKEND PYTHON THẬT CỦA CẬU VÀO ĐÂY SAU KHI DEPLOY (Phần 3) !!!
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
    <div class="fname">🌊 Đường dòng gió động</div>
    <button class="btn" style="width:100%;margin-top:6px;background:#e8f5e9;" id="windRealSimBtn">🚀 Chạy mô phỏng THẬT (backend Python)</button>
    <div id="windRealSimStatus" style="font-size:10px;color:#0275d8;margin-top:4px;"></div>
    <button class="btn" style="width:100%;margin-top:6px;" id="windStreamlineLoadJsonBtn">📂 Tải file JSON đường dòng (thủ công)</button>
    <input type="file" id="windStreamlineFileInput" accept=".json" style="display:none;">
    <button class="btn" style="width:100%;margin-top:6px;" id="windStreamlineClearBtn">↺ Xoá đường dòng</button>`;
  panel.appendChild(box);

  document.getElementById("windRealSimBtn").addEventListener("click", runRealWindSimulation);
  document.getElementById("windStreamlineClearBtn").addEventListener("click", clearWindStreamlines);
  document.getElementById("windStreamlineLoadJsonBtn").addEventListener("click", () => {
    document.getElementById("windStreamlineFileInput").click();
  });
  document.getElementById("windStreamlineFileInput").addEventListener("change", handleStreamlineJsonUpload);
}

/* ---------------------------------------------------------------------
   2. TẢI FILE JSON THẬT (thủ công, nếu cậu có sẵn kết quả từ nguồn khác)
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
   3. DỰNG HÌNH: dải ruy băng tĩnh (đường đi) + hạt động (hiệu ứng chạy)
   --------------------------------------------------------------------- */
function velocityToColor(v, maxV) {
  const t = Math.min(1, Math.max(0, v / maxV));
  // xanh dương (chậm) -> xanh lá -> đỏ (nhanh), giống bảng màu SimScale
  if (t < 0.5) { const k = t / 0.5; return [0.1, 0.3 + k * 0.5, 0.9 - k * 0.4]; }
  const k = (t - 0.5) / 0.5;
  return [0.5 + k * 0.5, 0.8 - k * 0.7, 0.1];
}

function renderWindStreamlines(data) {
  clearWindStreamlines();
  if (!data || !data.lines || data.lines.length === 0) return;

  const maxV = Math.max(0.001, ...data.lines.flatMap(l => l.velocities));
  const width = 0.12; // độ dày ruy băng (m), cố định đơn giản hoá

  data.lines.forEach(line => {
    const { points, velocities } = line;
    if (points.length < 2) return;

    const positions = [], colors = [], normals = [], indices = [];
    for (let i = 0; i < points.length; i++) {
      const [x, y, z] = points[i];
      const c = velocityToColor(velocities[i] ?? velocities[velocities.length - 1], maxV);
      // 2 đỉnh mỗi điểm (trên/dưới) tạo dải ruy băng mỏng theo phương đứng —
      // đơn giản hoá, đủ để thấy hướng + màu, không phải ống tròn 3D thật.
      positions.push(x, y - width / 2, z, x, y + width / 2, z);
      colors.push(...c, 1, ...c, 1);
      // Pháp tuyến xấp xỉ hướng ngang (vuông góc hướng đi) để ruy băng nhận
      // sáng tốt từ nhiều góc nhìn — không cần chính xác tuyệt đối vì đây
      // là hình minh hoạ hướng dòng chảy, không phải hình học kỹ thuật.
      const next = points[Math.min(i + 1, points.length - 1)];
      const prev = points[Math.max(i - 1, 0)];
      const dx = next[0] - prev[0], dz = next[2] - prev[2];
      const len = Math.sqrt(dx * dx + dz * dz) || 1;
      const nx = -dz / len, nz = dx / len; // vuông góc hướng đi, nằm ngang
      normals.push(nx, 0, nz, nx, 0, nz);
    }
    for (let i = 0; i < points.length - 1; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      indices.push(a, c, b, b, c, d);
    }

    const mesh = new window.XeokitMesh(window.viewer.scene, {
      geometry: new window.XeokitReadableGeometry(window.viewer.scene, {
        primitive: "triangles", positions, indices, colors, normals
      }),
      material: new window.XeokitPhongMaterial(window.viewer.scene, {
        diffuse: [1, 1, 1], backfaces: true, emissive: [0.55, 0.55, 0.55], ambient: [1, 1, 1]
      }),
      pickable: false, collidable: false
    });
    windStreamlineRibbons.push(mesh);

    // 3 hạt nhỏ animate chạy dọc theo đường này, cách đều nhau lúc bắt đầu
    for (let p = 0; p < 3; p++) {
      const particle = new window.XeokitMesh(window.viewer.scene, {
        geometry: new window.XeokitReadableGeometry(window.viewer.scene, buildSphereGeometryData(0.18)),
        material: new window.XeokitPhongMaterial(window.viewer.scene, { diffuse: [1, 1, 0.4], emissive: [0.6, 0.6, 0.2] }),
        position: points[0], pickable: false, collidable: false
      });
      windStreamlineParticles.push({ mesh: particle, points, offset: p / 3, speed: 0.15 });
    }
  });

  startWindStreamlineAnimation();
}

// Dựng geometry hình cầu nhỏ đơn giản (dùng làm "hạt" animate)
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
   4. VÒNG LẶP ANIMATE HẠT CHẠY DỌC ĐƯỜNG DÒNG
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
  windStreamlineRibbons.forEach(m => m.destroy());
  windStreamlineParticles.forEach(p => p.mesh.destroy());
  windStreamlineRibbons = [];
  windStreamlineParticles = [];
}

injectWindStreamlineBox();

/* ---------------------------------------------------------------------
   5. GỌI BACKEND PYTHON THẬT (Bước 3)
   Dựng STL từ cấu kiện đã chọn (dùng lại logic đã có ở nút Xuất STL),
   gửi lên backend, poll trạng thái, tải kết quả JSON về hiển thị.
   --------------------------------------------------------------------- */
async function runRealWindSimulation() {
  const statusEl = document.getElementById("windRealSimStatus");
  const btn = document.getElementById("windRealSimBtn");

  if (WIND_BACKEND_URL.includes("DIEN-URL-RENDER-CUA-CAU")) {
    alert("Chưa điền URL backend thật vào WIND_BACKEND_URL trong file cde-wind-streamlines.js (xem hướng dẫn Phần 3-4).");
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
    const { positions, indices, dimensions } = await window.extractIdsMeshForGLB([...multiSelectedIds], (done, total) => {
      statusEl.innerText = `⏳ Đang đọc model ${done}/${total}...`;
    });
    if (!indices || indices.length === 0) throw new Error("Không đọc được tam giác nào (có thể thuộc model .xkt, chưa hỗ trợ).");

    // extractIdsMeshForGLB dịch toạ độ về gần (0,0,0) để tối ưu cho AR — lưu
    // lại đúng điểm tâm đã trừ đi để cộng ngược lại vào kết quả trả về từ
    // backend, nếu không đường dòng sẽ vẽ sai chỗ (rất xa mô hình thật).
    const worldOffset = (dimensions && dimensions.center) ? dimensions.center : [0, 0, 0];

    statusEl.innerText = "⏳ Đang dựng file STL...";
    const stlBuffer = buildBinarySTLForWind(positions, indices);
    const stlBlob = new Blob([stlBuffer], { type: "model/stl" });

    const dirDeg = document.getElementById("windDirDeg") ? document.getElementById("windDirDeg").value : 0;

    const formData = new FormData();
    formData.append("stl", stlBlob, "model.stl");
    formData.append("dirDeg", dirDeg);
    formData.append("speed", "5");
    formData.append("resolution", "32");
    formData.append("iterations", "60");
    formData.append("seedCount", "5");

    statusEl.innerText = "⏳ Đang gửi lên backend, chờ khởi động (có thể mất 30-60s nếu server đang ngủ)...";
    const submitRes = await fetch(`${WIND_BACKEND_URL}/simulate`, { method: "POST", body: formData });
    if (!submitRes.ok) throw new Error("Gửi thất bại: HTTP " + submitRes.status);
    const { job_id } = await submitRes.json();

    // Poll trạng thái mỗi 3 giây
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
        const lines = await resultRes.json();
        // Cộng lại đúng offset thế giới thật đã lưu ở trên
        lines.forEach(line => {
          line.points = line.points.map(p => [
            p[0] + worldOffset[0], p[1] + worldOffset[1], p[2] + worldOffset[2]
          ]);
        });
        windStreamlineData = { lines };
        renderWindStreamlines(windStreamlineData);
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
    view.setFloat32(offset + 36, cx, true); view.setFloat32(offset + 40, cy, true); view.setFloat32(offset + 44, cz, true);
    view.setUint16(offset + 48, 0, true);
    offset += 50;
  }
  return buffer;
}
