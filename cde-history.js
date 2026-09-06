/* =====================================================================
   CDE HISTORY MODULE — Xem lại lịch sử các lần Check Va Chạm đã lưu
   Markup được xử lý trực tiếp trong module chính của index.html (vì cần
   vẽ pin 3D) — xem window.loadProjectMarkups ở đó.
   ===================================================================== */

let clashHistoryLoaded = false;

window.toggleClashHistory = async function () {
  const box = document.getElementById("clashHistoryBox");
  const willShow = box.style.display !== "block";
  box.style.display = willShow ? "block" : "none";
  if (willShow) await loadClashHistory();
};

async function loadClashHistory() {
  const box = document.getElementById("clashHistoryBox");
  if (!activeProjectId) {
    box.innerHTML = `<div style="color:#999;font-size:11px;padding:6px 0;">Chọn dự án trong panel 📁 CDE trước.</div>`;
    return;
  }

  box.innerHTML = `<div style="font-size:11px;color:#888;padding:6px 0;">Đang tải...</div>`;

  const { data, error } = await sb
    .from("project_clash_runs")
    .select("*")
    .eq("project_id", activeProjectId)
    .order("created_at", { ascending: false })
    .limit(30);

  if (error) { box.innerHTML = `<div style="color:#d9534f;font-size:11px;">${error.message}</div>`; return; }
  if (!data || data.length === 0) {
    box.innerHTML = `<div style="color:#999;font-size:11px;padding:6px 0;">Chưa có lần quét nào được lưu.</div>`;
    return;
  }

  box.innerHTML = "";
  data.forEach(run => box.appendChild(buildClashHistoryCard(run)));
}

function buildClashHistoryCard(run) {
  const card = document.createElement("div");
  card.className = "cde-file-card";
  const dateStr = new Date(run.created_at).toLocaleString("vi-VN");
  card.innerHTML = `
    <div class="fname" style="font-size:11px;">${dateStr}</div>
    <div class="meta" style="font-size:10px;">
      Chế độ: ${run.mode || "-"} · Clearance: ${run.tolerance}m<br>
      Tổng: <b>${run.clash_count}</b> va chạm (${run.hard_count} đâm xuyên thật, ${run.soft_count} chạm nhẹ)
    </div>
    <div class="actions"><button id="clashHistDetail_${run.id}">👁 Xem chi tiết</button></div>
    <div id="clashHistTable_${run.id}" style="display:none;margin-top:6px;"></div>`;

  card.querySelector(`#clashHistDetail_${run.id}`).addEventListener("click", () => {
    const tableBox = card.querySelector(`#clashHistTable_${run.id}`);
    const show = tableBox.style.display !== "block";
    tableBox.style.display = show ? "block" : "none";
    if (show && !tableBox.dataset.rendered) {
      const clashes = run.clashes || [];
      tableBox.innerHTML = renderClashHistoryTable(clashes);
      tableBox.dataset.rendered = "1";
      tableBox.querySelectorAll(".clash-hist-row").forEach(row => {
        row.addEventListener("click", () => {
          const idx = parseInt(row.dataset.idx);
          window.zoomToHistoryClash(clashes[idx]);
        });
      });
    }
  });

  return card;
}

function renderClashHistoryTable(clashes) {
  if (clashes.length === 0) return `<div style="font-size:10px;color:#999;">Không có va chạm nào.</div>`;
  const rows = clashes.map((c, idx) => `
    <tr class="clash-hist-row" data-idx="${idx}" style="border-bottom:1px solid #eee;cursor:pointer;">
      <td style="padding:3px;">${c.isHardClash ? "🔴 Đâm xuyên" : "🟡 Chạm nhẹ"}</td>
      <td style="padding:3px;">${(c.realPenetration ?? 0).toFixed(3)}</td>
      <td style="padding:3px;">${c.labelA || c.globalIdA || "-"}</td>
      <td style="padding:3px;">${c.labelB || c.globalIdB || "-"}</td>
    </tr>`).join("");
  return `
    <table style="width:100%;font-size:10px;border-collapse:collapse;" id="clashHistTable_${Math.random().toString(36).slice(2)}">
      <thead><tr style="background:#f1f3f5;"><th style="padding:3px;text-align:left;">Trạng thái</th><th style="padding:3px;text-align:left;">Ăn sâu (m)</th><th style="padding:3px;text-align:left;">Cấu kiện A</th><th style="padding:3px;text-align:left;">Cấu kiện B</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div style="font-size:9px;color:#999;margin-top:4px;">💡 Bấm vào 1 dòng để zoom/highlight tới đúng cấu kiện (chỉ hoạt động nếu model tương ứng đang được nạp trong phiên hiện tại).</div>`;
}

// Quy đổi GlobalId (lưu trong lịch sử, ổn định lâu dài) về đúng object id
// đang tồn tại trong phiên viewer hiện tại (có thể khác giữa các lần nạp
// model, nhất là khi có tiền tố "<modelId>#...").
function resolveGlobalIdToViewerId(globalId) {
  if (!globalId || !viewer || !viewer.scene) return null;
  if (viewer.scene.objects[globalId]) return globalId; // trùng khớp trực tiếp
  for (const id of viewer.scene.objectIds) {
    const e = viewer.scene.objects[id];
    if (e && e.originalSystemId === globalId) return id;
  }
  return null;
}

window.zoomToHistoryClash = function (clash) {
  const idA = resolveGlobalIdToViewerId(clash.globalIdA);
  const idB = resolveGlobalIdToViewerId(clash.globalIdB);
  if (!idA || !idB) {
    alert("Không tìm thấy 1 hoặc cả 2 cấu kiện này trong model đang mở — cần nạp đúng model của lần quét này trước.");
    return;
  }
  if (window.highlightClashPair) window.highlightClashPair(idA, idB);
};
