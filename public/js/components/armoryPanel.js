import { api } from '../api.js';
import { confirm, showToast } from '../app.js';

let current = {
  state: null,
  rotationOffers: [],
  onRedeemed: null,
};

export async function openArmoryPanel(options = {}) {
  current.onRedeemed = typeof options.onRedeemed === 'function' ? options.onRedeemed : null;
  document.getElementById('armory-panel').classList.remove('hidden');
  await refreshArmoryPanel();
}

export function closeArmoryPanel() {
  document.getElementById('armory-panel').classList.add('hidden');
}

export async function refreshArmoryPanel() {
  const offersEl = document.getElementById('armory-offers');
  const collectionsEl = document.getElementById('armory-collections');

  offersEl.innerHTML = '<p class="loading-msg">Loading current Armory rotation...</p>';
  collectionsEl.innerHTML = '';

  try {
    const [stateResp, collectionsResp] = await Promise.all([
      api.armory.state(),
      api.armory.collections(),
    ]);

    current.state = stateResp;
    current.rotationOffers = (stateResp.rotationOffers && stateResp.rotationOffers.length > 0)
      ? stateResp.rotationOffers
      : (collectionsResp.rotationOffers ?? []);

    renderHeader(stateResp);
    renderRotation(current.rotationOffers, stateResp);
    renderSeasonMeta(stateResp, collectionsResp);
  } catch (error) {
    offersEl.innerHTML = `<p class="loading-msg" style="color:var(--danger)">${error.message}</p>`;
    showToast(error.message, 'error');
  }
}

function renderHeader(state) {
  const balance = Number(state?.balance ?? 0) || 0;
  document.getElementById('armory-balance').textContent = `${balance} stars`;

  const status = document.getElementById('armory-status');
  if (!state?.connectedToGC) {
    status.textContent = 'Disconnected from GC. Armory actions are disabled.';
    status.classList.remove('hidden');
    return;
  }

  if (balance <= 0) {
    status.textContent = 'No redeemable stars available.';
    status.classList.remove('hidden');
    return;
  }

  status.classList.add('hidden');
  status.textContent = '';
}

function renderRotation(offers, state) {
  const root = document.getElementById('armory-offers');
  root.innerHTML = '';

  if (!offers.length) {
    root.innerHTML = '<p class="loading-msg">No XP shop rotation data found in items_game.txt.</p>';
    return;
  }

  const frag = document.createDocumentFragment();

  for (const offer of offers) {
    const card = document.createElement('article');
    card.className = 'armory-offer-card';

    const title = document.createElement('h4');
    title.textContent = offer.collectionLabel || offer.itemName || 'Armory Reward';
    card.appendChild(title);

    const subtitle = document.createElement('p');
    subtitle.className = 'armory-offer-meta';
    subtitle.textContent = `${Number(offer.points ?? 0) || 0} stars`;
    card.appendChild(subtitle);

    const img = document.createElement('img');
    img.src = offer.previewImage || buildFallbackPreview(title.textContent);
    img.alt = title.textContent;
    img.className = 'armory-offer-image';
    img.loading = 'lazy';
    img.onerror = () => {
      img.onerror = null;
      img.src = buildFallbackPreview(title.textContent);
    };
    card.appendChild(img);

    const button = document.createElement('button');
    button.className = 'btn btn-primary';
    button.textContent = 'Redeem';
    button.disabled = !offer.canRedeem;
    button.addEventListener('click', () => onRedeemOffer(offer));
    card.appendChild(button);

    if (!offer.canRedeem) {
      const hint = document.createElement('p');
      hint.className = 'armory-offer-hint';
      hint.textContent = buildDisabledHint(offer, state);
      card.appendChild(hint);
    }

    frag.appendChild(card);
  }

  root.appendChild(frag);
}

function renderSeasonMeta(stateResp, collectionsResp) {
  const seasonId = stateResp.currentArmorySeason || collectionsResp.currentArmorySeason;
  const meta = document.getElementById('armory-collections');
  meta.innerHTML = '';

  const text = document.createElement('p');
  text.className = 'armory-collection-meta';
  text.textContent = seasonId
    ? `Season ${seasonId} XP shop rotation loaded from items_game.txt.`
    : 'No active xpshop season found in items_game.txt.';
  meta.appendChild(text);
}

function buildDisabledHint(offer, state) {
  if (!state?.connectedToGC) {
    return 'GC not connected.';
  }

  const balance = Number(state?.balance ?? 0) || 0;
  const points = Number(offer.points ?? 0) || 0;
  if (balance < points) {
    return `Need ${points} stars (you have ${balance}).`;
  }

  if (!offer.redeemPayload) {
    return 'Redeem unavailable right now.';
  }

  return 'Redeem unavailable.';
}

function buildFallbackPreview(label) {
  const safe = String(label || 'Armory Reward')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="360" viewBox="0 0 360 360"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#10273c"/><stop offset="100%" stop-color="#214966"/></linearGradient></defs><rect width="360" height="360" fill="url(#g)"/><rect x="12" y="12" width="336" height="336" fill="none" stroke="#4f7da1" stroke-opacity="0.6"/><text x="180" y="170" fill="#d6e9f6" font-size="18" text-anchor="middle" font-family="Segoe UI, sans-serif">Armory</text><text x="180" y="205" fill="#b7cddd" font-size="15" text-anchor="middle" font-family="Segoe UI, sans-serif">${safe}</text></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

async function onRedeemOffer(offer) {
  const payload = offer.redeemPayload;
  if (!payload) {
    showToast('This reward does not have redeem payload data yet.', 'error');
    return;
  }

  const name = offer.collectionLabel || offer.itemName || 'reward';
  const ok = await confirm(`Redeem "${name}" for ${offer.points} stars?`);
  if (!ok) {
    return;
  }

  try {
    await api.armory.redeem(payload);
    showToast(`Redeemed ${name}`, 'success');
    await refreshArmoryPanel();
    current.onRedeemed?.();
  } catch (error) {
    showToast(error.message, 'error');
  }
}
