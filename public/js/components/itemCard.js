export function createItemCard(item, onClick) {
  const card = document.createElement('div');
  card.className = 'item-card';
  card.dataset.id = item.id;
  card.style.borderLeftColor = item.rarityColor || '#b0c3d9';

  if (item.imageUrl) {
    const img = document.createElement('img');
    img.src = item.imageUrl;
    img.alt = item.name;
    img.loading = 'lazy';
    img.onerror = () => {
      img.replaceWith(placeholder());
    };
    card.appendChild(img);
  } else {
    card.appendChild(placeholder());
  }

  const info = document.createElement('div');
  info.className = 'item-info';

  const name = document.createElement('span');
  name.className = 'item-name';
  name.textContent = item.customName || item.name;
  name.title = item.name;
  info.appendChild(name);

  if (item.exterior) {
    const ext = document.createElement('span');
    ext.className = 'item-exterior';
    ext.textContent = abbreviateExterior(item.exterior);
    info.appendChild(ext);
  }

  if (item.paintWear != null) {
    const fl = document.createElement('span');
    fl.className = 'item-float';
    fl.textContent = item.paintWear.toFixed(6);
    info.appendChild(fl);
  }

  card.appendChild(info);

  const badges = document.createElement('div');
  badges.className = 'item-badges';
  if (item.statTrak != null) {
    badges.appendChild(badge('ST', 'badge-stattrak'));
  }
  if (item.isSouvenir || item.localizedQuality === 'Souvenir') {
    badges.appendChild(badge('SV', 'badge-souvenir'));
  }
  if (item.customName) {
    badges.appendChild(badge('NT', 'badge-nametag'));
  }
  if (item.inCasket) {
    badges.appendChild(badge('SU', 'badge-storage-unit'));
  }
  if (item.hasKeychain) {
    badges.appendChild(badge('KC', 'badge-keychain'));
  }
  if (badges.children.length) {
    card.appendChild(badges);
  }

  if (onClick) {
    card.addEventListener('click', () => onClick(item));
  }

  return card;
}

function abbreviateExterior(ext) {
  const map = {
    'Factory New': 'FN',
    'Minimal Wear': 'MW',
    'Field-Tested': 'FT',
    'Well-Worn': 'WW',
    'Battle-Scarred': 'BS',
  };
  return map[ext] || ext;
}

function badge(text, cls) {
  const el = document.createElement('span');
  el.className = `badge ${cls}`;
  el.textContent = text;
  return el;
}

function placeholder() {
  const el = document.createElement('div');
  el.className = 'item-img-placeholder';
  el.textContent = '?';
  return el;
}
