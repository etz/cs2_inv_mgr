const { formatItem, formatStorageUnit, STORAGE_UNIT_DEF_INDEX } = require('../utils/itemFormatter');
const {
  applyMarketDescriptions,
  collectMissingMarketHashNames,
} = require('./marketFallback');

function buildInventoryMap(items) {
  const map = new Map();
  for (const item of items ?? []) {
    map.set(String(item.id), item);
  }
  return map;
}

async function getInventory(steamClient) {
  const { csgo } = steamClient;

  if (!csgo.inventory || csgo.inventory.length === 0) {
    return { items: [], storageUnits: [] };
  }

  const inventoryById = buildInventoryMap(csgo.inventory);
  const assetDescriptionById = await steamClient.getAssetDescriptions();
  const keychainDescriptionByName = steamClient.buildKeychainDescriptionByName(assetDescriptionById);
  const stickerDescriptionByName = steamClient.buildStickerDescriptionByName(assetDescriptionById);
  const storageUnits = [];
  const items = [];

  for (const gcItem of csgo.inventory) {
    if (gcItem.def_index === STORAGE_UNIT_DEF_INDEX) {
      storageUnits.push(formatStorageUnit(gcItem, {
        inventoryById,
        assetDescriptionById,
        keychainDescriptionByName,
        stickerDescriptionByName,
      }));
      continue;
    }

    if (gcItem.casket_id) {
      continue;
    }

    items.push(formatItem(gcItem, {
      inventoryById,
      assetDescriptionById,
      keychainDescriptionByName,
      stickerDescriptionByName,
    }));
  }

  const missingHashNames = collectMissingMarketHashNames(items);
  if (missingHashNames.length > 0) {
    const marketDescriptions = await steamClient.getMarketDescriptionsByHash(missingHashNames);
    applyMarketDescriptions(items, marketDescriptions);
  }

  const inCasketCount = (csgo.inventory ?? []).filter((item) => Boolean(item.casket_id)).length;
  console.log(
    `[inventory] returning ${items.length} item(s) (${inCasketCount} in storage units), ${storageUnits.length} storage unit(s)`
  );

  return { items, storageUnits };
}

module.exports = { getInventory };
