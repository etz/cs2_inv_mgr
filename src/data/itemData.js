const vdf = require('vdf-parser');

const ITEMS_GAME_URL = 'https://raw.githubusercontent.com/SteamDatabase/GameTracking-CS2/master/game/csgo/pak01_dir/scripts/items/items_game.txt';

let cache = null;
let pending = null;

async function loadItemData(options = {}) {
  const { force = false } = options;

  if (!force && cache) {
    return cache;
  }
  if (!force && pending) {
    return pending;
  }

  pending = (async () => {
    const response = await fetch(ITEMS_GAME_URL);
    if (!response.ok) {
      throw new Error(`Failed to fetch items_game.txt (${response.status})`);
    }

    const text = await response.text();
    const parsed = vdf.parse(text);
    const root = parsed.items_game ?? parsed;
    cache = extractItemData(root);
    return cache;
  })();

  try {
    return await pending;
  } finally {
    pending = null;
  }
}

async function getCollections(options = {}) {
  const data = await loadItemData(options);
  return data.collections;
}

async function getItemData(options = {}) {
  return loadItemData(options);
}

function extractItemData(root) {
  const rawDefs = flattenKeyedArray(root.items ?? root.item_definitions ?? {});
  const itemDefinitions = new Map();
  const itemDefinitionsByName = new Map();

  for (const [key, value] of Object.entries(rawDefs)) {
    const defIndex = Number(key);
    if (!Number.isFinite(defIndex) || !value || typeof value !== 'object') {
      continue;
    }

    const item = {
      def_index: defIndex,
      name: value.item_name || value.name || `Def ${defIndex}`,
      internal_name: value.name || null,
      image_inventory: value.image_inventory || null,
      image_url: buildImageUrl(value.image_inventory || null),
      prefab: value.prefab || null,
      rarity: value.item_rarity || value.rarity || null,
    };

    itemDefinitions.set(defIndex, item);
    if (item.internal_name) {
      itemDefinitionsByName.set(item.internal_name, item);
    }
  }

  const itemSetsRaw = flattenKeyedArray(root.item_sets ?? {});
  const collections = [];

  for (const [setId, setData] of Object.entries(itemSetsRaw)) {
    if (!setData || typeof setData !== 'object') {
      continue;
    }

    const entries = extractCollectionEntries(setData.items ?? {});
    const items = entries
      .map((entry) => itemDefinitionsByName.get(entry) || null)
      .filter(Boolean)
      .map((item) => ({ ...item }));

    collections.push({
      id: setId,
      name: setData.name || setId,
      itemCount: items.length,
      items,
    });
  }

  const lootListsRaw = flattenKeyedArray(root.loot_lists ?? {});
  const normalizedLootLists = Object.fromEntries(
    Object.entries(lootListsRaw).map(([name, list]) => [name, extractCollectionEntries(list)])
  );

  const clientLootLists = flattenKeyedArray(root.client_loot_lists ?? {});
  const currentArmorySeason = getCurrentArmorySeason(root.seasonaloperations ?? {});
  const currentArmoryRotation = buildArmoryRotation(
    currentArmorySeason,
    itemDefinitionsByName,
    clientLootLists
  );

  return {
    fetchedAt: new Date().toISOString(),
    itemDefinitions,
    itemDefinitionsList: [...itemDefinitions.values()],
    itemDefinitionsByName,
    collections,
    lootLists: normalizedLootLists,
    currentArmorySeason,
    currentArmoryRotation,
  };
}

function flattenKeyedArray(value) {
  if (Array.isArray(value)) {
    const merged = {};
    for (const entry of value) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        continue;
      }
      Object.assign(merged, entry);
    }
    return merged;
  }
  return value && typeof value === 'object' ? value : {};
}

function extractCollectionEntries(itemsSection) {
  const normalized = flattenKeyedArray(itemsSection);
  if (!normalized || typeof normalized !== 'object') {
    return [];
  }

  const entries = [];
  for (const [key, value] of Object.entries(normalized)) {
    if (typeof value === 'string' && value.startsWith('weapon_')) {
      entries.push(value);
      continue;
    }

    if (typeof key === 'string' && key.startsWith('weapon_')) {
      entries.push(key);
      continue;
    }

    if (typeof value === 'string' && value.startsWith('[') && value.endsWith(']')) {
      entries.push(value.slice(1, -1));
    }
  }

  return [...new Set(entries)];
}

function getCurrentArmorySeason(seasonalOperations) {
  const normalized = flattenKeyedArray(seasonalOperations);
  let selected = null;

  for (const [seasonId, seasonData] of Object.entries(normalized)) {
    if (!seasonData || typeof seasonData !== 'object') {
      continue;
    }

    if (String(seasonData.redeemable_goods || '').toLowerCase() !== 'xpshop') {
      continue;
    }

    if (!selected || Number(seasonId) > Number(selected.id)) {
      selected = { id: seasonId, ...seasonData };
    }
  }

  return selected;
}

function buildArmoryRotation(seasonData, itemDefinitionsByName, clientLootLists) {
  if (!seasonData || typeof seasonData !== 'object') {
    return [];
  }

  const redeemables = asArray(seasonData.operational_point_redeemable)
    .filter((entry) => entry && typeof entry === 'object');

  const mapped = redeemables.map((entry, index) => {
    const points = Number(entry.points ?? 0) || 0;
    const itemName = String(entry.item_name ?? '');
    const callout = String(entry.callout ?? '');
    const uiOrder = Number(entry.ui_order ?? 9999) || 9999;
    const thumbnailPath = String(entry.ui_image_thumbnail ?? '');
    const setImage = String(entry.ui_set_image ?? '');

    const itemRefName = itemName.startsWith('lootlist:')
      ? itemName.slice('lootlist:'.length)
      : itemName;
    const itemDef = itemDefinitionsByName.get(itemRefName) ?? null;

    return {
      id: `${itemName || 'entry'}:${index}`,
      index,
      uiOrder,
      points,
      itemName,
      collectionLabel: buildCollectionLabel({ callout, itemName, setImage }),
      previewImage: resolvePreviewImage({
        itemName,
        setImage,
        thumbnailPath,
        itemDef,
        itemDefinitionsByName,
        clientLootLists,
      }),
      callout,
      setImage,
      thumbnailPath,
      flags: Number(entry.flags ?? 0) || 0,
      limitedUntil: Number(entry.limited_until ?? 0) || null,
      uiShowNewTag: Number(entry.ui_show_new_tag ?? 0) || null,
    };
  });

  return mapped.sort((a, b) => {
    if (a.uiOrder !== b.uiOrder) {
      return a.uiOrder - b.uiOrder;
    }
    return a.index - b.index;
  });
}

function prettifyLabel(callout, itemName) {
  const source = callout || itemName || 'Armory Reward';

  const trimmed = source
    .replace(/^#CSGO_/i, '')
    .replace(/^lootlist:/i, '')
    .replace(/_short$/i, '')
    .replace(/_/g, ' ')
    .trim();

  if (!trimmed) {
    return 'Armory Reward';
  }

  return trimmed
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function buildCollectionLabel({ callout, itemName, setImage }) {
  const lootListName = itemName.startsWith('lootlist:')
    ? itemName.slice('lootlist:'.length)
    : null;
  const collectionId = setImage || lootListName;

  if (collectionId && collectionId.startsWith('set_') && !collectionId.startsWith('set_kc_')) {
    return `The ${humanizeCollectionId(collectionId.slice(4))} Collection`;
  }

  return prettifyLabel(callout, itemName);
}

function humanizeCollectionId(value) {
  return String(value)
    .replace(/_/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function asArray(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (value == null) {
    return [];
  }
  return [value];
}

function buildImageUrl(imageInventory) {
  if (!imageInventory) {
    return null;
  }

  const trimmed = String(imageInventory).replace(/^\/+/, '');
  if (!trimmed) {
    return null;
  }

  return `https://media.steampowered.com/apps/csgo/icons/${trimmed}.png`;
}

function buildThumbnailUrl(path) {
  const trimmed = String(path || '').replace(/^\/+/, '');
  if (!trimmed) {
    return null;
  }

  return `https://community.cloudflare.steamstatic.com/economy/image/${trimmed}`;
}

function buildSetImageUrl(setImage) {
  const trimmed = String(setImage || '').replace(/^\/+/, '');
  if (!trimmed) {
    return null;
  }

  return `https://community.cloudflare.steamstatic.com/economy/image/set_icons/${trimmed}`;
}

function resolvePreviewImage({
  itemName,
  setImage,
  thumbnailPath,
  itemDef,
  itemDefinitionsByName,
  clientLootLists,
}) {
  if (itemName.startsWith('lootlist:set_')) {
    const setId = itemName.slice('lootlist:'.length);
    const promo = buildImageUrl(`econ/tools/${setId}_storepromo_key`);
    if (promo) {
      return promo;
    }
  }

  if (itemName.startsWith('lootlist:') && itemName.endsWith('_lootlist')) {
    const base = itemName.slice('lootlist:'.length, -'_lootlist'.length);
    const crateDef = itemDefinitionsByName.get(`crate_${base}`);
    if (crateDef?.image_url) {
      return crateDef.image_url;
    }
  }

  if (setImage) {
    const promoDef = itemDefinitionsByName.get(`${setImage}_storepromo_key`);
    if (promoDef?.image_url) {
      return promoDef.image_url;
    }
  }

  if (itemDef?.image_url) {
    return itemDef.image_url;
  }

  if (itemName.startsWith('lootlist:')) {
    const lootListName = itemName.slice('lootlist:'.length);
    const lootList = clientLootLists?.[lootListName];
    if (lootList && typeof lootList === 'object') {
      for (const key of Object.keys(lootList)) {
        const nested = itemDefinitionsByName.get(key);
        if (nested?.image_url) {
          return nested.image_url;
        }
      }
    }
  }

  return buildThumbnailUrl(thumbnailPath) || buildSetImageUrl(setImage) || null;
}

module.exports = {
  ITEMS_GAME_URL,
  getCollections,
  getItemData,
  loadItemData,
};
