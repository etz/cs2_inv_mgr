const { decodeGcItemAttributes } = require('../utils/gcItemDecoder');

const STAT_TRAK_LABEL = 'StatTrak\u2122';
const STAR_PREFIX = '\u2605';

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
  'Machine Gun',
]);

const STORAGE_UNIT_DEF_INDEX = 1201;
const GENERIC_CHARM_NAMES = new Set(['Charm', 'Keychain']);

function createSchemaResolver(schema) {
  if (!schema) {
    throw new Error('CS2 schema data is required');
  }

  function formatItem(gcItem, options = {}) {
    const inventoryById = options.inventoryById ?? new Map();
    const assetDescriptionById = options.assetDescriptionById ?? new Map();
    const keychainDescriptionByName = options.keychainDescriptionByName ?? new Map();
    const stickerDescriptionByName = options.stickerDescriptionByName ?? new Map();
    const assetDescription = assetDescriptionById.get(String(gcItem.id)) ?? null;
    const decoded = decodeGcItemAttributes(gcItem);
    const definition = schema.definitionsByDefIndex[String(gcItem.def_index)] ?? null;
    const paintIndex = normaliseNumber(gcItem.paint_index);
    const variantKey = paintIndex != null ? `[${paintIndex}]${gcItem.def_index}` : null;
    const variant = variantKey ? schema.variantsByKey[variantKey] ?? null : null;
    const paint = paintIndex != null ? schema.paintsByIndex[String(paintIndex)] ?? null : null;
    const standaloneKeychain = decoded.standaloneKeychainId != null
      ? schema.keychainDefinitionsById[String(decoded.standaloneKeychainId)] ?? null
      : null;
    const qualityValue = normaliseNumberish(gcItem.quality ?? definition?.qualityValue);
    const quality = qualityValue != null ? schema.qualitiesByValue[String(qualityValue)] ?? null : null;
    const display = resolveDisplayMetadata({
      definition,
      variant,
      standaloneKeychain,
      assetDescription,
      keychainDescriptionByName,
    });
    const rarityValue = normaliseNumberish(gcItem.rarity ?? display.rarityValue ?? variant?.rarityValue ?? definition?.rarityValue);
    const rarity = rarityValue != null ? schema.raritiesByValue[String(rarityValue)] ?? null : null;
    const wear = resolveWearBand(schema, gcItem.paint_wear);
    const isSouvenir = quality?.localizedName === 'Souvenir';
    const trackedKills = gcItem.kill_eater_value ?? null;
    const isStattrak = trackedKills != null || quality?.localizedName === STAT_TRAK_LABEL;
    const localizedQuality = quality?.localizedName ?? definition?.localizedQuality ?? null;
    const category = display.category ?? definition?.category ?? null;
    const stickers = resolveStickers(schema, gcItem.stickers ?? [], stickerDescriptionByName);
    const keychains = resolveKeychains(schema, decoded.attachedKeychains, keychainDescriptionByName);
    const casketId = gcItem.casket_id ? String(gcItem.casket_id) : null;
    const casketName = casketId ? resolveCasketName(schema, inventoryById, casketId) : null;
    const fallbackRarityName = pickRarityName(rarity, category, variant?.rarityName ?? definition?.rarityName);
    const rarityName = display.rarityName
      ?? resolveDescriptionRarityName(assetDescription)
      ?? fallbackRarityName;
    const rarityColor = display.rarityColor
      ?? variant?.rarityColor
      ?? definition?.rarityColor
      ?? resolveDescriptionRarityColor(assetDescription)
      ?? rarity?.color
      ?? '#b0c3d9';
    const localizedName = display.localizedName
      ?? resolvePaintedLocalizedName(definition, variant, paint)
      ?? assetDescription?.localizedName
      ?? `Item #${gcItem.def_index}`;
    const marketHashName = display.marketHashName ?? assetDescription?.marketHashName ?? buildMarketHashName({
      localizedName,
      localizedQuality,
      isSouvenir,
      isStattrak,
      category,
      wearLabel: wear?.localizedName ?? null,
    });
    const itemUrl = display.itemUrl
      ?? variant?.itemUrl
      ?? assetDescription?.itemUrl
      ?? definition?.itemUrl
      ?? null;
    const definitionMetadata = buildDefinitionMetadata(definition);
    const quantityValue = normaliseNumberish(gcItem.quantity);
    const levelValue = normaliseNumberish(gcItem.level);
    const flagsValue = normaliseNumberish(gcItem.flags);
    const styleValue = normaliseNumberish(gcItem.style);
    const positionValue = normaliseNumberish(gcItem.position);
    const killEaterScoreTypeValue = normaliseNumberish(gcItem.kill_eater_score_type);
    const questIdValue = normaliseNumberish(gcItem.quest_id);

    return {
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
      escrowTime: decoded.escrowTime,
      isOnMarket: null,
      itemWearName: wear?.key ?? null,
      itemWearNameLocalized: wear?.localizedName ?? null,
      casketName,
      itemPhaseName: variant?.itemPhaseName ?? paint?.phaseName ?? null,
      isUnclaimedReward: null,
      isRental: decoded.isRental,
      casketContainsCount: gcItem.casket_contained_item_count ?? 0,
      quantity: quantityValue,
      level: levelValue,
      flags: flagsValue,
      inUse: gcItem.in_use ?? null,
      style: styleValue,
      customDescription: gcItem.custom_desc ?? null,
      inventoryPosition: positionValue,
      killEaterScoreType: killEaterScoreTypeValue,
      questId: questIdValue,
      hasKeychain: keychains.length > 0,
      keychainSeed: keychains[0]?.seed ?? decoded.standaloneKeychainSeed ?? null,
      itemDetails: {
        defIndex: gcItem.def_index,
        paintIndex,
        rarityValue,
        qualityValue,
        originValue: normaliseNumberish(gcItem.origin),
        originalId: gcItem.original_id ? String(gcItem.original_id) : null,
        equippedState: gcItem.equipped_state ?? [],
        standaloneKeychainId: decoded.standaloneKeychainId,
        standaloneKeychainName: standaloneKeychain?.localizedName ?? null,
        standaloneKeychainItemUrl: standaloneKeychain?.itemUrl
          ?? (standaloneKeychain?.localizedName
            ? keychainDescriptionByName.get(standaloneKeychain.localizedName)?.itemUrl ?? null
            : null)
          ?? assetDescription?.itemUrl
          ?? null,
        standaloneKeychainSeed: decoded.standaloneKeychainSeed,
        standaloneKeychainSourceAttribute: decoded.standaloneSourceAttribute,
        attachedKeychainCount: keychains.length,
        quantity: quantityValue,
        level: levelValue,
        flags: flagsValue,
        inUse: gcItem.in_use ?? null,
        style: styleValue,
        customDescription: gcItem.custom_desc ?? null,
        position: positionValue,
        killEaterScoreType: killEaterScoreTypeValue,
        questId: questIdValue,
        inventoryValue: normaliseNumberish(gcItem.inventory),
        interiorItemId: gcItem.interior_item?.id ? String(gcItem.interior_item.id) : null,
        definition: definitionMetadata,
      },
      rarityColor,
      localizedQuality,
      settings: null,
      item_name: display.item_name ?? definition?.item_name ?? null,
      qan: null,
      customName: gcItem.custom_name ?? null,
      paintSeed: normaliseNumberish(gcItem.paint_seed),
      paintWear: gcItem.paint_wear != null ? Number(gcItem.paint_wear.toFixed(8)) : null,
      trackedKills,
      stickers,
      keychains,
      highlightReelLink: keychains[0]?.highlightReel ?? decoded.standaloneHighlightReel ?? null,
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
      definitionMetadata,
    };
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

function resolveDisplayMetadata({
  definition,
  variant,
  standaloneKeychain,
  assetDescription,
  keychainDescriptionByName,
}) {
  if (standaloneKeychain && definition?.category === 'Charm') {
    const localizedName = buildStandaloneKeychainName(definition, standaloneKeychain);
    const fallbackKeychainDescription = keychainDescriptionByName.get(standaloneKeychain.localizedName) ?? null;
    return {
      localizedName,
      marketHashName: localizedName,
      itemUrl: standaloneKeychain.itemUrl
        ?? assetDescription?.itemUrl
        ?? fallbackKeychainDescription?.itemUrl
        ?? definition?.itemUrl
        ?? null,
      rarityValue: standaloneKeychain.rarityValue ?? definition?.rarityValue ?? null,
      rarityName: standaloneKeychain.rarityName
        ?? fallbackKeychainDescription?.rarityName
        ?? definition?.rarityName
        ?? null,
      rarityColor: standaloneKeychain.rarityColor
        ?? fallbackKeychainDescription?.rarityColor
        ?? definition?.rarityColor
        ?? null,
      category: definition.category,
      item_name: standaloneKeychain.item_name ?? definition?.item_name ?? null,
    };
  }

  if (definition?.category === 'Charm' && assetDescription?.marketHashName && isGenericCharmName(definition.localizedName)) {
    const localizedName = assetDescription.localizedName ?? assetDescription.marketName ?? assetDescription.marketHashName;
    return {
      localizedName,
      marketHashName: assetDescription.marketHashName ?? localizedName,
      itemUrl: assetDescription.itemUrl ?? definition?.itemUrl ?? null,
      rarityValue: variant?.rarityValue ?? definition?.rarityValue ?? null,
      rarityName: resolveDescriptionRarityName(assetDescription) ?? variant?.rarityName ?? definition?.rarityName ?? null,
      rarityColor: resolveDescriptionRarityColor(assetDescription) ?? variant?.rarityColor ?? definition?.rarityColor ?? null,
      category: definition.category,
      item_name: definition?.item_name ?? null,
    };
  }

  return {
    localizedName: variant?.localizedName ?? null,
    marketHashName: null,
    itemUrl: variant?.itemUrl ?? null,
    rarityValue: variant?.rarityValue ?? definition?.rarityValue ?? null,
    rarityName: variant?.rarityName ?? definition?.rarityName ?? null,
    rarityColor: variant?.rarityColor ?? definition?.rarityColor ?? null,
    category: definition?.category ?? null,
    item_name: definition?.item_name ?? null,
  };
}

function buildStandaloneKeychainName(definition, keychainDefinition) {
  return `Charm | ${keychainDefinition.localizedName}`;
}

function resolvePaintedLocalizedName(definition, variant, paint) {
  if (variant?.localizedName) {
    return variant.localizedName;
  }

  if (definition?.localizedName && paint?.localizedName) {
    return `${definition.localizedName} | ${paint.localizedName}`;
  }

  return definition?.localizedName ?? null;
}

function isGenericCharmName(name) {
  if (!name) {
    return false;
  }

  return GENERIC_CHARM_NAMES.has(String(name).trim());
}

function resolveDescriptionRarityName(assetDescription) {
  return findDescriptionTag(assetDescription, 'Rarity')?.name ?? null;
}

function resolveDescriptionRarityColor(assetDescription) {
  return findDescriptionTag(assetDescription, 'Rarity')?.color ?? null;
}

function findDescriptionTag(assetDescription, categoryName) {
  if (!assetDescription?.tags) {
    return null;
  }

  return assetDescription.tags.find((tag) => tag.category_name === categoryName) ?? null;
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
    prefixes.push(STAT_TRAK_LABEL);
  }
  if (hasStarPrefix(category)) {
    prefixes.push(STAR_PREFIX);
  }
  if (isSouvenir) {
    prefixes.push('Souvenir');
  } else if (!isStattrak && localizedQuality === STAR_PREFIX) {
    prefixes.push(STAR_PREFIX);
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

function resolveStickers(schema, stickers, stickerDescriptionByName = new Map()) {
  return stickers.map((sticker) => {
    const stickerId = String(sticker.sticker_id);
    const metadata = schema.stickerKitsById[stickerId] ?? null;
    const fallbackMetadata = metadata?.localizedName
      ? stickerDescriptionByName.get(metadata.localizedName) ?? null
      : null;

    return {
      slot: sticker.slot ?? null,
      stickerId: Number(sticker.sticker_id),
      wear: sticker.wear ?? 0,
      scale: sticker.scale ?? null,
      rotation: sticker.rotation ?? null,
      tintId: sticker.tint_id ?? null,
      offsetX: sticker.offset_x ?? null,
      offsetY: sticker.offset_y ?? null,
      localizedName: metadata?.localizedName ?? null,
      item_name: metadata?.item_name ?? null,
      itemUrl: metadata?.itemUrl ?? fallbackMetadata?.itemUrl ?? null,
      rarityName: metadata?.rarityName ?? fallbackMetadata?.rarityName ?? null,
      rarityColor: metadata?.rarityColor ?? fallbackMetadata?.rarityColor ?? null,
      tournamentEventId: metadata?.tournamentEventId ?? null,
      tournamentTeamId: metadata?.tournamentTeamId ?? null,
      tournamentPlayerId: metadata?.tournamentPlayerId ?? null,
      patchMaterial: metadata?.patchMaterial ?? null,
    };
  });
}

function resolveKeychains(schema, keychains, keychainDescriptionByName = new Map()) {
  return keychains.map((keychain) => {
    const metadata = schema.keychainDefinitionsById[String(keychain.keychainId)] ?? null;
    const fallbackMetadata = metadata?.localizedName
      ? keychainDescriptionByName.get(metadata.localizedName) ?? null
      : null;

    return {
      slot: keychain.slot ?? null,
      keychainId: keychain.keychainId ?? null,
      seed: keychain.seed ?? null,
      offsetX: keychain.offsetX ?? null,
      offsetY: keychain.offsetY ?? null,
      offsetZ: keychain.offsetZ ?? null,
      highlightReel: keychain.highlightReel ?? null,
      localizedName: metadata?.localizedName ?? null,
      item_name: metadata?.item_name ?? null,
      itemUrl: metadata?.itemUrl ?? fallbackMetadata?.itemUrl ?? null,
      rarityName: metadata?.rarityName ?? fallbackMetadata?.rarityName ?? null,
      rarityColor: metadata?.rarityColor ?? fallbackMetadata?.rarityColor ?? null,
      displaySeed: metadata?.displaySeed ?? null,
      keychainMaterial: metadata?.keychainMaterial ?? null,
      qualityValue: metadata?.qualityValue ?? null,
      localizedQuality: metadata?.localizedQuality ?? null,
      isCommodity: metadata?.isCommodity ?? null,
    };
  });
}

function buildDefinitionMetadata(definition) {
  if (!definition) {
    return null;
  }

  return {
    prefab: definition.prefab ?? null,
    itemType: definition.itemType ?? null,
    itemClass: definition.itemClass ?? null,
    itemDescription: definition.itemDescription ?? null,
    lootListName: definition.lootListName ?? null,
    supplyCrateSeries: definition.supplyCrateSeries ?? null,
    canOpenForRental: definition.canOpenForRental ?? null,
    volatileContainer: definition.volatileContainer ?? null,
    invContainerAndTools: definition.invContainerAndTools ?? null,
    toolType: definition.toolType ?? null,
    firstSaleDate: definition.firstSaleDate ?? null,
    imageInventoryVolatile: definition.image_inventory_volatile ?? null,
    modelPlayer: definition.modelPlayer ?? null,
    itemSetTag: definition.itemSetTag ?? null,
  };
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
