const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildEconomyImageUrl,
  buildKeychainDescriptionByName,
  buildStickerDescriptionByName,
  fetchAssetDescriptionsByAssetId,
} = require('../src/steam/assetDescriptions');

test('buildEconomyImageUrl returns cloudflare economy URL', () => {
  assert.equal(
    buildEconomyImageUrl('abc123'),
    'https://community.cloudflare.steamstatic.com/economy/image/abc123/360fx360f'
  );
  assert.equal(buildEconomyImageUrl(null), null);
});

test('buildKeychainDescriptionByName extracts charm market names', () => {
  const source = new Map([
    ['1', {
      marketHashName: 'Charm | Die-cast AK',
      itemUrl: 'https://example.com/charm.png',
      tags: [{ category_name: 'Rarity', name: 'Remarkable', color: '8847ff' }],
    }],
    ['2', {
      marketHashName: 'AK-47 | Redline',
      itemUrl: 'https://example.com/skin.png',
      tags: [],
    }],
  ]);

  const index = buildKeychainDescriptionByName(source);
  assert.equal(index.size, 1);
  assert.equal(index.get('Die-cast AK').itemUrl, 'https://example.com/charm.png');
  assert.equal(index.get('Die-cast AK').rarityName, 'Remarkable');
  assert.equal(index.get('Die-cast AK').rarityColor, '8847ff');
});

test('buildStickerDescriptionByName extracts sticker market names', () => {
  const source = new Map([
    ['1', {
      marketHashName: 'Sticker | Team Spirit (Holo)',
      localizedName: 'Sticker | Team Spirit (Holo)',
      itemUrl: 'https://example.com/sticker.png',
      tags: [{ category_name: 'Rarity', name: 'Exotic', color: '8847ff' }],
    }],
    ['2', {
      marketHashName: 'Charm | Die-cast AK',
      localizedName: 'Charm | Die-cast AK',
      itemUrl: 'https://example.com/charm.png',
      tags: [],
    }],
  ]);

  const index = buildStickerDescriptionByName(source);
  assert.equal(index.size, 2);
  assert.equal(index.get('Sticker | Team Spirit (Holo)').itemUrl, 'https://example.com/sticker.png');
  assert.equal(index.get('Team Spirit (Holo)').itemUrl, 'https://example.com/sticker.png');
  assert.equal(index.get('Sticker | Team Spirit (Holo)').rarityName, 'Exotic');
});

test('fetchAssetDescriptionsByAssetId maps assets to description metadata', async () => {
  const pages = [
    {
      success: 1,
      more_items: true,
      last_assetid: '200',
      descriptions: [
        {
          classid: '10',
          instanceid: '0',
          market_hash_name: 'Charm | Die-cast AK',
          market_name: 'Charm | Die-cast AK',
          name: 'Charm | Die-cast AK',
          icon_url: 'icon_hash_1',
          tags: [{ category_name: 'Rarity', name: 'Remarkable', color: '8847ff' }],
        },
      ],
      assets: [
        { assetid: '100', classid: '10', instanceid: '0' },
      ],
    },
    {
      success: 1,
      more_items: false,
      descriptions: [
        {
          classid: '11',
          instanceid: '0',
          market_hash_name: 'Sticker | Test',
          market_name: 'Sticker | Test',
          name: 'Sticker | Test',
          icon_url_large: 'icon_hash_2',
          tags: [],
        },
      ],
      assets: [
        { assetid: '200', classid: '11', instanceid: '0' },
      ],
    },
  ];

  const seenUrls = [];
  const descriptions = await fetchAssetDescriptionsByAssetId({
    steamId: '76561198000000000',
    count: 5000,
    requestJson: async (url) => {
      seenUrls.push(url);
      return pages.shift();
    },
  });

  assert.equal(seenUrls.length, 2);
  assert.match(seenUrls[0], /count=2000/);
  assert.equal(
    descriptions.get('100').itemUrl,
    'https://community.cloudflare.steamstatic.com/economy/image/icon_hash_1/360fx360f'
  );
  assert.equal(
    descriptions.get('200').itemUrl,
    'https://community.cloudflare.steamstatic.com/economy/image/icon_hash_2/360fx360f'
  );
  assert.equal(descriptions.get('100').marketHashName, 'Charm | Die-cast AK');
});

test('fetchAssetDescriptionsByAssetId retries after 400 on first strategy', async () => {
  const calls = [];
  let attempt = 0;

  const descriptions = await fetchAssetDescriptionsByAssetId({
    steamId: '76561198000000000',
    cookies: ['steamLoginSecure=token; Path=/; Domain=.steamcommunity.com'],
    requestJson: async (url, headers) => {
      calls.push({ url, cookie: headers.cookie ?? '' });
      attempt += 1;
      if (attempt === 1) {
        const error = new Error('Inventory request failed (400)');
        error.statusCode = 400;
        throw error;
      }

      return {
        success: 1,
        more_items: false,
        descriptions: [
          {
            classid: '99',
            instanceid: '0',
            market_hash_name: 'Charm | Retry Test',
            market_name: 'Charm | Retry Test',
            name: 'Charm | Retry Test',
            icon_url: 'retry_hash',
            tags: [],
          },
        ],
        assets: [{ assetid: '999', classid: '99', instanceid: '0' }],
      };
    },
  });

  assert.ok(calls.length >= 2);
  assert.equal(descriptions.get('999').marketHashName, 'Charm | Retry Test');
});
