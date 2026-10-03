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
      `position:fixed; bottom:0; height:${DOCK_BOTTOM_HEIGHT}px; background:#eef0f2;
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

    // dockBottom chỉ trải giữa 2 dock trái/phải, không đè lên chúng
    if (dockBottom) {
      dockBottom.style.left = leftW + "px";
      dockBottom.style.right = rightW + "px";
    }

    canvas.style.position = "fixed";
    canvas.style.top = "0";
    canvas.style.left = leftW + "px";
    canvas.style.right = rightW + "px";
    canvas.style.bottom = bottomH + "px";
    canvas.style.width = `calc(100vw - ${leftW + rightW}px)`;
    canvas.style.height = `calc(100vh - ${bottomH}px)`;

    // NavCube và khung tên đăng nhập luôn bám theo đúng góc của khung 3D
    // đã co lại (không phải góc toàn màn hình nữa), để không bao giờ bị
    // dock trái/phải/dưới che mất.
    const navCanvas = document.getElementById("myNavCubeCanvas");
    if (navCanvas) {
      navCanvas.style.right = (rightW + 15) + "px";
      navCanvas.style.bottom = (bottomH + 15) + "px";
    }
    const userBadge = document.getElementById("cdeUserBadge");
    if (userBadge) {
      userBadge.style.right = (rightW + 15) + "px";
      userBadge.style.left = "auto";
    }

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

  // Khi ghim DƯỚI, khung rất rộng nhưng thấp — gói toàn bộ nội dung panel
  // (trừ phần tiêu đề) vào 1 hàng ngang cuộn được, mỗi khối rộng cố định,
  // thay vì xếp dọc rất dài gây phải cuộn nhiều. Không đụng tới code của
  // từng file panel — chỉ di chuyển đúng các <div> con đã có sẵn.
  function wrapContentHorizontally(panelEl) {
    if (panelEl.dataset.horizWrapped) return;
    const header = panelEl.querySelector(".panel-header");
    const rest = [...panelEl.children].filter(c => c !== header);
    if (rest.length === 0) return;

    const wrapper = document.createElement("div");
    wrapper.className = "cde-dock-bottom-row";
    wrapper.style.cssText = "display:flex; flex-direction:row; gap:10px; overflow-x:auto; align-items:flex-start; padding-top:6px; width:100%;";
    rest.forEach(el => {
      el.dataset.origFlex = el.style.flex || "";
      el.dataset.origMaxHeight = el.style.maxHeight || "";
      el.dataset.origOverflowY = el.style.overflowY || "";
      el.style.flex = "0 0 280px";
      el.style.maxHeight = (DOCK_BOTTOM_HEIGHT - 60) + "px";
      el.style.overflowY = "auto";
      wrapper.appendChild(el);
    });
    panelEl.appendChild(wrapper);
    panelEl.dataset.horizWrapped = "1";
  }

  function unwrapContentHorizontally(panelEl) {
    if (!panelEl.dataset.horizWrapped) return;
    const wrapper = panelEl.querySelector(":scope > .cde-dock-bottom-row");
    if (wrapper) {
      [...wrapper.children].forEach(el => {
        el.style.flex = el.dataset.origFlex || "";
        el.style.maxHeight = el.dataset.origMaxHeight || "";
        el.style.overflowY = el.dataset.origOverflowY || "";
        panelEl.appendChild(el);
      });
      wrapper.remove();
    }
    delete panelEl.dataset.horizWrapped;
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
      // Luôn tháo bọc hàng ngang trước, rồi mới bọc lại nếu cần — tránh
      // bọc lồng bọc khi đổi qua lại nhiều lần giữa các kiểu ghim.
      unwrapContentHorizontally(panelEl);

      if (newState === "float") {
        panelEl.style.position = "absolute";
        panelEl.style.width = "";
        panelEl.style.maxWidth = "";
        panelEl.style.flexShrink = "";
        panelEl.style.marginBottom = "";
        document.body.appendChild(panelEl);
      } else if (newState === "bottom") {
        panelEl.style.position = "static";
        panelEl.style.width = "auto";
        panelEl.style.maxWidth = "none";
        panelEl.style.flexShrink = "0";
        panelEl.style.marginBottom = "0";
        document.getElementById("dockBottom").appendChild(panelEl);
        wrapContentHorizontally(panelEl);
      } else {
        panelEl.style.position = "static";
        panelEl.style.width = "100%";
        panelEl.style.maxWidth = "";
        panelEl.style.flexShrink = "0";
        panelEl.style.marginBottom = "0";
        const zone = document.getElementById(newState === "left" ? "dockLeft" : "dockRight");
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
