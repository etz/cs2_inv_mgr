const test = require('node:test');
const assert = require('node:assert/strict');

const { getInventory } = require('../src/steam/inventory');

function createSteamClient({ inventory, assetDescriptionsByAssetId }) {
  let marketLookupCalls = 0;

  return {
    csgo: { inventory },
    async getAssetDescriptions() {
      return assetDescriptionsByAssetId;
    },
    buildKeychainDescriptionByName() {
      return new Map();
    },
    buildStickerDescriptionByName() {
      return new Map();
    },
    async getMarketDescriptionsByHash() {
      marketLookupCalls += 1;
      return new Map();
    },
    get marketLookupCalls() {
      return marketLookupCalls;
    },
  };
}

test('getInventory excludes GC-only items missing from Steam web inventory payload by default', async () => {
  const steamClient = createSteamClient({
    inventory: [
      { id: '100', def_index: 4846, quality: 4, rarity: 1, inventory: 3 },
      { id: '200', def_index: 4950, quality: 4, rarity: 1, inventory: 1 },
    ],
    assetDescriptionsByAssetId: new Map([
      ['100', {
        marketHashName: 'Recoil Case',
        localizedName: 'Recoil Case',
        itemUrl: 'https://example.com/recoil-case.png',
        tags: [],
      }],
    ]),
  });

  const data = await getInventory(steamClient);

  assert.equal(data.items.length, 1);
  assert.equal(data.items[0].id, '100');
  assert.equal(data.items[0].itemUrl, 'https://example.com/recoil-case.png');
  assert.equal(steamClient.marketLookupCalls, 0);
});

test('getInventory can include GC-only items when strict web inventory matching is disabled', async () => {
  const original = process.env.CS2_STRICT_WEB_INVENTORY_MATCH;
  process.env.CS2_STRICT_WEB_INVENTORY_MATCH = '0';

  try {
    const steamClient = createSteamClient({
      inventory: [
        { id: '100', def_index: 4846, quality: 4, rarity: 1, inventory: 3 },
        { id: '200', def_index: 4950, quality: 4, rarity: 1, inventory: 1 },
      ],
      assetDescriptionsByAssetId: new Map([
        ['100', {
          marketHashName: 'Recoil Case',
          localizedName: 'Recoil Case',
          itemUrl: 'https://example.com/recoil-case.png',
          tags: [],
        }],
      ]),
    });

    const data = await getInventory(steamClient);

    assert.equal(data.items.length, 2);
    assert.deepEqual(data.items.map((item) => item.id).sort(), ['100', '200']);
  } finally {
    if (typeof original === 'undefined') {
      delete process.env.CS2_STRICT_WEB_INVENTORY_MATCH;
    } else {
      process.env.CS2_STRICT_WEB_INVENTORY_MATCH = original;
    }
  }
});
