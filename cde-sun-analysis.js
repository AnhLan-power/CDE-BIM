/* =====================================================================
   CDE SUN ANALYSIS MODULE — Phân tích số giờ nắng (Sun Hours)
   Yêu cầu: chạy SAU cde-auth.js (dùng chung sb, activeProjectId,
   activeRole, currentUser) và sau khi index.html đã export window.viewer,
   window.multiSelectedIds, window.showToast từ module chính.

   ⚠️ ĐÂY LÀ ƯỚC TÍNH GẦN ĐÚNG, không phải mô phỏng quang học chuyên dụng:
   - Vị trí mặt trời tính theo công thức thiên văn đơn giản hoá (chưa hiệu
     chỉnh phương trình thời gian / múi giờ chính xác tới từng phút).
   - Mỗi cấu kiện chỉ lấy 1 điểm mẫu (tâm mặt trên của khối bao), không
     phải lưới nhiều điểm như phần mềm chuyên dụng — phù hợp nhất cho các
     mặt tương đối nằm ngang (mái, sân, mặt bằng), kém chính xác hơn với
     mặt đứng (tường, mặt dựng).
   ===================================================================== */

let sunCalibrating = false;
let sunCalibrationPoints = [];
let sunLastResults = []; // [{ id, name, hours }]

/* ---------------------------------------------------------------------
   1. GIAO DIỆN
   --------------------------------------------------------------------- */
function injectSunAnalysisUI() {
  const panel = document.createElement("div");
  panel.className = "panel";
  panel.id = "sunAnalysisPanel";
  panel.style.display = "none";
  panel.innerHTML = `
    <div class="panel-header">
      <b>☀️ Phân Tích Giờ Nắng</b>
      <span style="cursor:pointer" onclick="document.getElementById('sunAnalysisPanel').style.display='none'">✕</span>
    </div>
    <div id="sunNoProjectMsg" style="color:#999;padding:8px 0;">Vào panel 📁 CDE, chọn dự án trước đã.</div>
    <div id="sunContent" style="display:none;">
      <div style="font-size:10px;color:#888;background:#fff8e1;padding:6px 8px;border-radius:6px;margin-bottom:8px;">
        ⚠️ Ước tính gần đúng (1 điểm mẫu/cấu kiện, công thức thiên văn đơn giản hoá) — không thay thế phần mềm phân tích ánh sáng chuyên dụng.
      </div>
      <div id="sunLocationBox"></div>
      <div id="sunParamsBox"></div>
      <div id="sunResultsBox"></div>
    </div>`;
  document.body.appendChild(panel);
}

window.toggleSunAnalysisPanel = function () {
  const p = document.getElementById("sunAnalysisPanel");
  const willShow = p.style.display !== "block";
  p.style.display = willShow ? "block" : "none";
  if (willShow) refreshSunPanel();
};

async function refreshSunPanel() {
  if (!activeProjectId) {
    document.getElementById("sunNoProjectMsg").style.display = "block";
    document.getElementById("sunContent").style.display = "none";
    return;
  }
  document.getElementById("sunNoProjectMsg").style.display = "none";
  document.getElementById("sunContent").style.display = "block";

  const { data: project, error } = await sb
    .from("projects")
    .select("latitude, longitude, north_dir_x, north_dir_z")
    .eq("id", activeProjectId)
    .single();
  if (error) { alert("Lỗi tải thông tin dự án: " + error.message); return; }

  renderLocationBox(project || {});
  renderParamsBox();
  renderResultsBox();
}

function canEditSunSettings() {
  return activeRole === "bim_manager";
}

/* ---------------------------------------------------------------------
   2. VỊ TRÍ DỰ ÁN + HIỆU CHỈNH HƯỚNG BẮC
   --------------------------------------------------------------------- */
function renderLocationBox(project) {
  const box = document.getElementById("sunLocationBox");
  const lat = project.latitude ?? "";
  const lng = project.longitude ?? "";
  const nx = project.north_dir_x ?? 0;
  const nz = project.north_dir_z ?? -1;
  const hasNorth = !(nx === 0 && nz === -1 && project.north_dir_x == null);

  box.innerHTML = `
    <div class="cde-file-card">
      <div class="fname">📍 Vị trí & hướng Bắc dự án</div>
      ${canEditSunSettings() ? `
        <div style="display:flex;gap:6px;margin-top:6px;">
          <input type="number" step="0.0001" id="sunLat" placeholder="Vĩ độ, vd 21.03" value="${lat}" style="flex:1;">
          <input type="number" step="0.0001" id="sunLng" placeholder="Kinh độ, vd 105.85" value="${lng}" style="flex:1;">
        </div>
        <button class="btn" style="width:100%;margin-top:6px;" id="sunSaveLocation">💾 Lưu vị trí</button>
        <div class="meta" style="margin-top:8px;">Hướng Bắc hiện tại: vector (${nx.toFixed?.(2) ?? nx}, ${nz.toFixed?.(2) ?? nz}) trên mặt bằng</div>
        <button class="btn" style="width:100%;margin-top:4px;" id="sunCalibrateBtn">🧭 Hiệu chỉnh hướng Bắc (click 2 điểm trên mô hình)</button>
        <div id="sunCalibrateStatus" style="font-size:10px;color:#0275d8;margin-top:4px;"></div>
      ` : `<div class="meta">Vĩ độ ${lat || "?"}, Kinh độ ${lng || "?"} — chỉ BIM Manager sửa được.</div>`}
    </div>`;

  if (canEditSunSettings()) {
    document.getElementById("sunSaveLocation").addEventListener("click", saveSunLocation);
    document.getElementById("sunCalibrateBtn").addEventListener("click", startNorthCalibration);
  }
}

async function saveSunLocation() {
  const lat = parseFloat(document.getElementById("sunLat").value);
  const lng = parseFloat(document.getElementById("sunLng").value);
  if (isNaN(lat) || isNaN(lng)) { alert("Nhập đủ vĩ độ và kinh độ."); return; }

  const { error } = await sb.from("projects").update({ latitude: lat, longitude: lng }).eq("id", activeProjectId);
  if (error) { alert("Lỗi lưu: " + error.message); return; }
  showToast ? showToast("✅ Đã lưu vị trí dự án", "success") : alert("Đã lưu.");
}

// Hiệu chỉnh hướng Bắc: người dùng click 2 điểm trên mô hình theo đúng
// hướng mũi tên Bắc trên bản vẽ mặt bằng (điểm 1 = gốc, điểm 2 = hướng Bắc).
function startNorthCalibration() {
  sunCalibrating = true;
  sunCalibrationPoints = [];
  const statusEl = document.getElementById("sunCalibrateStatus");
  statusEl.innerText = "Click điểm THỨ NHẤT trên mô hình (điểm gốc)...";

  const canvas = viewer.scene.canvas.canvas;
  const handler = (e) => {
    const rect = canvas.getBoundingClientRect();
    const canvasPos = [e.clientX - rect.left, e.clientY - rect.top];
    const hit = viewer.scene.pick({ canvasPos, pickSurface: true });
    if (!hit || !hit.worldPos) { statusEl.innerText = "Không trúng bề mặt nào, thử click lại."; return; }

    sunCalibrationPoints.push(hit.worldPos.slice());

    if (sunCalibrationPoints.length === 1) {
      statusEl.innerText = "Click điểm THỨ HAI theo đúng hướng Bắc...";
    } else {
      canvas.removeEventListener("click", handler);
      sunCalibrating = false;
      finishNorthCalibration(sunCalibrationPoints[0], sunCalibrationPoints[1]);
    }
  };
  canvas.addEventListener("click", handler);
}

async function finishNorthCalibration(p1, p2) {
  let dx = p2[0] - p1[0];
  let dz = p2[2] - p1[2];
  const len = Math.sqrt(dx * dx + dz * dz);
  if (len < 0.001) { alert("2 điểm quá gần nhau, hiệu chỉnh thất bại. Thử lại."); return; }
  dx /= len; dz /= len;

  const { error } = await sb.from("projects").update({ north_dir_x: dx, north_dir_z: dz }).eq("id", activeProjectId);
  if (error) { alert("Lỗi lưu hướng Bắc: " + error.message); return; }

  document.getElementById("sunCalibrateStatus").innerText = "✅ Đã lưu hướng Bắc mới.";
  await refreshSunPanel();
}

/* ---------------------------------------------------------------------
   3. THAM SỐ PHÂN TÍCH + CHẠY
   --------------------------------------------------------------------- */
function renderParamsBox() {
  const box = document.getElementById("sunParamsBox");
  const today = new Date().toISOString().slice(0, 10);
  box.innerHTML = `
    <div class="cde-file-card">
      <div class="fname">☀️ Thông số phân tích</div>
      <input type="date" id="sunDate" value="${today}">
      <div style="display:flex;gap:6px;margin:4px 0;">
        <div style="flex:1;">
          <label style="font-size:10px;color:#888;">Giờ bắt đầu</label>
          <input type="number" id="sunStartHour" min="0" max="23" value="7">
        </div>
        <div style="flex:1;">
          <label style="font-size:10px;color:#888;">Giờ kết thúc</label>
          <input type="number" id="sunEndHour" min="0" max="23" value="18">
        </div>
        <div style="flex:1;">
          <label style="font-size:10px;color:#888;">Bước (phút)</label>
          <input type="number" id="sunStepMin" min="5" max="120" value="30">
        </div>
      </div>
      <button class="btn btn-primary" style="width:100%;margin-top:6px;" id="sunRunBtn">▶ Phân tích cấu kiện đã chọn</button>
      <div style="font-size:10px;color:#888;margin-top:4px;">Dùng nút "Chọn Nhiều" trên thanh công cụ để chọn cấu kiện (mái, sân, mặt bằng...) trước khi bấm.</div>
    </div>`;
  document.getElementById("sunRunBtn").addEventListener("click", runSunAnalysis);
}

/* ---------------------------------------------------------------------
   4. TÍNH VỊ TRÍ MẶT TRỜI (công thức thiên văn đơn giản hoá)
   --------------------------------------------------------------------- */
function getDayOfYear(date) {
  const start = new Date(date.getFullYear(), 0, 0);
  return Math.floor((date - start) / 86400000);
}

// Trả về { altitudeRad, azimuthRad } — azimuth đo theo chiều kim đồng hồ
// tính từ hướng Bắc (0=Bắc, 90=Đông, 180=Nam, 270=Tây)
function getSunPosition(date, latDeg, lngDeg) {
  const rad = Math.PI / 180;
  const dayOfYear = getDayOfYear(date);
  const declDeg = 23.45 * Math.sin(rad * 360 / 365 * (284 + dayOfYear));
  const hourDecimal = date.getHours() + date.getMinutes() / 60;
  const hourAngleDeg = 15 * (hourDecimal - 12); // xấp xỉ, chưa hiệu chỉnh equation of time/kinh tuyến múi giờ

  const latRad = latDeg * rad, declRad = declDeg * rad, haRad = hourAngleDeg * rad;

  const sinAlt = Math.sin(latRad) * Math.sin(declRad) + Math.cos(latRad) * Math.cos(declRad) * Math.cos(haRad);
  const altitudeRad = Math.asin(Math.min(1, Math.max(-1, sinAlt)));

  const cosAz = (Math.sin(declRad) - Math.sin(latRad) * Math.sin(altitudeRad)) / (Math.cos(latRad) * Math.cos(altitudeRad));
  let azimuthRad = Math.acos(Math.min(1, Math.max(-1, cosAz)));
  if (hourAngleDeg > 0) azimuthRad = 2 * Math.PI - azimuthRad;

  return { altitudeRad, azimuthRad };
}

// Chuyển altitude/azimuth mặt trời + hướng Bắc đã hiệu chỉnh thành vector
// hướng 3D trong hệ toạ độ Y-up của viewer.
function sunDirectionVector(altitudeRad, azimuthRad, northDir) {
  const north = [northDir.x, 0, northDir.z];
  const east = [north[2], 0, -north[0]]; // vuông góc với north trên mặt phẳng XZ (quay 90° theo chiều kim đồng hồ nhìn từ trên xuống)

  const cosAz = Math.cos(azimuthRad), sinAz = Math.sin(azimuthRad);
  const cosAlt = Math.cos(altitudeRad), sinAlt = Math.sin(altitudeRad);

  const horiz = [
    north[0] * cosAz + east[0] * sinAz,
    0,
    north[2] * cosAz + east[2] * sinAz
  ];
  return [horiz[0] * cosAlt, sinAlt, horiz[2] * cosAlt];
}

/* ---------------------------------------------------------------------
   5. CHẠY PHÂN TÍCH TRÊN CẤU KIỆN ĐÃ CHỌN
   --------------------------------------------------------------------- */
async function runSunAnalysis() {
  if (typeof multiSelectedIds === "undefined" || multiSelectedIds.size === 0) {
    alert("Bấm 'Chọn Nhiều' trên thanh công cụ và chọn ít nhất 1 cấu kiện trước.");
    return;
  }

  const { data: project } = await sb
    .from("projects")
    .select("latitude, longitude, north_dir_x, north_dir_z")
    .eq("id", activeProjectId)
    .single();

  if (!project || project.latitude == null || project.longitude == null) {
    alert("Chưa có vĩ độ/kinh độ dự án. Điền và Lưu vị trí trước.");
    return;
  }
  const northDir = { x: project.north_dir_x ?? 0, z: project.north_dir_z ?? -1 };

  const dateStr = document.getElementById("sunDate").value;
  const startHour = parseInt(document.getElementById("sunStartHour").value);
  const endHour = parseInt(document.getElementById("sunEndHour").value);
  const stepMin = parseInt(document.getElementById("sunStepMin").value);
  if (!dateStr || isNaN(startHour) || isNaN(endHour) || isNaN(stepMin) || stepMin < 1) {
    alert("Điền đủ ngày, giờ bắt đầu/kết thúc, bước thời gian."); return;
  }

  const btn = document.getElementById("sunRunBtn");
  btn.disabled = true; btn.innerText = "⏳ Đang phân tích...";

  const ids = [...multiSelectedIds];
  const results = [];

  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const entity = viewer.scene.objects[id];
    if (!entity || !entity.aabb) continue;

    const aabb = entity.aabb;
    const point = [(aabb[0] + aabb[3]) / 2, aabb[4] + 0.05, (aabb[2] + aabb[5]) / 2];

    let sunlitSteps = 0, totalSteps = 0;
    for (let h = startHour; h <= endHour; h += stepMin / 60) {
      const d = new Date(dateStr + "T00:00:00");
      d.setHours(Math.floor(h), Math.round((h % 1) * 60), 0, 0);

      const { altitudeRad, azimuthRad } = getSunPosition(d, project.latitude, project.longitude);
      if (altitudeRad <= 0) continue; // mặt trời dưới đường chân trời
      totalSteps++;

      const dir = sunDirectionVector(altitudeRad, azimuthRad, northDir);
      const hit = viewer.scene.pick({ origin: point, direction: dir, pickSurface: true });
      if (!hit) sunlitSteps++; // không trúng gì -> không bị che, có nắng
    }

    const hours = sunlitSteps * (stepMin / 60);
    results.push({ id, name: entity.name || id, hours });

    if (i % 5 === 0) await new Promise(r => setTimeout(r, 0)); // nhường luồng UI, tránh đứng hình
  }

  sunLastResults = results;
  applySunColorization(results);
  renderResultsBox();

  btn.disabled = false; btn.innerText = "▶ Phân tích cấu kiện đã chọn";
}

/* ---------------------------------------------------------------------
   6. TÔ MÀU KẾT QUẢ + BẢNG DANH SÁCH
   --------------------------------------------------------------------- */
function hoursToColor(hours, maxHours) {
  const t = maxHours > 0 ? Math.min(1, hours / maxHours) : 0;
  // Gradient: xanh dương (ít nắng) -> vàng -> đỏ cam (nhiều nắng)
  if (t < 0.5) {
    const k = t / 0.5;
    return [0.15 + k * 0.85, 0.25 + k * 0.6, 0.75 - k * 0.65];
  } else {
    const k = (t - 0.5) / 0.5;
    return [1.0, 0.85 - k * 0.55, 0.1];
  }
}

function applySunColorization(results) {
  const maxHours = Math.max(0.001, ...results.map(r => r.hours));
  results.forEach(r => {
    const e = viewer.scene.objects[r.id];
    if (e) e.colorize = hoursToColor(r.hours, maxHours);
  });
}

function clearSunColorization() {
  sunLastResults.forEach(r => {
    const e = viewer.scene.objects[r.id];
    if (e) e.colorize = null;
  });
  sunLastResults = [];
  renderResultsBox();
}

function renderResultsBox() {
  const box = document.getElementById("sunResultsBox");
  if (!sunLastResults || sunLastResults.length === 0) { box.innerHTML = ""; return; }

  const rows = sunLastResults
    .slice()
    .sort((a, b) => b.hours - a.hours)
    .map(r => `<div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid #f0f0f0;">
      <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:230px;">${r.name}</span>
      <b>${r.hours.toFixed(1)} h</b>
    </div>`).join("");

  box.innerHTML = `
    <div class="cde-file-card">
      <div class="fname">📊 Kết quả (${sunLastResults.length} cấu kiện)</div>
      <div style="display:flex;gap:10px;font-size:10px;margin:6px 0;color:#666;">
        <span>🔵 Ít nắng</span><span>🟡 Trung bình</span><span>🔴 Nhiều nắng</span>
      </div>
      <div style="max-height:180px;overflow-y:auto;font-size:11px;">${rows}</div>
      <button class="btn" style="width:100%;margin-top:6px;" id="sunClearBtn">↺ Xoá màu kết quả</button>
    </div>`;
  document.getElementById("sunClearBtn").addEventListener("click", clearSunColorization);
}

injectSunAnalysisUI();
