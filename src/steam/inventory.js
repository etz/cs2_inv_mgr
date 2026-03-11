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
  const strictWebInventoryMatch = process.env.CS2_STRICT_WEB_INVENTORY_MATCH !== '0';
  const hasWebInventoryData = assetDescriptionById.size > 0;
  const keychainDescriptionByName = steamClient.buildKeychainDescriptionByName(assetDescriptionById);
  const stickerDescriptionByName = steamClient.buildStickerDescriptionByName(assetDescriptionById);
  const storageUnits = [];
  const items = [];
  let skippedGcOnlyItems = 0;

  for (const gcItem of csgo.inventory) {
    const hasAssetDescription = assetDescriptionById.has(String(gcItem.id));
    if (strictWebInventoryMatch && hasWebInventoryData && !hasAssetDescription) {
      skippedGcOnlyItems += 1;
      continue;
    }

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
  if (skippedGcOnlyItems > 0) {
    console.log(`[inventory] skipped ${skippedGcOnlyItems} GC-only item(s) not present in Steam web inventory`);
  }
  console.log(
    `[inventory] returning ${items.length} item(s) (${inCasketCount} in storage units), ${storageUnits.length} storage unit(s)`
  );

  return { items, storageUnits };
}

module.exports = { getInventory };
