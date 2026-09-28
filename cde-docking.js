/* =====================================================================
   CDE DOCKING SYSTEM — Ghim panel về 2 bên/dưới màn hình (kiểu
   Navisworks), giữ khung nhìn 3D luôn ở giữa, không bị panel che mất.

   Cách hoạt động: theo dõi (MutationObserver) mọi phần tử có class
   "panel" được thêm vào <body> — dù đã có sẵn hay được tạo bởi bất kỳ
   file .js nào sau này — rồi tự động chèn 4 nút ghim (◧ Trái/◨ Phải/
   ▭ Dưới/⬜ Nổi) vào .panel-header của nó. KHÔNG cần sửa tay từng file
   panel hiện có.

   Phải load TRƯỚC mọi file tạo panel khác (cde-auth.js, cde-timeline.js,
   ...) để observer kịp bắt các panel được tạo ngay khi các file đó chạy.
   ===================================================================== */

(function () {
  const DOCK_WIDTH = 360;
  const DOCK_BOTTOM_HEIGHT = 260;

  function ensureDockZones() {
    if (document.getElementById("dockLeft")) return;
    const mkZone = (id, cssText) => {
      const el = document.createElement("div");
      el.id = id;
      el.style.cssText = cssText;
      document.body.appendChild(el);
      watchDockZone(el);
      return el;
    };
    mkZone("dockLeft",
      `position:fixed; top:0; left:0; bottom:0; width:${DOCK_WIDTH}px; background:#eef0f2;
       border-right:1px solid #ddd; overflow-y:auto; z-index:80; display:none;
       flex-direction:column; padding:8px; box-sizing:border-box; gap:8px;`);
    mkZone("dockRight",
      `position:fixed; top:0; right:0; bottom:0; width:${DOCK_WIDTH}px; background:#eef0f2;
       border-left:1px solid #ddd; overflow-y:auto; z-index:80; display:none;
       flex-direction:column; padding:8px; box-sizing:border-box; gap:8px;`);
    mkZone("dockBottom",
      `position:fixed; left:0; right:0; bottom:0; height:${DOCK_BOTTOM_HEIGHT}px; background:#eef0f2;
       border-top:1px solid #ddd; overflow-x:auto; overflow-y:hidden; z-index:80; display:none;
       flex-direction:row; padding:8px; box-sizing:border-box; gap:8px;`);
  }

  function hasVisibleChild(zone) {
    if (!zone) return false;
    return [...zone.children].some(c => getComputedStyle(c).display !== "none");
  }

  let isUpdatingInsets = false;

  function updateViewportInsets() {
    const canvas = document.getElementById("myCanvas");
    if (!canvas) return;
    isUpdatingInsets = true;

    const dockLeft = document.getElementById("dockLeft");
    const dockRight = document.getElementById("dockRight");
    const dockBottom = document.getElementById("dockBottom");

    const leftOpen = hasVisibleChild(dockLeft);
    const rightOpen = hasVisibleChild(dockRight);
    const bottomOpen = hasVisibleChild(dockBottom);

    if (dockLeft) dockLeft.style.display = leftOpen ? "flex" : "none";
    if (dockRight) dockRight.style.display = rightOpen ? "flex" : "none";
    if (dockBottom) dockBottom.style.display = bottomOpen ? "flex" : "none";

    const leftW = leftOpen ? DOCK_WIDTH : 0;
    const rightW = rightOpen ? DOCK_WIDTH : 0;
    const bottomH = bottomOpen ? DOCK_BOTTOM_HEIGHT : 0;

    canvas.style.position = "fixed";
    canvas.style.top = "0";
    canvas.style.left = leftW + "px";
    canvas.style.right = rightW + "px";
    canvas.style.bottom = bottomH + "px";
    canvas.style.width = `calc(100vw - ${leftW + rightW}px)`;
    canvas.style.height = `calc(100vh - ${bottomH}px)`;

    const navCanvas = document.getElementById("myNavCubeCanvas");
    if (navCanvas) navCanvas.style.right = (rightW + 15) + "px";

    // Nhả cờ sau khi trình duyệt xử lý xong các thay đổi vừa rồi, tránh
    // observer bên dưới bị kích hoạt lặp vô hạn bởi chính lần cập nhật này.
    setTimeout(() => { isUpdatingInsets = false; }, 0);
  }
  window.updateViewportInsets = updateViewportInsets;

  // Theo dõi mỗi khi 1 panel trong khung ghim được bật/tắt (các file khác
  // đổi style.display trực tiếp, không báo cho hệ thống này) để tự thu/mở
  // lại khung ghim cho đúng.
  function watchDockZone(zone) {
    const obs = new MutationObserver(() => {
      if (!isUpdatingInsets) updateViewportInsets();
    });
    obs.observe(zone, { childList: true, subtree: true, attributes: true, attributeFilter: ["style"] });
  }

  window.makeDockable = function (panelEl) {
    const header = panelEl.querySelector(".panel-header");
    if (!header || header.dataset.dockified) return;
    header.dataset.dockified = "1";
    ensureDockZones();

    const pinGroup = document.createElement("span");
    pinGroup.style.cssText = "display:inline-flex; gap:5px; margin-right:8px; font-size:12px;";
    pinGroup.innerHTML = `
      <span title="Ghim trái" class="cde-dock-btn" data-dock="left" style="cursor:pointer;">◧</span>
      <span title="Ghim phải" class="cde-dock-btn" data-dock="right" style="cursor:pointer;">◨</span>
      <span title="Ghim dưới" class="cde-dock-btn" data-dock="bottom" style="cursor:pointer;">▭</span>
      <span title="Thả nổi" class="cde-dock-btn" data-dock="float" style="cursor:pointer;">⬜</span>`;
    header.insertBefore(pinGroup, header.lastElementChild);

    function applyDock(newState) {
      if (newState === "float") {
        panelEl.style.position = "absolute";
        panelEl.style.width = "";
        panelEl.style.flexShrink = "";
        panelEl.style.marginBottom = "";
        document.body.appendChild(panelEl);
      } else {
        panelEl.style.position = "static";
        panelEl.style.width = newState === "bottom" ? "340px" : "100%";
        panelEl.style.flexShrink = "0";
        panelEl.style.marginBottom = "0";
        const zone = document.getElementById(
          newState === "left" ? "dockLeft" : newState === "right" ? "dockRight" : "dockBottom"
        );
        zone.appendChild(panelEl);
      }
      updateViewportInsets();
    }

    pinGroup.querySelectorAll(".cde-dock-btn").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        applyDock(btn.dataset.dock);
      });
    });
  };

  function enhanceIfPanel(node) {
    if (!node || node.nodeType !== 1) return;
    if (node.classList && node.classList.contains("panel")) window.makeDockable(node);
    // Phòng trường hợp panel được bọc trong 1 node cha khác khi thêm vào body
    if (node.querySelectorAll) {
      node.querySelectorAll(".panel").forEach(p => window.makeDockable(p));
    }
  }

  const observer = new MutationObserver((mutations) => {
    mutations.forEach(m => m.addedNodes.forEach(enhanceIfPanel));
  });
  observer.observe(document.body, { childList: true });

  // Xử lý luôn panel nào đã có sẵn trong DOM trước khi script này chạy
  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll(".panel").forEach(enhanceIfPanel);
  });
})();
