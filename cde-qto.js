/* =====================================================================
   CDE QTO MODULE — Bóc Tách Khối Lượng (Quantity Takeoff)
   Tương đương Quantification Workbook của Navisworks, phân loại theo
   hạng mục quen thuộc với dự toán Việt Nam (Phần Ngầm/Phần Thân/Hoàn
   Thiện/Điện Nước...) thay vì UniFormat kiểu Mỹ.

   ⚠️ CHỈ hỗ trợ trích xuất KHỐI LƯỢNG từ mô hình BIM. Mã hiệu định mức
   và đơn giá theo Định mức dự toán xây dựng Việt Nam (Thông tư
   12/2021/TT-BXD và các văn bản liên quan) cần tự tra cứu/nhập — không
   nhúng sẵn bộ định mức đầy đủ vì có hàng nghìn mã hiệu, thay đổi theo
   thời gian và địa phương.
   ===================================================================== */

const QTO_CATEGORY_LABELS = {
  phan_ngam: "Phần Ngầm", phan_than: "Phần Thân", phan_bao_che: "Phần Bao Che",
  hoan_thien: "Hoàn Thiện", dien_nuoc: "Điện Nước", ha_tang: "Hạ Tầng", khac: "Khác"
};
const QTO_UNIT_LABELS = { m3: "m³", m2: "m²", md: "md", kg: "kg", tan: "tấn", cai: "cái", bo: "bộ" };

let qtoItems = []; // toàn bộ item của dự án, tải 1 lần rồi lọc theo tab
let qtoActiveCategory = "phan_ngam";

function injectQtoUI() {
  const panel = document.createElement("div");
  panel.className = "panel";
  panel.id = "qtoPanel";
  panel.style.display = "none";
  panel.innerHTML = `
    <div class="panel-header">
      <b>📐 Bóc Tách Khối Lượng</b>
      <span style="cursor:pointer" onclick="document.getElementById('qtoPanel').style.display='none'">✕</span>
    </div>
    <div style="font-size:10px;color:#888;background:#fff8e1;padding:6px 8px;border-radius:6px;margin-bottom:8px;">
      ⚠️ Chỉ trích xuất khối lượng từ mô hình. Mã hiệu/đơn giá theo Định mức dự toán XD Việt Nam cần tự tra cứu, không nhúng sẵn.
    </div>
    <div id="qtoNoProjectMsg" style="color:#999;padding:8px 0;">Vào panel 📁 CDE, chọn dự án trước đã.</div>
    <div id="qtoContent" style="display:none;">
      <div id="qtoLibraryBox"></div>
      <div class="cde-status-tabs" id="qtoCategoryTabs"></div>
      <div id="qtoAddBox"></div>
      <div id="qtoListBox"></div>
      <div id="qtoSummaryBox"></div>
    </div>`;
  document.body.appendChild(panel);
}

/* ---------------------------------------------------------------------
   0. THƯ VIỆN MÃ HIỆU ĐỊNH MỨC (dùng chung mọi dự án)
   --------------------------------------------------------------------- */
function renderQtoLibraryBox() {
  const box = document.getElementById("qtoLibraryBox");
  box.innerHTML = `
    <div class="cde-file-card">
      <div class="fname">📚 Thư Viện Mã Hiệu Định Mức</div>
      <div class="meta" id="qtoLibCount">Đang kiểm tra...</div>
      <input type="file" id="qtoLibFileInput" accept=".xlsx,.xls" style="display:none;">
      <button class="btn" style="width:100%;margin-top:6px;" id="qtoLibImportBtn">📥 Import Excel (Mã hiệu / Tên công tác / Đơn vị)</button>
    </div>`;
  document.getElementById("qtoLibImportBtn").addEventListener("click", () => {
    document.getElementById("qtoLibFileInput").click();
  });
  document.getElementById("qtoLibFileInput").addEventListener("change", handleLibraryImport);
  updateQtoLibCount();
}

async function updateQtoLibCount() {
  const { count } = await sb.from("norm_code_library").select("*", { count: "exact", head: true });
  const el = document.getElementById("qtoLibCount");
  if (el) el.innerText = `Đã có ${count || 0} mã hiệu trong thư viện.`;
}

function handleLibraryImport(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (ev) => {
    try {
      const workbook = XLSX.read(ev.target.result, { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
      if (rows.length === 0) { alert("File rỗng."); return; }

      const headers = Object.keys(rows[0]);
      const codeCol = headers.find(h => /mã\s*hiệu|ma\s*hieu|code/i.test(h));
      const nameCol = headers.find(h => /tên\s*công\s*tác|ten\s*cong\s*tac|name|công\s*tác/i.test(h));
      const unitCol = headers.find(h => /đơn\s*vị|don\s*vi|unit/i.test(h));
      const chapterCol = headers.find(h => /chương|chuong|chapter/i.test(h));
      if (!codeCol || !nameCol) { alert("Không tìm thấy cột 'Mã hiệu' và 'Tên công tác' trong file."); return; }

      const entries = rows
        .map(r => ({
          norm_code: String(r[codeCol]).trim(),
          task_name: String(r[nameCol]).trim(),
          unit: unitCol ? String(r[unitCol]).trim() : null,
          chapter: chapterCol ? String(r[chapterCol]).trim() : null,
          created_by: currentUser.id
        }))
        .filter(r => r.norm_code && r.task_name);

      if (!confirm(`Tìm thấy ${entries.length} mã hiệu trong file. Thêm vào thư viện?`)) return;

      // Chèn theo lô (500 dòng/lần) tránh vượt giới hạn 1 request
      for (let i = 0; i < entries.length; i += 500) {
        const chunk = entries.slice(i, i + 500);
        const { error } = await sb.from("norm_code_library").insert(chunk);
        if (error) { alert("Lỗi ở lô " + i + ": " + error.message); return; }
      }

      showToast ? showToast(`✅ Đã import ${entries.length} mã hiệu`, "success") : alert("Import xong.");
      updateQtoLibCount();
    } catch (err) {
      alert("Lỗi đọc file: " + err.message);
    }
  };
  reader.readAsArrayBuffer(file);
}

/* Tìm kiếm gợi ý theo tên công tác hoặc mã hiệu — gắn vào 1 ô input, hiện
   dropdown kết quả bên dưới, chọn 1 dòng sẽ tự điền tên/mã/đơn vị. */
function attachLibraryAutocomplete(inputEl, onPick) {
  const dropdown = document.createElement("div");
  dropdown.style.cssText = "position:relative;";
  const list = document.createElement("div");
  list.style.cssText = "position:absolute;top:0;left:0;right:0;background:#fff;border:1px solid #ddd;border-radius:6px;max-height:160px;overflow-y:auto;z-index:200;display:none;box-shadow:0 4px 10px rgba(0,0,0,0.1);";
  inputEl.parentNode.insertBefore(dropdown, inputEl.nextSibling);
  dropdown.appendChild(list);

  let debounceTimer;
  inputEl.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    const q = inputEl.value.trim();
    if (q.length < 2) { list.style.display = "none"; return; }
    debounceTimer = setTimeout(async () => {
      const { data } = await sb
        .from("norm_code_library")
        .select("norm_code, task_name, unit")
        .or(`task_name.ilike.%${q}%,norm_code.ilike.%${q}%`)
        .limit(15);
      if (!data || data.length === 0) { list.style.display = "none"; return; }
      list.innerHTML = data.map((r, i) =>
        `<div class="qto-lib-suggestion" data-idx="${i}" style="padding:5px 8px;font-size:11px;cursor:pointer;border-bottom:1px solid #f0f0f0;">
          <b>${r.norm_code}</b> — ${r.task_name} ${r.unit ? `<span style="color:#999;">(${r.unit})</span>` : ""}
        </div>`).join("");
      list.style.display = "block";
      list.querySelectorAll(".qto-lib-suggestion").forEach(el => {
        el.addEventListener("click", () => {
          const r = data[parseInt(el.dataset.idx)];
          onPick(r);
          list.style.display = "none";
        });
      });
    }, 300);
  });
  inputEl.addEventListener("blur", () => setTimeout(() => { list.style.display = "none"; }, 200));
}

window.toggleQtoPanel = function () {
  const p = document.getElementById("qtoPanel");
  const willShow = p.style.display !== "block";
  p.style.display = willShow ? "block" : "none";
  if (willShow) refreshQtoPanel();
};

async function refreshQtoPanel() {
  if (!activeProjectId) {
    document.getElementById("qtoNoProjectMsg").style.display = "block";
    document.getElementById("qtoContent").style.display = "none";
    return;
  }
  document.getElementById("qtoNoProjectMsg").style.display = "none";
  document.getElementById("qtoContent").style.display = "block";

  renderQtoLibraryBox();
  await loadQtoItems();
  renderQtoCategoryTabs();
}

function canEditQto() {
  return ["author", "task_team_manager", "bim_manager"].includes(activeRole);
}

async function loadQtoItems() {
  const { data, error } = await sb
    .from("qto_items")
    .select("*")
    .eq("project_id", activeProjectId)
    .order("created_at", { ascending: true });
  if (error) { alert("Lỗi tải khối lượng: " + error.message); return; }
  qtoItems = data || [];
}

/* ---------------------------------------------------------------------
   1. TAB HẠNG MỤC
   --------------------------------------------------------------------- */
function renderQtoCategoryTabs() {
  const tabsEl = document.getElementById("qtoCategoryTabs");
  tabsEl.innerHTML = "";
  Object.entries(QTO_CATEGORY_LABELS).forEach(([key, label]) => {
    const tab = document.createElement("div");
    tab.className = "cde-status-tab" + (qtoActiveCategory === key ? " active" : "");
    tab.innerText = label;
    tab.style.fontSize = "9px";
    tab.addEventListener("click", () => { qtoActiveCategory = key; renderQtoCategoryTabs(); });
    tabsEl.appendChild(tab);
  });
  renderAddQtoBox();
  renderQtoList();
  renderQtoSummary();
}

/* ---------------------------------------------------------------------
   2. THÊM HẠNG MỤC KHỐI LƯỢNG MỚI
   --------------------------------------------------------------------- */
function renderAddQtoBox() {
  const box = document.getElementById("qtoAddBox");
  if (!canEditQto()) { box.innerHTML = ""; return; }

  const unitOptions = Object.entries(QTO_UNIT_LABELS)
    .map(([k, v]) => `<option value="${k}">${v}</option>`).join("");

  box.innerHTML = `
    <div class="cde-file-card">
      <div class="fname">➕ Thêm công tác (${QTO_CATEGORY_LABELS[qtoActiveCategory]})</div>
      <input type="text" id="qtoNewName" placeholder="Tên công tác, vd: Bê tông cột C1 đá 1x2 M300">
      <input type="text" id="qtoNewCode" placeholder="Mã hiệu định mức (tuỳ chọn), vd: AF.611">
      <div style="display:flex;gap:6px;">
        <select id="qtoNewUnit" style="flex:1;">${unitOptions}</select>
        <input type="number" id="qtoNewPrice" placeholder="Đơn giá (VNĐ)" style="flex:1;">
      </div>
      <button class="btn btn-primary" style="width:100%;margin-top:6px;" id="qtoRunBtn">▶ Tính từ cấu kiện đã chọn</button>
      <div style="font-size:10px;color:#888;margin-top:4px;">Dùng "Chọn Nhiều" trên thanh công cụ để chọn cấu kiện trước khi bấm. Với đơn vị kg/tấn, app sẽ hỏi khối lượng riêng (kg/m³) để quy đổi từ thể tích.</div>
    </div>`;

  document.getElementById("qtoRunBtn").addEventListener("click", runQtoCalculation);
}

function findQuantityFromPsets(entityId, patterns) {
  const metaObject = viewer.metaScene && viewer.metaScene.metaObjects[entityId];
  if (!metaObject || !metaObject.propertySets) return null;
  for (const pattern of patterns) {
    for (const pset of metaObject.propertySets) {
      if (!pset.properties) continue;
      for (const p of pset.properties) {
        if (pattern.test(p.name) && p.value !== undefined && !isNaN(parseFloat(p.value))) {
          return parseFloat(p.value);
        }
      }
    }
  }
  return null;
}

function getElementQuantity(entityId, unit, density) {
  const entity = viewer.scene.objects[entityId];
  if (!entity) return { value: 0, estimated: true };

  if (unit === "cai" || unit === "bo") return { value: 1, estimated: false };

  if (unit === "m3") {
    const v = findQuantityFromPsets(entityId, [/netvolume/i, /grossvolume/i, /^volume$/i]);
    if (v !== null && v > 0) return { value: v, estimated: false };
    if (entity.aabb) {
      const a = entity.aabb;
      return { value: Math.max(0, a[3] - a[0]) * Math.max(0, a[4] - a[1]) * Math.max(0, a[5] - a[2]), estimated: true };
    }
    return { value: 0, estimated: true };
  }

  if (unit === "m2") {
    const v = findQuantityFromPsets(entityId, [/netarea/i, /grossarea/i, /^area$/i]);
    if (v !== null && v > 0) return { value: v, estimated: false };
    if (entity.aabb) {
      const a = entity.aabb;
      const dims = [a[3] - a[0], a[4] - a[1], a[5] - a[2]].sort((x, y) => y - x);
      return { value: Math.max(0, dims[0]) * Math.max(0, dims[1]), estimated: true }; // 2 chiều lớn nhất ~ diện tích mặt lớn nhất
    }
    return { value: 0, estimated: true };
  }

  if (unit === "md") {
    const v = findQuantityFromPsets(entityId, [/^length$/i, /netlength/i]);
    if (v !== null && v > 0) return { value: v, estimated: false };
    if (entity.aabb) {
      const a = entity.aabb;
      return { value: Math.max(a[3] - a[0], a[4] - a[1], a[5] - a[2]), estimated: true }; // chiều dài nhất của khối bao
    }
    return { value: 0, estimated: true };
  }

  if (unit === "kg" || unit === "tan") {
    const volResult = getElementQuantity(entityId, "m3", null);
    const kg = volResult.value * (density || 0);
    return { value: unit === "tan" ? kg / 1000 : kg, estimated: volResult.estimated };
  }

  return { value: 0, estimated: true };
}

async function runQtoCalculation() {
  if (!activeProjectId) { alert("Chọn dự án trong panel CDE trước."); return; }
  if (typeof multiSelectedIds === "undefined" || multiSelectedIds.size === 0) {
    alert("Bấm 'Chọn Nhiều' trên thanh công cụ và chọn ít nhất 1 cấu kiện trước.");
    return;
  }

  const name = document.getElementById("qtoNewName").value.trim();
  const normCode = document.getElementById("qtoNewCode").value.trim();
  const unit = document.getElementById("qtoNewUnit").value;
  const unitPrice = parseFloat(document.getElementById("qtoNewPrice").value) || 0;
  if (!name) { alert("Nhập tên công tác."); return; }

  let density = null;
  if (unit === "kg" || unit === "tan") {
    const input = prompt("Khối lượng riêng vật liệu (kg/m³)? Vd: bê tông ~2400, thép ~7850", "2400");
    density = parseFloat(input);
    if (isNaN(density) || density <= 0) { alert("Khối lượng riêng không hợp lệ."); return; }
  }

  const btn = document.getElementById("qtoRunBtn");
  btn.disabled = true; btn.innerText = "⏳ Đang tính...";

  const ids = [...multiSelectedIds];
  const elements = [];
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const entity = viewer.scene.objects[id];
    if (!entity) continue;
    const { value, estimated } = getElementQuantity(id, unit, density);
    elements.push({ id, name: entity.name || id, value, estimated });
    if (i % 10 === 0) await new Promise(r => setTimeout(r, 0));
  }

  const totalQuantity = elements.reduce((s, e) => s + e.value, 0);
  const estimatedCount = elements.filter(e => e.estimated).length;

  const { error } = await sb.from("qto_items").insert({
    project_id: activeProjectId,
    category: qtoActiveCategory,
    name, norm_code: normCode || null,
    unit, quantity: totalQuantity, unit_price: unitPrice,
    elements, estimated_count: estimatedCount,
    created_by: currentUser.id
  });
  if (error) { alert("Lỗi lưu: " + error.message); btn.disabled = false; btn.innerText = "▶ Tính từ cấu kiện đã chọn"; return; }

  document.getElementById("qtoNewName").value = "";
  document.getElementById("qtoNewCode").value = "";
  document.getElementById("qtoNewPrice").value = "";
  showToast ? showToast("✅ Đã thêm công tác", "success") : alert("Đã thêm.");

  await loadQtoItems();
  renderQtoList();
  renderQtoSummary();
  btn.disabled = false; btn.innerText = "▶ Tính từ cấu kiện đã chọn";
}

/* ---------------------------------------------------------------------
   3. DANH SÁCH + TỔNG HỢP
   --------------------------------------------------------------------- */
function formatVND(n) {
  return n.toLocaleString("vi-VN") + " đ";
}

function renderQtoList() {
  const box = document.getElementById("qtoListBox");
  const items = qtoItems.filter(it => it.category === qtoActiveCategory);
  if (items.length === 0) { box.innerHTML = `<div style="color:#999;padding:8px 0;">Chưa có công tác nào trong hạng mục này.</div>`; return; }

  box.innerHTML = "";
  items.forEach(it => {
    const card = document.createElement("div");
    card.className = "cde-file-card";
    const thanhTien = it.quantity * it.unit_price;
    card.innerHTML = `
      <div class="fname">${it.name} ${it.norm_code ? `<span style="color:#888;font-weight:400;">(${it.norm_code})</span>` : ""}</div>
      <div class="meta">
        ${it.quantity.toFixed(2)} ${QTO_UNIT_LABELS[it.unit]} × ${formatVND(it.unit_price)} = <b>${formatVND(thanhTien)}</b>
        ${it.estimated_count > 0 ? `<br>⚠️ ${it.estimated_count} cấu kiện dùng khối bao ước tính (không có Pset thật)` : ""}
      </div>
      <div class="actions" id="qtoActions_${it.id}"></div>`;
    box.appendChild(card);
    if (canEditQto()) {
      const btnDel = document.createElement("button");
      btnDel.innerText = "❌ Xoá";
      btnDel.addEventListener("click", () => deleteQtoItem(it.id));
      card.querySelector(".actions").appendChild(btnDel);
    }
  });
}

async function deleteQtoItem(id) {
  if (!confirm("Xoá công tác này?")) return;
  const { error } = await sb.from("qto_items").delete().eq("id", id);
  if (error) { alert("Lỗi xoá: " + error.message); return; }
  await loadQtoItems();
  renderQtoList();
  renderQtoSummary();
}

function renderQtoSummary() {
  const box = document.getElementById("qtoSummaryBox");
  if (qtoItems.length === 0) { box.innerHTML = ""; return; }

  const byCategory = {};
  qtoItems.forEach(it => {
    if (!byCategory[it.category]) byCategory[it.category] = 0;
    byCategory[it.category] += it.quantity * it.unit_price;
  });
  const grandTotal = Object.values(byCategory).reduce((s, v) => s + v, 0);

  const rows = Object.entries(byCategory).map(([cat, total]) => `
    <div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid #f0f0f0;">
      <span>${QTO_CATEGORY_LABELS[cat]}</span><b>${formatVND(total)}</b>
    </div>`).join("");

  box.innerHTML = `
    <div class="cde-file-card">
      <div class="fname">📊 Tổng hợp toàn dự án (${qtoItems.length} công tác)</div>
      <div style="font-size:16px;font-weight:700;color:#0275d8;text-align:center;margin:8px 0;">${formatVND(grandTotal)}</div>
      <div style="font-size:11px;">${rows}</div>
      <div class="actions" style="margin-top:8px;">
        <button id="qtoExportExcelBtn">📥 Xuất Excel</button>
        <button id="qtoExportPdfBtn">📄 Xuất PDF</button>
      </div>
    </div>`;
  document.getElementById("qtoExportExcelBtn").addEventListener("click", exportQtoExcel);
  document.getElementById("qtoExportPdfBtn").addEventListener("click", exportQtoPdf);
}

/* ---------------------------------------------------------------------
   4. XUẤT BÁO CÁO — DẠNG BẢNG TIÊN LƯỢNG QUEN THUỘC
   --------------------------------------------------------------------- */
function exportQtoExcel() {
  if (qtoItems.length === 0) { alert("Chưa có dữ liệu."); return; }

  const rows = [];
  let stt = 1;
  Object.keys(QTO_CATEGORY_LABELS).forEach(cat => {
    const items = qtoItems.filter(it => it.category === cat);
    if (items.length === 0) return;
    rows.push({ "STT": "", "Mã hiệu": "", "Tên công tác": QTO_CATEGORY_LABELS[cat].toUpperCase(), "Đơn vị": "", "Khối lượng": "", "Đơn giá": "", "Thành tiền": "" });
    items.forEach(it => {
      rows.push({
        "STT": stt++,
        "Mã hiệu": it.norm_code || "",
        "Tên công tác": it.name,
        "Đơn vị": QTO_UNIT_LABELS[it.unit],
        "Khối lượng": Number(it.quantity.toFixed(3)),
        "Đơn giá": it.unit_price,
        "Thành tiền": Number((it.quantity * it.unit_price).toFixed(0))
      });
    });
  });

  const grandTotal = qtoItems.reduce((s, it) => s + it.quantity * it.unit_price, 0);
  rows.push({ "STT": "", "Mã hiệu": "", "Tên công tác": "TỔNG CỘNG", "Đơn vị": "", "Khối lượng": "", "Đơn giá": "", "Thành tiền": Number(grandTotal.toFixed(0)) });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Bảng Tiên Lượng");
  XLSX.writeFile(wb, `BangTienLuong_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

function exportQtoPdf() {
  if (qtoItems.length === 0) { alert("Chưa có dữ liệu."); return; }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: "landscape" });
  const grandTotal = qtoItems.reduce((s, it) => s + it.quantity * it.unit_price, 0);

  doc.setFontSize(16);
  doc.text("Bảng Tiên Lượng / Bóc Tách Khối Lượng", 14, 15);
  doc.setFontSize(10);
  doc.text(`Ngày xuất: ${new Date().toLocaleString("vi-VN")}  ·  Tổng cộng: ${formatVND(grandTotal)}`, 14, 22);
  doc.setFontSize(8);
  doc.text("Lưu ý: mã hiệu/đơn giá do người dùng tự nhập, cần đối chiếu Định mức dự toán XD Việt Nam hiện hành.", 14, 27);

  const body = [];
  let stt = 1;
  Object.keys(QTO_CATEGORY_LABELS).forEach(cat => {
    const items = qtoItems.filter(it => it.category === cat);
    if (items.length === 0) return;
    body.push([{ content: QTO_CATEGORY_LABELS[cat].toUpperCase(), colSpan: 6, styles: { fontStyle: "bold", fillColor: [240, 240, 240] } }]);
    items.forEach(it => {
      body.push([
        stt++, it.norm_code || "", it.name + (it.estimated_count > 0 ? " (*)" : ""),
        QTO_UNIT_LABELS[it.unit], it.quantity.toFixed(2),
        it.unit_price.toLocaleString("vi-VN"), (it.quantity * it.unit_price).toLocaleString("vi-VN")
      ]);
    });
  });

  doc.autoTable({
    startY: 32,
    head: [["STT", "Mã hiệu", "Tên công tác", "Đơn vị", "Khối lượng", "Đơn giá", "Thành tiền"]],
    body,
    styles: { fontSize: 8 }
  });

  doc.save(`BangTienLuong_${new Date().toISOString().slice(0, 10)}.pdf`);
}

injectQtoUI();
