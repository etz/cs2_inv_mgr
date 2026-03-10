const https = require('https');

const MARKET_SEARCH_ENDPOINT = 'https://steamcommunity.com/market/search/render/';
const APP_ID = 730;
const RESULT_COUNT = 20;
const DEFAULT_TIMEOUT_MS = 15000;

function buildEconomyImageUrl(iconHash, size = '360fx360f') {
  if (!iconHash) {
    return null;
  }

  const cleaned = String(iconHash).trim();
  if (!cleaned) {
    return null;
  }

  return `https://community.cloudflare.steamstatic.com/economy/image/${cleaned}/${size}`;
}

async function fetchMarketDescriptionByHashName(hashName, options = {}) {
  const normalizedHash = normaliseHashName(hashName);
  if (!normalizedHash) {
    return null;
  }

  const requestJson = options.requestJson ?? requestJsonOverHttps;
  const params = new URLSearchParams({
    appid: String(APP_ID),
    norender: '1',
    count: String(RESULT_COUNT),
    query: normalizedHash,
  });
  const url = `${MARKET_SEARCH_ENDPOINT}?${params.toString()}`;
  const headers = {
    accept: 'application/json,text/plain,*/*',
    'accept-encoding': 'gzip, deflate, br',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
    referer: 'https://steamcommunity.com/market/',
  };

  const payload = await requestJson(url, headers, DEFAULT_TIMEOUT_MS);
  const results = payload?.results ?? [];
  const exact = results.find((entry) => matchesHash(entry, normalizedHash))
    ?? null;
  const chosen = exact ?? null;

  if (!chosen?.asset_description) {
    return null;
  }

  const description = chosen.asset_description;
  return {
    marketHashName: description.market_hash_name ?? chosen.hash_name ?? normalizedHash,
    marketName: description.market_name ?? chosen.name ?? normalizedHash,
    localizedName: description.name ?? chosen.name ?? normalizedHash,
    itemUrl: buildEconomyImageUrl(description.icon_url_large ?? description.icon_url),
    rarityName: parseRarityName(description.type),
    rarityColor: description.name_color ? `#${description.name_color}` : null,
  };
}

function matchesHash(entry, hashName) {
  const target = hashName.toLowerCase();
  const candidates = [
    entry?.hash_name,
    entry?.asset_description?.market_hash_name,
    entry?.name,
    entry?.asset_description?.market_name,
  ].filter(Boolean).map((value) => String(value).toLowerCase());

  return candidates.includes(target);
}

function normaliseHashName(hashName) {
  const value = String(hashName ?? '').trim();
  return value || null;
}

function parseRarityName(typeLabel) {
  const type = String(typeLabel ?? '').trim();
  if (!type) {
    return null;
  }

  const index = type.indexOf(' ');
  if (index === -1) {
    return type;
  }

  return type.slice(0, index);
}

function requestJsonOverHttps(url, headers, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers }, (response) => {
      if (response.statusCode !== 200) {
        const error = new Error(`Market search failed (${response.statusCode})`);
        error.statusCode = response.statusCode;
        response.resume();
        reject(error);
        return;
      }

      let raw = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        raw += chunk;
      });
      response.on('end', () => {
        try {
          resolve(JSON.parse(raw));
        } catch (error) {
          reject(new Error(`Failed to parse market search payload: ${error.message}`));
        }
      });
    });

    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error('Market search request timed out'));
    });
    request.on('error', reject);
  });
}

module.exports = {
  buildEconomyImageUrl,
  fetchMarketDescriptionByHashName,
};
