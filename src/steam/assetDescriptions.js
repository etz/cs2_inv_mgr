const https = require('https');
const zlib = require('zlib');

const INVENTORY_ENDPOINT = 'https://steamcommunity.com/inventory';
const ECONOMY_IMAGE_ENDPOINT = 'https://community.cloudflare.steamstatic.com/economy/image';
const DEFAULT_IMAGE_SIZE = '360fx360f';
const DEFAULT_PAGE_SIZE = 2000;
const DEFAULT_MAX_PAGES = 30;
const MAX_ALLOWED_PAGE_SIZE = 2000;

function buildEconomyImageUrl(iconHash, size = DEFAULT_IMAGE_SIZE) {
  if (!iconHash) {
    return null;
  }

  const cleaned = String(iconHash).trim();
  if (!cleaned) {
    return null;
  }

  return `${ECONOMY_IMAGE_ENDPOINT}/${cleaned}/${size}`;
}

async function fetchAssetDescriptionsByAssetId({
  steamId,
  cookies = [],
  language = 'english',
  count = DEFAULT_PAGE_SIZE,
  maxPages = DEFAULT_MAX_PAGES,
  requestJson = requestJsonOverHttps,
}) {
  if (!steamId) {
    return new Map();
  }

  const sanitizedCookies = sanitiseCookies(cookies);
  const pageSize = clampPageSize(count);
  const strategies = buildRequestStrategies(sanitizedCookies);
  let lastError = null;

  for (const strategy of strategies) {
    try {
      const map = await fetchWithStrategy({
        steamId,
        language,
        pageSize,
        maxPages,
        requestJson,
        strategy,
      });
      if (map.size > 0) {
        return map;
      }
      if (strategy.cookies.length === 0) {
        return map;
      }
    } catch (error) {
      lastError = error;
      if (!isRetryableStatus(error.statusCode)) {
        throw error;
      }
    }
  }

  if (lastError) {
    throw lastError;
  }

  return new Map();
}

async function fetchWithStrategy({
  steamId,
  language,
  pageSize,
  maxPages,
  requestJson,
  strategy,
}) {
  const map = new Map();
  let startAssetId = null;
  let page = 0;

  while (page < maxPages) {
    const params = new URLSearchParams({
      count: String(pageSize),
    });
    if (strategy.includeLanguage && language) {
      params.set('l', language);
    }
    if (startAssetId) {
      params.set('start_assetid', String(startAssetId));
    }

    const url = `${INVENTORY_ENDPOINT}/${encodeURIComponent(String(steamId))}/730/2?${params.toString()}`;
    const headers = {
      accept: 'application/json,text/plain,*/*',
      'accept-encoding': 'gzip, deflate, br',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
      referer: 'https://steamcommunity.com/',
    };

    if (strategy.cookies.length > 0) {
      headers.cookie = strategy.cookies.join('; ');
    }

    let payload;
    try {
      payload = await requestJson(url, headers);
    } catch (error) {
      if (map.size > 0 && isRetryableStatus(error.statusCode)) {
        return map;
      }
      throw error;
    }

    if (!payload || payload.success !== 1) {
      break;
    }

    appendPageToAssetMap(map, payload);

    if (!payload.more_items || !payload.last_assetid) {
      break;
    }

    startAssetId = payload.last_assetid;
    page += 1;
  }

  return map;
}

function appendPageToAssetMap(map, payload) {
  const descriptionsByClass = new Map();
  for (const description of payload.descriptions ?? []) {
    const classKey = buildClassKey(description.classid, description.instanceid);
    if (!classKey) {
      continue;
    }

    descriptionsByClass.set(classKey, {
      classid: description.classid ?? null,
      instanceid: description.instanceid ?? '0',
      marketHashName: description.market_hash_name ?? null,
      marketName: description.market_name ?? null,
      localizedName: description.name ?? null,
      type: description.type ?? null,
      iconUrl: description.icon_url ?? null,
      iconUrlLarge: description.icon_url_large ?? null,
      itemUrl: buildEconomyImageUrl(description.icon_url_large ?? description.icon_url),
      tags: Array.isArray(description.tags) ? description.tags : [],
    });
  }

  for (const asset of payload.assets ?? []) {
    const classKey = buildClassKey(asset.classid, asset.instanceid);
    if (!classKey) {
      continue;
    }

    const description = descriptionsByClass.get(classKey);
    if (!description) {
      continue;
    }

    map.set(String(asset.assetid), description);
  }
}

function buildRequestStrategies(sanitizedCookies) {
  const candidates = [
    { includeLanguage: true, cookies: sanitizedCookies },
    { includeLanguage: false, cookies: sanitizedCookies },
    { includeLanguage: true, cookies: [] },
    { includeLanguage: false, cookies: [] },
  ];

  const seen = new Set();
  const strategies = [];
  for (const candidate of candidates) {
    const key = `${candidate.includeLanguage ? 'l' : 'nol'}:${candidate.cookies.join('|')}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    strategies.push(candidate);
  }

  return strategies;
}

function clampPageSize(count) {
  const numeric = Number(count);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return DEFAULT_PAGE_SIZE;
  }

  return Math.min(Math.floor(numeric), MAX_ALLOWED_PAGE_SIZE);
}

function isRetryableStatus(statusCode) {
  return statusCode === 400 || statusCode === 403 || statusCode === 429;
}

function sanitiseCookies(cookies) {
  const byName = new Map();
  for (const cookie of cookies ?? []) {
    const raw = String(cookie ?? '').split(';')[0].trim();
    if (!raw || !raw.includes('=')) {
      continue;
    }

    const name = raw.slice(0, raw.indexOf('=')).trim();
    if (!name) {
      continue;
    }

    byName.set(name, raw);
  }

  return [...byName.values()];
}

function buildClassKey(classId, instanceId) {
  if (!classId) {
    return null;
  }

  return `${String(classId)}_${String(instanceId ?? '0')}`;
}

function buildKeychainDescriptionByName(assetDescriptionsByAssetId) {
  const byName = new Map();

  for (const description of assetDescriptionsByAssetId.values()) {
    const marketHashName = description.marketHashName ?? '';
    if (!marketHashName.startsWith('Charm | ')) {
      continue;
    }

    const localizedName = marketHashName.slice('Charm | '.length).trim();
    if (!localizedName) {
      continue;
    }

    if (!byName.has(localizedName)) {
      byName.set(localizedName, {
        localizedName,
        itemUrl: description.itemUrl ?? null,
        rarityName: findTagName(description.tags, 'Rarity'),
        rarityColor: findTagColor(description.tags, 'Rarity'),
      });
    }
  }

  return byName;
}

function buildStickerDescriptionByName(assetDescriptionsByAssetId) {
  const byName = new Map();

  for (const description of assetDescriptionsByAssetId.values()) {
    const marketHashName = description.marketHashName ?? '';
    if (!marketHashName.startsWith('Sticker | ')) {
      continue;
    }

    const localizedName = description.localizedName ?? description.marketName ?? marketHashName;
    if (!localizedName) {
      continue;
    }

    const value = {
      localizedName,
      itemUrl: description.itemUrl ?? null,
      rarityName: findTagName(description.tags, 'Rarity'),
      rarityColor: findTagColor(description.tags, 'Rarity'),
    };

    for (const key of collectStickerNameKeys(localizedName, marketHashName)) {
      if (!byName.has(key)) {
        byName.set(key, value);
      }
    }
  }

  return byName;
}

function collectStickerNameKeys(localizedName, marketHashName) {
  const keys = new Set([localizedName, marketHashName]);

  for (const value of [localizedName, marketHashName]) {
    if (value && value.startsWith('Sticker | ')) {
      keys.add(value.slice('Sticker | '.length).trim());
    }
  }

  return [...keys].filter(Boolean);
}

function findTagName(tags, categoryName) {
  if (!Array.isArray(tags)) {
    return null;
  }

  return tags.find((tag) => tag.category_name === categoryName)?.name ?? null;
}

function findTagColor(tags, categoryName) {
  if (!Array.isArray(tags)) {
    return null;
  }

  return tags.find((tag) => tag.category_name === categoryName)?.color ?? null;
}

function requestJsonOverHttps(url, headers, redirects = 3) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers }, (response) => {
      if (
        response.statusCode
        && response.statusCode >= 300
        && response.statusCode < 400
        && response.headers.location
        && redirects > 0
      ) {
        const redirectUrl = new URL(response.headers.location, url).toString();
        response.resume();
        resolve(requestJsonOverHttps(redirectUrl, headers, redirects - 1));
        return;
      }

      const chunks = [];
      response.on('data', (chunk) => {
        chunks.push(Buffer.from(chunk));
      });
      response.on('end', () => {
        const rawBuffer = Buffer.concat(chunks);
        const raw = decodeBody(response.headers['content-encoding'], rawBuffer);

        if (response.statusCode !== 200) {
          const error = new Error(`Inventory request failed (${response.statusCode})`);
          error.statusCode = response.statusCode;
          error.body = raw.slice(0, 300);
          reject(error);
          return;
        }

        try {
          resolve(JSON.parse(raw));
        } catch (error) {
          reject(new Error(`Failed to parse Steam inventory payload: ${error.message}`));
        }
      });
    });

    request.on('error', reject);
  });
}

function decodeBody(encoding, buffer) {
  if (!buffer || buffer.length === 0) {
    return '';
  }

  const value = String(encoding ?? '').toLowerCase();
  try {
    if (value.includes('gzip')) {
      return zlib.gunzipSync(buffer).toString('utf8');
    }
    if (value.includes('deflate')) {
      return zlib.inflateSync(buffer).toString('utf8');
    }
    if (value.includes('br') && typeof zlib.brotliDecompressSync === 'function') {
      return zlib.brotliDecompressSync(buffer).toString('utf8');
    }
  } catch {
    return buffer.toString('utf8');
  }

  return buffer.toString('utf8');
}

module.exports = {
  buildEconomyImageUrl,
  buildKeychainDescriptionByName,
  buildStickerDescriptionByName,
  fetchAssetDescriptionsByAssetId,
};
