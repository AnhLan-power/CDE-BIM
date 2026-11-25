/* =====================================================================
   CDE PROJECTS — Panel "Dự Án": hạn mức tạo dự án, xoá dự án, khu quản trị của admin
   - Hạn mức (mặc định 2 dự án/tài khoản) và quyền xoá được ÁP DỤNG Ở DATABASE (trigger + hàm delete_project,
     xem migration_projects_admin.sql); phần giao diện này chỉ hiện thông tin và báo lỗi cho dễ hiểu.
   - Không sửa cde-auth.js: module gắn thêm vào panel dự án (#cdeFilesPanel) lúc chạy.
   - Dùng chung biến toàn cục của cde-auth.js: sb, currentUser, currentProfile, currentProjects,
     activeProjectId, activeRole và hàm loadProfileAndProjects().
   ===================================================================== */

(function () {
  "use strict";

  const S = {
    quota: null, quotaErr: "", proj: null, adminOpen: false,
    accounts: null, allProjects: null, adminErr: "", accFilter: "", prjFilter: "",
    lastKey: "", busy: false,
  };

  /* ------------------------- tiện ích ------------------------- */
  function $(id) { return document.getElementById(id); }
  function esc(v) {
    return String(v === null || v === undefined ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function client() { return (typeof sb !== "undefined" && sb) ? sb : window.sb; }
  function meId() { try { return currentUser && currentUser.id; } catch (e) { return null; } }
  function profile() { try { return currentProfile; } catch (e) { return null; } }
  function isAdmin() { const p = profile(); return !!(p && p.is_admin); }
  function activeId() { try { return activeProjectId || window.activeProjectId || null; } catch (e) { return window.activeProjectId || null; } }
  function myRole() { try { return activeRole; } catch (e) { return null; } }
  function projectName(id) {
    try { const p = currentProjects.find((x) => x.project_id === id); if (p) return p.name; } catch (e) { /* bỏ qua */ }
    return S.proj && S.proj.id === id ? S.proj.name : "";
  }
  function say(msg) { if (typeof window.showToast === "function") window.showToast(msg, "success"); else alert(msg); }
  function fmtDate(s) { if (!s) return "—"; const d = new Date(s); return isNaN(d) ? "—" : d.toLocaleDateString("vi-VN"); }
  function looksMissing(msg) { return /could not find|schema cache|does not exist|function .* not|migration/i.test(String(msg)); }

  /* ------------------------- dựng khung trong panel dự án ------------------------- */
  function renamePanel() {
    const b = document.querySelector("#cdeFilesPanel .panel-header b");
    if (b) b.textContent = "📁 Dự Án";
  }

  function ensureBox() {
    if ($("cpjBox")) return;
    const sel = $("cdeProjectSelect");
    if (!sel) return;
    const style = document.createElement("style");
    style.textContent = `
      #cpjBox { margin:6px 0 10px; font-size:12px; }
      #cpjBox .cpj-btn { padding:4px 9px; border:1px solid #ccd; background:#f8f9fa; border-radius:5px; cursor:pointer; font-size:11px; }
      #cpjBox .cpj-btn.danger { color:#c5221f; border-color:#e6b8b7; }
      #cpjBox .cpj-btn:disabled { opacity:.5; cursor:not-allowed; }
      #cpjBox .cpj-row { display:flex; align-items:center; gap:6px; padding:5px 0; border-bottom:1px solid #eee; }
      #cpjBox .cpj-sub { color:#777; font-size:10px; }
      #cpjBox input[type=text], #cpjBox input[type=number] { padding:3px 5px; font-size:11px; }
    `;
    document.head.appendChild(style);
    const box = document.createElement("div");
    box.id = "cpjBox";
    box.innerHTML = `
      <div id="cpjQuota" style="margin-bottom:6px;"></div>
      <div id="cpjActions" style="display:flex;gap:6px;flex-wrap:wrap;">
        <button class="cpj-btn danger" id="cpjDelete" data-act="delete">🗑 Xoá dự án này</button>
        <button class="cpj-btn" id="cpjAdminBtn" data-act="admin" style="display:none;">🛡 Quản trị</button>
      </div>
      <div id="cpjAdmin" style="display:none;margin-top:8px;"></div>`;
    const wrap = sel.parentElement;
    wrap.parentNode.insertBefore(box, wrap.nextSibling);
    box.addEventListener("click", onClick);
    box.addEventListener("input", onInput);
  }

  /* ------------------------- nạp thông tin ------------------------- */
  async function refreshInfo() {
    const c = client(); if (!c) return;
    S.quota = null; S.quotaErr = "";
    try {
      const { data, error } = await c.rpc("my_project_quota");
      if (error) throw error;
      S.quota = Array.isArray(data) ? data[0] : data;
    } catch (e) { S.quotaErr = e.message || String(e); }
    S.proj = null;
    const id = activeId();
    if (id) {
      try {
        const { data } = await c.from("projects").select("id, name, created_by").eq("id", id).maybeSingle();
        S.proj = data || null;
      } catch (e) { /* bỏ qua */ }
    }
    render();
  }

  function canDelete() {
    if (!S.proj) return false;
    return isAdmin() || S.proj.created_by === meId() || (S.proj.created_by === null && myRole() === "bim_manager");
  }

  function render() {
    ensureBox();
    if (!$("cpjBox")) return;
    // hạn mức
    const q = S.quota, el = $("cpjQuota");
    if (q) {
      const full = !q.unlimited && q.created >= q.quota;
      el.innerHTML = q.unlimited
        ? `🛡 Tài khoản admin: tạo dự án <b>không giới hạn</b> (đã tạo ${esc(q.created)}).`
        : `Dự án bạn đã tạo: <b style="color:${full ? "#c5221f" : "#188038"};">${esc(q.created)}/${esc(q.quota)}</b>` +
          (full ? `<div style="color:#8a4b00;">Đã đạt hạn mức — xoá bớt dự án không dùng hoặc nhờ admin cấp thêm.</div>` : "");
    } else if (S.quotaErr) {
      el.innerHTML = looksMissing(S.quotaErr)
        ? `<span style="color:#8a4b00;">⚠️ Chưa chạy SQL <code>migration_projects_admin.sql</code> nên hạn mức và xoá dự án chưa hoạt động.</span>`
        : `<span style="color:#8a4b00;">⚠️ Không đọc được hạn mức: ${esc(S.quotaErr)}</span>`;
    } else el.textContent = "";
    // nút xoá
    const del = $("cpjDelete");
    const has = !!activeId() && !!S.proj;
    del.style.display = has ? "" : "none";
    const allowed = canDelete();
    del.disabled = !allowed;
    del.title = allowed ? "Xoá vĩnh viễn dự án đang chọn (file trên Google Drive không bị xoá)" : "Chỉ người tạo dự án hoặc admin được xoá dự án";
    // quản trị
    $("cpjAdminBtn").style.display = isAdmin() ? "" : "none";
    const adm = $("cpjAdmin");
    adm.style.display = isAdmin() && S.adminOpen ? "block" : "none";
    if (isAdmin() && S.adminOpen) renderAdmin();
  }

  /* ------------------------- xoá dự án ------------------------- */
  function currentKey() {
    let n = 0; try { n = currentProjects.length; } catch (e) { /* bỏ qua */ }
    return [activeId(), meId(), (profile() || {}).is_admin ? 1 : 0, n].join("|");
  }

  async function afterProjectsChanged(deletedId) {
    // Dự án đang chọn vừa bị xoá: bỏ tham chiếu để các module khác không còn trỏ vào dự án không tồn tại
    try { if (deletedId && activeId() === deletedId) { activeProjectId = null; activeRole = null; } } catch (e) { /* bỏ qua */ }
    if (deletedId && window.activeProjectId === deletedId) window.activeProjectId = null;
    if (typeof window.loadProfileAndProjects === "function") await window.loadProfileAndProjects();
    // Chạy lại đúng luồng "đổi dự án" của cde-auth.js cho dự án được chọn tiếp theo (nhãn vai trò, markup, tab, thành viên…);
    // chỉ nạp lại danh sách thì các phần đó vẫn còn dữ liệu của dự án vừa xoá.
    const sel = $("cdeProjectSelect"), nextId = activeId();
    if (sel && nextId) { sel.value = nextId; sel.dispatchEvent(new Event("change", { bubbles: true })); }
    else { const chip = $("cdeRoleChip"); if (chip) chip.innerText = "—"; }
    S.lastKey = currentKey();      // đã làm mới ngay bên dưới nên không để tick() làm mới lần nữa
    await refreshInfo();
    if (S.adminOpen) await loadAdmin();
  }

  async function deleteProject(id, name) {
    if (!id || !name) return alert("Không xác định được dự án cần xoá (tên dự án trống).");   // tên rỗng sẽ khiến bước "gõ đúng tên" vô nghĩa
    const typed = prompt(
      `⚠️ XOÁ VĨNH VIỄN dự án “${name}”?\n\n` +
      `Sẽ xoá khỏi hệ thống: thành viên, cây thư mục và nhật ký CDE, views, ToDo, bóc khối lượng, tài sản vận hành… của dự án này.\n` +
      `File trên Google Drive KHÔNG bị xoá.\n\nKhông khôi phục được. Gõ chính xác tên dự án để xác nhận:`
    );
    if (typed === null) return false;
    if (typed.trim() !== name) { alert("Tên nhập vào không khớp — đã huỷ, dự án chưa bị xoá."); return false; }
    const { error } = await client().rpc("delete_project", { p_project_id: id });
    if (error) { alert("Không xoá được dự án: " + error.message); return false; }
    say(`✅ Đã xoá dự án “${name}”`);
    await afterProjectsChanged(id);
    return true;
  }

  /* ------------------------- khu quản trị (admin) ------------------------- */
  async function loadAdmin() {
    S.adminErr = ""; S.accounts = null; S.allProjects = null;
    renderAdmin();
    const c = client();
    const [a, p] = await Promise.all([c.rpc("admin_list_accounts"), c.rpc("admin_list_projects")]);
    if (a.error || p.error) S.adminErr = (a.error || p.error).message;
    S.accounts = a.data || []; S.allProjects = p.data || [];
    renderAdmin();
  }

  function renderAdminLists() {
    const accEl = $("cpjAccounts"), prjEl = $("cpjProjects");
    if (!accEl || !prjEl) return;
    const af = S.accFilter.trim().toLowerCase(), pf = S.prjFilter.trim().toLowerCase();
    const accs = (S.accounts || []).filter((a) => !af || `${a.full_name} ${a.email}`.toLowerCase().includes(af)).slice(0, 200);
    accEl.innerHTML = S.accounts === null ? `<div class="cpj-sub">⏳ Đang tải…</div>` : (accs.length ? accs.map((a) => `
      <div class="cpj-row" style="flex-wrap:wrap;">
        <div style="flex:1;min-width:130px;"><b>${esc(a.full_name || "(chưa đặt tên)")}</b> ${a.is_admin ? "🛡" : ""}<div class="cpj-sub">${esc(a.email)}</div></div>
        <div class="cpj-sub" title="Số dự án đã tạo">đã tạo <b>${esc(a.created_count)}</b></div>
        ${a.is_admin ? `<span class="cpj-sub">không giới hạn</span>` : `
        <label class="cpj-sub">hạn mức <input type="number" min="0" max="1000" value="${esc(a.project_quota)}" data-quota="${esc(a.id)}" style="width:52px;"></label>
        <button class="cpj-btn" data-act="saveq" data-uid="${esc(a.id)}">Lưu</button>`}
      </div>`).join("") : `<div class="cpj-sub">Không có tài khoản phù hợp.</div>`);
    const prjs = (S.allProjects || []).filter((x) => !pf || `${x.name} ${x.code} ${x.creator_name} ${x.creator_email}`.toLowerCase().includes(pf)).slice(0, 200);
    prjEl.innerHTML = S.allProjects === null ? `<div class="cpj-sub">⏳ Đang tải…</div>` : (prjs.length ? prjs.map((x) => `
      <div class="cpj-row">
        <div style="flex:1;min-width:0;"><b>${esc(x.name)}</b> <span class="cpj-sub">(${esc(x.code || "—")})</span>
          <div class="cpj-sub">${x.creator_email ? "bởi " + esc(x.creator_name || x.creator_email) : "không rõ người tạo"} · ${esc(x.member_count)} thành viên · ${esc(fmtDate(x.created_at))}</div></div>
        <button class="cpj-btn danger" data-act="admindel" data-pid="${esc(x.id)}" title="Xoá vĩnh viễn dự án này">🗑</button>
      </div>`).join("") : `<div class="cpj-sub">Không có dự án phù hợp.</div>`);
  }

  function renderAdmin() {
    const adm = $("cpjAdmin"); if (!adm) return;
    if (!$("cpjAccounts")) {
      adm.innerHTML = `
        <div style="border:1px solid #d7dee8;border-radius:6px;padding:8px;background:#f6f8fa;">
          <div style="font-weight:700;margin-bottom:4px;">🛡 Quản trị (chỉ admin)</div>
          <div class="cpj-sub" style="margin-bottom:4px;">Cấp thêm hạn mức tạo dự án cho tài khoản, hoặc xoá dự án của bất kỳ ai. Xoá dự án không xoá file trên Google Drive.</div>
          <div id="cpjAdminErr" style="color:#c5221f;"></div>
          <div style="font-weight:600;margin:6px 0 2px;">Hạn mức tạo dự án theo tài khoản</div>
          <input type="text" id="cpjAccFilter" placeholder="Tìm theo tên hoặc email…" style="width:100%;box-sizing:border-box;">
          <div id="cpjAccounts" style="max-height:200px;overflow:auto;"></div>
          <div style="font-weight:600;margin:8px 0 2px;">Tất cả dự án</div>
          <input type="text" id="cpjPrjFilter" placeholder="Tìm theo tên dự án, mã hoặc người tạo…" style="width:100%;box-sizing:border-box;">
          <div id="cpjProjects" style="max-height:220px;overflow:auto;"></div>
        </div>`;
    }
    $("cpjAdminErr").textContent = S.adminErr ? "⚠️ " + S.adminErr : "";
    renderAdminLists();
  }

  async function saveQuota(uid) {
    const inp = document.querySelector(`#cpjAccounts input[data-quota="${uid}"]`);
    const raw = inp ? String(inp.value).trim() : "";
    const n = Number(raw);
    if (raw === "" || !Number.isInteger(n) || n < 0 || n > 1000) return alert("Hạn mức phải là số nguyên từ 0 đến 1000.");
    const { error } = await client().rpc("admin_set_project_quota", { p_user_id: uid, p_quota: n });
    if (error) return alert("Không lưu được hạn mức: " + error.message);
    say("✅ Đã cập nhật hạn mức");
    await loadAdmin();
    if (uid === meId()) await refreshInfo();
  }

  /* ------------------------- sự kiện ------------------------- */
  async function onClick(e) {
    const t = e.target.closest ? e.target.closest("[data-act]") : null;
    if (!t) return;
    const act = t.dataset.act;
    try {
      if (act === "delete") { const id = activeId(); return await deleteProject(id, projectName(id) || (S.proj && S.proj.name) || ""); }
      if (act === "admin") { S.adminOpen = !S.adminOpen; render(); if (S.adminOpen) await loadAdmin(); return; }
      if (act === "saveq") return await saveQuota(t.dataset.uid);
      if (act === "admindel") {
        const p = (S.allProjects || []).find((x) => x.id === t.dataset.pid);
        if (p) return await deleteProject(p.id, p.name);
      }
    } catch (err) { alert(err.message); }
  }
  function onInput(e) {
    const t = e.target;
    if (t.id === "cpjAccFilter") { S.accFilter = t.value; renderAdminLists(); }
    else if (t.id === "cpjPrjFilter") { S.prjFilter = t.value; renderAdminLists(); }
  }

  // Đủ hạn mức thì báo ngay thay vì để người dùng nhập tên/mã dự án rồi mới bị từ chối.
  // Đăng ký ở pha "capture" và sớm hơn mã của cde-auth.js nên chạy trước và chặn được nó.
  function guardCreate() {
    const sel = $("cdeProjectSelect");
    if (!sel || sel.dataset.cpjGuard === "1") return;
    sel.dataset.cpjGuard = "1";
    sel.addEventListener("change", (e) => {
      if (e.target.value !== "__new__") return;
      const q = S.quota;
      if (q && !q.unlimited && q.created >= q.quota) {
        e.stopImmediatePropagation();
        alert(`Tài khoản đã tạo ${q.created} dự án, đạt hạn mức ${q.quota} dự án.\n\nHãy xoá bớt dự án không dùng (nút “🗑 Xoá dự án này”) hoặc nhờ admin cấp thêm hạn mức.`);
        sel.value = activeId() || "";
      }
    }, true);
  }

  // Nhận biết đổi dự án / đăng nhập mới / nạp lại danh sách để làm mới thông tin (không gọi mạng khi không có gì đổi)
  function tick() {
    const p = $("cdeFilesPanel");
    if (!p || p.style.display === "none" || !meId()) return;      // chưa đăng nhập thì chưa gọi gì
    const key = currentKey();
    if (key === S.lastKey) return;
    S.lastKey = key;
    refreshInfo();
  }

  function setup() { renamePanel(); ensureBox(); guardCreate(); }
  // Chạy NGAY khi nạp file (panel dự án đã được cde-auth.js dựng sẵn) để đăng ký chặn tạo dự án sớm hơn mã của cde-auth.js;
  // chạy lại lúc trang nạp xong cho trường hợp thứ tự nạp khác (các hàm đều an toàn khi gọi lặp).
  setup();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", setup);
  setInterval(tick, 1000);

  window.CdeProjects = { state: S, refresh: refreshInfo, esc };   // phục vụ kiểm thử
})();
