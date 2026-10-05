// --- MODULE QUẢN LÝ TÀI SẢN DIGITAL TWIN (FA/AM) ---
const DT_SUPABASE_URL = 'https://znzakqzdezxzqzfplmgv.supabase.co/rest/v1/'; 
const DT_SUPABASE_KEY = 'sb_publishable_Ks8amYP0KOO6IdUkRDSbLw_4NGI5G9r'; 
/**
 * Hàm lấy đối tượng Supabase Client chuẩn trong dự án CDE
 */
function getDigitalTwinSupabaseClient() {
  // 1. Kiểm tra các biến Supabase Client phổ biến đã khởi tạo trên window
  if (window.supabaseClient && typeof window.supabaseClient.from === 'function') {
    return window.supabaseClient;
  }
  if (window.supabase && typeof window.supabase.from === 'function') {
    return window.supabase;
  }
  if (window.dbClient && typeof window.dbClient.from === 'function') {
    return window.dbClient;
  }

  // 2. Nếu thư viện Supabase CDN đã nạp nhưng chưa tạo instance, tự khởi tạo từ cấu hình toàn cục
  if (window.supabase && typeof window.supabase.createClient === 'function') {
    const url = window.SUPABASE_URL || localStorage.getItem('SUPABASE_URL');
    const key = window.SUPABASE_ANON_KEY || window.SUPABASE_KEY || localStorage.getItem('SUPABASE_KEY');
    
    if (url && key) {
      window.supabaseClient = window.supabase.createClient(url, key);
      return window.supabaseClient;
    }
  }

  return null;
}

/**
 * Khởi tạo và nhúng Side Panel vào DOM
 */
function injectDigitalTwinPanel() {
  if (document.getElementById('dt-asset-panel')) return;

  const panelHtml = `
    <div id="dt-asset-panel" style="display:none; position:fixed; right:20px; top:80px; width:360px; background:#fff; border-radius:10px; box-shadow: 0 4px 20px rgba(0,0,0,0.15); z-index:9999; padding:20px; font-family:sans-serif;">
      <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #eee; padding-bottom:10px; margin-bottom:15px;">
        <h3 style="margin:0; font-size:16px; color:#1a73e8;">🏷️️ Quản Lý Tài Sản (Digital Twin)</h3>
        <button type="button" onclick="closeAssetPanel()" style="border:none; background:none; cursor:pointer; font-size:18px;">✕</button>
      </div>

      <form id="dt-asset-form">
        <input type="hidden" id="dt_global_id" />
        <input type="hidden" id="dt_express_id" />

        <div style="margin-bottom:10px;">
          <label style="font-size:12px; color:#666;">GlobalID IFC:</label>
          <input type="text" id="dt_display_global_id" disabled style="width:100%; padding:6px; background:#f5f5f5; border:1px solid #ddd; border-radius:4px;" />
        </div>

        <div style="margin-bottom:10px;">
          <label style="font-size:12px; font-weight:bold;">Mã Tài Sản (Asset Tag) <span style="color:red">*</span>:</label>
          <input type="text" id="dt_asset_code" placeholder="VD: PUMP-001" required style="width:100%; padding:6px; border:1px solid #ccc; border-radius:4px;" />
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
}

/**
 * Hiển thị Panel và nạp dữ liệu khi người dùng chọn đối tượng 3D
 */
async function openDigitalTwinPanel(expressID, globalID) {
  injectDigitalTwinPanel();

  const panel = document.getElementById('dt-asset-panel');
  panel.style.display = 'block';

  document.getElementById('dt_global_id').value = globalID || '';
  document.getElementById('dt_express_id').value = expressID || '';
  document.getElementById('dt_display_global_id').value = globalID || '';

  document.getElementById('dt-asset-form').reset();
  document.getElementById('dt_doc_list').innerHTML = '';

  const client = getDigitalTwinSupabaseClient();
  if (client && globalID) {
    try {
      const { data: existingAsset, error } = await client
        .from('project_assets')
        .select('*, asset_documents(*)')
        .eq('global_id', globalID)
        .maybeSingle();

      if (error) {
        console.warn('Lỗi khi truy vấn dữ liệu tài sản:', error.message);
        return;
      }

      if (existingAsset) {
        document.getElementById('dt_asset_code').value = existingAsset.asset_code || '';
        document.getElementById('dt_asset_name').value = existingAsset.asset_name || '';
        document.getElementById('dt_status').value = existingAsset.status || 'OPERATIONAL';
        document.getElementById('dt_install_date').value = existingAsset.installation_date || '';
        document.getElementById('dt_warranty_date').value = existingAsset.warranty_expiry || '';

        if (existingAsset.asset_documents && existingAsset.asset_documents.length > 0) {
          let docsHtml = '<b>Tài liệu đã đính kèm:</b><br>';
          existingAsset.asset_documents.forEach(doc => {
            docsHtml += `📄 <a href="${doc.file_url}" target="_blank" style="color:#1a73e8; text-decoration:none;">${doc.file_name}</a><br>`;
          });
          document.getElementById('dt_doc_list').innerHTML = docsHtml;
        }
      }
    } catch (e) {
      console.warn('Không thể kết nối Supabase:', e);
    }
  } else if (!client) {
    console.warn('⚠️ Cảnh báo: Chưa tìm thấy Supabase Client hợp lệ trên window.');
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
 * Lưu dữ liệu tài sản và upload tài liệu lên Supabase Storage
 */
async function saveAssetToDatabase() {
  const globalId = document.getElementById('dt_global_id').value;
  const expressId = document.getElementById('dt_express_id').value;
  const assetCode = document.getElementById('dt_asset_code').value;
  const assetName = document.getElementById('dt_asset_name').value;
  const status = document.getElementById('dt_status').value;
  const installDate = document.getElementById('dt_install_date').value || null;
  const warrantyDate = document.getElementById('dt_warranty_date').value || null;
  const fileInput = document.getElementById('dt_file_input');

  if (!assetCode || !assetName) {
    alert('Vui lòng nhập Mã Tài Sản và Tên Thiết Bị!');
    return;
  }

  const client = getDigitalTwinSupabaseClient();
  const projectId = window.currentProjectId || 'DEFAULT_PROJ';

  if (!client) {
    alert('Chưa kết nối CSDL Supabase! Vui lòng kiểm tra biến cấu hình Supabase Client.');
    return;
  }

  try {
    // 1. Lưu thông tin vào bảng project_assets
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
        updated_at: new Date()
      }, { onConflict: 'global_id' })
      .select()
      .single();

    if (assetErr) throw assetErr;

    // 2. Upload file đính kèm vào Storage (nếu có)
    if (fileInput.files.length > 0 && assetData) {
      const file = fileInput.files[0];
      const filePath = `assets/${assetData.id}/${Date.now()}_${file.name}`;

      const { error: uploadErr } = await client
        .storage
        .from('asset-docs')
        .upload(filePath, file);

      if (uploadErr) {
        console.error('Lỗi khi upload file:', uploadErr);
        alert('Cập nhật tài sản thành công nhưng không thể upload tài liệu đính kèm.');
      } else {
        const { data: publicUrlData } = client.storage.from('asset-docs').getPublicUrl(filePath);
        
        await client.from('asset_documents').insert({
          asset_id: assetData.id,
          file_name: file.name,
          file_url: publicUrlData.publicUrl
        });
      }
    }

    alert('✅ Đã lưu thông tin tài sản thành công!');
    closeAssetPanel();
  } catch (err) {
    console.error('Lỗi khi lưu tài sản:', err);
    alert('Có lỗi xảy ra: ' + err.message);
  }
}
