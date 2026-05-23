// ============================================================
// MAINTENANCE STORE — MAIN APP
// ============================================================

// Initialize Supabase
const sb = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);

// App state
let currentPage = 'dashboard';
let pageStack = [];
let masterItems = [], masterMachines = [], masterSuppliers = [];
let currentTab = 'items';

// ── PIN AUTH ─────────────────────────────────────────────
let pinEntered = '';

document.getElementById('login-factory-name').textContent = CONFIG.FACTORY_NAME;

function pinPress(digit) {
  if (pinEntered.length >= 4) return;
  pinEntered += digit;
  updatePinDots();
  if (pinEntered.length === 4) {
    setTimeout(checkPin, 200);
  }
}

function pinDelete() {
  pinEntered = pinEntered.slice(0, -1);
  updatePinDots();
  document.getElementById('pin-error').textContent = '';
}

function updatePinDots() {
  for (let i = 0; i < 4; i++) {
    document.getElementById('dot-' + i).classList.toggle('filled', i < pinEntered.length);
  }
}

function checkPin() {
  if (pinEntered === CONFIG.APP_PIN) {
    sessionStorage.setItem('pinOk', '1');
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('main-app').style.display = 'flex';
    initApp();
  } else {
    document.getElementById('pin-error').textContent = 'Wrong PIN. Try again.';
    pinEntered = '';
    updatePinDots();
    for (let i = 0; i < 4; i++) {
      const dot = document.getElementById('dot-' + i);
      dot.style.background = '#C00000';
      dot.style.borderColor = '#C00000';
    }
    setTimeout(() => {
      for (let i = 0; i < 4; i++) {
        const dot = document.getElementById('dot-' + i);
        dot.style.background = '';
        dot.style.borderColor = '';
      }
    }, 500);
  }
}

// Check if already logged in
if (sessionStorage.getItem('pinOk') === '1') {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('main-app').style.display = 'flex';
  initApp();
}

// ── INIT ─────────────────────────────────────────────────
async function initApp() {
  await loadMasters();
  navigate('dashboard');
}

async function loadMasters() {
  const [i, m, s] = await Promise.all([
    sb.from('items').select('*').order('name'),
    sb.from('machines').select('*').order('name'),
    sb.from('suppliers').select('*').order('name')
  ]);
  masterItems = i.data || [];
  masterMachines = m.data || [];
  masterSuppliers = s.data || [];
}

// ── NAVIGATION ────────────────────────────────────────────
function navigate(page, push = true) {
  if (push && currentPage !== page) pageStack.push(currentPage);
  currentPage = page;

  // Update nav highlight
  ['dashboard', 'inward', 'outward', 'stock', 'more'].forEach(p => {
    const el = document.getElementById('nav-' + p);
    if (el) el.classList.toggle('active', p === page || (page === 'reports' && p === 'more') || (page === 'masters' && p === 'more'));
  });

  // Header
  const titles = {
    dashboard: CONFIG.FACTORY_NAME,
    inward: 'Inward Register',
    'add-inward': 'Add Inward Entry',
    outward: 'Outward Register',
    'add-outward': 'Issue Parts',
    stock: 'Stock Register',
    reports: 'Monthly Report',
    masters: 'Masters',
    more: 'More'
  };
  document.getElementById('page-title').textContent = titles[page] || page;

  const backBtn = document.getElementById('back-btn');
  backBtn.style.display = (page === 'add-inward' || page === 'add-outward') ? 'block' : 'none';

  document.getElementById('header-actions').innerHTML = '';

  const pages = { dashboard, inward, 'add-inward': addInward, outward, 'add-outward': addOutward, stock, reports, masters, more };
  if (pages[page]) pages[page]();
}

function goBack() {
  const prev = pageStack.pop() || 'dashboard';
  navigate(prev, false);
}

// ── TOAST ─────────────────────────────────────────────────
function showToast(msg, duration = 2500) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), duration);
}

// ── LOADING ───────────────────────────────────────────────
function setLoading() {
  document.getElementById('page-content').innerHTML = '<div class="loading"><div class="spinner"></div></div>';
}

// ── DASHBOARD ─────────────────────────────────────────────
async function dashboard() {
  setLoading();
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth() + 1;
  const startDate = `${y}-${String(m).padStart(2, '0')}-01`;
  const endDate = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;

  const [inData, outData, stockData, itemsData] = await Promise.all([
    sb.from('inward').select('total_amount').gte('date', startDate).lt('date', endDate),
    sb.from('outward').select('issue_amount').gte('date', startDate).lt('date', endDate),
    sb.from('opening_stock').select('item_name, quantity'),
    sb.from('items').select('name, min_stock, category')
  ]);

  const totalPurchase = (inData.data || []).reduce((s, r) => s + (r.total_amount || 0), 0);
  const totalIssue = (outData.data || []).reduce((s, r) => s + (r.issue_amount || 0), 0);

  // Calculate low stock
  const openingMap = {};
  (stockData.data || []).forEach(r => openingMap[r.item_name] = r.quantity);

  const inSums = {}, outSums = {};
  // We'll do a quick DB query for totals
  const [inAll, outAll] = await Promise.all([
    sb.from('inward').select('item_name, quantity'),
    sb.from('outward').select('item_name, quantity')
  ]);
  (inAll.data || []).forEach(r => inSums[r.item_name] = (inSums[r.item_name] || 0) + (r.quantity || 0));
  (outAll.data || []).forEach(r => outSums[r.item_name] = (outSums[r.item_name] || 0) + (r.quantity || 0));

  const lowStockItems = (itemsData.data || []).map(item => {
    const stock = (openingMap[item.name] || 0) + (inSums[item.name] || 0) - (outSums[item.name] || 0);
    return { ...item, currentStock: stock };
  }).filter(i => i.currentStock <= i.min_stock).slice(0, 6);

  const monthName = now.toLocaleString('default', { month: 'long' });

  document.getElementById('page-content').innerHTML = `
    <div class="page-pad">
      <div class="kpi-grid">
        <div class="kpi-card">
          <div class="kpi-label">Purchased ${monthName}</div>
          <div class="kpi-value primary">₹${fmtNum(totalPurchase)}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Issued ${monthName}</div>
          <div class="kpi-value orange">₹${fmtNum(totalIssue)}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Low Stock Items</div>
          <div class="kpi-value ${lowStockItems.length > 0 ? 'red' : 'green'}">${lowStockItems.length}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Transactions</div>
          <div class="kpi-value primary">${(inData.data || []).length + (outData.data || []).length}</div>
        </div>
      </div>

      <div class="quick-actions">
        <button class="action-btn inward" onclick="navigate('add-inward')">
          <i class="lucide-plus-circle"></i>Add Inward
        </button>
        <button class="action-btn outward" onclick="navigate('add-outward')">
          <i class="lucide-arrow-up-circle"></i>Issue Parts
        </button>
        <button class="action-btn stock" onclick="navigate('stock')">
          <i class="lucide-package"></i>View Stock
        </button>
        <button class="action-btn report" onclick="navigate('reports')">
          <i class="lucide-bar-chart-2"></i>Monthly Report
        </button>
      </div>

      ${lowStockItems.length > 0 ? `
      <div class="card">
        <div class="card-title">⚠ Low Stock Alerts</div>
        ${lowStockItems.map(i => `
          <div class="alert-item">
            <div>
              <div class="alert-name">${esc(i.name)}</div>
              <div class="alert-meta">${i.category}</div>
            </div>
            <span class="badge ${i.currentStock <= 0 ? 'danger' : 'warning'}">
              Qty: ${i.currentStock}
            </span>
          </div>
        `).join('')}
      </div>` : '<div class="card"><div class="card-title">✅ All items are well stocked</div></div>'}
    </div>`;
}

// ── INWARD LIST ───────────────────────────────────────────
async function inward() {
  setLoading();
  document.getElementById('header-actions').innerHTML = `
    <button onclick="navigate('add-inward')" style="color:white;padding:8px;font-size:13px;font-weight:600;background:rgba(255,255,255,0.2);border-radius:8px;border:none;cursor:pointer;">+ Add</button>`;

  const { data } = await sb.from('inward').select('*').order('date', { ascending: false }).limit(100);
  const rows = data || [];

  document.getElementById('page-content').innerHTML = `
    <div class="search-bar">
      <i class="lucide-search"></i>
      <input type="text" placeholder="Search item or supplier..." id="inward-search" oninput="filterInward()" />
    </div>
    <div id="inward-list">
      ${rows.length === 0 ? '<div class="list-empty">No inward entries yet.<br>Tap + Add to add your first entry.</div>' : ''}
      ${rows.map(r => `
        <div class="list-item" data-name="${esc(r.item_name)}" data-supplier="${esc(r.supplier_name)}">
          <div class="list-dot green"></div>
          <div style="flex:1">
            <div class="list-main">${esc(r.item_name || '—')}</div>
            <div class="list-sub">${esc(r.supplier_name || '—')} ${r.invoice_number ? '· ' + r.invoice_number : ''}</div>
          </div>
          <div class="list-right">
            <div class="list-amount" style="color:var(--green)">₹${fmtNum(r.total_amount)}</div>
            <div class="list-date">${fmtDate(r.date)} · Qty ${r.quantity}</div>
          </div>
        </div>`).join('')}
    </div>`;
}

function filterInward() {
  const q = document.getElementById('inward-search').value.toLowerCase();
  document.querySelectorAll('#inward-list .list-item').forEach(el => {
    const name = el.dataset.name.toLowerCase();
    const sup = el.dataset.supplier.toLowerCase();
    el.style.display = (name.includes(q) || sup.includes(q)) ? '' : 'none';
  });
}

// ── ADD INWARD ────────────────────────────────────────────
function addInward() {
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('page-content').innerHTML = `
    <div class="page-pad">
      <div class="form-section">
        <div class="form-section-title">Purchase Details</div>
        <div class="form-group">
          <label class="form-label">Date <span>*</span></label>
          <input type="date" class="form-control" id="in-date" value="${today}" required>
        </div>
        <div class="form-group">
          <label class="form-label">Supplier Name <span>*</span></label>
          <select class="form-control" id="in-supplier">
            <option value="">Select supplier...</option>
            ${masterSuppliers.map(s => `<option value="${esc(s.name)}">${esc(s.name)}</option>`).join('')}
            <option value="__OTHER__">Other (type below)</option>
          </select>
        </div>
        <div class="form-group" id="in-supplier-other-wrap" style="display:none">
          <label class="form-label">Supplier Name (type)</label>
          <input type="text" class="form-control" id="in-supplier-other" placeholder="Enter supplier name">
        </div>
        <div class="form-group">
          <label class="form-label">Invoice / Bill No.</label>
          <input type="text" class="form-control" id="in-invoice" placeholder="e.g. INV-2024-001">
        </div>
      </div>

      <div class="form-section">
        <div class="form-section-title">Item Details</div>
        <div class="form-group">
          <label class="form-label">Item Name <span>*</span></label>
          <select class="form-control" id="in-item" onchange="onItemSelect('in')">
            <option value="">Select item...</option>
            ${masterItems.map(i => `<option value="${esc(i.name)}" data-cat="${esc(i.category)}" data-unit="${esc(i.unit)}">${esc(i.name)}</option>`).join('')}
            <option value="__OTHER__">Other (type below)</option>
          </select>
        </div>
        <div class="form-group" id="in-item-other-wrap" style="display:none">
          <input type="text" class="form-control" id="in-item-other" placeholder="Enter item name">
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Category</label>
            <input type="text" class="form-control auto" id="in-category" placeholder="Auto-filled" readonly>
          </div>
          <div class="form-group">
            <label class="form-label">Size / Spec</label>
            <input type="text" class="form-control" id="in-size" placeholder="e.g. 2 inch">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Quantity <span>*</span></label>
            <input type="number" class="form-control" id="in-qty" placeholder="0" min="0" step="any" oninput="calcTotal()">
          </div>
          <div class="form-group">
            <label class="form-label">Unit</label>
            <input type="text" class="form-control auto" id="in-unit" placeholder="Auto-filled" readonly>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Rate per Unit (₹) <span>*</span></label>
            <input type="number" class="form-control" id="in-rate" placeholder="0.00" min="0" step="any" oninput="calcTotal()">
          </div>
          <div class="form-group">
            <label class="form-label">Total Amount (₹)</label>
            <input type="text" class="form-control auto" id="in-total" placeholder="Auto" readonly>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Remark</label>
          <input type="text" class="form-control" id="in-remark" placeholder="Optional note">
        </div>
      </div>

      <button class="btn btn-green" onclick="saveInward()">
        <i class="lucide-save"></i> Save Inward Entry
      </button>
      <div style="height:16px"></div>
    </div>`;

  // Supplier other toggle
  document.getElementById('in-supplier').addEventListener('change', function() {
    document.getElementById('in-supplier-other-wrap').style.display = this.value === '__OTHER__' ? '' : 'none';
  });
  // Item other toggle
  document.getElementById('in-item').addEventListener('change', function() {
    document.getElementById('in-item-other-wrap').style.display = this.value === '__OTHER__' ? '' : 'none';
  });
}

function onItemSelect(prefix) {
  const sel = document.getElementById(prefix + '-item');
  const opt = sel.options[sel.selectedIndex];
  document.getElementById(prefix + '-category').value = opt.dataset.cat || '';
  document.getElementById(prefix + '-unit').value = opt.dataset.unit || '';
}

function calcTotal() {
  const qty = parseFloat(document.getElementById('in-qty').value) || 0;
  const rate = parseFloat(document.getElementById('in-rate').value) || 0;
  document.getElementById('in-total').value = qty && rate ? '₹' + fmtNum(qty * rate) : '';
}

async function saveInward() {
  const supplierSel = document.getElementById('in-supplier').value;
  const itemSel = document.getElementById('in-item').value;
  const supplier = supplierSel === '__OTHER__' ? document.getElementById('in-supplier-other').value.trim() : supplierSel;
  const itemName = itemSel === '__OTHER__' ? document.getElementById('in-item-other').value.trim() : itemSel;
  const date = document.getElementById('in-date').value;
  const qty = parseFloat(document.getElementById('in-qty').value);
  const rate = parseFloat(document.getElementById('in-rate').value) || 0;

  if (!date || !itemName || !qty || qty <= 0) { showToast('Please fill Date, Item, and Quantity'); return; }

  const row = {
    date, supplier_name: supplier || null, item_name: itemName,
    category: document.getElementById('in-category').value || null,
    size_spec: document.getElementById('in-size').value.trim() || null,
    quantity: qty, unit: document.getElementById('in-unit').value || null,
    rate, total_amount: qty * rate,
    invoice_number: document.getElementById('in-invoice').value.trim() || null,
    remark: document.getElementById('in-remark').value.trim() || null
  };

  const { error } = await sb.from('inward').insert([row]);
  if (error) { showToast('Error saving: ' + error.message); return; }
  showToast('✓ Inward entry saved!');
  navigate('inward');
}

// ── OUTWARD LIST ──────────────────────────────────────────
async function outward() {
  setLoading();
  document.getElementById('header-actions').innerHTML = `
    <button onclick="navigate('add-outward')" style="color:white;padding:8px;font-size:13px;font-weight:600;background:rgba(255,255,255,0.2);border-radius:8px;border:none;cursor:pointer;">+ Issue</button>`;

  const { data } = await sb.from('outward').select('*').order('date', { ascending: false }).limit(100);
  const rows = data || [];

  document.getElementById('page-content').innerHTML = `
    <div class="search-bar">
      <i class="lucide-search"></i>
      <input type="text" placeholder="Search item or machine..." id="out-search" oninput="filterOutward()" />
    </div>
    <div id="outward-list">
      ${rows.length === 0 ? '<div class="list-empty">No outward entries yet.<br>Tap + Issue to record parts issued.</div>' : ''}
      ${rows.map(r => `
        <div class="list-item" data-name="${esc(r.item_name)}" data-machine="${esc(r.machine_name)}">
          <div class="list-dot orange"></div>
          <div style="flex:1">
            <div class="list-main">${esc(r.item_name || '—')}</div>
            <div class="list-sub">${esc(r.machine_name || '—')} ${r.purpose ? '· ' + r.purpose : ''}</div>
          </div>
          <div class="list-right">
            <div class="list-amount" style="color:var(--orange)">₹${fmtNum(r.issue_amount)}</div>
            <div class="list-date">${fmtDate(r.date)} · Qty ${r.quantity}</div>
          </div>
        </div>`).join('')}
    </div>`;
}

function filterOutward() {
  const q = document.getElementById('out-search').value.toLowerCase();
  document.querySelectorAll('#outward-list .list-item').forEach(el => {
    const name = el.dataset.name.toLowerCase();
    const machine = el.dataset.machine.toLowerCase();
    el.style.display = (name.includes(q) || machine.includes(q)) ? '' : 'none';
  });
}

// ── ADD OUTWARD ───────────────────────────────────────────
function addOutward() {
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('page-content').innerHTML = `
    <div class="page-pad">
      <div class="form-section">
        <div class="form-section-title">Issue Details</div>
        <div class="form-group">
          <label class="form-label">Date <span>*</span></label>
          <input type="date" class="form-control" id="out-date" value="${today}" required>
        </div>
        <div class="form-group">
          <label class="form-label">Machine <span>*</span></label>
          <select class="form-control" id="out-machine">
            <option value="">Select machine...</option>
            ${masterMachines.map(m => `<option value="${esc(m.name)}">${esc(m.name)} (${esc(m.department)})</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Purpose / Remark</label>
          <input type="text" class="form-control" id="out-purpose" placeholder="e.g. Bearing replacement, Exhaust fan repair">
        </div>
        <div class="form-group">
          <label class="form-label">Issued By</label>
          <input type="text" class="form-control" id="out-issuedby" value="${esc(CONFIG.STOREKEEPER_NAME)}">
        </div>
      </div>

      <div class="form-section">
        <div class="form-section-title">Item Details</div>
        <div class="form-group">
          <label class="form-label">Item Name <span>*</span></label>
          <select class="form-control" id="out-item" onchange="onOutItemSelect()">
            <option value="">Select item...</option>
            ${masterItems.map(i => `<option value="${esc(i.name)}" data-cat="${esc(i.category)}" data-unit="${esc(i.unit)}">${esc(i.name)}</option>`).join('')}
            <option value="__OTHER__">Other (type below)</option>
          </select>
        </div>
        <div class="form-group" id="out-item-other-wrap" style="display:none">
          <input type="text" class="form-control" id="out-item-other" placeholder="Enter item name">
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Category</label>
            <input type="text" class="form-control auto" id="out-category" placeholder="Auto-filled" readonly>
          </div>
          <div class="form-group">
            <label class="form-label">Size / Spec</label>
            <input type="text" class="form-control" id="out-size" placeholder="e.g. 2 inch">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Quantity <span>*</span></label>
            <input type="number" class="form-control" id="out-qty" placeholder="0" min="0" step="any" oninput="calcOutTotal()">
          </div>
          <div class="form-group">
            <label class="form-label">Unit</label>
            <input type="text" class="form-control auto" id="out-unit" placeholder="Auto-filled" readonly>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Rate (₹) <span style="color:var(--text-secondary);font-weight:400">(optional)</span></label>
            <input type="number" class="form-control" id="out-rate" placeholder="0.00" min="0" step="any" oninput="calcOutTotal()">
          </div>
          <div class="form-group">
            <label class="form-label">Issue Amount (₹)</label>
            <input type="text" class="form-control auto" id="out-total" placeholder="Auto" readonly>
          </div>
        </div>
      </div>

      <button class="btn btn-orange" onclick="saveOutward()">
        <i class="lucide-save"></i> Save Outward Entry
      </button>
      <div style="height:16px"></div>
    </div>`;

  document.getElementById('out-item').addEventListener('change', function() {
    document.getElementById('out-item-other-wrap').style.display = this.value === '__OTHER__' ? '' : 'none';
  });
}

async function onOutItemSelect() {
  const sel = document.getElementById('out-item');
  const opt = sel.options[sel.selectedIndex];
  document.getElementById('out-category').value = opt.dataset.cat || '';
  document.getElementById('out-unit').value = opt.dataset.unit || '';

  // Auto-fill last rate from inward
  const itemName = sel.value;
  if (itemName && itemName !== '__OTHER__') {
    const { data } = await sb.from('inward').select('rate').eq('item_name', itemName).order('date', { ascending: false }).limit(1);
    if (data && data[0] && data[0].rate) {
      document.getElementById('out-rate').value = data[0].rate;
      calcOutTotal();
    }
  }
}

function calcOutTotal() {
  const qty = parseFloat(document.getElementById('out-qty').value) || 0;
  const rate = parseFloat(document.getElementById('out-rate').value) || 0;
  document.getElementById('out-total').value = qty && rate ? '₹' + fmtNum(qty * rate) : '';
}

async function saveOutward() {
  const itemSel = document.getElementById('out-item').value;
  const itemName = itemSel === '__OTHER__' ? document.getElementById('out-item-other').value.trim() : itemSel;
  const date = document.getElementById('out-date').value;
  const machine = document.getElementById('out-machine').value;
  const qty = parseFloat(document.getElementById('out-qty').value);
  const rate = parseFloat(document.getElementById('out-rate').value) || 0;

  if (!date || !itemName || !machine || !qty || qty <= 0) { showToast('Please fill Date, Item, Machine, and Quantity'); return; }

  const row = {
    date, item_name: itemName,
    category: document.getElementById('out-category').value || null,
    size_spec: document.getElementById('out-size').value.trim() || null,
    quantity: qty, unit: document.getElementById('out-unit').value || null,
    machine_name: machine, rate, issue_amount: qty * rate,
    purpose: document.getElementById('out-purpose').value.trim() || null,
    issued_by: document.getElementById('out-issuedby').value.trim() || null
  };

  const { error } = await sb.from('outward').insert([row]);
  if (error) { showToast('Error saving: ' + error.message); return; }
  showToast('✓ Outward entry saved!');
  navigate('outward');
}

// ── STOCK REGISTER ────────────────────────────────────────
async function stock() {
  setLoading();
  document.getElementById('page-content').innerHTML = `
    <div class="search-bar">
      <i class="lucide-search"></i>
      <input type="text" placeholder="Search items..." id="stock-search" oninput="filterStock()" />
    </div>
    <div class="loading"><div class="spinner"></div></div>`;

  const [itemsRes, openingRes, inRes, outRes] = await Promise.all([
    sb.from('items').select('name, category, unit, min_stock').order('name'),
    sb.from('opening_stock').select('item_name, quantity'),
    sb.from('inward').select('item_name, quantity'),
    sb.from('outward').select('item_name, quantity')
  ]);

  const opening = {};
  (openingRes.data || []).forEach(r => opening[r.item_name] = r.quantity);
  const inSums = {}, outSums = {};
  (inRes.data || []).forEach(r => inSums[r.item_name] = (inSums[r.item_name] || 0) + (r.quantity || 0));
  (outRes.data || []).forEach(r => outSums[r.item_name] = (outSums[r.item_name] || 0) + (r.quantity || 0));

  const stockItems = (itemsRes.data || []).map(item => ({
    ...item,
    current: (opening[item.name] || 0) + (inSums[item.name] || 0) - (outSums[item.name] || 0)
  }));

  const listHtml = stockItems.map(item => {
    const status = item.current <= 0 ? 'out' : item.current <= item.min_stock ? 'low' : 'ok';
    return `<div class="stock-item" data-name="${esc(item.name)}" data-cat="${esc(item.category)}">
      <div style="flex:1">
        <div class="stock-name">${esc(item.name)}</div>
        <div class="stock-cat">${esc(item.category)} · Min: ${item.min_stock} ${esc(item.unit)}</div>
      </div>
      <div class="stock-qty ${status}">${item.current}</div>
      <div style="font-size:11px;color:var(--text-secondary);margin-left:4px">${esc(item.unit)}</div>
    </div>`;
  }).join('');

  document.getElementById('page-content').innerHTML = `
    <div class="search-bar">
      <i class="lucide-search"></i>
      <input type="text" placeholder="Search items..." id="stock-search" oninput="filterStock()" />
    </div>
    <div style="padding:8px 16px;display:flex;gap:8px;flex-wrap:wrap">
      <button onclick="filterStockCat('')" class="cat-filter-btn active" data-cat="">All</button>
      ${[...new Set(stockItems.map(i => i.category))].map(c => `
        <button onclick="filterStockCat('${esc(c)}')" class="cat-filter-btn" data-cat="${esc(c)}">${esc(c)}</button>`).join('')}
    </div>
    <style>
      .cat-filter-btn{padding:5px 12px;border-radius:999px;border:1.5px solid var(--border);background:var(--white);font-size:12px;font-weight:500;cursor:pointer;color:var(--text-secondary);}
      .cat-filter-btn.active{background:var(--primary);color:white;border-color:var(--primary);}
    </style>
    <div id="stock-list" style="background:white;border-radius:12px;margin:0 16px;box-shadow:var(--shadow);">${listHtml}</div>
    <div style="padding:12px 16px;font-size:12px;color:var(--text-secondary)">
      <span style="color:var(--green)">● OK</span> &nbsp;
      <span style="color:var(--amber)">● Low</span> &nbsp;
      <span style="color:var(--red)">● Out of stock</span>
    </div>`;

  // Also set opening stock button
  document.getElementById('header-actions').innerHTML = `
    <button onclick="showOpeningStock()" style="color:white;padding:8px;font-size:12px;font-weight:600;background:rgba(255,255,255,0.2);border-radius:8px;border:none;cursor:pointer;">Opening Stock</button>`;
}

function filterStock() {
  const q = document.getElementById('stock-search').value.toLowerCase();
  document.querySelectorAll('#stock-list .stock-item').forEach(el => {
    const name = el.dataset.name.toLowerCase();
    el.style.display = name.includes(q) ? '' : 'none';
  });
}

function filterStockCat(cat) {
  document.querySelectorAll('.cat-filter-btn').forEach(b => b.classList.toggle('active', b.dataset.cat === cat));
  document.querySelectorAll('#stock-list .stock-item').forEach(el => {
    el.style.display = (!cat || el.dataset.cat === cat) ? '' : 'none';
  });
}

async function showOpeningStock() {
  const { data } = await sb.from('opening_stock').select('*');
  const map = {};
  (data || []).forEach(r => map[r.item_name] = r.quantity);

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-sheet" style="max-height:80vh">
      <div class="modal-handle"></div>
      <div class="modal-title">Set Opening Stock</div>
      <p style="font-size:13px;color:var(--text-secondary);margin-bottom:16px">Enter the current physical count for each item. Do this once when you first start.</p>
      <div style="max-height:50vh;overflow-y:auto">
        ${masterItems.map(item => `
          <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
            <div style="flex:1;font-size:13px;font-weight:500">${esc(item.name)}</div>
            <input type="number" value="${map[item.name] || 0}" min="0" step="any"
              id="os-${esc(item.name.replace(/[^a-z0-9]/gi,'_'))}"
              data-item="${esc(item.name)}"
              style="width:70px;padding:6px 8px;border:1.5px solid var(--border);border-radius:6px;text-align:right;font-size:13px">
            <span style="font-size:11px;color:var(--text-secondary);width:28px">${esc(item.unit)}</span>
          </div>`).join('')}
      </div>
      <div class="modal-actions">
        <button class="btn btn-outline" onclick="this.closest('.modal-overlay').remove()">Cancel</button>
        <button class="btn btn-primary" onclick="saveOpeningStock()">Save</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}

async function saveOpeningStock() {
  const inputs = document.querySelectorAll('[data-item]');
  const rows = [];
  inputs.forEach(inp => {
    rows.push({ item_name: inp.dataset.item, quantity: parseFloat(inp.value) || 0, updated_at: new Date().toISOString() });
  });

  for (const row of rows) {
    await sb.from('opening_stock').upsert(row, { onConflict: 'item_name' });
  }
  document.querySelector('.modal-overlay').remove();
  showToast('✓ Opening stock saved!');
  stock();
}

// ── MONTHLY REPORT ────────────────────────────────────────
async function reports() {
  const now = new Date();
  let selMonth = now.getMonth() + 1;
  let selYear = now.getFullYear();

  async function loadReport() {
    const start = `${selYear}-${String(selMonth).padStart(2,'0')}-01`;
    const nextM = selMonth === 12 ? 1 : selMonth + 1;
    const nextY = selMonth === 12 ? selYear + 1 : selYear;
    const end = `${nextY}-${String(nextM).padStart(2,'0')}-01`;

    const [inData, outData] = await Promise.all([
      sb.from('inward').select('total_amount').gte('date', start).lt('date', end),
      sb.from('outward').select('issue_amount, machine_name, quantity').gte('date', start).lt('date', end)
    ]);

    const totalPurchase = (inData.data || []).reduce((s, r) => s + (r.total_amount || 0), 0);
    const totalIssue = (outData.data || []).reduce((s, r) => s + (r.issue_amount || 0), 0);
    const totalQty = (outData.data || []).reduce((s, r) => s + (r.quantity || 0), 0);

    const machineMap = {};
    (outData.data || []).forEach(r => {
      if (r.machine_name) {
        machineMap[r.machine_name] = (machineMap[r.machine_name] || 0) + (r.issue_amount || 0);
      }
    });
    const sortedMachines = Object.entries(machineMap).sort((a,b) => b[1]-a[1]);
    const maxAmt = sortedMachines[0]?.[1] || 1;

    const monthName = new Date(selYear, selMonth-1, 1).toLocaleString('default', { month: 'long' });

    document.getElementById('report-body').innerHTML = `
      <div class="page-pad">
        <div class="kpi-grid">
          <div class="kpi-card"><div class="kpi-label">Total Purchased</div><div class="kpi-value primary">₹${fmtNum(totalPurchase)}</div></div>
          <div class="kpi-card"><div class="kpi-label">Total Issued</div><div class="kpi-value orange">₹${fmtNum(totalIssue)}</div></div>
          <div class="kpi-card"><div class="kpi-label">Transactions</div><div class="kpi-value primary">${(inData.data||[]).length + (outData.data||[]).length}</div></div>
          <div class="kpi-card"><div class="kpi-label">Parts Qty Issued</div><div class="kpi-value green">${totalQty}</div></div>
        </div>
      </div>

      <div class="section-title">Machine-wise Maintenance Cost</div>
      <div style="background:white;border-radius:12px;margin:0 16px;box-shadow:var(--shadow)">
        ${sortedMachines.length === 0 ? '<div class="list-empty">No outward entries for this month.</div>' : ''}
        ${sortedMachines.map(([name, amt]) => `
          <div class="machine-row">
            <div class="machine-name">${esc(name)}</div>
            <div class="machine-bar-wrap"><div class="machine-bar" style="width:${Math.round(amt/maxAmt*100)}%"></div></div>
            <div class="machine-amount">₹${fmtNum(amt)}</div>
          </div>`).join('')}
      </div>
      <div style="height:20px"></div>`;
  }

  document.getElementById('page-content').innerHTML = `
    <div class="month-selector">
      <select id="rpt-month" onchange="rptChange()">
        ${Array.from({length:12},(_,i)=>`<option value="${i+1}" ${i+1===selMonth?'selected':''}>${new Date(2000,i,1).toLocaleString('default',{month:'long'})}</option>`).join('')}
      </select>
      <select id="rpt-year" onchange="rptChange()">
        ${[selYear-1, selYear, selYear+1].map(y=>`<option value="${y}" ${y===selYear?'selected':''}>${y}</option>`).join('')}
      </select>
    </div>
    <div id="report-body"><div class="loading"><div class="spinner"></div></div></div>`;

  window.rptChange = async () => {
    selMonth = parseInt(document.getElementById('rpt-month').value);
    selYear = parseInt(document.getElementById('rpt-year').value);
    document.getElementById('report-body').innerHTML = '<div class="loading"><div class="spinner"></div></div>';
    await loadReport();
  };

  await loadReport();
}

// ── MORE SCREEN ───────────────────────────────────────────
function more() {
  document.getElementById('page-content').innerHTML = `
    <div class="page-pad">
      <div class="card">
        <div class="card-title">Management</div>
        <button onclick="navigate('reports')" style="display:flex;align-items:center;gap:12px;width:100%;padding:14px 0;border-bottom:1px solid var(--border);background:none;text-align:left;cursor:pointer">
          <i class="lucide-bar-chart-2" style="font-size:22px;color:var(--primary)"></i>
          <div><div style="font-size:14px;font-weight:600">Monthly Report</div><div style="font-size:12px;color:var(--text-secondary)">Spend analysis, machine costs</div></div>
          <i class="lucide-chevron-right" style="font-size:18px;color:var(--gray-400);margin-left:auto"></i>
        </button>
        <button onclick="navigate('masters')" style="display:flex;align-items:center;gap:12px;width:100%;padding:14px 0;background:none;text-align:left;cursor:pointer">
          <i class="lucide-database" style="font-size:22px;color:var(--primary)"></i>
          <div><div style="font-size:14px;font-weight:600">Masters</div><div style="font-size:12px;color:var(--text-secondary)">Items, machines, suppliers</div></div>
          <i class="lucide-chevron-right" style="font-size:18px;color:var(--gray-400);margin-left:auto"></i>
        </button>
      </div>
      <div class="card">
        <div class="card-title">App Info</div>
        <div style="font-size:13px;color:var(--text-secondary);line-height:1.7">
          <div><b>Factory:</b> ${esc(CONFIG.FACTORY_NAME)}</div>
          <div><b>Version:</b> 1.0</div>
        </div>
        <button onclick="logout()" class="btn btn-outline" style="margin-top:16px">
          <i class="lucide-log-out"></i> Logout
        </button>
      </div>
    </div>`;
}

function logout() {
  sessionStorage.removeItem('pinOk');
  location.reload();
}

// ── MASTERS ───────────────────────────────────────────────
async function masters() {
  currentTab = currentTab || 'items';
  setLoading();

  async function loadTab(tab) {
    currentTab = tab;
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    const listEl = document.getElementById('masters-list');

    if (tab === 'items') {
      const { data } = await sb.from('items').select('*').order('name');
      listEl.innerHTML = (data || []).map(i => `
        <div class="master-item">
          <div style="flex:1">
            <div class="master-name">${esc(i.name)}</div>
            <div class="master-sub">Unit: ${esc(i.unit)} · Min Stock: ${i.min_stock}</div>
          </div>
          <span class="cat-pill">${esc(i.category)}</span>
        </div>`).join('');
    } else if (tab === 'machines') {
      const { data } = await sb.from('machines').select('*').order('name');
      listEl.innerHTML = (data || []).map(m => `
        <div class="master-item">
          <div style="flex:1">
            <div class="master-name">${esc(m.name)}</div>
            <div class="master-sub">${esc(m.department)} · ${esc(m.machine_type)}</div>
          </div>
        </div>`).join('');
    } else {
      const { data } = await sb.from('suppliers').select('*').order('name');
      listEl.innerHTML = (data || []).map(s => `
        <div class="master-item">
          <div style="flex:1">
            <div class="master-name">${esc(s.name)}</div>
            <div class="master-sub">${esc(s.products_supplied || '—')}</div>
          </div>
        </div>`).join('');
    }
  }

  document.getElementById('page-content').innerHTML = `
    <div class="tab-bar">
      <div class="tab ${currentTab==='items'?'active':''}" data-tab="items" onclick="masters_loadTab('items')">Items</div>
      <div class="tab ${currentTab==='machines'?'active':''}" data-tab="machines" onclick="masters_loadTab('machines')">Machines</div>
      <div class="tab ${currentTab==='suppliers'?'active':''}" data-tab="suppliers" onclick="masters_loadTab('suppliers')">Suppliers</div>
    </div>
    <div style="background:white;border-radius:12px;margin:16px;box-shadow:var(--shadow)">
      <div id="masters-list"><div class="loading"><div class="spinner"></div></div></div>
    </div>`;

  window.masters_loadTab = loadTab;
  loadTab(currentTab);
}

// ── UTILS ─────────────────────────────────────────────────
function fmtNum(n) {
  if (!n && n !== 0) return '0';
  if (n >= 100000) return (n/100000).toFixed(1) + 'L';
  if (n >= 1000) return (n/1000).toFixed(1) + 'k';
  return parseFloat(n.toFixed(2)).toString();
}

function fmtDate(d) {
  if (!d) return '—';
  const dt = new Date(d);
  return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
