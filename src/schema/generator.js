const path = require('path');
const VDF = require('vdf-parser');

const PHASE_NAMES = {
  '1': 'Phase 1',
  '2': 'Phase 2',
  '3': 'Phase 3',
  '4': 'Phase 4',
  '5': 'Ruby',
  '6': 'Sapphire',
  '7': 'Black Pearl',
  '8': 'Emerald',
};

const PHASE_MAPPING = {
  '415': '5',
  '416': '6',
  '417': '7',
  '418': '1',
  '419': '2',
  '420': '3',
  '421': '4',
  '568': '8',
  '569': '1',
  '570': '2',
  '571': '3',
  '572': '4',
  '617': '7',
  '618': '2',
  '619': '6',
  '852': '1',
  '853': '2',
  '854': '3',
  '855': '4',
  '1119': '8',
  '1120': '1',
  '1121': '2',
  '1122': '3',
  '1123': '4',
};

const WEAR_BANDS = [
  { key: 'factory_new', localizedName: 'Factory New', min: 0, max: 0.07 },
  { key: 'minimal_wear', localizedName: 'Minimal Wear', min: 0.07, max: 0.15 },
  { key: 'field_tested', localizedName: 'Field-Tested', min: 0.15, max: 0.38 },
  { key: 'well_worn', localizedName: 'Well-Worn', min: 0.38, max: 0.45 },
  { key: 'battle_scarred', localizedName: 'Battle-Scarred', min: 0.45, max: 1.01 },
];

function parseVdf(text) {
  return VDF.parse(text, { types: false, arrayify: false });
}

function parseCdn(text) {
  const entries = {};

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex);
    const url = trimmed.slice(separatorIndex + 1);
    entries[key] = normaliseUrl(url);
  }

  return entries;
}

function normaliseUrl(url) {
  if (!url) {
    return null;
  }

  return url.replace(/^http:\/\//i, 'https://');
}

function resolveToken(tokens, rawValue) {
  if (!rawValue) {
    return null;
  }

  const key = rawValue.startsWith('#') ? rawValue.slice(1) : rawValue;
  if (tokens[key]) {
    return tokens[key];
  }

  return rawValue.startsWith('#') ? null : rawValue;
}

function deepMerge(base, override) {
  const merged = { ...base };

  for (const [key, value] of Object.entries(override ?? {})) {
    const current = merged[key];
    if (isPlainObject(current) && isPlainObject(value)) {
      merged[key] = deepMerge(current, value);
    } else {
      merged[key] = value;
    }
  }

  return merged;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function splitPrefabKeys(prefab) {
  if (!prefab) {
    return [];
  }

  const keys = String(prefab)
    .split(/\s+/)
    .map((value) => value.trim())
    .filter(Boolean);
  if (!keys.length) {
    return [];
  }

  if (keys[0] === 'valve') {
    return keys.slice(1);
  }

  return keys;
}

function resolvePrefabDefinition(prefabs, prefabKey, cache, seen = new Set()) {
  if (!prefabKey || seen.has(prefabKey)) {
    return {};
  }

  if (cache.has(prefabKey)) {
    return cache.get(prefabKey);
  }

  const prefab = prefabs[prefabKey];
  if (!prefab) {
    return {};
  }

  seen.add(prefabKey);
  let merged = {};
  for (const parentKey of splitPrefabKeys(prefab.prefab)) {
    merged = deepMerge(merged, resolvePrefabDefinition(prefabs, parentKey, cache, seen));
  }

  merged = deepMerge(merged, prefab);
  cache.set(prefabKey, merged);
  return merged;
}

function resolvePrefabChain(prefabs, itemData, cache) {
  let merged = {};
  for (const prefabKey of splitPrefabKeys(itemData?.prefab)) {
    merged = deepMerge(merged, resolvePrefabDefinition(prefabs, prefabKey, cache));
  }

  return deepMerge(merged, itemData ?? {});
}

function findTopLevelValue(prefabs, itemData, attributeName, cache) {
  const resolved = resolvePrefabChain(prefabs, itemData, cache);
  return resolved?.[attributeName] ?? null;
}

function toIntegerOrNull(value) {
  if (value == null) {
    return null;
  }

  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function toBooleanOrNull(value) {
  if (value == null) {
    return null;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  const normalized = String(value).trim().toLowerCase();
  if (normalized === '1' || normalized === 'true') {
    return true;
  }
  if (normalized === '0' || normalized === 'false') {
    return false;
  }

  return null;
}

function cloneSerializable(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => cloneSerializable(entry));
  }

  if (isPlainObject(value)) {
    const cloned = {};
    for (const [key, entry] of Object.entries(value)) {
      cloned[key] = cloneSerializable(entry);
    }
    return cloned;
  }

  return value;
}

function readDefinitionAttributeValue(attributes, key) {
  const value = attributes?.[key];
  if (value == null) {
    return null;
  }

  if (isPlainObject(value)) {
    return value.value ?? null;
  }

  return value;
}

function normalizeDefinitionAttributes(attributes) {
  if (!isPlainObject(attributes)) {
    return null;
  }

  const normalized = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (isPlainObject(value)) {
      normalized[key] = {
        attributeClass: value.attribute_class ?? null,
        value: value.value ?? null,
      };
      continue;
    }

    normalized[key] = {
      attributeClass: null,
      value: value ?? null,
    };
  }

  return normalized;
}

function resolveCategory(tokens, merged, categoryToken) {
  const resolvedCategory = resolveToken(tokens, categoryToken)
    ?? resolveToken(tokens, merged.item_type_name)
    ?? merged.visuals?.weapon_type
    ?? null;

  if (resolvedCategory) {
    return resolvedCategory;
  }

  if (String(merged.inv_container_and_tools ?? '').toLowerCase() === 'tool') {
    return 'Tool';
  }

  return null;
}

function buildQualities(itemsGame, tokens) {
  const byValue = {};
  const byKey = {};

  for (const [qualityKey, qualityData] of Object.entries(itemsGame.qualities ?? {})) {
    const value = String(qualityData.value);
    const localizedName = tokens[qualityKey] ?? titleCase(qualityKey);
    const entry = {
      key: qualityKey,
      value,
      localizedName,
    };

    byValue[value] = entry;
    byKey[qualityKey] = entry;
  }

  return { byValue, byKey };
}

function buildRarities(itemsGame, tokens) {
  const byValue = {};
  const byKey = {};

  for (const [rarityKey, rarityData] of Object.entries(itemsGame.rarities ?? {})) {
    const value = String(rarityData.value);
    const colorKey = rarityData.color;
    const rawColor = itemsGame.colors?.[colorKey]?.hex_color ?? null;
    const color = rawColor
      ? (rawColor.startsWith('#') ? rawColor : `#${rawColor}`)
      : null;
    const weaponName = resolveToken(tokens, rarityData.loc_key_weapon);
    const nonweaponName = resolveToken(tokens, rarityData.loc_key);
    const entry = {
      key: rarityKey,
      value,
      weaponName,
      nonweaponName,
      color,
    };

    byValue[value] = entry;
    byKey[rarityKey] = entry;
  }

  return { byValue, byKey };
}

function buildPaints(itemsGame, tokens, raritiesByKey) {
  const paints = {};

  for (const [paintIndex, paintData] of Object.entries(itemsGame.paint_kits ?? {})) {
    if (paintIndex === '0') {
      continue;
    }

    const rarity = raritiesByKey[itemsGame.paint_kits_rarity?.[paintData.name] ?? ''] ?? null;
    const phaseId = PHASE_MAPPING[paintIndex] ?? null;

    paints[paintIndex] = {
      paintIndex,
      item_name: paintData.name,
      localizedName: resolveToken(tokens, paintData.description_tag)
        ?? resolveToken(tokens, paintData.description_string)
        ?? titleCase(paintData.name),
      wearMin: Number.parseFloat(paintData.wear_remap_min ?? '0.06'),
      wearMax: Number.parseFloat(paintData.wear_remap_max ?? '0.80'),
      rarityValue: rarity?.value ?? null,
      rarityName: rarity?.weaponName ?? null,
      rarityColor: rarity?.color ?? null,
      phaseName: phaseId ? PHASE_NAMES[phaseId] : null,
    };
  }

  return paints;
}

function buildStickerKits(itemsGame, tokens, cdnMap, raritiesByKey, imagePathIndex) {
  const stickerKits = {};

  for (const [stickerId, stickerData] of Object.entries(itemsGame.sticker_kits ?? {})) {
    const imageInventory = stickerData.image_inventory ?? null;
    const stickerMaterial = stickerData.sticker_material ?? null;
    const rarity = raritiesByKey[stickerData.item_rarity ?? ''] ?? null;
    if (imageInventory) {
      imagePathIndex[imageInventory] = imageInventory;
    }

    stickerKits[stickerId] = {
      stickerId,
      item_name: stickerData.name,
      localizedName: resolveToken(tokens, stickerData.item_name)
        ?? resolveToken(tokens, stickerData.description_string)
        ?? titleCase(stickerData.name),
      rarityValue: rarity?.value ?? null,
      rarityName: rarity?.weaponName ?? rarity?.nonweaponName ?? null,
      rarityColor: rarity?.color ?? null,
      stickerMaterial,
      patchMaterial: stickerData.patch_material ?? null,
      tournamentEventId: toIntegerOrNull(stickerData.tournament_event_id),
      tournamentTeamId: toIntegerOrNull(stickerData.tournament_team_id),
      tournamentPlayerId: toIntegerOrNull(stickerData.tournament_player_id),
      itemUrl: resolveItemUrl(cdnMap, {
        name: stickerData.name,
        image_inventory: stickerData.image_inventory,
      }, imagePathIndex),
    };
  }

  return stickerKits;
}

function buildDefinitions(itemsGame, tokens, cdnMap, qualitiesByKey, raritiesByKey, imagePathIndex) {
  const definitions = {};
  const renderKeysByDefIndex = {};
  const prefabCache = new Map();
  const prefabs = itemsGame.prefabs ?? {};

  for (const [defIndex, itemData] of Object.entries(itemsGame.items ?? {})) {
    const merged = resolvePrefabChain(prefabs, itemData, prefabCache);
    const categoryToken = findTopLevelValue(prefabs, itemData, 'item_type_name', prefabCache);
    const quality = qualitiesByKey[merged.item_quality ?? itemData.item_quality ?? ''] ?? null;
    const rarity = raritiesByKey[merged.item_rarity ?? itemData.item_rarity ?? ''] ?? null;
    const renderKeys = buildRenderKeys(itemData, merged);

    if (merged.image_inventory) {
      imagePathIndex[merged.image_inventory] = merged.image_inventory;
    }

    definitions[defIndex] = {
      defIndex,
      item_name: itemData.name,
      localizedName: resolveToken(tokens, merged.item_name) ?? titleCase(itemData.name),
      category: resolveCategory(tokens, merged, categoryToken),
      qualityValue: quality?.value ?? null,
      localizedQuality: quality?.localizedName ?? null,
      rarityValue: rarity?.value ?? null,
      rarityName: rarity?.weaponName ?? rarity?.nonweaponName ?? null,
      rarityColor: rarity?.color ?? null,
      itemUrl: resolveItemUrl(cdnMap, merged, imagePathIndex),
      itemDescription: resolveToken(tokens, merged.item_description) ?? null,
      itemType: merged.item_type ?? null,
      itemClass: merged.item_class ?? null,
      prefab: merged.prefab ?? null,
      paintable: Boolean(merged.paint_data),
      image_inventory: merged.image_inventory ?? null,
      image_inventory_volatile: merged['image_inventory^volatile'] ?? null,
      modelPlayer: merged.model_player ?? null,
      invContainerAndTools: merged.inv_container_and_tools ?? null,
      firstSaleDate: merged.first_sale_date ?? null,
      lootListName: merged.loot_list_name ?? null,
      toolType: merged.tool?.type ?? null,
      toolData: cloneSerializable(merged.tool ?? null),
      capabilities: cloneSerializable(merged.capabilities ?? null),
      associatedItems: cloneSerializable(merged.associated_items ?? null),
      itemTags: cloneSerializable(merged.tags ?? null),
      itemSetTag: merged.tags?.ItemSet?.tag_value ?? null,
      supplyCrateSeries: toIntegerOrNull(readDefinitionAttributeValue(merged.attributes, 'set supply crate series')),
      canOpenForRental: toBooleanOrNull(readDefinitionAttributeValue(merged.attributes, 'can open for rental')),
      volatileContainer: toBooleanOrNull(readDefinitionAttributeValue(merged.attributes, 'volatile container')),
      definitionAttributes: normalizeDefinitionAttributes(merged.attributes),
      renderKeys,
    };

    renderKeysByDefIndex[defIndex] = renderKeys;
  }

  return {
    definitions,
    renderKeysByDefIndex,
  };
}

function buildRenderKeys(itemData, merged) {
  const keys = new Set();
  const imageInventory = merged.image_inventory ?? itemData.image_inventory ?? null;
  const paintMaterial = merged.paint_data?.PaintableMaterial0?.Name
    ?? merged.paint_data?.paintablematerial0?.Name
    ?? null;

  for (const candidate of [
    paintMaterial,
    itemData.name,
    merged.name,
    imageInventory,
    imageInventory ? path.posix.basename(imageInventory) : null,
    merged.item_class,
  ]) {
    if (candidate) {
      keys.add(candidate);
    }
  }

  return [...keys];
}

function resolveItemUrl(cdnMap, itemData, imagePathIndex = {}) {
  const candidates = [];
  const imageInventory = itemData?.image_inventory ?? null;

  if (imageInventory) {
    candidates.push(imageInventory);
    candidates.push(path.posix.basename(imageInventory));
  }

  if (itemData?.name) {
    candidates.push(itemData.name);
  }

  if (itemData?.item_class) {
    candidates.push(itemData.item_class);
  }

  for (const candidate of candidates) {
    if (candidate && cdnMap[candidate]) {
      return cdnMap[candidate];
    }
  }

  return null;
}

function buildVariants(definitions, renderKeysByDefIndex, paints, cdnMap) {
  const variants = {};

  for (const definition of Object.values(definitions)) {
    const renderKeys = renderKeysByDefIndex[definition.defIndex] ?? definition.renderKeys ?? [];
    if (!renderKeys.length) {
      continue;
    }

    for (const paint of Object.values(paints)) {
      let itemUrl = null;

      for (const renderKey of renderKeys) {
        const candidate = `${renderKey}_${paint.item_name}`;
        if (cdnMap[candidate]) {
          itemUrl = cdnMap[candidate];
          break;
        }
      }

      if (!itemUrl) {
        continue;
      }

      variants[`[${paint.paintIndex}]${definition.defIndex}`] = {
        defIndex: definition.defIndex,
        paintIndex: paint.paintIndex,
        localizedName: `${definition.localizedName} | ${paint.localizedName}`,
        itemUrl,
        rarityValue: paint.rarityValue ?? definition.rarityValue ?? null,
        rarityName: paint.rarityName ?? definition.rarityName ?? null,
        rarityColor: paint.rarityColor ?? definition.rarityColor ?? null,
        itemPhaseName: paint.phaseName ?? null,
      };
    }
  }

  return variants;
}

function buildKeychainDefinitions(itemsGame, tokens, qualitiesByKey, raritiesByKey, cdnMap, imagePathIndex) {
  const keychainDefinitions = {};

  for (const [keychainId, keychainData] of Object.entries(itemsGame.keychain_definitions ?? {})) {
    const imageInventory = keychainData.image_inventory ?? null;
    const quality = qualitiesByKey[keychainData.item_quality ?? ''] ?? null;
    const rarity = raritiesByKey[keychainData.item_rarity ?? ''] ?? null;
    if (imageInventory) {
      imagePathIndex[imageInventory] = imageInventory;
    }

    keychainDefinitions[keychainId] = {
      keychainId,
      item_name: keychainData.name,
      localizedName: resolveToken(tokens, keychainData.loc_name)
        ?? resolveToken(tokens, keychainData.item_name)
        ?? titleCase(keychainData.name),
      localizedDescription: resolveToken(tokens, keychainData.loc_description) ?? null,
      qualityValue: quality?.value ?? null,
      localizedQuality: quality?.localizedName ?? null,
      rarityValue: rarity?.value ?? null,
      rarityName: rarity?.weaponName ?? rarity?.nonweaponName ?? null,
      rarityColor: rarity?.color ?? null,
      image_inventory: imageInventory,
      displaySeed: toIntegerOrNull(keychainData.display_seed),
      keychainMaterial: keychainData.keychain_material ?? null,
      isCommodity: toBooleanOrNull(keychainData['is commodity']),
      itemTags: cloneSerializable(keychainData.tags ?? null),
      itemUrl: resolveItemUrl(cdnMap, {
        name: keychainData.name,
        image_inventory: keychainData.image_inventory,
      }, imagePathIndex),
      pedestalModel: keychainData.pedestal_display_model ?? null,
    };
  }

  return keychainDefinitions;
}

function buildAttributeDefinitions(itemsGame, tokens) {
  const attributeDefs = {};

  for (const [attributeId, attributeData] of Object.entries(itemsGame.attributes ?? {})) {
    attributeDefs[attributeId] = {
      attributeId,
      name: attributeData.name ?? null,
      attributeClass: attributeData.attribute_class ?? null,
      descriptionString: attributeData.description_string ?? null,
      localizedDescription: resolveToken(tokens, attributeData.description_string) ?? null,
      storedAsInteger: attributeData['stored_as_integer'] === '1',
      hidden: attributeData.hidden === '1',
    };
  }

  return attributeDefs;
}

function buildSchema({ itemsGameText, csgoEnglishText, itemsCdnText }) {
  const itemsGame = parseVdf(itemsGameText).items_game;
  const csgoEnglish = parseVdf(csgoEnglishText).lang;
  const tokens = csgoEnglish.Tokens ?? {};
  const cdnMap = parseCdn(itemsCdnText);
  const imagePathIndex = {};
  const qualities = buildQualities(itemsGame, tokens);
  const rarities = buildRarities(itemsGame, tokens);
  const paints = buildPaints(itemsGame, tokens, rarities.byKey);
  const attributeDefs = buildAttributeDefinitions(itemsGame, tokens);
  const {
    definitions,
    renderKeysByDefIndex,
  } = buildDefinitions(itemsGame, tokens, cdnMap, qualities.byKey, rarities.byKey, imagePathIndex);
  const variants = buildVariants(definitions, renderKeysByDefIndex, paints, cdnMap);
  const stickerKits = buildStickerKits(itemsGame, tokens, cdnMap, rarities.byKey, imagePathIndex);
  const keychainDefinitions = buildKeychainDefinitions(itemsGame, tokens, qualities.byKey, rarities.byKey, cdnMap, imagePathIndex);

  return {
    generatedAt: new Date().toISOString(),
    wearBands: WEAR_BANDS,
    phaseNames: PHASE_NAMES,
    imagePathIndex,
    attributeDefsById: attributeDefs,
    qualitiesByValue: qualities.byValue,
    raritiesByValue: rarities.byValue,
    definitionsByDefIndex: definitions,
    renderKeysByDefIndex,
    paintsByIndex: paints,
    variantsByKey: variants,
    stickerKitsById: stickerKits,
    keychainDefinitionsById: keychainDefinitions,
  };
}

function titleCase(value) {
  return String(value)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

module.exports = {
  PHASE_NAMES,
  PHASE_MAPPING,
  WEAR_BANDS,
  buildSchema,
  normaliseUrl,
  parseCdn,
  parseVdf,
  resolveToken,
};
