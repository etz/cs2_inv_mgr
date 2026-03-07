const IMAGE_BASE = 'https://community.akamai.steamstatic.com/economy/image/';

// def_index 1201 = Storage Unit (Casket)
const STORAGE_UNIT_DEF_INDEX = 1201;

// Rarity tag → hex color map
const RARITY_COLORS = {
  'Consumer Grade': '#b0c3d9',
  'Industrial Grade': '#5e98d9',
  'Mil-Spec Grade': '#4b69ff',
  'Restricted': '#8847ff',
  'Classified': '#d32ce6',
  'Covert': '#eb4b4b',
  'Extraordinary': '#e4ae39', // knives, gloves
  'Contraband': '#e4ae39',
  'Base Grade': '#b0c3d9',
  'High Grade': '#5e98d9',
  'Remarkable': '#8847ff',
  'Exotic': '#eb4b4b',
  'Distinguished': '#4b69ff',
  'Exceptional': '#8847ff',
  'Superior': '#d32ce6',
  'Master': '#e4ae39',
};

function getTag(tags, category) {
  return tags?.find(t => t.category === category);
}

function formatItem(gcItem, communityItem) {
  const tags = communityItem?.tags ?? [];
  const rarityTag = getTag(tags, 'Rarity');
  const exteriorTag = getTag(tags, 'Exterior');
  const typeTag = getTag(tags, 'Type');
  const weaponTag = getTag(tags, 'Weapon');

  const rarityName = rarityTag?.localized_tag_name ?? null;
  const rarityColor = rarityName ? (RARITY_COLORS[rarityName] ?? '#b0c3d9') : '#b0c3d9';

  const iconUrl = communityItem?.icon_url;
  const imageUrl = iconUrl ? `${IMAGE_BASE}${iconUrl}` : null;

  return {
    id: gcItem.id.toString(),
    defIndex: gcItem.def_index,
    name: communityItem?.market_hash_name ?? `Item #${gcItem.def_index}`,
    imageUrl,
    rarity: rarityName,
    rarityColor,
    type: typeTag?.localized_tag_name ?? null,
    weapon: weaponTag?.localized_tag_name ?? null,
    exterior: exteriorTag?.localized_tag_name ?? null,
    customName: gcItem.custom_name ?? null,
    paintWear: gcItem.paint_wear != null ? Number(gcItem.paint_wear.toFixed(8)) : null,
    paintSeed: gcItem.paint_seed ?? null,
    statTrak: gcItem.kill_eater_value != null ? gcItem.kill_eater_value : null,
    stickers: (gcItem.stickers ?? []).map(s => ({
      slot: s.slot,
      stickerId: s.sticker_id,
      wear: s.wear ?? 0,
    })),
    tradable: communityItem?.tradable ?? false,
    inCasket: gcItem.casket_id ? gcItem.casket_id.toString() : null,
    casketItemCount: gcItem.casket_contained_item_count ?? 0,
    isStorageUnit: gcItem.def_index === STORAGE_UNIT_DEF_INDEX,
  };
}

function formatStorageUnit(gcItem, communityItem) {
  const base = formatItem(gcItem, communityItem);
  return {
    ...base,
    name: gcItem.custom_name || communityItem?.market_hash_name || 'Storage Unit',
    itemCount: gcItem.casket_contained_item_count ?? 0,
    maxItems: 1000,
  };
}

module.exports = { formatItem, formatStorageUnit, STORAGE_UNIT_DEF_INDEX };
