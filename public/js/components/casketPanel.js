import { api } from '../api.js';
import { createItemCard } from './itemCard.js';
import { showToast, confirm } from '../app.js';

let currentCasket = null;
let inventoryItems = [];
let casketItems = [];

export function openCasketPanel(casket, allInventoryItems) {
  currentCasket = casket;
  inventoryItems = allInventoryItems;

  document.getElementById('casket-name').textContent = casket.name;
  updateCasketCount(casket.itemCount, casket.maxItems);

  // Show panel
  document.getElementById('casket-panel').classList.remove('hidden');

  // Render inventory side — exclude items already inside any storage unit
  // (can't move an item from one storage unit directly to another via the GC API)
  renderInvSide(inventoryItems.filter(i => !i.inCasket));

  // Load casket contents
  document.getElementById('casket-contents-grid').innerHTML = '<div class="loading-msg">Loading contents...</div>';
  loadCasketContents();

  // Search filters
  document.getElementById('casket-inv-search').value = '';
  document.getElementById('casket-contents-search').value = '';

  document.getElementById('casket-inv-search').oninput = (e) => {
    const q = e.target.value.toLowerCase();
    renderInvSide(
      inventoryItems
        .filter(i => !i.inCasket)
        .filter(i => i.name.toLowerCase().includes(q) || (i.customName?.toLowerCase().includes(q)))
    );
  };

  document.getElementById('casket-contents-search').oninput = (e) => {
    const q = e.target.value.toLowerCase();
    renderContentsSide(casketItems.filter(i => i.name.toLowerCase().includes(q) || (i.customName?.toLowerCase().includes(q))));
  };
}

export function closeCasketPanel() {
  document.getElementById('casket-panel').classList.add('hidden');
  currentCasket = null;
}

async function loadCasketContents() {
  try {
    const { items } = await api.caskets.contents(currentCasket.id);
    casketItems = items;
    renderContentsSide(casketItems);
    updateCasketCount(casketItems.length, currentCasket.maxItems);
  } catch (err) {
    document.getElementById('casket-contents-grid').innerHTML = `<p class="loading-msg" style="color:var(--danger)">${err.message}</p>`;
    showToast(err.message, 'error');
  }
}

function renderInvSide(items) {
  const grid = document.getElementById('casket-inv-grid');
  grid.innerHTML = '';
  if (!items.length) {
    grid.innerHTML = '<p class="loading-msg">No items.</p>';
    return;
  }
  const frag = document.createDocumentFragment();
  for (const item of items) {
    frag.appendChild(createItemCard(item, onClickInventoryItem));
  }
  grid.appendChild(frag);
}

function renderContentsSide(items) {
  const grid = document.getElementById('casket-contents-grid');
  grid.innerHTML = '';
  if (!items.length) {
    grid.innerHTML = '<p class="loading-msg">Storage unit is empty.</p>';
    return;
  }
  const frag = document.createDocumentFragment();
  for (const item of items) {
    frag.appendChild(createItemCard(item, onClickCasketItem));
  }
  grid.appendChild(frag);
}

async function onClickInventoryItem(item) {
  if (!currentCasket) return;

  const ok = await confirm(`Move "${item.customName || item.name}" into "${currentCasket.name}"?`);
  if (!ok) return;

  // Optimistic UI: move card immediately
  const card = document.querySelector(`#casket-inv-grid [data-id="${item.id}"]`);
  if (card) card.style.opacity = '0.4';

  try {
    await api.caskets.add(currentCasket.id, item.id);
    // Update local state
    inventoryItems = inventoryItems.filter(i => i.id !== item.id);
    casketItems = [...casketItems, { ...item, inCasket: currentCasket.id }];
    renderInvSide(inventoryItems);
    renderContentsSide(casketItems);
    updateCasketCount(casketItems.length, currentCasket.maxItems);
    showToast(`Moved "${item.customName || item.name}" to storage unit`, 'success');
    // Notify app to update main inventory
    window.__casketMoved?.(item.id, 'add');
  } catch (err) {
    if (card) card.style.opacity = '1';
    showToast(err.message, 'error');
  }
}

async function onClickCasketItem(item) {
  if (!currentCasket) return;

  const ok = await confirm(`Move "${item.customName || item.name}" back to your inventory?`);
  if (!ok) return;

  const card = document.querySelector(`#casket-contents-grid [data-id="${item.id}"]`);
  if (card) card.style.opacity = '0.4';

  try {
    await api.caskets.remove(currentCasket.id, item.id);
    casketItems = casketItems.filter(i => i.id !== item.id);
    inventoryItems = [...inventoryItems, { ...item, inCasket: null }];
    renderContentsSide(casketItems);
    renderInvSide(inventoryItems);
    updateCasketCount(casketItems.length, currentCasket.maxItems);
    showToast(`Moved "${item.customName || item.name}" to inventory`, 'success');
    window.__casketMoved?.(item.id, 'remove', item);
  } catch (err) {
    if (card) card.style.opacity = '1';
    showToast(err.message, 'error');
  }
}

function updateCasketCount(current, max) {
  document.getElementById('casket-count').textContent = `${current} / ${max} items`;
}
