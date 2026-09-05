/* =====================================================================
   CDE EMBODIED CARBON MODULE — Ước tính phát thải carbon vật liệu
   (có lưu lịch sử vào Supabase + xuất báo cáo Excel/PDF)

   Cách tính: với mỗi cấu kiện đã chọn, tìm khối lượng (m³) từ Pset của
   file IFC (ưu tiên NetVolume, sau đó GrossVolume/Volume) — đây LÀ dữ
   liệu thật nếu model có xuất kèm Quantity Takeoff. Nếu không tìm thấy,
   dùng khối bao (bounding box) làm ước tính thô — LUÔN đánh dấu rõ ràng
   khi phải dùng cách này vì kém chính xác hơn nhiều.

   Hệ số phát thải (kgCO2e/m³) mặc định chỉ mang tính THAM KHẢO, tổng hợp
   sơ bộ từ các nguồn công khai phổ biến (không phải EPD chính thức của
   nhà sản xuất) — cậu nên chỉnh lại theo dữ liệu thật của dự án khi có.
   ===================================================================== */

const DEFAULT_CARBON_FACTORS = {
  concrete: { label: "Bê tông", factor: 300 },
  steel: { label: "Thép kết cấu", factor: 10000 },
  brick: { label: "Gạch / khối xây", factor: 300 },
  timber: { label: "Gỗ", factor: 100 },
  glass: { label: "Kính", factor: 1500 },
  aluminum: { label: "Nhôm", factor: 20000 },
  mortar: { label: "Vữa / xi măng", factor: 250 },
  other: { label: "Khác (tự nhập hệ số)", factor: 300 }
};

// { id (uuid trong DB), material, factor, elements, totalVolume, totalCarbon, createdAt }
let carbonBatches = [];

function injectCarbonUI() {
  const panel = document.createElement("div");
  panel.className = "panel";
  panel.id = "carbonPanel";
  panel.style.display = "none";
  panel.innerHTML = `
    <div class="panel-header">
      <b>🌍 Embodied Carbon</b>
      <span style="cursor:pointer" onclick="document.getElementById('carbonPanel').style.display='none'">✕</span>
    </div>
    <div style="font-size:10px;color:#888;background:#fff8e1;padding:6px 8px;border-radius:6px;margin-bottom:8px;">
      ⚠️ Hệ số phát thải mặc định chỉ tham khảo — chỉnh lại theo dữ liệu thật (EPD/ICE/EC3) khi có. Khối lượng ưu tiên lấy từ Pset IFC thật; cấu kiện không có Pset khối lượng sẽ dùng khối bao (kém chính xác hơn, có đánh dấu ⚠).
    </div>
    <div id="cbParamsBox"></div>
    <div id="cbSummaryBox"></div>
    <div id="cbBatchListBox"></div>`;
  document.body.appendChild(panel);
}

window.toggleCarbonPanel = function () {
  const p = document.getElementById("carbonPanel");
  const willShow = p.style.display !== "block";
  p.style.display = willShow ? "block" : "none";
  if (willShow) refreshCarbonPanel();
};

async function refreshCarbonPanel() {
  renderCarbonParamsBox();
  await loadCarbonHistory();
  renderCarbonSummary();
  renderCarbonBatchList();
}

/* ---------------------------------------------------------------------
   1. TẢI / LƯU / XOÁ LỊCH SỬ TRONG SUPABASE
   --------------------------------------------------------------------- */
async function loadCarbonHistory() {
  if (!activeProjectId) { carbonBatches = []; return; }

  const { data, error } = await sb
    .from("carbon_calculations")
    .select("*")
    .eq("project_id", activeProjectId)
    .order("created_at", { ascending: true });

  if (error) { alert("Lỗi tải lịch sử carbon: " + error.message); return; }

  carbonBatches = (data || []).map(row => ({
    id: row.id,
    material: row.material,
    factor: row.factor,
    elements: row.elements || [],
    totalVolume: row.total_volume,
    totalCarbon: row.total_carbon,
    createdAt: row.created_at
  }));

  carbonBatches.forEach(b => applyCarbonColorization(b.elements));
}

/* ---------------------------------------------------------------------
   2. THAM SỐ + CHẠY PHÂN TÍCH
   --------------------------------------------------------------------- */
function renderCarbonParamsBox() {
  const box = document.getElementById("cbParamsBox");
  const options = Object.entries(DEFAULT_CARBON_FACTORS)
    .map(([k, v]) => `<option value="${k}">${v.label} (${v.factor} kgCO2e/m³)</option>`).join("");

  box.innerHTML = `
    <div class="cde-file-card">
      <div class="fname">➕ Tính cho nhóm cấu kiện đã chọn</div>
      <label style="font-size:10px;color:#888;">Loại vật liệu</label>
      <select id="cbMaterialSelect">${options}</select>
      <label style="font-size:10px;color:#888;">Hệ số phát thải (kgCO2e/m³) — có thể sửa</label>
      <input type="number" id="cbFactorInput" value="${DEFAULT_CARBON_FACTORS.concrete.factor}">
      <button class="btn btn-primary" style="width:100%;margin-top:6px;" id="cbRunBtn">▶ Tính cho cấu kiện đã chọn</button>
      <div style="font-size:10px;color:#888;margin-top:4px;">Dùng "Chọn Nhiều" để chọn 1 nhóm cấu kiện CÙNG loại vật liệu (vd: chọn hết cột bê tông) rồi bấm — lặp lại cho từng nhóm vật liệu khác nhau. Kết quả tự lưu vào dự án, còn nguyên khi tải lại trang.</div>
    </div>`;

  document.getElementById("cbMaterialSelect").addEventListener("change", (e) => {
    document.getElementById("cbFactorInput").value = DEFAULT_CARBON_FACTORS[e.target.value].factor;
  });
  document.getElementById("cbRunBtn").addEventListener("click", runCarbonAnalysis);
}

function findVolumeFromPsets(entityId) {
  const metaObject = viewer.metaScene && viewer.metaScene.metaObjects[entityId];
  if (!metaObject || !metaObject.propertySets) return null;

  const tryPattern = (pattern) => {
    for (const pset of metaObject.propertySets) {
      if (!pset.properties) continue;
      for (const p of pset.properties) {
        if (pattern.test(p.name) && p.value !== undefined && !isNaN(parseFloat(p.value))) {
          return parseFloat(p.value);
        }
      }
    }
    return null;
  };

  return tryPattern(/netvolume/i) ?? tryPattern(/grossvolume/i) ?? tryPattern(/^volume$/i);
}

function getElementVolume(entityId) {
  const fromPset = findVolumeFromPsets(entityId);
  if (fromPset !== null && fromPset > 0) return { volume: fromPset, estimated: false };

  const entity = viewer.scene.objects[entityId];
  if (entity && entity.aabb) {
    const aabb = entity.aabb;
    const volume = Math.max(0, aabb[3] - aabb[0]) * Math.max(0, aabb[4] - aabb[1]) * Math.max(0, aabb[5] - aabb[2]);
    return { volume, estimated: true };
  }
  return { volume: 0, estimated: true };
}

async function runCarbonAnalysis() {
  if (!activeProjectId) { alert("Chọn dự án trong panel CDE trước."); return; }
  if (typeof multiSelectedIds === "undefined" || multiSelectedIds.size === 0) {
    alert("Bấm 'Chọn Nhiều' trên thanh công cụ và chọn ít nhất 1 cấu kiện trước.");
    return;
  }

  const materialKey = document.getElementById("cbMaterialSelect").value;
  const factor = parseFloat(document.getElementById("cbFactorInput").value);
  if (isNaN(factor) || factor < 0) { alert("Hệ số phát thải không hợp lệ."); return; }

  const btn = document.getElementById("cbRunBtn");
  btn.disabled = true; btn.innerText = "⏳ Đang tính...";

  const ids = [...multiSelectedIds];
  const elements = [];

  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const entity = viewer.scene.objects[id];
    if (!entity) continue;
    const { volume, estimated } = getElementVolume(id);
    const carbon = volume * factor;
    elements.push({ id, name: entity.name || id, volume, estimated, carbon });
    if (i % 10 === 0) await new Promise(r => setTimeout(r, 0));
  }

  const totalVolume = elements.reduce((s, e) => s + e.volume, 0);
  const totalCarbon = elements.reduce((s, e) => s + e.carbon, 0);
  const material = DEFAULT_CARBON_FACTORS[materialKey].label;
  const estimatedCount = elements.filter(e => e.estimated).length;

  const { data, error } = await sb.from("carbon_calculations").insert({
    project_id: activeProjectId,
    material, factor,
    total_volume: totalVolume,
    total_carbon: totalCarbon,
    element_count: elements.length,
    estimated_count: estimatedCount,
    elements,
    created_by: currentUser.id
  }).select().single();

  if (error) { alert("Lỗi lưu kết quả: " + error.message); btn.disabled = false; btn.innerText = "▶ Tính cho cấu kiện đã chọn"; return; }

  carbonBatches.push({
    id: data.id, material, factor, elements, totalVolume, totalCarbon, createdAt: data.created_at
  });

  applyCarbonColorization(elements);
  renderCarbonSummary();
  renderCarbonBatchList();

  btn.disabled = false; btn.innerText = "▶ Tính cho cấu kiện đã chọn";
}

/* ---------------------------------------------------------------------
   3. TÔ MÀU + XOÁ
   --------------------------------------------------------------------- */
function carbonValueToColor(carbon, maxCarbon) {
  const t = maxCarbon > 0 ? Math.min(1, carbon / maxCarbon) : 0;
  return [0.25 + t * 0.65, 0.55 - t * 0.4, 0.2];
}

function applyCarbonColorization(elements) {
  const maxCarbon = Math.max(0.001, ...elements.map(e => e.carbon));
  elements.forEach(e => {
    const entity = viewer.scene.objects[e.id];
    if (entity) entity.colorize = carbonValueToColor(e.carbon, maxCarbon);
  });
}

async function clearAllCarbonData() {
  if (!confirm("Xoá toàn bộ lịch sử tính carbon của dự án này? Không thể hoàn tác.")) return;
  carbonBatches.forEach(b => b.elements.forEach(e => {
    const entity = viewer.scene.objects[e.id];
    if (entity) entity.colorize = null;
  }));

  const { error } = await sb.from("carbon_calculations").delete().eq("project_id", activeProjectId);
  if (error) { alert("Lỗi xoá: " + error.message); return; }

  carbonBatches = [];
  renderCarbonSummary();
  renderCarbonBatchList();
}

async function removeBatch(index) {
  const batch = carbonBatches[index];
  const { error } = await sb.from("carbon_calculations").delete().eq("id", batch.id);
  if (error) { alert("Lỗi xoá: " + error.message); return; }

  batch.elements.forEach(e => {
    const entity = viewer.scene.objects[e.id];
    if (entity) entity.colorize = null;
  });
  carbonBatches.splice(index, 1);
  renderCarbonSummary();
  renderCarbonBatchList();
}

function formatCarbon(kg) {
  return kg >= 1000 ? (kg / 1000).toFixed(2) + " tấn" : kg.toFixed(0) + " kg";
}

/* ---------------------------------------------------------------------
   4. GIAO DIỆN TỔNG HỢP + DANH SÁCH
   --------------------------------------------------------------------- */
function renderCarbonSummary() {
  const box = document.getElementById("cbSummaryBox");
  if (carbonBatches.length === 0) { box.innerHTML = ""; return; }

  const grandTotal = carbonBatches.reduce((s, b) => s + b.totalCarbon, 0);
  const byMaterial = {};
  carbonBatches.forEach(b => {
    if (!byMaterial[b.material]) byMaterial[b.material] = { volume: 0, carbon: 0 };
    byMaterial[b.material].volume += b.totalVolume;
    byMaterial[b.material].carbon += b.totalCarbon;
  });

  const rows = Object.entries(byMaterial).map(([mat, v]) => `
    <div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid #f0f0f0;">
      <span>${mat} <span style="color:#999;">(${v.volume.toFixed(1)} m³)</span></span>
      <b>${formatCarbon(v.carbon)} CO2e</b>
    </div>`).join("");

  box.innerHTML = `
    <div class="cde-file-card">
      <div class="fname">📊 Tổng phát thải carbon (${carbonBatches.length} nhóm đã tính)</div>
      <div style="font-size:20px;font-weight:700;color:#c0392b;text-align:center;margin:8px 0;">
        ${formatCarbon(grandTotal)} CO2e
      </div>
      <div style="font-size:11px;">${rows}</div>
      <div class="actions" style="margin-top:8px;">
        <button id="cbExportExcelBtn">📥 Xuất Excel</button>
        <button id="cbExportPdfBtn">📄 Xuất PDF</button>
        <button id="cbClearAllBtn">🗑 Xoá toàn bộ</button>
      </div>
    </div>`;
  document.getElementById("cbClearAllBtn").addEventListener("click", clearAllCarbonData);
  document.getElementById("cbExportExcelBtn").addEventListener("click", exportCarbonExcel);
  document.getElementById("cbExportPdfBtn").addEventListener("click", exportCarbonPdf);
}

function renderCarbonBatchList() {
  const box = document.getElementById("cbBatchListBox");
  if (carbonBatches.length === 0) { box.innerHTML = ""; return; }

  box.innerHTML = `<div style="font-size:11px;font-weight:700;margin:10px 0 4px;">📋 Chi tiết từng nhóm đã tính</div>`;

  carbonBatches.forEach((b, idx) => {
    const estimatedCount = b.elements.filter(e => e.estimated).length;
    const dateStr = b.createdAt ? new Date(b.createdAt).toLocaleString("vi-VN") : "";
    const card = document.createElement("div");
    card.className = "cde-file-card";
    card.innerHTML = `
      <div class="fname">${b.material} <span style="font-weight:400;color:#888;">(${b.elements.length} cấu kiện, ${b.factor} kgCO2e/m³)</span></div>
      <div class="meta">
        ${b.totalVolume.toFixed(2)} m³ · ${formatCarbon(b.totalCarbon)} CO2e · ${dateStr}
        ${estimatedCount > 0 ? `<br>⚠️ ${estimatedCount}/${b.elements.length} cấu kiện dùng khối bao (không có Pset khối lượng, kém chính xác hơn)` : ""}
      </div>
      <div class="actions"><button id="cbRemoveBatch_${idx}">❌ Xoá nhóm này</button></div>`;
    box.appendChild(card);
    card.querySelector(`#cbRemoveBatch_${idx}`).addEventListener("click", () => removeBatch(idx));
  });
}

/* ---------------------------------------------------------------------
   5. XUẤT BÁO CÁO EXCEL / PDF
   --------------------------------------------------------------------- */
function exportCarbonExcel() {
  if (carbonBatches.length === 0) { alert("Chưa có dữ liệu để xuất."); return; }

  const summaryRows = carbonBatches.map(b => ({
    "Vật liệu": b.material,
    "Hệ số (kgCO2e/m³)": b.factor,
    "Số cấu kiện": b.elements.length,
    "Thể tích (m³)": Number(b.totalVolume.toFixed(3)),
    "Carbon (kgCO2e)": Number(b.totalCarbon.toFixed(1)),
    "Ngày tính": b.createdAt ? new Date(b.createdAt).toLocaleString("vi-VN") : ""
  }));

  const detailRows = [];
  carbonBatches.forEach(b => {
    b.elements.forEach(e => {
      detailRows.push({
        "Vật liệu": b.material,
        "Tên cấu kiện": e.name,
        "ID": e.id,
        "Thể tích (m³)": Number(e.volume.toFixed(4)),
        "Ước tính từ khối bao?": e.estimated ? "Có (⚠ kém chính xác)" : "Không (Pset thật)",
        "Carbon (kgCO2e)": Number(e.carbon.toFixed(2))
      });
    });
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryRows), "Tổng hợp");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detailRows), "Chi tiết cấu kiện");
  XLSX.writeFile(wb, `BaoCao_EmbodiedCarbon_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

function exportCarbonPdf() {
  if (carbonBatches.length === 0) { alert("Chưa có dữ liệu để xuất."); return; }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: "landscape" });
  const grandTotal = carbonBatches.reduce((s, b) => s + b.totalCarbon, 0);

  doc.setFontSize(16);
  doc.text("Báo Cáo Ước Tính Phát Thải Carbon (Embodied Carbon)", 14, 15);
  doc.setFontSize(10);
  doc.text(`Ngày xuất: ${new Date().toLocaleString("vi-VN")}  ·  Tổng: ${formatCarbon(grandTotal)} CO2e`, 14, 22);
  doc.setFontSize(8);
  doc.text("Lưu ý: hệ số phát thải mặc định chỉ tham khảo, không phải EPD chính thức. Cấu kiện đánh dấu (*) dùng khối bao thay vì Pset thật.", 14, 27);

  doc.autoTable({
    startY: 32,
    head: [["Vật liệu", "Hệ số (kgCO2e/m³)", "Số cấu kiện", "Thể tích (m³)", "Carbon (kgCO2e)"]],
    body: carbonBatches.map(b => [
      b.material, b.factor, b.elements.length, b.totalVolume.toFixed(2), formatCarbon(b.totalCarbon)
    ]),
    styles: { fontSize: 8 }
  });

  let y = doc.lastAutoTable.finalY + 10;
  carbonBatches.forEach(b => {
    if (y > 180) { doc.addPage(); y = 15; }
    doc.setFontSize(10);
    doc.text(`Chi tiết: ${b.material}`, 14, y);
    doc.autoTable({
      startY: y + 3,
      head: [["Cấu kiện", "Thể tích (m³)", "Carbon (kgCO2e)"]],
      body: b.elements.map(e => [e.name + (e.estimated ? " (*)" : ""), e.volume.toFixed(3), e.carbon.toFixed(1)]),
      styles: { fontSize: 7 },
      margin: { left: 14 }
    });
    y = doc.lastAutoTable.finalY + 10;
  });

  doc.save(`BaoCao_EmbodiedCarbon_${new Date().toISOString().slice(0, 10)}.pdf`);
}

injectCarbonUI();
