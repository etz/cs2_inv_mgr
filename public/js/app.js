import { api } from './api.js';
import { initLoginForm } from './components/loginForm.js';
import { renderInventoryGrid, filterAndSort, renderItems } from './components/inventoryGrid.js';
import { openCasketPanel, closeCasketPanel } from './components/casketPanel.js';
import { openArmoryPanel, closeArmoryPanel } from './components/armoryPanel.js';
import { initItemDetailsModal, openItemDetails } from './components/itemDetailsModal.js';

// ── State ────────────────────────────────────────────────────────────────────

const state = {
  user: null,
  inventory: [],
  storageUnits: [],
  filters: { search: '', type: '', rarity: '', sort: 'name' },
};

// ── Toast ────────────────────────────────────────────────────────────────────

export function showToast(message, type = 'info') {
  const container = document.getElementById('toasts');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// ── Confirm modal ────────────────────────────────────────────────────────────

export function confirm(message) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('confirm-modal');
    document.getElementById('confirm-msg').textContent = message;
    overlay.classList.remove('hidden');

    function cleanup(result) {
      overlay.classList.add('hidden');
      document.getElementById('btn-confirm-yes').removeEventListener('click', yes);
      document.getElementById('btn-confirm-no').removeEventListener('click', no);
      resolve(result);
    }
    function yes() { cleanup(true); }
    function no()  { cleanup(false); }

    document.getElementById('btn-confirm-yes').addEventListener('click', yes);
    document.getElementById('btn-confirm-no').addEventListener('click', no);
  });
}

// ── Status banner ────────────────────────────────────────────────────────────

function setBanner(message, type) {
  const banner = document.getElementById('status-banner');
  if (!message) { banner.classList.add('hidden'); return; }
  banner.textContent = message;
  banner.className = `status-banner ${type}`;
}

// ── Views ────────────────────────────────────────────────────────────────────

function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  document.getElementById(`view-${name}`).classList.remove('hidden');
}

// ── Inventory ────────────────────────────────────────────────────────────────

async function loadInventory() {
  document.getElementById('inventory-grid').innerHTML = '<div class="loading-msg">Loading inventory...</div>';
  try {
    const { items, storageUnits } = await api.inventory.get();
    state.inventory = items;
    state.storageUnits = storageUnits;
    // Render storage unit sidebar
    renderInventoryGrid([], storageUnits, { onOpenCasket });
    // Render items with current filters
    applyFilters();
  } catch (err) {
    document.getElementById('inventory-grid').innerHTML = `<p class="loading-msg" style="color:var(--danger)">${err.message}</p>`;
    showToast(err.message, 'error');
  }
}

function applyFilters() {
  const filtered = filterAndSort(state.inventory, state.filters);
  renderItems(filtered, '#inventory-grid', openItemDetails);
  updateCount(filtered.length);
}

function updateCount(filtered) {
  const total = state.inventory.length;
  const shown = filtered ?? total;
  document.getElementById('inventory-count').textContent =
    shown === total ? `${total} items` : `${shown} of ${total} items`;
}

// ── Casket panel ─────────────────────────────────────────────────────────────

function onOpenCasket(su) {
  openCasketPanel(su, [...state.inventory]);
}

function onArmoryRedeemed() {
  loadInventory();
}

// Callbacks from casketPanel.js
window.__casketMoved = (itemId, direction, item) => {
  if (direction === 'add') {
    state.inventory = state.inventory.filter(i => i.id !== itemId);
  } else {
    // item from casket now has community data via backend fix
    if (item && !state.inventory.find(i => i.id === itemId)) {
      state.inventory = [...state.inventory, item];
    }
  }
  applyFilters();
  updateCount();
};

// ── GC status polling ─────────────────────────────────────────────────────────

let gcPollInterval = null;

function startGCPoll() {
  gcPollInterval = setInterval(async () => {
    try {
      const s = await api.auth.status();
      const dot = document.getElementById('gc-indicator');
      if (s.connectedToGC) {
        dot.className = 'gc-dot connected';
        dot.title = 'Connected to Game Coordinator';
        setBanner(null);
      } else if (s.loggedIn) {
        dot.className = 'gc-dot disconnected';
        dot.title = 'Disconnected from Game Coordinator';
        setBanner('Reconnecting to CS2 Game Coordinator...', 'warning');
      } else {
        // Logged out unexpectedly
        stopGCPoll();
        showView('login');
        showToast('Steam session ended. Please log in again.', 'error');
      }
    } catch (_) {}
  }, 10000);
}

function stopGCPoll() {
  if (gcPollInterval) { clearInterval(gcPollInterval); gcPollInterval = null; }
}

// ── Login success ─────────────────────────────────────────────────────────────

function onLoginSuccess(result) {
  state.user = result;
  document.getElementById('header-username').textContent = result.username || result.steamId || '';
  showView('inventory');
  loadInventory();
  startGCPoll();
}

// QR auth success callback
window.__qrAuthSuccess = onLoginSuccess;

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  initItemDetailsModal();

  // Filter/sort listeners
  document.getElementById('search-input').addEventListener('input', (e) => {
    state.filters.search = e.target.value;
    applyFilters();
  });
  document.getElementById('filter-type').addEventListener('change', (e) => {
    state.filters.type = e.target.value;
    applyFilters();
  });
  document.getElementById('filter-rarity').addEventListener('change', (e) => {
    state.filters.rarity = e.target.value;
    applyFilters();
  });
  document.getElementById('sort-by').addEventListener('change', (e) => {
    state.filters.sort = e.target.value;
    applyFilters();
  });
  document.getElementById('btn-refresh-inv').addEventListener('click', loadInventory);
  document.getElementById('btn-open-armory').addEventListener('click', () => {
    openArmoryPanel({ onRedeemed: onArmoryRedeemed });
  });

  // Logout
  document.getElementById('btn-logout').addEventListener('click', async () => {
    stopGCPoll();
    await api.auth.logout().catch(() => {});
    state.user = null;
    state.inventory = [];
    state.storageUnits = [];
    closeArmoryPanel();
    showView('login');
    setBanner(null);
  });

  // Close casket panel
  document.getElementById('btn-close-casket').addEventListener('click', () => {
    closeCasketPanel();
    // Deselect storage unit card
    document.querySelectorAll('.storage-unit-card').forEach(c => c.classList.remove('active'));
  });
  document.getElementById('btn-close-armory').addEventListener('click', closeArmoryPanel);

  // Init login form
  initLoginForm(onLoginSuccess);

  // Check if already logged in (page refresh)
  try {
    const s = await api.auth.status();
    if (s.loggedIn && s.connectedToGC) {
      onLoginSuccess({ steamId: s.steamId, username: s.username });
    } else {
      showView('login');
    }
  } catch (_) {
    showView('login');
  }
}

init();
