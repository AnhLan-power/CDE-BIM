/* =====================================================================
   CDE OPENNESS INDEX MODULE — Chỉ Số Độ Thông Thoáng

   ⚠️ ĐÂY KHÔNG PHẢI PHÂN TÍCH GIÓ / CFD THẬT. Gió là dòng chảy chất lỏng,
   có hiện tượng tăng tốc ở góc/khe hẹp, tạo xoáy/vùng quẩn phía sau công
   trình — hoàn toàn khác với việc "bị che tầm nhìn". Chỉ số này CHỈ đo
   mật độ vật cản hình học xung quanh 1 điểm (theo 360° mặt phẳng ngang),
   dùng để so sánh tương đối mức độ thông thoáng/bao vây giữa các khu vực
   trong đồ án — KHÔNG phản ánh tốc độ hay hướng dòng khí thực tế. Muốn có
   kết quả gió thật, cần dùng phần mềm CFD chuyên dụng (Autodesk CFD,
   SimScale, ANSYS, ENVI-met...).
   ===================================================================== */

let opennessLastResults = []; // [{ id, name, opennessPercent }]

function injectOpennessUI() {
  const panel = document.createElement("div");
  panel.className = "panel";
  panel.id = "opennessPanel";
  panel.style.display = "none";
  panel.innerHTML = `
    <div class="panel-header">
      <b>🌬️ Chỉ Số Độ Thông Thoáng</b>
      <span style="cursor:pointer" onclick="document.getElementById('opennessPanel').style.display='none'">✕</span>
    </div>
    <div style="font-size:10px;color:#888;background:#fdecea;padding:6px 8px;border-radius:6px;margin-bottom:8px;">
      ⚠️ KHÔNG PHẢI phân tích gió/CFD thật — chỉ đo mật độ vật cản hình học xung quanh (360° mặt phẳng ngang) để so sánh tương đối giữa các khu vực. Không phản ánh tốc độ/hướng gió thực tế.
    </div>
    <div id="opParamsBox"></div>
    <div id="opResultsBox"></div>`;
  document.body.appendChild(panel);
}

window.toggleOpennessPanel = function () {
  const p = document.getElementById("opennessPanel");
  const willShow = p.style.display !== "block";
  p.style.display = willShow ? "block" : "none";
  if (willShow) { renderOpennessParamsBox(); renderOpennessResultsBox(); }
};

function renderOpennessParamsBox() {
  const box = document.getElementById("opParamsBox");
  box.innerHTML = `
    <div class="cde-file-card">
      <div class="fname">🌬️ Thông số khảo sát</div>
      <div style="display:flex;gap:6px;">
        <div style="flex:1;">
          <label style="font-size:10px;color:#888;">Bán kính khảo sát (m)</label>
          <input type="number" id="opRadius" min="5" max="500" value="50">
        </div>
        <div style="flex:1;">
          <label style="font-size:10px;color:#888;">Số hướng lấy mẫu</label>
          <input type="number" id="opDirCount" min="8" max="72" value="24">
        </div>
      </div>
      <button class="btn btn-primary" style="width:100%;margin-top:6px;" id="opRunBtn">▶ Phân tích cấu kiện đã chọn</button>
      <div style="font-size:10px;color:#888;margin-top:4px;">Dùng nút "Chọn Nhiều" trên thanh công cụ để chọn cấu kiện (mặt bằng, sân, khoảng trống giữa các khối nhà...) trước khi bấm.</div>
    </div>`;
  document.getElementById("opRunBtn").addEventListener("click", runOpennessAnalysis);
}

// Bắn N tia theo 360° trên mặt phẳng ngang (Y cố định) từ 1 điểm. Tia nào
// gặp vật cản trong bán kính khảo sát -> tính "mức độ bị bao vây" theo độ
// gần (gần = bao vây nhiều); tia không gặp gì trong bán kính -> thông
// thoáng hoàn toàn theo hướng đó.
function computeOpennessIndex(point, dirCount, radius) {
  let totalOpenness = 0;
  for (let i = 0; i < dirCount; i++) {
    const angle = (i / dirCount) * Math.PI * 2;
    const dir = [Math.cos(angle), 0, Math.sin(angle)];
    const hit = viewer.scene.pick({ origin: point, direction: dir, pickSurface: true });

    if (!hit || !hit.worldPos) { totalOpenness += 1; continue; } // không gặp gì -> thông thoáng 100% hướng này
    const dx = hit.worldPos[0] - point[0], dz = hit.worldPos[2] - point[2];
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist >= radius) { totalOpenness += 1; continue; } // vật cản ở ngoài bán kính khảo sát -> coi như thông thoáng

    totalOpenness += dist / radius; // càng gần vật cản, đóng góp thông thoáng càng thấp
  }
  return totalOpenness / dirCount; // 0..1
}

async function runOpennessAnalysis() {
  if (typeof multiSelectedIds === "undefined" || multiSelectedIds.size === 0) {
    alert("Bấm 'Chọn Nhiều' trên thanh công cụ và chọn ít nhất 1 cấu kiện trước.");
    return;
  }

  const radius = Math.max(5, Math.min(500, parseFloat(document.getElementById("opRadius").value) || 50));
  const dirCount = Math.max(8, Math.min(72, parseInt(document.getElementById("opDirCount").value) || 24));

  const btn = document.getElementById("opRunBtn");
  btn.disabled = true; btn.innerText = "⏳ Đang phân tích...";

  const ids = [...multiSelectedIds];
  const results = [];

  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const entity = viewer.scene.objects[id];
    if (!entity || !entity.aabb) continue;

    const aabb = entity.aabb;
    const point = [(aabb[0] + aabb[3]) / 2, aabb[4] + 0.05, (aabb[2] + aabb[5]) / 2];

    const openness = computeOpennessIndex(point, dirCount, radius);
    results.push({ id, name: entity.name || id, opennessPercent: openness * 100 });

    if (i % 3 === 0) await new Promise(r => setTimeout(r, 0)); // nhường luồng UI
  }

  opennessLastResults = results;
  applyOpennessColorization(results);
  renderOpennessResultsBox();

  btn.disabled = false; btn.innerText = "▶ Phân tích cấu kiện đã chọn";
}

function opennessValueToColor(percent) {
  const t = Math.min(1, Math.max(0, percent / 100));
  // Tím (bị bao vây nhiều) -> xám -> xanh lá (thông thoáng)
  if (t < 0.5) {
    const k = t / 0.5;
    return [0.5 - k * 0.15, 0.15 + k * 0.25, 0.55 - k * 0.15];
  } else {
    const k = (t - 0.5) / 0.5;
    return [0.35 - k * 0.2, 0.4 + k * 0.4, 0.4 - k * 0.15];
  }
}

function applyOpennessColorization(results) {
  results.forEach(r => {
    const e = viewer.scene.objects[r.id];
    if (e) e.colorize = opennessValueToColor(r.opennessPercent);
  });
}

function clearOpennessColorization() {
  opennessLastResults.forEach(r => {
    const e = viewer.scene.objects[r.id];
    if (e) e.colorize = null;
  });
  opennessLastResults = [];
  renderOpennessResultsBox();
}

function renderOpennessResultsBox() {
  const box = document.getElementById("opResultsBox");
  if (!opennessLastResults || opennessLastResults.length === 0) { box.innerHTML = ""; return; }

  const rows = opennessLastResults
    .slice()
    .sort((a, b) => b.opennessPercent - a.opennessPercent)
    .map(r => `<div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid #f0f0f0;">
      <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:230px;">${r.name}</span>
      <b>${r.opennessPercent.toFixed(0)}%</b>
    </div>`).join("");

  box.innerHTML = `
    <div class="cde-file-card">
      <div class="fname">📊 Kết quả (${opennessLastResults.length} cấu kiện)</div>
      <div style="display:flex;gap:10px;font-size:10px;margin:6px 0;color:#666;">
        <span>🟣 Bị bao vây nhiều</span><span>🟢 Thông thoáng</span>
      </div>
      <div style="max-height:180px;overflow-y:auto;font-size:11px;">${rows}</div>
      <button class="btn" style="width:100%;margin-top:6px;" id="opClearBtn">↺ Xoá màu kết quả</button>
    </div>`;
  document.getElementById("opClearBtn").addEventListener("click", clearOpennessColorization);
}

injectOpennessUI();
