import { createItemCard } from './itemCard.js';

const RARITY_ORDER = [
  'Consumer Grade', 'Industrial Grade', 'Mil-Spec Grade',
  'Restricted', 'Classified', 'Covert', 'Extraordinary', 'Contraband',
];

export function renderInventoryGrid(items, storageUnits, { onOpenCasket }) {
  renderStorageUnits(storageUnits, onOpenCasket);
  // Item rendering is handled separately by renderItems / applyFilters
}

function renderStorageUnits(storageUnits, onOpenCasket) {
  const list = document.getElementById('storage-unit-list');
  list.innerHTML = '';

  if (!storageUnits.length) {
    list.innerHTML = '<p class="empty-msg">No storage units found.</p>';
    return;
  }

  for (const su of storageUnits) {
    const card = document.createElement('div');
    card.className = 'storage-unit-card';
    card.dataset.id = su.id;

    const name = document.createElement('span');
    name.className = 'su-name';
    name.textContent = su.name;
    name.title = su.name;

    const count = document.createElement('span');
    count.className = 'su-count';
    count.textContent = `${su.itemCount} / ${su.maxItems} items`;

    card.appendChild(name);
    card.appendChild(count);
    card.addEventListener('click', () => {
      document.querySelectorAll('.storage-unit-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      onOpenCasket(su);
    });

    list.appendChild(card);
  }
}

export function renderItems(items, containerSelector = '#inventory-grid', onItemClick = null) {
  const grid = document.querySelector(containerSelector);
  grid.innerHTML = '';

  if (!items.length) {
    grid.innerHTML = '<p class="loading-msg">No items found.</p>';
    return;
  }

  const frag = document.createDocumentFragment();
  for (const item of items) {
    frag.appendChild(createItemCard(item, onItemClick));
  }
  grid.appendChild(frag);
}

export function filterAndSort(items, { search, type, rarity, sort }) {
  let result = items;

  if (search) {
    const q = search.toLowerCase();
    result = result.filter(i => i.name.toLowerCase().includes(q) || (i.customName?.toLowerCase().includes(q)));
  }
  if (type) {
    result = result.filter(i => i.type === type || i.weapon === type);
  }
  if (rarity) {
    result = result.filter(i => i.rarity === rarity);
  }

  result = [...result].sort((a, b) => {
    if (sort === 'rarity') {
      return (RARITY_ORDER.indexOf(b.rarity) - RARITY_ORDER.indexOf(a.rarity));
    }
    if (sort === 'float') {
      return (b.paintWear ?? 1) - (a.paintWear ?? 1);
    }
    return a.name.localeCompare(b.name);
  });

  return result;
}
