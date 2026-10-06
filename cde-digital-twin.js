// --- MODULE QUẢN LÝ TÀI SẢN DIGITAL TWIN (FA/AM) ---

const DT_SUPABASE_URL = window.SUPABASE_URL || 'https://znzakqzdezxzqzfplmgv.supabase.co'; 
const DT_SUPABASE_KEY = window.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInRefiI6InpuemFrcXpkZXp4enF6ZnBsbWd2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc4MTQyNzAsImV4cCI6MjEwMzM5MDI3MH0.aV5YaOLxTySiB26ror4CRzJvQsjANNI1DwbtbxcNe4A';

/**
 * Bảng màu trạng thái vận hành
 */
const STATUS_COLORS = {
  OPERATIONAL: { rgb: [0.1, 0.8, 0.3], hex: '#28a745' }, // 🟢 Xanh lá (Hoạt động)
  MAINTENANCE: { rgb: [0.9, 0.7, 0.1], hex: '#ffc107' }, // 🟡 Vàng (Bảo trì)
  FAULT:       { rgb: [0.9, 0.2, 0.2], hex: '#dc3545' }  // 🔴 Đỏ (Sự cố)
};

let isColorCodingActive = false;

function getDigitalTwinSupabaseClient() {
  // 1. Ưu tiên lấy client window.sb (từ file auth của cậu) hoặc các biến toàn cục khác
  if (window.sb && typeof window.sb.from === 'function') return window.sb;
  if (window.supabaseClient && typeof window.supabaseClient.from === 'function') return window.supabaseClient;
  if (window.supabase && typeof window.supabase.from === 'function') return window.supabase;
  if (window.dbClient && typeof window.dbClient.from === 'function') return window.dbClient;

  // 2. Nếu chưa có thì mới tự khởi tạo client mới
  if (window.supabase && typeof window.supabase.createClient === 'function') {
    if (!window._dtSupabaseInstance && DT_SUPABASE_URL.includes('http')) {
      window._dtSupabaseInstance = window.supabase.createClient(DT_SUPABASE_URL, DT_SUPABASE_KEY);
    }
    return window._dtSupabaseInstance || null;
  }
  return null;
}

/**
 * Nhúng Side Panel vào DOM (Đã bổ sung nút Đổi Màu Vận Hành bên trong)
 */
function injectDigitalTwinPanel() {
  if (document.getElementById('dt-asset-panel')) return;

  const panelHtml = `
    <div id="dt-asset-panel" style="display:none; position:fixed; left:20px; top:80px; width:380px; max-height:85vh; overflow-y:auto; background:#fff; border-radius:10px; box-shadow: 0 4px 20px rgba(0,0,0,0.2); z-index:9999; padding:20px; font-family:sans-serif; user-select:none;">
      
      <!-- Header di chuyển -->
      <div id="dt-panel-header" style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #eee; padding-bottom:10px; margin-bottom:15px; cursor:move; background:#f8f9fa; margin:-20px -20px 15px -20px; padding:15px 20px; border-radius:10px 10px 0 0;">
        <h3 style="margin:0; font-size:15px; color:#1a73e8; pointer-events:none;">🏷️ Quản Lý Tài Sản (Digital Twin)</h3>
        <button type="button" onclick="closeAssetPanel()" style="border:none; background:none; cursor:pointer; font-size:18px; font-weight:bold;">✕</button>
      </div>

      <!-- NÚT BẬT/TẮT TÔ MÀU TRẠNG THÁI TÍCH HỢP TRONG PANEL -->
      <div style="margin-bottom:15px;">
        <button type="button" id="dt-btn-toggle-color" onclick="toggleColorCodingMode(this)" 
                style="width:100%; padding:8px 12px; background:#f0f4f9; color:#1a73e8; border:1px solid #b6d4fe; border-radius:6px; font-weight:bold; cursor:pointer; font-size:12px; display:flex; align-items:center; justify-content:center; gap:6px; transition:0.2s;">
          🎨 Xem Trạng Thái Vận Hành 3D
        </button>
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
          <label style="font-size:12px; font-weight:bold;">Trạng Thái Vận Hành:</label>
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
 * Kéo thả di chuyển Panel
 */
function makePanelDraggable() {
  const panel = document.getElementById('dt-asset-panel');
  const header = document.getElementById('dt-panel-header');
  if (!panel || !header || panel.dataset.draggable === 'true') return;
  panel.dataset.draggable = 'true';

  let posX = 0, posY = 0, mouseX = 0, mouseY = 0;
  header.onmousedown = (e) => {
    e = e || window.event;
    e.preventDefault();
    mouseX = e.clientX;
    mouseY = e.clientY;
    document.onmouseup = () => { document.onmouseup = null; document.onmousemove = null; };
    document.onmousemove = (ev) => {
      ev = ev || window.event;
      ev.preventDefault();
      posX = mouseX - ev.clientX;
      posY = mouseY - ev.clientY;
      mouseX = ev.clientX;
      mouseY = ev.clientY;
      panel.style.top = (panel.offsetTop - posY) + 'px';
      panel.style.left = (panel.offsetLeft - posX) + 'px';
      panel.style.right = 'auto';
    };
  };
}

/**
 * Bật/Tắt Panel từ Nút Menu "Digital Twin" ở Trang Chủ
 */
function toggleDigitalTwinPanelFromMenu() {
  injectDigitalTwinPanel();
  const panel = document.getElementById('dt-asset-panel');
  if (panel.style.display === 'none' || panel.style.display === '') {
    panel.style.display = 'block';
  } else {
    panel.style.display = 'none';
  }
}

/**
 * Mở Panel khi kích chọn thiết bị trên mô hình 3D
 */
async function openDigitalTwinPanel(expressID, globalID, assetName = '') {
  injectDigitalTwinPanel();
  const panel = document.getElementById('dt-asset-panel');
  panel.style.display = 'block';

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
    if (aName) document.getElementById('dt_asset_name').value = aName;
  };

  applyValuesToForm(finalGlobalID, expressID, assetName);

  setTimeout(() => {
    const delayedId = getIfcGlobalIdFromDOM();
    if (delayedId) applyValuesToForm(delayedId, expressID, assetName);
  }, 150);

  const client = getDigitalTwinSupabaseClient();
  const searchId = finalGlobalID || expressID;

  if (client && searchId) {
    try {
      const { data: existingAsset, error } = await client
        .from('project_assets')
        .select('*, asset_documents(*)')
        .eq('global_id', searchId)
        .maybeSingle();

      if (error) return;

      if (existingAsset) {
        document.getElementById('dt_asset_code').value = existingAsset.asset_code || '';
        document.getElementById('dt_asset_name').value = existingAsset.asset_name || assetName;
        document.getElementById('dt_status').value = existingAsset.status || 'OPERATIONAL';
        document.getElementById('dt_install_date').value = existingAsset.installation_date || '';
        document.getElementById('dt_warranty_date').value = existingAsset.warranty_expiry || '';
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
      console.warn('Lỗi đọc CSDL:', e);
    }
  }
}

function closeAssetPanel() {
  const panel = document.getElementById('dt-asset-panel');
  if (panel) panel.style.display = 'none';
}

// =========================================================================
// --- TÔ MÀU MÔ HÌNH 3D THEO TRẠNG THÁI VẬN HÀNH ---
// =========================================================================

async function applyAssetColorCoding() {
  const client = getDigitalTwinSupabaseClient();
  if (!client) return;

  try {
    const { data: assets, error } = await client
      .from('project_assets')
      .select('express_id, global_id, status');

    if (error || !assets) return;

    assets.forEach(asset => {
      const colorConfig = STATUS_COLORS[asset.status] || STATUS_COLORS.OPERATIONAL;
      const expressId = asset.express_id;
      const globalId = asset.global_id;

      if (window.xeokitViewer || window.viewer?.scene) {
        const viewerInstance = window.xeokitViewer || window.viewer;
        const entity = viewerInstance.scene.objects[globalId] || viewerInstance.scene.objects[expressId];
        if (entity) entity.colorize = colorConfig.rgb;
      } else if (window.viewer && typeof window.viewer.setElementColor === 'function') {
        window.viewer.setElementColor(expressId, colorConfig.rgb);
      }
    });

    isColorCodingActive = true;
  } catch (err) {
    console.error('Lỗi tô màu 3D:', err);
  }
}

function resetModelColors() {
  if (window.xeokitViewer || window.viewer?.scene) {
    const viewerInstance = window.xeokitViewer || window.viewer;
    Object.values(viewerInstance.scene.objects).forEach(entity => {
      entity.colorize = null;
    });
  } else if (window.viewer && typeof window.viewer.resetColors === 'function') {
    window.viewer.resetColors();
  }
  isColorCodingActive = false;
}

/**
 * Hàm Bật/Tắt Chế Độ Xem Màu Trạng Thái (Được gọi từ nút bấm trong Panel)
 */
function toggleColorCodingMode(buttonEl) {
  const btn = buttonEl || document.getElementById('dt-btn-toggle-color');
  if (!isColorCodingActive) {
    applyAssetColorCoding();
    if (btn) {
      btn.innerText = '🔄 Khôi Phục Màu Mặc Định';
      btn.style.backgroundColor = '#28a745';
      btn.style.color = '#fff';
      btn.style.borderColor = '#28a745';
    }
  } else {
    resetModelColors();
    if (btn) {
      btn.innerText = '🎨 Xem Trạng Thái Vận Hành 3D';
      btn.style.backgroundColor = '#f0f4f9';
      btn.style.color = '#1a73e8';
      btn.style.borderColor = '#b6d4fe';
    }
  }
}

/**
 * Lưu dữ liệu thiết bị và tự động cập nhật màu
 */
async function saveAssetToDatabase() {
  const globalId = document.getElementById('dt_global_id').value;
  const expressId = document.getElementById('dt_express_id').value;
  const assetCode = document.getElementById('dt_asset_code').value;
  const assetName = document.getElementById('dt_asset_name').value;
  const status = document.getElementById('dt_status').value;
  const installDate = document.getElementById('dt_install_date').value || null;
  const warrantyDate = document.getElementById('dt_warranty_date').value || null;
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

    if (fileInput.files.length > 0 && assetData) {
      const file = fileInput.files[0];
      const safeFileName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
      const filePath = `assets/${assetData.id}/${Date.now()}_${safeFileName}`;

      const { error: uploadErr } = await client.storage.from('asset-docs').upload(filePath, file, { cacheControl: '3600', upsert: true });
      if (!uploadErr) {
        const { data: publicUrlData } = client.storage.from('asset-docs').getPublicUrl(filePath);
        await client.from('asset_documents').insert({ asset_id: assetData.id, file_name: file.name, file_url: publicUrlData.publicUrl });
      }
    }

    // Tự động tô lại màu 3D nếu chế độ xem trạng thái đang bật
    if (isColorCodingActive) {
      applyAssetColorCoding();
    }

    alert('✅ Đã lưu hồ sơ thiết bị và nhật ký bảo trì thành công!');
    closeAssetPanel();
  } catch (err) {
    console.error('Lỗi lưu tài sản:', err);
    alert('Có lỗi xảy ra: ' + err.message);
  }
}
