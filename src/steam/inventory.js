const SteamCommunity = require('steamcommunity');
const { formatItem, formatStorageUnit, STORAGE_UNIT_DEF_INDEX } = require('../utils/itemFormatter');

const CS2_APP_ID = 730;
const CS2_CONTEXT_ID = 2;

/**
 * Fetch the community inventory (names, images, tags) via steamcommunity.
 * Returns a Map<assetId, communityItem>.
 */
async function fetchCommunityInventory(steamUser, webCookies) {
  return new Promise((resolve, reject) => {
    const community = new SteamCommunity();

    const proceed = (cookies) => {
      community.setCookies(cookies);
      community.getUserInventoryContents(
        steamUser.steamID,
        CS2_APP_ID,
        CS2_CONTEXT_ID,
        false, // include non-tradable items
        'english',
        (err, items) => {
          if (err) return reject(err);
          const map = new Map();
          for (const item of items) {
            map.set(item.assetid, item);
          }
          resolve(map);
        }
      );
    };

    if (webCookies) {
      proceed(webCookies);
    } else {
      steamUser.once('webSession', (sessionId, cookies) => proceed(cookies));
      steamUser.webLogOn();
    }
  });
}

/**
 * Build the full inventory response from GC + community data.
 * Returns { items, storageUnits }
 */
async function getInventory(steamClient) {
  const { steamUser, csgo, _webCookies } = steamClient;

  if (!csgo.inventory || csgo.inventory.length === 0) {
    return { items: [], storageUnits: [] };
  }

  // Attempt community inventory for rich metadata; fall back gracefully.
  // Cache the map on steamClient so getCasketContents can reuse it for items
  // that are inside storage units (not returned in items/storageUnits arrays).
  let communityMap = steamClient._communityMap ?? new Map();
  try {
    communityMap = await fetchCommunityInventory(steamUser, _webCookies);
    steamClient._communityMap = communityMap;
  } catch (err) {
    console.warn('Could not fetch community inventory metadata:', err.message);
  }

  const storageUnits = [];
  const items = [];

  for (const gcItem of csgo.inventory) {
    const assetId = gcItem.id.toString();
    const communityItem = communityMap.get(assetId) ?? null;

    if (gcItem.def_index === STORAGE_UNIT_DEF_INDEX) {
      storageUnits.push(formatStorageUnit(gcItem, communityItem));
    } else if (!gcItem.casket_id) {
      // Only include items that are NOT inside a casket
      items.push(formatItem(gcItem, communityItem));
    }
  }

  return { items, storageUnits };
}

module.exports = { getInventory };
