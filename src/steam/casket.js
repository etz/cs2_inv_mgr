const GlobalOffensive = require('globaloffensive');
const { formatItem, STORAGE_UNIT_DEF_INDEX } = require('../utils/itemFormatter');

const OPERATION_TIMEOUT_MS = 20000;
const OPERATION_DELAY_MS = 1000;

// ── Operation Queue ──────────────────────────────────────────────────────────

class OperationQueue {
  constructor(delayMs = OPERATION_DELAY_MS) {
    this.queue = [];
    this.processing = false;
    this.delayMs = delayMs;
  }

  enqueue(operation) {
    return new Promise((resolve, reject) => {
      this.queue.push({ operation, resolve, reject });
      if (!this.processing) this._process();
    });
  }

  async _process() {
    this.processing = true;
    while (this.queue.length > 0) {
      const { operation, resolve, reject } = this.queue.shift();
      try {
        resolve(await operation());
      } catch (err) {
        reject(err);
      }
      if (this.queue.length > 0) {
        await new Promise(r => setTimeout(r, this.delayMs));
      }
    }
    this.processing = false;
  }
}

const opQueue = new OperationQueue();

// ── Helpers ──────────────────────────────────────────────────────────────────

function waitForNotification(csgo, expectedType, timeoutMs = OPERATION_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      csgo.removeListener('itemCustomizationNotification', handler);
      reject(new Error(`Operation timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);

    function handler(itemIds, notificationType) {
      if (notificationType === expectedType) {
        clearTimeout(timer);
        csgo.removeListener('itemCustomizationNotification', handler);
        resolve(itemIds);
      }
    }

    csgo.on('itemCustomizationNotification', handler);
  });
}

// ── Casket Operations ────────────────────────────────────────────────────────

/**
 * Load contents of a storage unit. Returns formatted items.
 * Note: items inside storage units are NOT available in the Steam Community
 * inventory, so we can only show GC data (no images/names from community API).
 */
async function getCasketContents(steamClient, casketId) {
  const { csgo } = steamClient;

  // Verify the casket exists in inventory
  const casket = csgo.inventory?.find(
    i => i.id.toString() === casketId && i.def_index === STORAGE_UNIT_DEF_INDEX
  );
  if (!casket) throw new Error('Storage unit not found in inventory');

  // Items inside storage units ARE present in the Steam Community inventory
  // (they're still economy items; the casket relationship is a GC-layer concept).
  // Use the cached community map from the last inventory fetch.
  const communityMap = steamClient._communityMap ?? new Map();

  return new Promise((resolve, reject) => {
    csgo.getCasketContents(casket.id, (err, items) => {
      if (err) return reject(err);
      resolve(items.map(item => formatItem(item, communityMap.get(item.id.toString()) ?? null)));
    });
  });
}

/**
 * Move an item from the main inventory into a storage unit.
 */
function addItemToCasket(csgo, casketId, itemId) {
  return opQueue.enqueue(() => _addItemToCasket(csgo, casketId, itemId));
}

async function _addItemToCasket(csgo, casketId, itemId) {
  // Pre-check: casket not full
  const casket = csgo.inventory?.find(i => i.id.toString() === casketId);
  if (casket && (casket.casket_contained_item_count ?? 0) >= 1000) {
    throw new Error('Storage unit is full (1000 item limit)');
  }

  const notifPromise = waitForNotification(
    csgo,
    GlobalOffensive.ItemCustomizationNotification.CasketAdded
  );

  csgo.addToCasket(casketId, itemId);
  await notifPromise;
  return { success: true };
}

/**
 * Move an item from a storage unit back into the main inventory.
 */
function removeItemFromCasket(csgo, casketId, itemId) {
  return opQueue.enqueue(() => _removeItemFromCasket(csgo, casketId, itemId));
}

async function _removeItemFromCasket(csgo, casketId, itemId) {
  const notifPromise = waitForNotification(
    csgo,
    GlobalOffensive.ItemCustomizationNotification.CasketRemoved
  );

  csgo.removeFromCasket(casketId, itemId);
  await notifPromise;
  return { success: true };
}

module.exports = { getCasketContents, addItemToCasket, removeItemFromCasket };
