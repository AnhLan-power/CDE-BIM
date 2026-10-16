/* =====================================================================
   CDE BCF MODULE — Xuất file BCF 2.1 (.bcfzip) đúng chuẩn buildingSMART
   để các phần mềm khác (BIMcollab/Revit, Navisworks, Solibri...) đọc
   được viewpoint và zoom đúng góc nhìn.

   - GUID viewpoint trong markup.bcf và viewpoint.bcfv trùng nhau; có
     <Comment> trỏ tới viewpoint + snapshot; bcf.version đúng chuẩn;
     thứ tự thẻ <Topic> đúng schema; escape ký tự đặc biệt XML.
   - Toạ độ camera đổi từ hệ Y-up của xeokit sang hệ Z-up của IFC/BCF:
     (x, y, z)_xeokit -> (x, -z, y)_BCF  (đã kiểm chứng đúng hướng nhìn
     với ViewCube của Revit). Tắt bằng window.CDE_BCF_AXIS_CONVERT=false.
   - OFFSET toạ độ: mô hình gắn toạ độ địa lý thật (hàng trăm nghìn mét)
     nên Revit/BIMcollab có thể đặt gốc khác IFC -> camera rơi rất xa mô
     hình. Offset (m) được TRỪ khỏi vị trí camera khi xuất; lưu theo
     trình duyệt (localStorage), chỉnh trong khung "Căn chỉnh toạ độ BCF".
   - Chụp ảnh bằng render() + drawImage, KHÔNG dùng viewer.getSnapshot
     (hàm đó đổi kích thước canvas làm khung 3D bị đen tới khi tương tác).
   ===================================================================== */

(function (root) {
  const OFFSET_KEY = "cde_bcf_origin_offset";

  function uuid() {
    if (root.crypto && root.crypto.randomUUID) return root.crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === "x" ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  function esc(s) {
    return String(s === undefined || s === null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
  }

  function num(v) {
    const n = Number(Number(v).toFixed(6));
    return Number.isFinite(n) ? String(n) : "0";
  }

  function normalize(v) {
    const len = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]) || 1;
    return [v[0] / len, v[1] / len, v[2] / len];
  }

  // xeokit (Y-up) -> BCF/IFC (Z-up)
  function toBcf(v) {
    if (root.CDE_BCF_AXIS_CONVERT === false) return [v[0], v[1], v[2]];
    return [v[0], -v[2], v[1]];
  }

  function getOffset() {
    try {
      const a = JSON.parse(root.localStorage.getItem(OFFSET_KEY));
      if (Array.isArray(a) && a.length === 3 && a.every(Number.isFinite)) return a;
    } catch (e) { /* không có / hỏng -> 0 */ }
    return [0, 0, 0];
  }

  function setOffset(a) {
    try { root.localStorage.setItem(OFFSET_KEY, JSON.stringify(a.map(Number))); } catch (e) { /* bỏ qua */ }
  }

  function xyz(tag, v) {
    return `<${tag}>\n      <X>${num(v[0])}</X>\n      <Y>${num(v[1])}</Y>\n      <Z>${num(v[2])}</Z>\n    </${tag}>`;
  }

  /**
   * Dựng nội dung 3 file XML của 1 topic BCF.
   * p: { title, description, author, status, topicType, priority, dueDate,
   *      assignedTo, eye, look, up, fov, targetIds[], snapshotName,
   *      offset:[x,y,z] (m, trừ khỏi vị trí camera), topicGuid?, viewpointGuid? }
   */
  function buildBcfFiles(p) {
    const topicGuid = p.topicGuid || uuid();
    const viewpointGuid = p.viewpointGuid || uuid();
    const commentGuid = uuid();
    const now = new Date().toISOString();
    const author = p.author || "cde@bim.local";
    const title = p.title || "Sự cố BIM CDE";
    const description = p.description || "";
    const hasCamera = !!(p.eye && p.look && p.up);
    const ids = (p.targetIds || []).filter(Boolean);
    const off = p.offset || [0, 0, 0];

    let dueXml = "";
    if (p.dueDate) {
      const d = new Date(p.dueDate);
      if (!isNaN(d)) dueXml = `\n    <DueDate>${d.toISOString()}</DueDate>`;
    }

    const markup = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Markup xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <Topic Guid="${topicGuid}" TopicType="${esc(p.topicType || "Issue")}" TopicStatus="${esc(p.status || "Open")}">
    <Title>${esc(title)}</Title>${p.priority ? `\n    <Priority>${esc(p.priority)}</Priority>` : ""}
    <CreationDate>${now}</CreationDate>
    <CreationAuthor>${esc(author)}</CreationAuthor>${dueXml}${p.assignedTo ? `\n    <AssignedTo>${esc(p.assignedTo)}</AssignedTo>` : ""}
    <Description>${esc(description)}</Description>
  </Topic>
  <Comment Guid="${commentGuid}">
    <Date>${now}</Date>
    <Author>${esc(author)}</Author>
    <Comment>${esc(description || title)}</Comment>${hasCamera ? `\n    <Viewpoint Guid="${viewpointGuid}" />` : ""}
  </Comment>${hasCamera ? `
  <Viewpoints Guid="${viewpointGuid}">
    <Viewpoint>viewpoint.bcfv</Viewpoint>${p.snapshotName ? `\n    <Snapshot>${esc(p.snapshotName)}</Snapshot>` : ""}
  </Viewpoints>` : ""}
</Markup>`;

    let viewpoint = null;
    if (hasCamera) {
      const eyeRaw = toBcf(p.eye);
      const eyeB = [eyeRaw[0] - off[0], eyeRaw[1] - off[1], eyeRaw[2] - off[2]];
      const dirB = normalize(toBcf([p.look[0] - p.eye[0], p.look[1] - p.eye[1], p.look[2] - p.eye[2]]));
      const upB = normalize(toBcf(p.up));
      const fov = p.fov || 45;

      viewpoint = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<VisualizationInfo Guid="${viewpointGuid}">${ids.length ? `
  <Components>
    <Selection>${ids.map(id => `\n      <Component IfcGuid="${esc(id)}" />`).join("")}
    </Selection>
  </Components>` : ""}
  <PerspectiveCamera>
    ${xyz("CameraViewPoint", eyeB)}
    ${xyz("CameraDirection", dirB)}
    ${xyz("CameraUpVector", upB)}
    <FieldOfView>${num(fov)}</FieldOfView>
  </PerspectiveCamera>
</VisualizationInfo>`;
    }

    const version = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Version xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" VersionId="2.1">
  <DetailedVersion>2.1</DetailedVersion>
</Version>`;

    return { topicGuid, viewpointGuid, markup, viewpoint, version };
  }

  function parseDataUrl(dataUrl) {
    const m = /^data:image\/(png|jpeg|jpg);base64,(.+)$/.exec(dataUrl || "");
    if (!m) return null;
    return { ext: m[1] === "jpeg" ? "jpg" : m[1], base64: m[2] };
  }

  /**
   * Chụp khung nhìn 3D hiện tại -> data URL. Ép render 1 khung rồi vẽ ngay
   * sang canvas nhỏ trong cùng 1 lượt (không cần preserveDrawingBuffer) và
   * KHÔNG đổi kích thước canvas chính -> không làm khung 3D bị đen.
   */
  function captureViewerImage(width, mime, quality) {
    const viewer = root.viewer;
    if (!viewer || !viewer.scene || !viewer.scene.canvas) return null;
    const src = viewer.scene.canvas.canvas;
    try { viewer.scene.render(true); } catch (e) { /* vẫn thử chụp */ }
    if (!src.width || !src.height) return null;
    const w = width || 480;
    const h = Math.max(1, Math.round(w * src.height / src.width));
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    c.getContext("2d").drawImage(src, 0, 0, w, h);
    return c.toDataURL(mime || "image/jpeg", quality || 0.85);
  }

  /**
   * Xuất + tải về file .bcfzip.
   * opts: { title, description, targetIds, eye, look, up, snapshotDataUrl,
   *         attachView (mặc định true), status, topicType, priority,
   *         dueDate, assignedTo }
   * Không truyền eye/look/up -> dùng camera hiện tại + chụp snapshot mới.
   */
  async function exportBcfIssue(opts) {
    opts = opts || {};
    const viewer = root.viewer;
    const attachView = opts.attachView !== false;

    let eye = opts.eye, look = opts.look, up = opts.up;
    let snapshot = parseDataUrl(opts.snapshotDataUrl);

    if (attachView && !eye && viewer) {
      eye = [...viewer.camera.eye];
      look = [...viewer.camera.look];
      up = [...viewer.camera.up];
      try { snapshot = parseDataUrl(captureViewerImage(960, "image/png")); } catch (e) { snapshot = null; }
    }
    if (!attachView) { eye = look = up = null; snapshot = null; }

    let author = "cde@bim.local";
    try {
      if (typeof currentProfile !== "undefined" && currentProfile && (currentProfile.full_name || currentProfile.email)) {
        author = currentProfile.email || currentProfile.full_name;
      }
    } catch (e) { /* giữ mặc định */ }

    const fov = (viewer && viewer.camera && viewer.camera.perspective && viewer.camera.perspective.fov) || 45;
    const snapshotName = snapshot ? "snapshot." + snapshot.ext : null;

    const files = buildBcfFiles({
      title: opts.title, description: opts.description, author,
      status: opts.status, topicType: opts.topicType, priority: opts.priority,
      dueDate: opts.dueDate, assignedTo: opts.assignedTo,
      eye, look, up, fov, targetIds: opts.targetIds, snapshotName,
      offset: getOffset()
    });

    const zip = new JSZip();
    zip.file("bcf.version", files.version);
    const folder = zip.folder(files.topicGuid);
    folder.file("markup.bcf", files.markup);
    if (files.viewpoint) folder.file("viewpoint.bcfv", files.viewpoint);
    if (snapshot) folder.file(snapshotName, snapshot.base64, { base64: true });

    const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `CDE_Issue_${(opts.title || "BCF").replace(/[^\p{L}\p{N}]+/gu, "_")}.bcfzip`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 2000);

    return { topicGuid: files.topicGuid };
  }

  /* ------------------------------------------------------------------
     KHUNG "CĂN CHỈNH TOẠ ĐỘ BCF" trong panel Tạo BCF Issue
     ------------------------------------------------------------------ */
  function fmt(v) { return v.map(n => Number(n).toFixed(3)).join(" ; "); }

  function selectedCenterBcf() {
    const viewer = root.viewer;
    if (!viewer || !viewer.scene) return null;
    const ids = viewer.scene.selectedObjectIds || [];
    let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity], n = 0;
    ids.forEach(id => {
      const e = viewer.scene.objects[id];
      if (!e || !e.aabb) return;
      const a = e.aabb;
      for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], a[i]); max[i] = Math.max(max[i], a[i + 3]); }
      n++;
    });
    if (!n) return null;
    const c = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
    const s = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
    return { n, center: toBcf(c), size: [s[0], s[2], s[1]] };
  }

  function refreshReadout() {
    const el = root.document.getElementById("bcfCoordReadout");
    if (!el) return;
    const viewer = root.viewer;
    if (!viewer) { el.textContent = "Chưa nạp mô hình."; return; }
    const off = getOffset();
    const eye = toBcf(viewer.camera.eye);
    const sent = [eye[0] - off[0], eye[1] - off[1], eye[2] - off[2]];
    const sel = selectedCenterBcf();
    el.textContent =
      "Camera (toạ độ IFC, m)  : " + fmt(eye) + "\n" +
      "Camera gửi đi (-offset) : " + fmt(sent) + "\n" +
      (sel ? "Tâm " + sel.n + " cấu kiện chọn  : " + fmt(sel.center) + "\nKích thước (Đ;B;Cao)   : " + fmt(sel.size)
           : "Tâm cấu kiện chọn     : (chưa chọn cấu kiện nào)");
    const o = getOffset();
    ["X", "Y", "Z"].forEach((k, i) => { const inp = root.document.getElementById("bcfOff" + k); if (inp && root.document.activeElement !== inp) inp.value = o[i]; });
  }

  function injectCalibrationUI() {
    const d = root.document;
    const refreshBtn = d.getElementById("bcfRefreshView");
    if (!refreshBtn || d.getElementById("bcfCalibBox")) return;

    const box = d.createElement("details");
    box.id = "bcfCalibBox";
    box.style.cssText = "margin-top:8px;font-size:11px;";
    box.innerHTML = `
      <summary style="cursor:pointer;font-weight:600;">⚙️ Căn chỉnh toạ độ BCF (nếu Revit zoom lệch)</summary>
      <div style="margin-top:6px;color:#555;line-height:1.5;">
        <pre id="bcfCoordReadout" style="background:#f6f8fa;border-radius:6px;padding:6px;font-size:10px;white-space:pre-wrap;margin:0;"></pre>
        <button type="button" id="bcfCoordRefresh" class="btn" style="width:100%;margin-top:4px;font-size:10px;">🔄 Cập nhật toạ độ</button>
        <div style="margin-top:6px;font-weight:600;">Offset trừ khỏi vị trí camera khi xuất (m):</div>
        <div style="display:flex;gap:4px;">
          <input type="number" step="any" id="bcfOffX" placeholder="X (Đông)" style="flex:1;min-width:0;">
          <input type="number" step="any" id="bcfOffY" placeholder="Y (Bắc)" style="flex:1;min-width:0;">
          <input type="number" step="any" id="bcfOffZ" placeholder="Z (Cao)" style="flex:1;min-width:0;">
        </div>
        <div style="display:flex;gap:4px;margin-top:4px;">
          <button type="button" id="bcfOffSave" class="btn" style="flex:1;font-size:10px;">💾 Lưu offset</button>
          <button type="button" id="bcfOffZero" class="btn" style="flex:1;font-size:10px;">↺ Về 0</button>
        </div>
        <div style="margin-top:6px;color:#888;">
          Mô hình dùng toạ độ địa lý thật (hàng trăm nghìn mét). Nếu BIMcollab/Revit đặt gốc toạ độ khác IFC thì camera rơi rất xa mô hình.
          Offset = toạ độ IFC của 1 điểm (xem ở trên) − toạ độ của <b>đúng điểm đó</b> trong Revit. Offset lưu theo trình duyệt và áp dụng cho cả nút "Xuất BCF" của ToDo.
        </div>
      </div>`;
    refreshBtn.parentNode.insertBefore(box, refreshBtn.nextSibling);

    d.getElementById("bcfCoordRefresh").addEventListener("click", refreshReadout);
    box.addEventListener("toggle", () => { if (box.open) refreshReadout(); });
    d.getElementById("bcfOffSave").addEventListener("click", () => {
      const v = ["X", "Y", "Z"].map(k => parseFloat(d.getElementById("bcfOff" + k).value) || 0);
      setOffset(v); refreshReadout();
    });
    d.getElementById("bcfOffZero").addEventListener("click", () => { setOffset([0, 0, 0]); refreshReadout(); });
  }

  root.CdeBcf = { buildBcfFiles, parseDataUrl, getOffset, setOffset };
  root.CdeSnapshot = { capture: captureViewerImage };
  root.exportBcfIssue = exportBcfIssue;
  if (typeof module !== "undefined" && module.exports) module.exports = root.CdeBcf;

  if (root.document && root.document.getElementById) injectCalibrationUI();
})(typeof window !== "undefined" ? window : globalThis);
