/* =====================================================================
   CDE WIND STREAMLINES MODULE — Đường dòng gió động kiểu SimScale
   (Bước 1+2 của lộ trình: dữ liệu mẫu cứng (chưa phải vật lý thật) +
   hiển thị/animate bằng xeokit. Bước 3 — thay dữ liệu mẫu bằng kết quả
   tính toán thật từ backend Python — làm sau khi có server riêng.)

   Cấu trúc dữ liệu mong đợi (JSON), khớp với đề xuất backend sau này:
   [
     { "id": 1, "points": [[x,y,z], ...], "velocities": [v0, v1, ...] },
     ...
   ]
   ===================================================================== */

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
    <div class="fname">🌊 Đường dòng động (thử nghiệm hiển thị)</div>
    <div class="meta">
      Bước 1+2 của lộ trình: dữ liệu bên dưới là DỮ LIỆU MẪU dựng sẵn (chưa phải kết quả tính toán vật lý thật) — dùng để kiểm tra cách hiển thị/animate trước khi nối với backend tính toán thật (Bước 3).
    </div>
    <button class="btn btn-primary" style="width:100%;margin-top:6px;" id="windStreamlineDemoBtn">🧪 Tạo dữ liệu mẫu & xem thử</button>
    <button class="btn" style="width:100%;margin-top:6px;" id="windStreamlineLoadJsonBtn">📂 Tải file JSON đường dòng (khi có từ backend)</button>
    <input type="file" id="windStreamlineFileInput" accept=".json" style="display:none;">
    <button class="btn" style="width:100%;margin-top:6px;" id="windStreamlineClearBtn">↺ Xoá đường dòng</button>`;
  panel.appendChild(box);

  document.getElementById("windStreamlineDemoBtn").addEventListener("click", generateDemoStreamlines);
  document.getElementById("windStreamlineClearBtn").addEventListener("click", clearWindStreamlines);
  document.getElementById("windStreamlineLoadJsonBtn").addEventListener("click", () => {
    document.getElementById("windStreamlineFileInput").click();
  });
  document.getElementById("windStreamlineFileInput").addEventListener("change", handleStreamlineJsonUpload);
}

/* ---------------------------------------------------------------------
   1. DỮ LIỆU MẪU CỨNG (Bước 1) — 5 đường uốn lượn quanh vùng đã chọn
   (dùng lại windAreaPoints nếu cậu đã chọn vùng ở khối "Vùng khảo sát"
   phía trên; nếu chưa chọn, dùng 1 vùng mặc định quanh gốc toạ độ).
   --------------------------------------------------------------------- */
function generateDemoStreamlines() {
  let minX = -10, maxX = 10, minZ = -10, maxZ = 10, baseY = 0;
  if (typeof windAreaPoints !== "undefined" && windAreaPoints.length === 2) {
    const [p1, p2] = windAreaPoints;
    minX = Math.min(p1[0], p2[0]); maxX = Math.max(p1[0], p2[0]);
    minZ = Math.min(p1[2], p2[2]); maxZ = Math.max(p1[2], p2[2]);
    baseY = (p1[1] + p2[1]) / 2 + 1.5;
  } else if (typeof viewer !== "undefined" && viewer.scene.aabb) {
    const aabb = viewer.scene.aabb;
    minX = aabb[0]; maxX = aabb[3]; minZ = aabb[2]; maxZ = aabb[5];
    baseY = aabb[4] + 1.5;
  }

  const lines = [];
  const lineCount = 5;
  const pointsPerLine = 24;
  for (let l = 0; l < lineCount; l++) {
    const startZ = minZ + (maxZ - minZ) * ((l + 0.5) / lineCount);
    const points = [], velocities = [];
    for (let k = 0; k <= pointsPerLine; k++) {
      const t = k / pointsPerLine;
      const x = minX + (maxX - minX) * t;
      // Uốn lượn giả lập "né chướng ngại vật" — CHỈ để test hiển thị, không phải vật lý thật
      const wiggle = Math.sin(t * Math.PI * 2 + l) * (maxZ - minZ) * 0.08;
      const z = startZ + wiggle;
      const y = baseY + Math.sin(t * Math.PI * 3 + l) * 0.3;
      points.push([x, y, z]);
      // Vận tốc giả lập: chậm lại ở giữa đoạn (như đi qua vùng bị che), nhanh ở 2 đầu
      const v = 3 + 4 * Math.abs(Math.sin(t * Math.PI));
      velocities.push(v);
    }
    lines.push({ id: l + 1, points, velocities });
  }

  windStreamlineData = { lines };
  renderWindStreamlines(windStreamlineData);
}

/* ---------------------------------------------------------------------
   2. TẢI FILE JSON THẬT (khi có dữ liệu từ backend — Bước 3 sau này)
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

    const positions = [], colors = [], indices = [];
    for (let i = 0; i < points.length; i++) {
      const [x, y, z] = points[i];
      const c = velocityToColor(velocities[i] ?? velocities[velocities.length - 1], maxV);
      // 2 đỉnh mỗi điểm (trên/dưới) tạo dải ruy băng mỏng theo phương đứng —
      // đơn giản hoá, đủ để thấy hướng + màu, không phải ống tròn 3D thật.
      positions.push(x, y - width / 2, z, x, y + width / 2, z);
      colors.push(...c, 1, ...c, 1);
    }
    for (let i = 0; i < points.length - 1; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      indices.push(a, c, b, b, c, d);
    }

    const mesh = new window.XeokitMesh(window.viewer.scene, {
      geometry: new window.XeokitReadableGeometry(window.viewer.scene, {
        primitive: "triangles", positions, indices, colors, normals: null
      }),
      material: new window.XeokitPhongMaterial(window.viewer.scene, {
        diffuse: [1, 1, 1], backfaces: true, emissive: [0.3, 0.3, 0.3]
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
