const path = require('path');

const TRADE_UP_RARITIES = new Set([
  'Consumer Grade',
  'Industrial Grade',
  'Mil-Spec Grade',
  'Restricted',
  'Classified',
]);

const TRADE_UP_CATEGORIES = new Set([
  'Pistol',
  'Rifle',
  'SMG',
  'Shotgun',
  'Sniper Rifle',
  'Machinegun',
  'Submachine Gun',
]);

const STORAGE_UNIT_DEF_INDEX = 1201;

function createSchemaResolver(schema) {
  if (!schema) {
    throw new Error('CS2 schema data is required');
  }

  function formatItem(gcItem, options = {}) {
    const inventoryById = options.inventoryById ?? new Map();
    const definition = schema.definitionsByDefIndex[String(gcItem.def_index)] ?? null;
    const paintIndex = normaliseNumber(gcItem.paint_index);
    const variantKey = paintIndex != null ? `[${paintIndex}]${gcItem.def_index}` : null;
    const variant = variantKey ? schema.variantsByKey[variantKey] ?? null : null;
    const paint = paintIndex != null ? schema.paintsByIndex[String(paintIndex)] ?? null : null;
    const qualityValue = normaliseNumberish(gcItem.quality ?? definition?.qualityValue);
    const quality = qualityValue != null ? schema.qualitiesByValue[String(qualityValue)] ?? null : null;
    const rarityValue = normaliseNumberish(gcItem.rarity ?? variant?.rarityValue ?? definition?.rarityValue);
    const rarity = rarityValue != null ? schema.raritiesByValue[String(rarityValue)] ?? null : null;
    const wear = resolveWearBand(schema, gcItem.paint_wear);
    const isSouvenir = quality?.localizedName === 'Souvenir';
    const trackedKills = gcItem.kill_eater_value ?? null;
    const isStattrak = trackedKills != null || quality?.localizedName === 'StatTrak™';
    const itemUrl = variant?.itemUrl ?? definition?.itemUrl ?? null;
    const localizedName = variant?.localizedName ?? definition?.localizedName ?? `Item #${gcItem.def_index}`;
    const itemPhaseName = variant?.itemPhaseName ?? paint?.phaseName ?? null;
    const category = definition?.category ?? null;
    const stickers = resolveStickers(schema, gcItem.stickers ?? []);
    const casketId = gcItem.casket_id ? String(gcItem.casket_id) : null;
    const casketName = casketId ? resolveCasketName(schema, inventoryById, casketId) : null;
    const localizedQuality = quality?.localizedName ?? definition?.localizedQuality ?? null;
    const marketHashName = buildMarketHashName({
      localizedName,
      localizedQuality,
      isSouvenir,
      isStattrak,
      category,
      wearLabel: wear?.localizedName ?? null,
    });
    const rarityName = pickRarityName(rarity, category, variant?.rarityName ?? definition?.rarityName);
    const rarityColor = variant?.rarityColor ?? definition?.rarityColor ?? rarity?.color ?? '#b0c3d9';
    const item = {
      id: String(gcItem.id),
      marketHashName,
      localizedName,
      itemUrl,
      isTradeUp: isTradeUpEligible(category, rarityName, variant, isSouvenir),
      isStattrak,
      isMoveable: gcItem.def_index !== STORAGE_UNIT_DEF_INDEX,
      rarityName,
      isEquippedCT: isEquipped(gcItem.equipped_state, 3),
      stickerId: stickers[0]?.stickerId ?? null,
      isEquippedT: isEquipped(gcItem.equipped_state, 2),
      hasStickers: stickers.length > 0,
      category,
      casketId,
      unlockTime: gcItem.tradable_after instanceof Date ? gcItem.tradable_after.toISOString() : null,
      escrowTime: null,
      isOnMarket: null,
      itemWearName: wear?.key ?? null,
      itemWearNameLocalized: wear?.localizedName ?? null,
      casketName,
      itemPhaseName,
      isUnclaimedReward: null,
      isRental: null,
      casketContainsCount: gcItem.casket_contained_item_count ?? 0,
      hasKeychain: null,
      keychainSeed: null,
      itemDetails: {
        defIndex: gcItem.def_index,
        paintIndex,
        rarityValue,
        qualityValue,
        originValue: normaliseNumberish(gcItem.origin),
        originalId: gcItem.original_id ? String(gcItem.original_id) : null,
        equippedState: gcItem.equipped_state ?? [],
      },
      rarityColor,
      localizedQuality,
      settings: null,
      item_name: definition?.item_name ?? null,
      qan: null,
      customName: gcItem.custom_name ?? null,
      paintSeed: normaliseNumberish(gcItem.paint_seed),
      paintWear: gcItem.paint_wear != null ? Number(gcItem.paint_wear.toFixed(8)) : null,
      trackedKills,
      stickers,
      highlightReelLink: null,
      isSouvenir,
      name: marketHashName,
      imageUrl: itemUrl,
      rarity: rarityName,
      type: category,
      weapon: category,
      exterior: wear?.localizedName ?? null,
      statTrak: trackedKills,
      tradable: null,
      inCasket: casketId,
      casketItemCount: gcItem.casket_contained_item_count ?? 0,
      isStorageUnit: gcItem.def_index === STORAGE_UNIT_DEF_INDEX,
    };

    return item;
  }

  function formatStorageUnit(gcItem, options = {}) {
    const base = formatItem(gcItem, options);

    return {
      ...base,
      localizedName: gcItem.custom_name || base.localizedName || 'Storage Unit',
      marketHashName: gcItem.custom_name || base.marketHashName || 'Storage Unit',
      name: gcItem.custom_name || base.marketHashName || 'Storage Unit',
      casketName: gcItem.custom_name || base.localizedName || 'Storage Unit',
      itemCount: gcItem.casket_contained_item_count ?? 0,
      maxItems: 1000,
    };
  }

  return {
    formatItem,
    formatStorageUnit,
    STORAGE_UNIT_DEF_INDEX,
  };
}

function resolveWearBand(schema, paintWear) {
  if (paintWear == null) {
    return null;
  }

  const wearValue = Number(paintWear);
  return schema.wearBands.find((band) => wearValue >= band.min && wearValue < band.max) ?? schema.wearBands.at(-1);
}

function buildMarketHashName({ localizedName, localizedQuality, isSouvenir, isStattrak, category, wearLabel }) {
  const prefixes = [];

  if (isStattrak) {
    prefixes.push('StatTrak™');
  }
  if (hasStarPrefix(category)) {
    prefixes.push('★');
  }
  if (isSouvenir) {
    prefixes.push('Souvenir');
  } else if (!isStattrak && localizedQuality === '★') {
    prefixes.push('★');
  }

  const prefix = prefixes.length ? `${prefixes.join(' ')} ` : '';
  const suffix = wearLabel ? ` (${wearLabel})` : '';
  return `${prefix}${localizedName}${suffix}`.trim();
}

function hasStarPrefix(category) {
  return category === 'Knife' || category === 'Gloves';
}

function pickRarityName(rarity, category, fallback) {
  if (fallback) {
    return fallback;
  }

  if (!rarity) {
    return null;
  }

  if (category === 'Knife' || category === 'Gloves' || category === 'Agent') {
    return rarity.weaponName ?? rarity.nonweaponName ?? null;
  }

  return rarity.weaponName ?? rarity.nonweaponName ?? null;
}

function isTradeUpEligible(category, rarityName, variant, isSouvenir) {
  return Boolean(
    variant
    && !isSouvenir
    && TRADE_UP_CATEGORIES.has(category)
    && TRADE_UP_RARITIES.has(rarityName)
  );
}

function isEquipped(equippedState, expectedClass) {
  return (equippedState ?? []).some((entry) => Number(entry.new_class) === expectedClass);
}

function resolveStickers(schema, stickers) {
  return stickers.map((sticker) => {
    const stickerId = String(sticker.sticker_id);
    const metadata = schema.stickerKitsById[stickerId] ?? null;

    return {
      slot: sticker.slot ?? null,
      stickerId: Number(sticker.sticker_id),
      wear: sticker.wear ?? 0,
      scale: sticker.scale ?? null,
      rotation: sticker.rotation ?? null,
      offsetX: sticker.offset_x ?? null,
      offsetY: sticker.offset_y ?? null,
      localizedName: metadata?.localizedName ?? null,
      item_name: metadata?.item_name ?? null,
      itemUrl: metadata?.itemUrl ?? null,
    };
  });
}

function resolveCasketName(schema, inventoryById, casketId) {
  const casket = inventoryById.get(String(casketId));
  if (!casket) {
    return null;
  }

  const definition = schema.definitionsByDefIndex[String(casket.def_index)] ?? null;
  return casket.custom_name ?? definition?.localizedName ?? 'Storage Unit';
}

function normaliseNumberish(value) {
  if (value == null) {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normaliseNumber(value) {
  if (value == null) {
    return null;
  }

  const number = Number(value);
  if (!Number.isFinite(number)) {
    return null;
  }

  return Math.round(number);
}

module.exports = {
  STORAGE_UNIT_DEF_INDEX,
  createSchemaResolver,
};
