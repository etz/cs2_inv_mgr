const test = require('node:test');
const assert = require('node:assert/strict');

const { fetchMarketDescriptionByHashName } = require('../src/steam/marketSearch');

test('fetchMarketDescriptionByHashName returns exact hash match from market payload', async () => {
  const description = await fetchMarketDescriptionByHashName('Falchion Case', {
    requestJson: async () => ({
      results: [
        {
          hash_name: 'Falchion Case',
          name: 'Falchion Case',
          asset_description: {
            market_hash_name: 'Falchion Case',
            market_name: 'Falchion Case',
            name: 'Falchion Case',
            icon_url: 'hash123',
            type: 'Base Grade Container',
            name_color: 'b0c3d9',
          },
        },
      ],
    }),
  });

  assert.equal(description.marketHashName, 'Falchion Case');
  assert.equal(
    description.itemUrl,
    'https://community.cloudflare.steamstatic.com/economy/image/hash123/360fx360f'
  );
});

test('fetchMarketDescriptionByHashName returns null when no exact match exists', async () => {
  const description = await fetchMarketDescriptionByHashName('Sticker | Unknown', {
    requestJson: async () => ({
      results: [
        {
          hash_name: 'Sticker | Something Else',
          asset_description: {
            market_hash_name: 'Sticker | Something Else',
            icon_url: 'hash123',
          },
        },
      ],
    }),
  });

  assert.equal(description, null);
});
