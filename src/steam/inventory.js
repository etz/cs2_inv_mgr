const https = require('https');
const SteamCommunity = require('steamcommunity');
const { formatItem, formatStorageUnit, STORAGE_UNIT_DEF_INDEX } = require('../utils/itemFormatter');

const CS2_APP_ID = 730;
const CS2_CONTEXT_ID = 2;

/**
 * Minimal HTTPS GET that resolves with parsed JSON.
 */
function httpsGetJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { Accept: 'application/json' } }, (res) => {
      let raw = '';
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch (e) { reject(new Error(`JSON parse failed (${res.statusCode}): ${e.message}`)); }
      });
    }).on('error', reject);
  });
}

/**
 * Normalise a raw description object from IEconService so it looks like a
 * CEconItem from steamcommunity (same field names used by itemFormatter.js).
 */
function normaliseWebApiItem(asset, desc) {
  // Remap tag field names to match the CEconItem shape.
  const tags = (desc.tags || []).map(t => ({
    internal_name: t.internal_name,
    name:          t.localized_tag_name || t.name,
    category:      t.category,
    color:         t.color || '',
    category_name: t.localized_category_name || t.category_name,
  }));

  return {
    // asset fields
    assetid:    asset.assetid,
    classid:    asset.classid,
    instanceid: asset.instanceid || '0',
    amount:     asset.amount,
    // description fields
    icon_url:          desc.icon_url,
    icon_url_large:    desc.icon_url_large,
    name:              desc.name,
    market_hash_name:  desc.market_hash_name,
    market_name:       desc.market_name,
    type:              desc.type,
    tradable:          !!desc.tradable,
    marketable:        !!desc.marketable,
    commodity:         !!desc.commodity,
    fraudwarnings:     desc.fraudwarnings || [],
    descriptions:      desc.descriptions || [],
    owner_descriptions:desc.owner_descriptions || [],
    tags,
  };
}

/**
 * Fetch full inventory via IEconService/GetInventoryItemsWithDescriptions.
 * Requires an OAuth access token (available after QR / credential login via
 * steam-session).  Returns a Map<assetId, normalisedItem>.
 *
 * This endpoint returns ALL items including trade-holded ones, unlike the
 * community inventory endpoint which may omit them.
 */
async function fetchInventoryViaWebAPI(steamId, accessToken) {
  const map = new Map();
  let startAssetId = null;
  let totalCount = 0;
  let pages = 0;

  do {
    const qs = new URLSearchParams({
      access_token:  accessToken,
      steamid:       steamId,
      appid:         String(CS2_APP_ID),
      contextid:     String(CS2_CONTEXT_ID),
      get_descriptions: '1',
      count:         '5000',
    });
    if (startAssetId) qs.set('start_assetid', startAssetId);

    const url = `https://api.steampowered.com/IEconService/GetInventoryItemsWithDescriptions/v1/?${qs}`;
    const data = await httpsGetJSON(url);
    const resp = data.response;

    if (!resp) throw new Error('IEconService returned no response object');

    totalCount = resp.total_inventory_count || 0;
    pages++;

    if (resp.assets && resp.descriptions) {
      // Build fast classid_instanceid → description lookup.
      const descLookup = new Map();
      for (const desc of resp.descriptions) {
        descLookup.set(`${desc.classid}_${desc.instanceid || '0'}`, desc);
      }
      for (const asset of resp.assets) {
        const desc = descLookup.get(`${asset.classid}_${asset.instanceid || '0'}`);
        if (desc) map.set(asset.assetid, normaliseWebApiItem(asset, desc));
      }
    }

    startAssetId = resp.more_items ? resp.last_assetid : null;
  } while (startAssetId);

  console.log(`[webapi] fetched ${map.size} items over ${pages} page(s) (total_inventory_count=${totalCount})`);
  return map;
}

/**
 * Fetch the community inventory (names, images, tags) via steamcommunity.
 * Falls back to this when no access token is available (browser-token login).
 * Returns a Map<assetId, communityItem>.
 */
async function fetchCommunityInventory(steamUser, webCookies) {
  return new Promise((resolve, reject) => {
    const community = new SteamCommunity();

    const proceed = (cookies) => {
      if (cookies) community.setCookies(cookies);
      community.getUserInventoryContents(
        steamUser.steamID,
        CS2_APP_ID,
        CS2_CONTEXT_ID,
        false, // include non-tradable items
        'english',
        (err, items, _currency, totalCount) => {
          if (err) return reject(err);
          const map = new Map();
          for (const item of items) {
            map.set(item.assetid, item);
          }
          console.log(`[community] received ${items.length} items (Steam reports total_inventory_count=${totalCount})`);
          resolve(map);
        }
      );
    };

    if (webCookies) {
      proceed(webCookies);
    } else if (steamUser._refreshToken) {
      steamUser.once('webSession', (sessionId, cookies) => proceed(cookies));
      steamUser.webLogOn();
    } else {
      // webLogonToken auth — no refresh token, so webLogOn() can't be called.
      // getUserInventoryContents hits a public endpoint; proceed without cookies.
      proceed(null);
    }
  });
}

/**
 * Build the full inventory response from GC + community data.
 * Returns { items, storageUnits }
 *
 * items includes ALL non-storage-unit GC items — even those inside a casket
 * (item.inCasket will be set to the casket ID string for those). This mirrors
 * how the CS2 in-game inventory works: items inside storage units are still
 * visible in your inventory with a small indicator.
 */
async function getInventory(steamClient) {
  const { steamUser, csgo, _webCookies } = steamClient;

  if (!csgo.inventory || csgo.inventory.length === 0) {
    return { items: [], storageUnits: [] };
  }

  // Fetch item metadata (names, images, tags).
  // Preferred: IEconService/GetInventoryItemsWithDescriptions — returns ALL items
  //   including trade-holded ones.  Requires the steam-session access token,
  //   which is only available after a QR or credential login.
  // Fallback: community inventory endpoint — may omit trade-holded items.
  let communityMap = steamClient._communityMap ?? new Map();
  const accessToken = steamClient._accessToken ?? null;

  try {
    if (accessToken) {
      communityMap = await fetchInventoryViaWebAPI(steamClient.steamId, accessToken);
    } else {
      console.log('[inventory] No access token — using community inventory endpoint (trade-holded items may be missing)');
      communityMap = await fetchCommunityInventory(steamUser, _webCookies);
    }
    steamClient._communityMap = communityMap;
  } catch (err) {
    // If Web API failed (e.g. token expired), try community endpoint as fallback.
    if (accessToken) {
      console.warn('[inventory] IEconService fetch failed, retrying via community endpoint:', err.message);
      try {
        communityMap = await fetchCommunityInventory(steamUser, _webCookies);
        steamClient._communityMap = communityMap;
      } catch (err2) {
        console.warn('Could not fetch community inventory metadata:', err2.stack ?? err2.message);
        console.warn(`Using ${communityMap.size} cached community item(s).`);
      }
    } else {
      console.warn('Could not fetch community inventory metadata:', err.stack ?? err.message);
      console.warn(`Using ${communityMap.size} cached community item(s).`);
    }
  }

  console.log(`[inventory] GC items: ${csgo.inventory.length}, community map size: ${communityMap.size}`);

  const storageUnits = [];
  const items = [];
  let unmatchedCount = 0;
  const unmatchedSample = [];

  for (const gcItem of csgo.inventory) {
    const assetId = gcItem.id.toString();

    // Primary lookup by current asset ID.
    // Fallback to original_id for items that got a new ID when moved into/out of a
    // storage unit — the community API may list them under their pre-move ID.
    let communityItem = communityMap.get(assetId) ?? null;
    if (!communityItem && gcItem.original_id) {
      const origId = gcItem.original_id.toString();
      if (origId !== '0') communityItem = communityMap.get(origId) ?? null;
    }

    if (!communityItem) {
      unmatchedCount++;
      if (unmatchedSample.length < 5) {
        unmatchedSample.push({ id: assetId, def_index: gcItem.def_index, inCasket: !!gcItem.casket_id });
      }
    }

    if (gcItem.def_index === STORAGE_UNIT_DEF_INDEX) {
      storageUnits.push(formatStorageUnit(gcItem, communityItem));
    } else {
      // Include ALL other items — even those inside a casket.
      // formatItem sets item.inCasket = casket_id when the item is in a storage unit,
      // so the frontend can show an indicator and filter appropriately.
      items.push(formatItem(gcItem, communityItem));
    }
  }

  if (unmatchedCount > 0) {
    console.warn(`[inventory] ${unmatchedCount} GC item(s) had no community match. Sample:`,
      unmatchedSample.map(i => `id=${i.id} def=${i.def_index} inCasket=${i.inCasket}`).join(', '));
    console.warn('[inventory] Items inside storage units are NOT returned by the Steam community inventory API — this is expected.');
  }

  const inCasketCount = items.filter(i => i.inCasket).length;
  console.log(`[inventory] returning ${items.length} items (${inCasketCount} in storage units, ${unmatchedCount} without community metadata), ${storageUnits.length} storage unit(s)`);

  return { items, storageUnits };
}

module.exports = { getInventory };
