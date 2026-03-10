const { formatItem, formatStorageUnit, STORAGE_UNIT_DEF_INDEX } = require('../utils/itemFormatter');

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
  const storageUnits = [];
  const items = [];

  for (const gcItem of csgo.inventory) {
    if (gcItem.def_index === STORAGE_UNIT_DEF_INDEX) {
      storageUnits.push(formatStorageUnit(gcItem, inventoryById));
    } else {
      items.push(formatItem(gcItem, inventoryById));
    }
  }

  const inCasketCount = items.filter((item) => item.inCasket).length;
  console.log(
    `[inventory] returning ${items.length} item(s) (${inCasketCount} in storage units), ${storageUnits.length} storage unit(s)`
  );

  return { items, storageUnits };
}

module.exports = { getInventory };
