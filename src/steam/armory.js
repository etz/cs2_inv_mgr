const NodeCS2 = require('node-cs2');
const { getItemData } = require('../data/itemData');

const OPERATION_TIMEOUT_MS = 20000;
const OPERATION_DELAY_MS = 1000;

class OperationQueue {
  constructor(delayMs = OPERATION_DELAY_MS) {
    this.queue = [];
    this.processing = false;
    this.delayMs = delayMs;
  }

  enqueue(operation) {
    return new Promise((resolve, reject) => {
      this.queue.push({ operation, resolve, reject });
      if (!this.processing) {
        this._process();
      }
    });
  }

  async _process() {
    this.processing = true;

    while (this.queue.length > 0) {
      const { operation, resolve, reject } = this.queue.shift();

      try {
        const result = await operation();
        resolve(result);
      } catch (error) {
        reject(error);
      }

      if (this.queue.length > 0) {
        await new Promise((done) => setTimeout(done, this.delayMs));
      }
    }

    this.processing = false;
  }
}

const opQueue = new OperationQueue();

function waitForNotification(csgo, expectedType, timeoutMs = OPERATION_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      csgo.removeListener('itemCustomizationNotification', handler);
      reject(new Error(`Operation timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);

    function handler(itemIds, notificationType) {
      if (notificationType !== expectedType) {
        return;
      }

      clearTimeout(timer);
      csgo.removeListener('itemCustomizationNotification', handler);
      resolve(itemIds ?? []);
    }

    csgo.on('itemCustomizationNotification', handler);
  });
}

async function getArmoryState(steamClient) {
  const { armory } = steamClient;
  const personalStore = armory.personalStore;
  const xpShop = armory.xpShop;
  const xpShopBalance = Number(xpShop?.redeemable_balance);
  const personalStoreBalance = Number(personalStore?.redeemable_balance);
  const balance = Number.isFinite(xpShopBalance)
    ? xpShopBalance
    : (Number.isFinite(personalStoreBalance) ? personalStoreBalance : 0);
  const level = Number(xpShop?.current_level ?? 0) || 0;
  const xp = Number(xpShop?.current_xp ?? 0) || 0;

  const itemData = await getItemData().catch(() => null);
  const volatileOffers = (armory.volatileOffers ?? []).map((offer) => enrichVolatileOffer(offer, itemData));
  const rotationOffers = buildRotationOffers({
    connectedToGC: steamClient.isConnectedToGC,
    balance,
    personalStore,
    rotation: itemData?.currentArmoryRotation ?? [],
  });

  if (steamClient.isConnectedToGC && !personalStore) {
    console.warn(
      '[armory] connected to GC but no personal store payload yet;',
      `xpShopBalance=${Number(xpShop?.redeemable_balance ?? 0) || 0}`
    );
  }

  return {
    connectedToGC: steamClient.isConnectedToGC,
    balance,
    xp,
    level,
    personalStore,
    xpShop,
    volatileOffers,
    rotationOffers,
    currentArmorySeason: itemData?.currentArmorySeason?.id ?? null,
  };
}

function redeemItem(steamClient, payload) {
  const { csgo } = steamClient;

  return opQueue.enqueue(async () => {
    if (!steamClient.isConnectedToGC) {
      throw new Error('Not connected to CS2 Game Coordinator');
    }

    const generationTime = Number(payload?.generationTime);
    const redeemableBalance = Number(payload?.redeemableBalance);
    const items = Array.isArray(payload?.items) ? payload.items : [];

    if (!Number.isFinite(generationTime) || generationTime <= 0) {
      throw new Error('generationTime is required');
    }
    if (!Number.isFinite(redeemableBalance)) {
      throw new Error('redeemableBalance is required');
    }
    if (items.length === 0) {
      throw new Error('items must be a non-empty array');
    }

    const resultPromise = waitForNotification(
      csgo,
      NodeCS2.ItemCustomizationNotification.ClientRedeemFreeReward
    );

    csgo.redeemFreeReward(generationTime, redeemableBalance, items);
    const itemIds = await resultPromise;

    return { success: true, itemIds };
  });
}

function redeemMissionReward(steamClient, payload) {
  const { csgo } = steamClient;

  return opQueue.enqueue(async () => {
    if (!steamClient.isConnectedToGC) {
      throw new Error('Not connected to CS2 Game Coordinator');
    }

    const campaignId = Number(payload?.campaignId);
    const redeemId = Number(payload?.redeemId);
    const redeemableBalance = Number(payload?.redeemableBalance);
    const expectedCost = Number(payload?.expectedCost);

    if (!Number.isFinite(campaignId)) {
      throw new Error('campaignId is required');
    }
    if (!Number.isFinite(redeemId)) {
      throw new Error('redeemId is required');
    }
    if (!Number.isFinite(redeemableBalance)) {
      throw new Error('redeemableBalance is required');
    }
    if (!Number.isFinite(expectedCost)) {
      throw new Error('expectedCost is required');
    }

    const resultPromise = waitForNotification(
      csgo,
      NodeCS2.ItemCustomizationNotification.ClientRedeemMissionReward
    );

    csgo.redeemMissionReward(campaignId, redeemId, redeemableBalance, expectedCost);
    const itemIds = await resultPromise;

    return { success: true, itemIds };
  });
}

async function getCollections(options = {}) {
  const data = await getItemData(options);
  return {
    fetchedAt: data.fetchedAt,
    collections: data.collections,
    itemDefinitions: data.itemDefinitionsList,
    currentArmorySeason: data.currentArmorySeason?.id ?? null,
    rotationOffers: data.currentArmoryRotation ?? [],
  };
}

function enrichVolatileOffer(offer, itemData) {
  const defIndex = Number(offer?.defidx ?? 0) || 0;
  const definition = itemData?.itemDefinitions?.get(defIndex) ?? null;

  return {
    ...offer,
    item: definition,
  };
}

function buildRotationOffers({ connectedToGC, balance, personalStore, rotation }) {
  const generationTime = Number(personalStore?.generation_time ?? 0) || 0;
  const personalStoreItems = Array.isArray(personalStore?.items) ? personalStore.items : [];
  const hasMapping = personalStoreItems.length > 0;

  if (hasMapping) {
    console.log(
      '[armory] redeem mapping enabled from personal store:',
      `rotation=${(rotation ?? []).length},`,
      `storeItems=${personalStoreItems.length}`
    );
  }

  return (rotation ?? []).map((entry, index) => {
    const mappedItemId = personalStoreItems[index] != null
      ? String(personalStoreItems[index])
      : null;
    const points = Number(entry.points ?? 0) || 0;
    const redeemPayload = mappedItemId
      ? {
        generationTime,
        redeemableBalance: balance,
        items: [mappedItemId],
      }
      : null;
    const canRedeem = Boolean(connectedToGC)
      && balance >= points
      && Boolean(redeemPayload)
      && generationTime > 0;

    return {
      ...entry,
      canRedeem,
      redeemPayload: canRedeem ? redeemPayload : null,
    };
  });
}

module.exports = {
  getArmoryState,
  redeemItem,
  redeemMissionReward,
  getCollections,
};
