/* =====================================================================
   CDE BCF MODULE — Xuất file BCF 2.1 (.bcfzip) đúng chuẩn buildingSMART
   để các phần mềm khác (BIMcollab/Revit, Navisworks, Solibri...) đọc
   được viewpoint và zoom đúng góc nhìn.

   Các điểm quan trọng so với bản cũ:
   - GUID viewpoint trong markup.bcf và viewpoint.bcfv PHẢI trùng nhau.
   - Có <Comment> trỏ tới viewpoint + có snapshot (BIMcollab dựa vào đây).
   - bcf.version đúng chuẩn (không namespace mặc định, có DetailedVersion).
   - Thứ tự thẻ trong <Topic> đúng schema; escape ký tự đặc biệt XML.
   - Toạ độ camera đổi từ hệ Y-up của xeokit sang hệ Z-up của IFC/BCF
     (x, y, z)_xeokit -> (x, -z, y)_BCF. Nếu zoom vẫn lệch vị trí do mô
     hình có gốc toạ độ dịch (offset), đặt window.CDE_BCF_AXIS_CONVERT =
     false để tắt đổi trục, hoặc báo lại để chỉnh thêm offset.
   ===================================================================== */

(function (root) {
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

  function xyz(tag, v) {
    return `<${tag}>\n      <X>${num(v[0])}</X>\n      <Y>${num(v[1])}</Y>\n      <Z>${num(v[2])}</Z>\n    </${tag}>`;
  }

  /**
   * Dựng nội dung 3 file XML của 1 topic BCF.
   * p: { title, description, author, status, topicType, priority, dueDate,
   *      assignedTo, eye, look, up, fov, targetIds[], snapshotName,
   *      topicGuid?, viewpointGuid? }
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
      const eyeB = toBcf(p.eye);
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
      try {
        let url = viewer.getSnapshot ? await viewer.getSnapshot({ format: "png", width: 960, height: 540 }) : null;
        if (!parseDataUrl(url) && viewer.scene && viewer.scene.canvas) url = viewer.scene.canvas.canvas.toDataURL("image/png");
        snapshot = parseDataUrl(url);
      } catch (e) { snapshot = null; }
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
      eye, look, up, fov, targetIds: opts.targetIds, snapshotName
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

  root.CdeBcf = { buildBcfFiles, parseDataUrl };
  root.exportBcfIssue = exportBcfIssue;
  if (typeof module !== "undefined" && module.exports) module.exports = root.CdeBcf;
})(typeof window !== "undefined" ? window : globalThis);
