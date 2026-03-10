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

function normalisePrefabKey(prefab) {
  if (!prefab) {
    return null;
  }

  if (prefab.includes(' ') && prefab.startsWith('valve ')) {
    return prefab.split(' ')[1];
  }

  if (prefab.includes(' ')) {
    return prefab.split(' ')[0];
  }

  return prefab;
}

function resolvePrefabChain(prefabs, itemData, cache, seen = new Set()) {
  if (!itemData?.prefab) {
    return { ...itemData };
  }

  const prefabKey = normalisePrefabKey(itemData.prefab);
  if (!prefabKey || seen.has(prefabKey)) {
    return { ...itemData };
  }

  if (cache.has(prefabKey)) {
    return deepMerge(cache.get(prefabKey), itemData);
  }

  const prefab = prefabs[prefabKey];
  if (!prefab) {
    return { ...itemData };
  }

  seen.add(prefabKey);
  const resolved = resolvePrefabChain(prefabs, prefab, cache, seen);
  cache.set(prefabKey, resolved);
  return deepMerge(resolved, itemData);
}

function findTopLevelValue(prefabs, itemData, attributeName, cache) {
  const resolved = resolvePrefabChain(prefabs, itemData, cache);
  return resolved?.[attributeName] ?? null;
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

function buildStickerKits(itemsGame, tokens, cdnMap) {
  const stickerKits = {};

  for (const [stickerId, stickerData] of Object.entries(itemsGame.sticker_kits ?? {})) {
    stickerKits[stickerId] = {
      stickerId,
      item_name: stickerData.name,
      localizedName: resolveToken(tokens, stickerData.item_name)
        ?? resolveToken(tokens, stickerData.description_string)
        ?? titleCase(stickerData.name),
      itemUrl: resolveItemUrl(cdnMap, {
        name: stickerData.name,
        image_inventory: stickerData.image_inventory,
      }),
    };
  }

  return stickerKits;
}

function buildDefinitions(itemsGame, tokens, cdnMap, qualitiesByKey, raritiesByKey) {
  const definitions = {};
  const prefabCache = new Map();
  const prefabs = itemsGame.prefabs ?? {};

  for (const [defIndex, itemData] of Object.entries(itemsGame.items ?? {})) {
    const merged = resolvePrefabChain(prefabs, itemData, prefabCache);
    const categoryToken = findTopLevelValue(prefabs, itemData, 'item_type_name', prefabCache);
    const quality = qualitiesByKey[merged.item_quality ?? itemData.item_quality ?? ''] ?? null;
    const rarity = raritiesByKey[merged.item_rarity ?? itemData.item_rarity ?? ''] ?? null;

    definitions[defIndex] = {
      defIndex,
      item_name: itemData.name,
      localizedName: resolveToken(tokens, merged.item_name) ?? titleCase(itemData.name),
      category: resolveToken(tokens, categoryToken) ?? merged.visuals?.weapon_type ?? null,
      qualityValue: quality?.value ?? null,
      localizedQuality: quality?.localizedName ?? null,
      rarityValue: rarity?.value ?? null,
      rarityName: rarity?.weaponName ?? rarity?.nonweaponName ?? null,
      rarityColor: rarity?.color ?? null,
      itemUrl: resolveItemUrl(cdnMap, merged),
      paintable: Boolean(merged.paint_data),
      image_inventory: merged.image_inventory ?? null,
    };
  }

  return definitions;
}

function resolveItemUrl(cdnMap, itemData) {
  const candidates = [];

  if (itemData?.image_inventory) {
    candidates.push(itemData.image_inventory);
    candidates.push(path.posix.basename(itemData.image_inventory));
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

function buildVariants(definitions, paints, cdnMap) {
  const variants = {};

  for (const definition of Object.values(definitions)) {
    if (!definition.paintable || !definition.item_name) {
      continue;
    }

    for (const paint of Object.values(paints)) {
      const variantKey = `${definition.item_name}_${paint.item_name}`;
      const itemUrl = cdnMap[variantKey];
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

function buildSchema({ itemsGameText, csgoEnglishText, itemsCdnText }) {
  const itemsGame = parseVdf(itemsGameText).items_game;
  const csgoEnglish = parseVdf(csgoEnglishText).lang;
  const tokens = csgoEnglish.Tokens ?? {};
  const cdnMap = parseCdn(itemsCdnText);
  const qualities = buildQualities(itemsGame, tokens);
  const rarities = buildRarities(itemsGame, tokens);
  const paints = buildPaints(itemsGame, tokens, rarities.byKey);
  const definitions = buildDefinitions(itemsGame, tokens, cdnMap, qualities.byKey, rarities.byKey);
  const variants = buildVariants(definitions, paints, cdnMap);
  const stickerKits = buildStickerKits(itemsGame, tokens, cdnMap);

  return {
    generatedAt: new Date().toISOString(),
    wearBands: WEAR_BANDS,
    phaseNames: PHASE_NAMES,
    qualitiesByValue: qualities.byValue,
    raritiesByValue: rarities.byValue,
    definitionsByDefIndex: definitions,
    paintsByIndex: paints,
    variantsByKey: variants,
    stickerKitsById: stickerKits,
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
