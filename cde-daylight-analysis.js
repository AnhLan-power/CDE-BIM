/* =====================================================================
   CDE DAYLIGHT ANALYSIS MODULE — Daylight Potential (xấp xỉ qua Sky View
   Factor: tỷ lệ bầu trời nhìn thấy được từ 1 điểm, không bị che khuất).

   ⚠️ ĐÂY LÀ ƯỚC TÍNH GẦN ĐÚNG, không phải mô phỏng quang học chuyên dụng
   kiểu Radiance/Honeybee: không tính phản xạ ánh sáng, không phân biệt
   loại bầu trời (quang đãng/u ám), chỉ đo hình học che khuất thuần tuý.
   Phù hợp nhất cho mặt tương đối nằm ngang (mái, sân, mặt bằng).
   ===================================================================== */

let daylightLastResults = []; // [{ id, name, svfPercent }]

function injectDaylightUI() {
  const panel = document.createElement("div");
  panel.className = "panel";
  panel.id = "daylightPanel";
  panel.style.display = "none";
  panel.innerHTML = `
    <div class="panel-header">
      <b>🌤️ Daylight Potential</b>
      <span style="cursor:pointer" onclick="document.getElementById('daylightPanel').style.display='none'">✕</span>
    </div>
    <div style="font-size:10px;color:#888;background:#fff8e1;padding:6px 8px;border-radius:6px;margin-bottom:8px;">
      ⚠️ Ước tính qua "tỷ lệ bầu trời nhìn thấy" (Sky View Factor) — không phải mô phỏng quang học đầy đủ, không phân biệt loại bầu trời.
    </div>
    <div id="dlParamsBox"></div>
    <div id="dlResultsBox"></div>`;
  document.body.appendChild(panel);
}

window.toggleDaylightPanel = function () {
  const p = document.getElementById("daylightPanel");
  const willShow = p.style.display !== "block";
  p.style.display = willShow ? "block" : "none";
  if (willShow) { renderDaylightParamsBox(); renderDaylightResultsBox(); }
};

function renderDaylightParamsBox() {
  const box = document.getElementById("dlParamsBox");
  box.innerHTML = `
    <div class="cde-file-card">
      <div class="fname">🌤️ Thông số phân tích</div>
      <label style="font-size:10px;color:#888;">Số tia lấy mẫu (nhiều hơn = chính xác hơn nhưng chậm hơn)</label>
      <input type="number" id="dlRayCount" min="16" max="300" value="64">
      <button class="btn btn-primary" style="width:100%;margin-top:6px;" id="dlRunBtn">▶ Phân tích cấu kiện đã chọn</button>
      <div style="font-size:10px;color:#888;margin-top:4px;">Dùng nút "Chọn Nhiều" trên thanh công cụ để chọn cấu kiện (mái, sân, mặt bằng...) trước khi bấm.</div>
    </div>`;
  document.getElementById("dlRunBtn").addEventListener("click", runDaylightAnalysis);
}

// Sinh N hướng phân bố đều trên nửa bầu trời (Fibonacci hemisphere) —
// point[1] (thành phần Y) chính là cos(góc tính từ đỉnh trời), dùng luôn
// làm trọng số khi tính Sky View Factor.
function generateHemisphereDirections(n) {
  const points = [];
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - i / (n - 1); // 1 (đỉnh trời) -> 0 (chân trời)
    const radius = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = goldenAngle * i;
    points.push([Math.cos(theta) * radius, y, Math.sin(theta) * radius]);
  }
  return points;
}

function computeSkyViewFactor(point, hemisphereDirs) {
  let sumCos = 0;
  hemisphereDirs.forEach(dir => {
    const hit = viewer.scene.pick({ origin: point, direction: dir, pickSurface: true });
    if (!hit) sumCos += dir[1]; // không bị che -> cộng trọng số cos(góc từ đỉnh trời)
  });
  return (2 / hemisphereDirs.length) * sumCos; // 0..1 (SVF)
}

async function runDaylightAnalysis() {
  if (typeof multiSelectedIds === "undefined" || multiSelectedIds.size === 0) {
    alert("Bấm 'Chọn Nhiều' trên thanh công cụ và chọn ít nhất 1 cấu kiện trước.");
    return;
  }

  const rayCount = Math.max(16, Math.min(300, parseInt(document.getElementById("dlRayCount").value) || 64));
  const hemisphereDirs = generateHemisphereDirections(rayCount);

  const btn = document.getElementById("dlRunBtn");
  btn.disabled = true; btn.innerText = "⏳ Đang phân tích...";

  const ids = [...multiSelectedIds];
  const results = [];

  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const entity = viewer.scene.objects[id];
    if (!entity || !entity.aabb) continue;

    const aabb = entity.aabb;
    const point = [(aabb[0] + aabb[3]) / 2, aabb[4] + 0.05, (aabb[2] + aabb[5]) / 2];

    const svf = computeSkyViewFactor(point, hemisphereDirs);
    results.push({ id, name: entity.name || id, svfPercent: svf * 100 });

    if (i % 3 === 0) await new Promise(r => setTimeout(r, 0)); // nhường luồng UI
  }

  daylightLastResults = results;
  applyDaylightColorization(results);
  renderDaylightResultsBox();

  btn.disabled = false; btn.innerText = "▶ Phân tích cấu kiện đã chọn";
}

function daylightValueToColor(percent) {
  const t = Math.min(1, Math.max(0, percent / 100));
  if (t < 0.5) {
    const k = t / 0.5;
    return [0.1 + k * 0.1, 0.15 + k * 0.55, 0.55 + k * 0.15]; // xanh dương đậm -> xanh dương nhạt
  } else {
    const k = (t - 0.5) / 0.5;
    return [0.2 + k * 0.8, 0.7 + k * 0.25, 0.7 - k * 0.6]; // xanh nhạt -> vàng sáng
  }
}

function applyDaylightColorization(results) {
  results.forEach(r => {
    const e = viewer.scene.objects[r.id];
    if (e) e.colorize = daylightValueToColor(r.svfPercent);
  });
}

function clearDaylightColorization() {
  daylightLastResults.forEach(r => {
    const e = viewer.scene.objects[r.id];
    if (e) e.colorize = null;
  });
  daylightLastResults = [];
  renderDaylightResultsBox();
}

function renderDaylightResultsBox() {
  const box = document.getElementById("dlResultsBox");
  if (!daylightLastResults || daylightLastResults.length === 0) { box.innerHTML = ""; return; }

  const rows = daylightLastResults
    .slice()
    .sort((a, b) => b.svfPercent - a.svfPercent)
    .map(r => `<div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid #f0f0f0;">
      <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:230px;">${r.name}</span>
      <b>${r.svfPercent.toFixed(0)}%</b>
    </div>`).join("");

  box.innerHTML = `
    <div class="cde-file-card">
      <div class="fname">📊 Kết quả (${daylightLastResults.length} cấu kiện)</div>
      <div style="display:flex;gap:10px;font-size:10px;margin:6px 0;color:#666;">
        <span>🔵 Ít tiềm năng</span><span>🟡 Nhiều tiềm năng</span>
      </div>
      <div style="max-height:180px;overflow-y:auto;font-size:11px;">${rows}</div>
      <button class="btn" style="width:100%;margin-top:6px;" id="dlClearBtn">↺ Xoá màu kết quả</button>
    </div>`;
  document.getElementById("dlClearBtn").addEventListener("click", clearDaylightColorization);
}

injectDaylightUI();
