// --- MODULE QUẢN LÝ TÀI SẢN DIGITAL TWIN (FA/AM) ---

// Cấu hình URL & Key Supabase dự phòng
const DT_SUPABASE_URL = window.SUPABASE_URL || 'https://znzakqzdezxzqzfplmgv.supabase.co'; 
const DT_SUPABASE_KEY = window.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpuemFrcXpkZXp4enF6ZnBsbWd2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc4MTQyNzAsImV4cCI6MjEwMzM5MDI3MH0.aV5YaOLxTySiB26ror4CRzJvQsjANNI1DwbtbxcNe4A';

/**
 * Hàm lấy đối tượng Supabase Client
 */
function getDigitalTwinSupabaseClient() {
  if (window.supabaseClient && typeof window.supabaseClient.from === 'function') {
    return window.supabaseClient;
  }
  if (window.supabase && typeof window.supabase.from === 'function') {
    return window.supabase;
  }
  if (window.dbClient && typeof window.dbClient.from === 'function') {
    return window.dbClient;
  }

  if (window.supabase && typeof window.supabase.createClient === 'function') {
    if (!window._dtSupabaseInstance && DT_SUPABASE_URL.includes('http')) {
      window._dtSupabaseInstance = window.supabase.createClient(DT_SUPABASE_URL, DT_SUPABASE_KEY);
    }
    return window._dtSupabaseInstance || null;
  }

  return null;
}

/**
 * Khởi tạo và nhúng Side Panel vào DOM (Đã thêm các trường Bảo Trì & Nhật Ký)
 */
function injectDigitalTwinPanel() {
  if (document.getElementById('dt-asset-panel')) return;

  const panelHtml = `
    <div id="dt-asset-panel" style="display:none; position:fixed; left:20px; top:80px; width:380px; max-height:85vh; overflow-y:auto; background:#fff; border-radius:10px; box-shadow: 0 4px 20px rgba(0,0,0,0.2); z-index:9999; padding:20px; font-family:sans-serif; user-select:none;">
      <!-- Header kéo thả di chuyển panel -->
      <div id="dt-panel-header" style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #eee; padding-bottom:10px; margin-bottom:15px; cursor:move; background:#f8f9fa; margin:-20px -20px 15px -20px; padding:15px 20px; border-radius:10px 10px 0 0;">
        <h3 style="margin:0; font-size:15px; color:#1a73e8; pointer-events:none;">🏷️ Quản Lý Tài Sản (Digital Twin)</h3>
        <button type="button" onclick="closeAssetPanel()" style="border:none; background:none; cursor:pointer; font-size:18px; font-weight:bold;">✕</button>
      </div>

      <form id="dt-asset-form">
        <input type="hidden" id="dt_global_id" />
        <input type="hidden" id="dt_express_id" />

        <div style="margin-bottom:10px;">
          <label style="font-size:12px; font-weight:bold; color:#333;">GlobalID IFC:</label>
          <input type="text" id="dt_display_global_id" readonly style="width:100%; padding:8px; background:#eef3fc; border:1px solid #b6d4fe; border-radius:4px; font-size:12px; color:#0d6efd; font-weight:bold;" />
        </div>

        <div style="margin-bottom:10px;">
          <label style="font-size:12px; font-weight:bold;">Mã Tài Sản (Asset Tag) <span style="color:red">*</span>:</label>
          <input type="text" id="dt_asset_code" placeholder="VD: TS-PUMP-001" required style="width:100%; padding:6px; border:1px solid #ccc; border-radius:4px;" />
        </div>

        <div style="margin-bottom:10px;">
          <label style="font-size:12px; font-weight:bold;">Tên Thiết Bị <span style="color:red">*</span>:</label>
          <input type="text" id="dt_asset_name" placeholder="VD: Bơm nước thải số 1" required style="width:100%; padding:6px; border:1px solid #ccc; border-radius:4px;" />
        </div>

        <div style="margin-bottom:10px;">
          <label style="font-size:12px;">Trạng Thái Vận Hành:</label>
          <select id="dt_status" style="width:100%; padding:6px; border:1px solid #ccc; border-radius:4px;">
            <option value="OPERATIONAL">🟢 Đang hoạt động bình thường</option>
            <option value="MAINTENANCE">🟡 Đang bảo trì / Kiểm tra</option>
            <option value="FAULT">🔴 Có sự cố / Hỏng hóc</option>
          </select>
        </div>

        <div style="display:flex; gap:10px; margin-bottom:10px;">
          <div style="flex:1;">
            <label style="font-size:11px;">Ngày Lắp Đặt:</label>
            <input type="date" id="dt_install_date" style="width:100%; padding:4px; border:1px solid #ccc; border-radius:4px;" />
          </div>
          <div style="flex:1;">
            <label style="font-size:11px;">Hạn Bảo Hành:</label>
            <input type="date" id="dt_warranty_date" style="width:100%; padding:4px; border:1px solid #ccc; border-radius:4px;" />
          </div>
        </div>

        <!-- BỔ SUNG TRƯỜNG NGÀY BẢO TRÌ & LỊCH BẢO TRÌ KẾ TIẾP -->
        <div style="display:flex; gap:10px; margin-bottom:10px;">
          <div style="flex:1;">
            <label style="font-size:11px; font-weight:bold; color:#d93025;">🔧 Bảo Trì Gần Nhất:</label>
            <input type="date" id="dt_last_maint_date" style="width:100%; padding:4px; border:1px solid #ccc; border-radius:4px;" />
          </div>
          <div style="flex:1;">
            <label style="font-size:11px; font-weight:bold; color:#1a73e8;">📅 Lịch Bảo Trì Kế:</label>
            <input type="date" id="dt_next_maint_date" style="width:100%; padding:4px; border:1px solid #ccc; border-radius:4px;" />
          </div>
        </div>

        <!-- BỔ SUNG Ô NHẬT KÝ VẬN HÀNH -->
        <div style="margin-bottom:10px;">
          <label style="font-size:12px; font-weight:bold;">📝 Nhật Ký Vận Hành / Bảo Trì:</label>
          <textarea id="dt_maint_log" rows="3" placeholder="Nhập ghi chú tình trạng, lịch sử sửa chữa, thay dầu..." style="width:100%; padding:6px; border:1px solid #ccc; border-radius:4px; font-size:12px; resize:vertical;"></textarea>
        </div>

        <div style="margin-bottom:15px;">
          <label style="font-size:12px;">Đính kèm Tài Liệu / HDSD (PDF):</label>
          <input type="file" id="dt_file_input" accept=".pdf,.docx,.png,.jpg" style="width:100%; font-size:12px;" />
          <div id="dt_doc_list" style="margin-top:8px; font-size:12px; color:#1a73e8;"></div>
        </div>

        <button type="button" onclick="saveAssetToDatabase()" style="width:100%; padding:10px; background:#1a73e8; color:#fff; border:none; border-radius:5px; font-weight:bold; cursor:pointer;">💾 Lưu Hồ Sơ Thiết Bị</button>
      </form>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', panelHtml);
  makePanelDraggable();
}

/**
 * Hàm hỗ trợ di chuyển Cửa sổ Panel bằng chuột (Drag & Drop)
 */
function makePanelDraggable() {
  const panel = document.getElementById('dt-asset-panel');
  const header = document.getElementById('dt-panel-header');

  if (!panel || !header || panel.dataset.draggable === 'true') return;
  panel.dataset.draggable = 'true';

  let posX = 0, posY = 0, mouseX = 0, mouseY = 0;

  header.onmousedown = dragMouseDown;

  function dragMouseDown(e) {
    e = e || window.event;
    e.preventDefault();
    mouseX = e.clientX;
    mouseY = e.clientY;
    document.onmouseup = closeDragElement;
    document.onmousemove = elementDrag;
  }

  function elementDrag(e) {
    e = e || window.event;
    e.preventDefault();
    posX = mouseX - e.clientX;
    posY = mouseY - e.clientY;
    mouseX = e.clientX;
    mouseY = e.clientY;

    panel.style.top = (panel.offsetTop - posY) + 'px';
    panel.style.left = (panel.offsetLeft - posX) + 'px';
    panel.style.right = 'auto';
  }

  function closeDragElement() {
    document.onmouseup = null;
    document.onmousemove = null;
  }
}

/**
 * Hiển thị Panel và nạp dữ liệu khi chọn đối tượng 3D
 */
async function openDigitalTwinPanel(expressID, globalID, assetName = '') {
  injectDigitalTwinPanel();

  const panel = document.getElementById('dt-asset-panel');
  panel.style.display = 'block';

  panel.style.left = '20px';
  panel.style.top = '80px';
  panel.style.right = 'auto';

  document.getElementById('dt-asset-form').reset();
  document.getElementById('dt_doc_list').innerHTML = '';

  function getIfcGlobalIdFromDOM() {
    const elements = Array.from(document.querySelectorAll('tr, div, td, span'));
    for (const el of elements) {
      if (el.innerText && el.innerText.trim() === 'ID Cấu Kiện') {
        const parentRow = el.closest('tr') || el.parentElement;
        if (parentRow) {
          const cells = parentRow.querySelectorAll('td, span, div');
          if (cells.length > 1) {
            const val = cells[1].innerText.trim();
            if (val && val !== 'ID Cấu Kiện') return val;
          }
        }
      }
    }
    return '';
  }

  let finalGlobalID = globalID;
  if (!finalGlobalID || String(finalGlobalID) === String(expressID)) {
    const domId = getIfcGlobalIdFromDOM();
    if (domId) finalGlobalID = domId;
  }

  const applyValuesToForm = (gId, eId, aName) => {
    document.getElementById('dt_global_id').value = gId || eId || '';
    document.getElementById('dt_express_id').value = eId || '';
    document.getElementById('dt_display_global_id').value = gId || eId || '';
    if (aName) {
      document.getElementById('dt_asset_name').value = aName;
    }
  };

  applyValuesToForm(finalGlobalID, expressID, assetName);

  setTimeout(() => {
    const delayedId = getIfcGlobalIdFromDOM();
    if (delayedId) {
      finalGlobalID = delayedId;
      applyValuesToForm(finalGlobalID, expressID, assetName);
    }
  }, 150);

  // Truy vấn dữ liệu tài sản đã có
  const client = getDigitalTwinSupabaseClient();
  const searchId = finalGlobalID || expressID;

  if (client && searchId) {
    try {
      const { data: existingAsset, error } = await client
        .from('project_assets')
        .select('*, asset_documents(*)')
        .eq('global_id', searchId)
        .maybeSingle();

      if (error) {
        console.warn('Lỗi khi truy vấn dữ liệu tài sản:', error.message);
        return;
      }

      if (existingAsset) {
        document.getElementById('dt_asset_code').value = existingAsset.asset_code || '';
        document.getElementById('dt_asset_name').value = existingAsset.asset_name || assetName;
        document.getElementById('dt_status').value = existingAsset.status || 'OPERATIONAL';
        document.getElementById('dt_install_date').value = existingAsset.installation_date || '';
        document.getElementById('dt_warranty_date').value = existingAsset.warranty_expiry || '';
        
        // Nạp dữ liệu Bảo Trì & Nhật Ký
        document.getElementById('dt_last_maint_date').value = existingAsset.last_maintenance_date || '';
        document.getElementById('dt_next_maint_date').value = existingAsset.next_maintenance_date || '';
        document.getElementById('dt_maint_log').value = existingAsset.maintenance_log || '';

        if (existingAsset.asset_documents && existingAsset.asset_documents.length > 0) {
          let docsHtml = '<b>Tài liệu đã đính kèm:</b><br>';
          existingAsset.asset_documents.forEach(doc => {
            docsHtml += `📄 <a href="${doc.file_url}" target="_blank" style="color:#1a73e8; text-decoration:none;">${doc.file_name}</a><br>`;
          });
          document.getElementById('dt_doc_list').innerHTML = docsHtml;
        }
      }
    } catch (e) {
      console.warn('Lỗi truy vấn CSDL:', e);
    }
  }
}

/**
 * Đóng Panel
 */
function closeAssetPanel() {
  const panel = document.getElementById('dt-asset-panel');
  if (panel) panel.style.display = 'none';
}

/**
 * Lưu dữ liệu tài sản + thông tin bảo trì & upload tài liệu
 */
async function saveAssetToDatabase() {
  const globalId = document.getElementById('dt_global_id').value;
  const expressId = document.getElementById('dt_express_id').value;
  const assetCode = document.getElementById('dt_asset_code').value;
  const assetName = document.getElementById('dt_asset_name').value;
  const status = document.getElementById('dt_status').value;
  const installDate = document.getElementById('dt_install_date').value || null;
  const warrantyDate = document.getElementById('dt_warranty_date').value || null;
  
  // Lấy dữ liệu Ngày Bảo Trì & Nhật Ký
  const lastMaintDate = document.getElementById('dt_last_maint_date').value || null;
  const nextMaintDate = document.getElementById('dt_next_maint_date').value || null;
  const maintLog = document.getElementById('dt_maint_log').value || '';

  const fileInput = document.getElementById('dt_file_input');

  if (!assetCode || !assetName) {
    alert('Vui lòng nhập Mã Tài Sản và Tên Thiết Bị!');
    return;
  }

  const client = getDigitalTwinSupabaseClient();
  const projectId = window.currentProjectId || 'DEFAULT_PROJ';

  if (!client) {
    alert('Chưa kết nối CSDL Supabase!');
    return;
  }

  try {
    // 1. Lưu thông tin vào CSDL
    const { data: assetData, error: assetErr } = await client
      .from('project_assets')
      .upsert({
        project_id: projectId,
        global_id: globalId,
        express_id: parseInt(expressId) || 0,
        asset_code: assetCode,
        asset_name: assetName,
        status: status,
        installation_date: installDate,
        warranty_expiry: warrantyDate,
        last_maintenance_date: lastMaintDate,
        next_maintenance_date: nextMaintDate,
        maintenance_log: maintLog,
        updated_at: new Date()
      }, { onConflict: 'global_id' })
      .select()
      .single();

    if (assetErr) throw assetErr;

    // 2. Upload file đính kèm (nếu có)
    if (fileInput.files.length > 0 && assetData) {
      const file = fileInput.files[0];
      const safeFileName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
      const filePath = `assets/${assetData.id}/${Date.now()}_${safeFileName}`;

      const { error: uploadErr } = await client
        .storage
        .from('asset-docs')
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: true
        });

      if (uploadErr) {
        alert('Đã lưu thông tin tài sản nhưng lỗi upload file: ' + uploadErr.message);
        return;
      }

      const { data: publicUrlData } = client.storage.from('asset-docs').getPublicUrl(filePath);
      
      await client.from('asset_documents').insert({
        asset_id: assetData.id,
        file_name: file.name,
        file_url: publicUrlData.publicUrl
      });
    }

    alert('✅ Đã lưu hồ sơ thiết bị và nhật ký bảo trì thành công!');
    closeAssetPanel();
  } catch (err) {
    console.error('Lỗi khi lưu tài sản:', err);
    alert('Có lỗi xảy ra: ' + err.message);
  }
}