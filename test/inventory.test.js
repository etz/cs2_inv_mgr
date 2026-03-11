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

test('getInventory includes items even when Steam web inventory payload is missing entries', async () => {
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
  const recoil = data.items.find((item) => item.id === '100');
  assert.equal(recoil.itemUrl, 'https://example.com/recoil-case.png');
  assert.equal(steamClient.marketLookupCalls, 1);
});
