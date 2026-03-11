const test = require('node:test');
const assert = require('node:assert/strict');

const {
  applyMarketDescriptions,
  collectMissingMarketHashNames,
} = require('../src/steam/marketFallback');

test('collectMissingMarketHashNames gathers item, sticker, and charm hashes', () => {
  const items = [
    {
      marketHashName: 'Falchion Case',
      itemUrl: null,
      stickers: [{ localizedName: 'Sticker Test', itemUrl: null }],
      keychains: [{ localizedName: 'Disco MAC', itemUrl: null }],
    },
  ];

  const hashes = collectMissingMarketHashNames(items);
  assert.deepEqual(hashes.sort(), [
    'Charm | Disco MAC',
    'Falchion Case',
    'Sticker | Sticker Test',
  ]);
});

test('applyMarketDescriptions fills missing urls from market descriptions', () => {
  const items = [
    {
      marketHashName: 'Falchion Case',
      itemUrl: null,
      imageUrl: null,
      stickers: [{ localizedName: 'Sticker Test', itemUrl: null }],
      keychains: [{ localizedName: 'Disco MAC', itemUrl: null }],
    },
  ];
  const marketDescriptionsByHash = new Map([
    ['Falchion Case', { itemUrl: 'https://example.com/case.png' }],
    ['Sticker | Sticker Test', { itemUrl: 'https://example.com/sticker.png' }],
    ['Charm | Disco MAC', { itemUrl: 'https://example.com/charm.png' }],
  ]);

  applyMarketDescriptions(items, marketDescriptionsByHash);
  assert.equal(items[0].itemUrl, 'https://example.com/case.png');
  assert.equal(items[0].imageUrl, 'https://example.com/case.png');
  assert.equal(items[0].stickers[0].itemUrl, 'https://example.com/sticker.png');
  assert.equal(items[0].keychains[0].itemUrl, 'https://example.com/charm.png');
});
