function detailRow(label, value) {
  if (value == null || value === '') {
    return '';
  }

  return `
    <div class="details-row">
      <span class="details-label">${escapeHtml(label)}</span>
      <span class="details-value">${escapeHtml(String(value))}</span>
    </div>
  `;
}

function attachmentCard(attachment, extra = '') {
  const image = attachment.itemUrl
    ? `<img src="${escapeHtml(attachment.itemUrl)}" alt="${escapeHtml(attachment.localizedName || 'Attachment')}" loading="lazy" />`
    : '<div class="item-img-placeholder">?</div>';
  const subtitle = extra ? `<span class="details-attachment-subtitle">${escapeHtml(extra)}</span>` : '';

  return `
    <div class="details-attachment-card">
      <div class="details-attachment-thumb">${image}</div>
      <div class="details-attachment-copy">
        <span class="details-attachment-name">${escapeHtml(attachment.localizedName || attachment.item_name || 'Unknown')}</span>
        ${subtitle}
      </div>
    </div>
  `;
}

export function initItemDetailsModal() {
  const overlay = document.getElementById('item-details-modal');
  const closeButton = document.getElementById('btn-close-details');

  closeButton.addEventListener('click', closeItemDetails);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) {
      closeItemDetails();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !overlay.classList.contains('hidden')) {
      closeItemDetails();
    }
  });
}

export function openItemDetails(item) {
  const overlay = document.getElementById('item-details-modal');
  const image = document.getElementById('details-image');
  const placeholder = document.getElementById('details-placeholder');
  const subtitle = document.getElementById('details-subtitle');
  const meta = document.getElementById('details-meta');
  const stickerSection = document.getElementById('details-stickers');
  const keychainSection = document.getElementById('details-keychains');

  document.getElementById('details-name').textContent = item.customName || item.localizedName || item.name;
  subtitle.textContent = [item.localizedQuality, item.rarityName, item.category].filter(Boolean).join(' • ');

  if (item.imageUrl) {
    image.src = item.imageUrl;
    image.alt = item.name;
    image.classList.remove('hidden');
    placeholder.classList.add('hidden');
  } else {
    image.classList.add('hidden');
    placeholder.classList.remove('hidden');
  }

  meta.innerHTML = [
    detailRow('Market Name', item.marketHashName),
    detailRow('Custom Name', item.customName),
    detailRow('Wear', item.itemWearNameLocalized),
    detailRow('Float', item.paintWear != null ? item.paintWear.toFixed(8) : null),
    detailRow('Paint Seed', item.paintSeed),
    detailRow('Tracked Kills', item.trackedKills),
    detailRow('Charm Template', item.keychainSeed),
    detailRow('Trade Unlock', formatDate(item.unlockTime)),
    detailRow('Escrow Until', formatDate(item.escrowTime)),
    detailRow('Highlight', item.highlightReelLink),
    detailRow('Storage Unit', item.casketName),
  ].filter(Boolean).join('');

  renderAttachments(stickerSection, item.stickers ?? [], (sticker) => {
    const parts = [];
    if (sticker.rarityName) {
      parts.push(sticker.rarityName);
    }
    if (sticker.wear != null) {
      parts.push(`Wear ${Number(sticker.wear).toFixed(3)}`);
    }
    return parts.join(' • ');
  });

  renderAttachments(keychainSection, item.keychains ?? [], (keychain) => {
    const parts = [];
    if (keychain.seed != null) {
      parts.push(`Template ${keychain.seed}`);
    }
    if (keychain.highlightReel != null) {
      parts.push(`Highlight ${keychain.highlightReel}`);
    }
    return parts.join(' • ');
  });

  overlay.classList.remove('hidden');
}

export function closeItemDetails() {
  document.getElementById('item-details-modal').classList.add('hidden');
}

function renderAttachments(section, attachments, subtitleBuilder) {
  const container = section.querySelector('.details-attachments');
  if (!attachments.length) {
    section.classList.add('hidden');
    container.innerHTML = '';
    return;
  }

  container.innerHTML = attachments
    .map((attachment) => attachmentCard(attachment, subtitleBuilder(attachment)))
    .join('');
  section.classList.remove('hidden');
}

function formatDate(value) {
  if (!value) {
    return null;
  }

  return new Date(value).toLocaleString();
}

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
