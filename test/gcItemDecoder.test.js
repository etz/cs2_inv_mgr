const test = require('node:test');
const assert = require('node:assert/strict');

const { ATTRIBUTE_IDS, decodeGcItemAttributes } = require('../src/utils/gcItemDecoder');

test('decodeGcItemAttributes keeps standalone source null when no standalone keychain id exists', () => {
  const decoded = decodeGcItemAttributes({
    attribute: [],
  });

  assert.equal(decoded.standaloneKeychainId, null);
  assert.equal(decoded.standaloneSourceAttribute, null);
});

test('decodeGcItemAttributes prioritizes attribute 321 over 322 for standalone source', () => {
  const decoded = decodeGcItemAttributes({
    attribute: [
      { def_index: ATTRIBUTE_IDS.STANDALONE_KEYCHAIN_ID, value: 18 },
      { def_index: ATTRIBUTE_IDS.DISPLAY_CASE_KEYCHAIN_ID, value: 42 },
    ],
  });

  assert.equal(decoded.standaloneKeychainId, 18);
  assert.equal(decoded.standaloneSourceAttribute, ATTRIBUTE_IDS.STANDALONE_KEYCHAIN_ID);
});
