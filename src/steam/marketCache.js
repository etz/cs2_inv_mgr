const fs = require('fs');
const path = require('path');

const CACHE_VERSION = 1;

function defaultCachePath() {
  return path.join(process.cwd(), '.cache', 'market-descriptions.json');
}

function readCacheFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== CACHE_VERSION || typeof parsed.entries !== 'object') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function ensureDir(filePath) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  } catch {
    // best-effort
  }
}

function writeCacheFile(filePath, payload) {
  ensureDir(filePath);
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
}

function createMarketCache(options = {}) {
  const filePath = options.filePath ?? defaultCachePath();
  const ttlMs = Number.isFinite(Number(options.ttlMs))
    ? Math.max(0, Math.floor(Number(options.ttlMs)))
    : 180 * 24 * 60 * 60 * 1000; // 180 days

  const now = Date.now();
  const onDisk = readCacheFile(filePath);
  const entries = new Map();

  for (const [hashName, record] of Object.entries(onDisk?.entries ?? {})) {
    if (!record || typeof record !== 'object') continue;
    const fetchedAt = Number(record.fetchedAt ?? 0);
    if (!Number.isFinite(fetchedAt) || fetchedAt <= 0) continue;
    if (ttlMs > 0 && now - fetchedAt > ttlMs) continue;
    entries.set(hashName, { value: record.value ?? null, fetchedAt });
  }

  let saveTimer = null;
  function scheduleSave() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      try {
        const payload = {
          version: CACHE_VERSION,
          savedAt: Date.now(),
          entries: Object.fromEntries(
            [...entries.entries()].map(([hashName, record]) => [hashName, record])
          ),
        };
        writeCacheFile(filePath, payload);
      } catch {
        // best-effort
      }
    }, 500);
  }

  return {
    filePath,
    ttlMs,
    has(hashName) {
      return entries.has(hashName);
    },
    get(hashName) {
      const record = entries.get(hashName);
      return record ? record.value : undefined;
    },
    set(hashName, value) {
      entries.set(hashName, { value: value ?? null, fetchedAt: Date.now() });
      scheduleSave();
    },
    seedFromMap(map) {
      for (const [hashName, value] of map.entries()) {
        if (!entries.has(hashName)) {
          entries.set(hashName, { value: value ?? null, fetchedAt: Date.now() });
        }
      }
      scheduleSave();
    },
  };
}

module.exports = { createMarketCache };

