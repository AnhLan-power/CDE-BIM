/* =====================================================================
   CDE WIND FLOW MODULE — Mô phỏng dòng chảy gió 2D đơn giản hoá
   (thuật toán "Stable Fluids" — Jos Stam, thường dùng mô phỏng khói/nước
   thời gian thực trong game)

   ⚠️ ĐÂY LÀ ƯỚC LƯỢNG MINH HOẠ, KHÔNG PHẢI CFD KỸ THUẬT THẬT:
   - Chỉ mô phỏng 1 LÁT CẮT NGANG duy nhất (1 độ cao cố định), không có
     dòng chảy theo phương đứng (gió giật từ mái, xoáy 3 chiều quanh góc).
   - Không có mô hình nhiễu loạn (turbulence) chuẩn, điều kiện biên đơn
     giản hoá, không hiệu chỉnh theo lớp biên khí quyển thật.
   - CHỈ dùng để so sánh tương đối giữa các khu vực/phương án thiết kế.
   - TUYỆT ĐỐI không dùng để chứng minh tuân thủ tiêu chuẩn an toàn/tiện
     nghi gió cho người đi bộ — việc đó cần phần mềm CFD chuyên dụng.
   ===================================================================== */

let windAreaPoints = [];
let windCalibrating = false;
let windSlices = []; // [{ analysisY, minX, minZ, maxX, maxZ, n, mag, solid, maxSpeed, freestream }, ...]
let windActiveSliceIdx = 0;

function injectWindUI() {
  const panel = document.createElement("div");
  panel.className = "panel";
  panel.id = "windPanel";
  panel.style.display = "none";
  panel.innerHTML = `
    <div class="panel-header">
      <b>🌬️ Mô Phỏng Gió (Ước Lượng Minh Hoạ)</b>
      <span style="cursor:pointer" onclick="document.getElementById('windPanel').style.display='none'">✕</span>
    </div>
    <div style="font-size:10px;color:#888;background:#fdecea;padding:6px 8px;border-radius:6px;margin-bottom:8px;">
      ⚠️ Mô phỏng NHIỀU LÁT CẮT NGANG 2D độc lập (mỗi độ cao tính riêng, không liên kết dòng chảy giữa các lát cắt) — vẫn KHÔNG PHẢI CFD 3D thật, chỉ giúp thấy xu hướng thay đổi theo chiều cao. Không dùng cho báo cáo tuân thủ tiêu chuẩn.
    </div>
    <div id="windAreaBox"></div>
    <div id="windParamsBox"></div>
    <div id="windResultBox"></div>
    <div id="windStlExportBox"></div>`;
  document.body.appendChild(panel);
}

function renderWindStlExportBox() {
  const box = document.getElementById("windStlExportBox");
  box.innerHTML = `
    <div class="cde-file-card">
      <div class="fname">📤 Cần mô phỏng 3D thật (có xoáy chính xác)?</div>
      <div class="meta">Xuất cấu kiện đã chọn ("Chọn Nhiều") ra file .stl, rồi tự tải lên SimScale (miễn phí, chạy CFD 3D thật trên trình duyệt).</div>
      <button class="btn" style="width:100%;margin-top:6px;" id="windExportStlBtn">📦 Xuất STL (cấu kiện đã chọn)</button>
      <button class="btn" style="width:100%;margin-top:6px;" id="windOpenSimScaleBtn">🔗 Mở SimScale để tải STL lên</button>
    </div>`;
  document.getElementById("windExportStlBtn").addEventListener("click", exportSelectedAsSTL);
  document.getElementById("windOpenSimScaleBtn").addEventListener("click", () => {
    window.open("https://www.simscale.com/app/dashboard/projects", "_blank");
  });

window.toggleWindPanel = function () {
  const p = document.getElementById("windPanel");
  const willShow = p.style.display !== "block";
  p.style.display = willShow ? "block" : "none";
  if (willShow) { renderWindAreaBox(); renderWindParamsBox(); renderWindResultBox(); renderWindStlExportBox(); }
};

/* ---------------------------------------------------------------------
   1. CHỌN VÙNG KHẢO SÁT (click 2 điểm góc trên mặt bằng)
   --------------------------------------------------------------------- */
function renderWindAreaBox() {
  const box = document.getElementById("windAreaBox");
  const hasArea = windAreaPoints.length === 2;
  box.innerHTML = `
    <div class="cde-file-card">
      <div class="fname">📐 Vùng khảo sát</div>
      <div class="meta">${hasArea ? "Đã chọn vùng khảo sát." : "Chưa chọn vùng."}</div>
      <button class="btn" style="width:100%;margin-top:6px;" id="windPickAreaBtn">🧭 Click 2 điểm góc để chọn vùng (mặt bằng/sân)</button>
      <div id="windAreaStatus" style="font-size:10px;color:#0275d8;margin-top:4px;"></div>
    </div>`;
  document.getElementById("windPickAreaBtn").addEventListener("click", startWindAreaPick);
}

function startWindAreaPick() {
  windAreaPoints = [];
  windCalibrating = true;
  const statusEl = document.getElementById("windAreaStatus");
  statusEl.innerText = "Click góc THỨ NHẤT của vùng khảo sát...";

  const canvas = viewer.scene.canvas.canvas;
  const handler = (e) => {
    const rect = canvas.getBoundingClientRect();
    const canvasPos = [e.clientX - rect.left, e.clientY - rect.top];
    const hit = viewer.scene.pick({ canvasPos, pickSurface: true });
    if (!hit || !hit.worldPos) { statusEl.innerText = "Không trúng bề mặt nào, click lại."; return; }

    windAreaPoints.push(hit.worldPos.slice());
    if (windAreaPoints.length === 1) {
      statusEl.innerText = "Click góc THỨ HAI (đường chéo đối diện)...";
    } else {
      canvas.removeEventListener("click", handler);
      windCalibrating = false;
      statusEl.innerText = "✅ Đã chọn xong vùng khảo sát.";
      renderWindAreaBox();
    }
  };
  canvas.addEventListener("click", handler);
}

/* ---------------------------------------------------------------------
   2. THAM SỐ MÔ PHỎNG
   --------------------------------------------------------------------- */
function renderWindParamsBox() {
  const box = document.getElementById("windParamsBox");
  box.innerHTML = `
    <div class="cde-file-card">
      <div class="fname">🌬️ Thông số gió</div>
      <label style="font-size:10px;color:#888;">Hướng gió thổi tới (độ, 0=từ hướng Bắc thổi tới, đo theo hướng Bắc đã hiệu chỉnh ở panel ☀️ Giờ Nắng)</label>
      <input type="number" id="windDirDeg" value="0" min="0" max="359">
      <div style="display:flex;gap:6px;">
        <div style="flex:1;">
          <label style="font-size:10px;color:#888;">Độ cao thấp nhất (m, so với điểm click)</label>
          <input type="number" id="windHeightMin" value="1.5" step="0.1">
        </div>
        <div style="flex:1;">
          <label style="font-size:10px;color:#888;">Độ cao cao nhất (m)</label>
          <input type="number" id="windHeightMax" value="10" step="0.5">
        </div>
      </div>
      <label style="font-size:10px;color:#888;">Số lát cắt theo độ cao (nhiều hơn = thấy rõ xu hướng theo chiều cao hơn nhưng chạy lâu hơn theo đúng số lần đó)</label>
      <input type="number" id="windSliceCount" min="1" max="8" value="3">
      <div style="display:flex;gap:6px;">
        <div style="flex:1;">
          <label style="font-size:10px;color:#888;">Độ phân giải lưới</label>
          <input type="number" id="windGridRes" min="20" max="100" value="50">
        </div>
        <div style="flex:1;">
          <label style="font-size:10px;color:#888;">Số vòng lặp mô phỏng</label>
          <input type="number" id="windIterations" min="30" max="400" value="150">
        </div>
      </div>
      <button class="btn btn-primary" style="width:100%;margin-top:6px;" id="windRunBtn">▶ Chạy mô phỏng</button>
    </div>`;
  document.getElementById("windRunBtn").addEventListener("click", runWindSimulation);
}

/* ---------------------------------------------------------------------
   3. XÁC ĐỊNH VẬT CẢN THEO LƯỚI (raycasting thẳng đứng)
   --------------------------------------------------------------------- */
async function buildObstacleGrid(minX, maxX, minZ, maxZ, analysisY, n) {
  const dx = (maxX - minX) / n, dz = (maxZ - minZ) / n;
  const solid = new Uint8Array((n + 1) * (n + 1));
  const rayFromY = analysisY + 1000;

  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const x = minX + i * dx, z = minZ + j * dz;
      const hit = viewer.scene.pick({ origin: [x, rayFromY, z], direction: [0, -1, 0], pickSurface: true });
      const idx = j * (n + 1) + i;
      solid[idx] = (hit && hit.worldPos && hit.worldPos[1] >= analysisY) ? 1 : 0;
    }
    if (j % 5 === 0) await new Promise(r => setTimeout(r, 0));
  }
  return solid;
}

/* ---------------------------------------------------------------------
   4. BỘ GIẢI DÒNG CHẢY "STABLE FLUIDS" (đơn giản hoá)
   --------------------------------------------------------------------- */
function runStableFluids(n, solid, windDirX, windDirZ, speed, iterations) {
  const size = (n + 1) * (n + 1);
  const IX = (i, j) => j * (n + 1) + i;

  let u = new Float32Array(size), w = new Float32Array(size);
  let u0 = new Float32Array(size), w0 = new Float32Array(size);
  const p = new Float32Array(size), div = new Float32Array(size);

  // Khởi tạo: gió tự do khắp nơi, trừ ô vật cản
  for (let idx = 0; idx < size; idx++) {
    if (!solid[idx]) { u[idx] = windDirX * speed; w[idx] = windDirZ * speed; }
  }

  const enforceBoundary = (uArr, wArr) => {
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        const idx = IX(i, j);
        if (solid[idx]) { uArr[idx] = 0; wArr[idx] = 0; continue; }
        // Biên đầu hướng gió thổi tới -> ép giữ đúng vận tốc tự do (inflow)
        const isInflowEdge =
          (windDirX > 0.3 && i === 0) || (windDirX < -0.3 && i === n) ||
          (windDirZ > 0.3 && j === 0) || (windDirZ < -0.3 && j === n);
        if (isInflowEdge) { uArr[idx] = windDirX * speed; wArr[idx] = windDirZ * speed; }
      }
    }
  };

  const project = () => {
    const h = 1 / n;
    for (let j = 1; j < n; j++) {
      for (let i = 1; i < n; i++) {
        const idx = IX(i, j);
        if (solid[idx]) { div[idx] = 0; p[idx] = 0; continue; }
        div[idx] = -0.5 * h * (u[IX(i + 1, j)] - u[IX(i - 1, j)] + w[IX(i, j + 1)] - w[IX(i, j - 1)]);
        p[idx] = 0;
      }
    }
    for (let iter = 0; iter < 20; iter++) {
      for (let j = 1; j < n; j++) {
        for (let i = 1; i < n; i++) {
          const idx = IX(i, j);
          if (solid[idx]) continue;
          p[idx] = (div[idx] + p[IX(i - 1, j)] + p[IX(i + 1, j)] + p[IX(i, j - 1)] + p[IX(i, j + 1)]) / 4;
        }
      }
    }
    for (let j = 1; j < n; j++) {
      for (let i = 1; i < n; i++) {
        const idx = IX(i, j);
        if (solid[idx]) continue;
        u[idx] -= 0.5 * (p[IX(i + 1, j)] - p[IX(i - 1, j)]) / h;
        w[idx] -= 0.5 * (p[IX(i, j + 1)] - p[IX(i, j - 1)]) / h;
      }
    }
  };

  const advect = (dst, src, uArr, wArr, dt) => {
    for (let j = 1; j < n; j++) {
      for (let i = 1; i < n; i++) {
        const idx = IX(i, j);
        if (solid[idx]) { dst[idx] = 0; continue; }
        let x = i - dt * n * uArr[idx];
        let y = j - dt * n * wArr[idx];
        x = Math.max(0.5, Math.min(n - 0.5, x));
        y = Math.max(0.5, Math.min(n - 0.5, y));
        const i0 = Math.floor(x), i1 = i0 + 1, j0 = Math.floor(y), j1 = j0 + 1;
        const sx1 = x - i0, sx0 = 1 - sx1, sy1 = y - j0, sy0 = 1 - sy1;
        dst[idx] = sx0 * (sy0 * src[IX(i0, j0)] + sy1 * src[IX(i0, j1)]) +
                   sx1 * (sy0 * src[IX(i1, j0)] + sy1 * src[IX(i1, j1)]);
      }
    }
  };

  const dt = 0.15;
  for (let step = 0; step < iterations; step++) {
    enforceBoundary(u, w);
    project();
    u0.set(u); w0.set(w);
    advect(u, u0, u0, w0, dt);
    advect(w, w0, u0, w0, dt);
    enforceBoundary(u, w);
  }

  const mag = new Float32Array(size);
  let maxSpeed = 0.001;
  for (let idx = 0; idx < size; idx++) {
    mag[idx] = solid[idx] ? 0 : Math.sqrt(u[idx] * u[idx] + w[idx] * w[idx]);
    if (!solid[idx] && mag[idx] > maxSpeed) maxSpeed = mag[idx];
  }
  return { mag, maxSpeed };
}

/* ---------------------------------------------------------------------
   5. CHẠY TOÀN BỘ + DỰNG LỚP PHỦ MÀU
   --------------------------------------------------------------------- */
async function runWindSimulation() {
  if (windAreaPoints.length !== 2) { alert("Chọn vùng khảo sát (2 điểm góc) trước."); return; }

  const btn = document.getElementById("windRunBtn");
  btn.disabled = true;

  const [p1, p2] = windAreaPoints;
  const minX = Math.min(p1[0], p2[0]), maxX = Math.max(p1[0], p2[0]);
  const minZ = Math.min(p1[2], p2[2]), maxZ = Math.max(p1[2], p2[2]);
  const baseY = (p1[1] + p2[1]) / 2;
  const heightMin = parseFloat(document.getElementById("windHeightMin").value) || 1.5;
  const heightMax = parseFloat(document.getElementById("windHeightMax").value) || 10;
  const sliceCount = Math.max(1, Math.min(8, parseInt(document.getElementById("windSliceCount").value) || 3));
  const n = Math.max(20, Math.min(100, parseInt(document.getElementById("windGridRes").value) || 50));
  const iterations = Math.max(30, Math.min(400, parseInt(document.getElementById("windIterations").value) || 150));
  const dirDeg = parseFloat(document.getElementById("windDirDeg").value) || 0;

  // Hướng Bắc đã hiệu chỉnh (dùng chung với panel Giờ Nắng) — mặc định Bắc = -Z nếu chưa hiệu chỉnh
  let northX = 0, northZ = -1;
  try {
    const { data } = await sb.from("projects").select("north_dir_x, north_dir_z").eq("id", activeProjectId).single();
    if (data) { northX = data.north_dir_x ?? 0; northZ = data.north_dir_z ?? -1; }
  } catch (e) { /* dùng mặc định nếu lỗi */ }

  const north = [northX, 0, northZ];
  const east = [north[2], 0, -north[0]];
  const rad = dirDeg * Math.PI / 180;
  const windDirX = north[0] * Math.cos(rad) + east[0] * Math.sin(rad);
  const windDirZ = north[2] * Math.cos(rad) + east[2] * Math.sin(rad);

  const heights = sliceCount === 1
    ? [heightMin]
    : Array.from({ length: sliceCount }, (_, k) => heightMin + (heightMax - heightMin) * (k / (sliceCount - 1)));

  windSlices = [];
  for (let s = 0; s < heights.length; s++) {
    const analysisY = baseY + heights[s];
    btn.innerText = `⏳ Lát cắt ${s + 1}/${heights.length}: dựng lưới vật cản...`;
    await new Promise(r => setTimeout(r, 0));
    const solid = await buildObstacleGrid(minX, maxX, minZ, maxZ, analysisY, n);

    btn.innerText = `⏳ Lát cắt ${s + 1}/${heights.length}: đang giải mô phỏng...`;
    await new Promise(r => setTimeout(r, 30));
    const { mag, maxSpeed } = runStableFluids(n, solid, windDirX, windDirZ, 5, iterations);

    windSlices.push({
      heightLabel: heights[s].toFixed(1),
      minX, minZ, maxX, maxZ, analysisY, n, mag, solid, maxSpeed, freestream: 5
    });
  }

  windActiveSliceIdx = 0;
  buildWindOverlay(windSlices[0]);
  renderWindResultBox();

  btn.disabled = false; btn.innerText = "▶ Chạy mô phỏng";
}

function windSpeedToColor(speed, freestream) {
  // So với gió tự do: xanh dương (êm/bị che) -> xanh lá (~bằng gió tự do) -> đỏ (tăng tốc, hiệu ứng Venturi)
  const ratio = speed / freestream; // 0 = êm hoàn toàn, 1 = bằng gió tự do, >1 = tăng tốc
  if (ratio < 1) {
    const t = Math.max(0, ratio);
    return [0.1 + t * 0.1, 0.2 + t * 0.6, 0.75 - t * 0.35, 0.8];
  } else {
    const t = Math.min(1, (ratio - 1) / 1); // ratio 1..2 -> 0..1
    return [0.2 + t * 0.8, 0.8 - t * 0.6, 0.2, 0.85];
  }
}

function buildWindOverlay(grid) {
  const { minX, minZ, maxX, maxZ, analysisY, n, mag, solid, freestream } = grid;
  const dx = (maxX - minX) / n, dz = (maxZ - minZ) / n;

  const positions = [];
  const colors = [];
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const idx = j * (n + 1) + i;
      positions.push(minX + i * dx, analysisY + 0.03, minZ + j * dz);
      const c = solid[idx] ? [0, 0, 0, 0] : windSpeedToColor(mag[idx], freestream);
      colors.push(...c);
    }
  }

  const indices = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i, b = a + 1, c = a + (n + 1), d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  window.renderWindOverlayMesh(positions, indices, colors);
}

function clearWindOverlay() {
  window.removeWindOverlayMesh();
  windSlices = [];
  renderWindResultBox();
}

function renderWindResultBox() {
  const box = document.getElementById("windResultBox");
  if (!windSlices || windSlices.length === 0) { box.innerHTML = ""; return; }

  const current = windSlices[windActiveSliceIdx];
  const sliderHtml = windSlices.length > 1 ? `
    <label style="font-size:10px;color:#888;">Chọn độ cao xem (${windSlices.length} lát cắt)</label>
    <input type="range" id="windSliceSlider" min="0" max="${windSlices.length - 1}" value="${windActiveSliceIdx}" style="width:100%;">
  ` : "";

  box.innerHTML = `
    <div class="cde-file-card">
      <div class="fname">📊 Kết quả mô phỏng</div>
      <div style="display:flex;gap:10px;font-size:10px;margin:6px 0;color:#666;">
        <span>🔵 Êm / bị che</span><span>🟢 ~Gió tự do</span><span>🔴 Tăng tốc (hiệu ứng Venturi)</span>
      </div>
      ${sliderHtml}
      <div class="meta" style="text-align:center;font-weight:700;margin-top:4px;" id="windCurrentHeightLabel">Độ cao: ${current.heightLabel} m (lưới ${current.n}×${current.n})</div>
      <button class="btn" style="width:100%;margin-top:6px;" id="windClearBtn">↺ Xoá lớp phủ</button>
    </div>`;

  if (windSlices.length > 1) {
    document.getElementById("windSliceSlider").addEventListener("input", (e) => {
      windActiveSliceIdx = parseInt(e.target.value);
      const slice = windSlices[windActiveSliceIdx];
      buildWindOverlay(slice);
      document.getElementById("windCurrentHeightLabel").innerText = `Độ cao: ${slice.heightLabel} m (lưới ${slice.n}×${slice.n})`;
    });
  }
  document.getElementById("windClearBtn").addEventListener("click", clearWindOverlay);
}

injectWindUI();

/* ---------------------------------------------------------------------
   6. XUẤT STL (cho SimScale hoặc phần mềm CFD 3D thật khác)
   Tái sử dụng window.extractIdsMeshForGLB() — hàm đọc hình học tam giác
   THẬT từ file .ifc gốc, đã được dùng sẵn cho tính năng AR. Chỉ hoạt
   động với cấu kiện thuộc model .ifc gốc (không hỗ trợ model .xkt "nâng
   cao" — đúng giới hạn app đã có từ trước với AR).
   --------------------------------------------------------------------- */
function buildBinarySTL(positions, indices) {
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

async function exportSelectedAsSTL() {
  if (typeof multiSelectedIds === "undefined" || multiSelectedIds.size === 0) {
    alert("Bấm 'Chọn Nhiều' trên thanh công cụ và chọn ít nhất 1 cấu kiện trước (nên chọn cả công trình + các khối lân cận muốn phân tích gió).");
    return;
  }
  if (!window.extractIdsMeshForGLB) { alert("Không tìm thấy chức năng đọc hình học (extractIdsMeshForGLB). Kiểm tra lại index.html."); return; }

  const btn = document.getElementById("windExportStlBtn");
  btn.disabled = true; btn.innerText = "⏳ Đang đọc hình học...";

  try {
    const { positions, indices, objectCount } = await window.extractIdsMeshForGLB(
      [...multiSelectedIds],
      (done, total) => { btn.innerText = `⏳ Đang đọc model ${done}/${total}...`; }
    );

    if (!indices || indices.length === 0) throw new Error("Không đọc được tam giác nào — có thể cấu kiện đã chọn thuộc model .xkt (nâng cao), chưa hỗ trợ xuất STL.");

    btn.innerText = "⏳ Đang dựng file STL...";
    await new Promise(r => setTimeout(r, 0));
    const buffer = buildBinarySTL(positions, indices);

    const blob = new Blob([buffer], { type: "model/stl" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `mohinh_${objectCount}cauKien_${new Date().toISOString().slice(0, 10)}.stl`;
    a.click();
    URL.revokeObjectURL(url);

    showToast ? showToast(`✅ Đã xuất STL (${objectCount} cấu kiện)`, "success") : alert("Đã xuất STL.");
  } catch (e) {
    alert("Lỗi xuất STL: " + e.message);
  } finally {
    btn.disabled = false; btn.innerText = "📦 Xuất STL (cấu kiện đã chọn)";
  }
}
