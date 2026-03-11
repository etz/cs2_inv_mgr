const ATTRIBUTE_IDS = {
  IS_RENTAL: 297,
  KEYCHAIN_ID: 299,
  KEYCHAIN_OFFSET_X: 300,
  KEYCHAIN_OFFSET_Y: 301,
  KEYCHAIN_OFFSET_Z: 302,
  KEYCHAIN_SEED: 306,
  TRADE_PROTECTED_ESCROW_DATE: 312,
  KEYCHAIN_HIGHLIGHT: 314,
  STANDALONE_KEYCHAIN_ID: 321,
  DISPLAY_CASE_KEYCHAIN_ID: 322,
};

function decodeGcItemAttributes(gcItem) {
  const attachedKeychains = [];
  const attachedKeychainId = readUInt32(gcItem, ATTRIBUTE_IDS.KEYCHAIN_ID);
  if (attachedKeychainId != null) {
    attachedKeychains.push({
      slot: 0,
      keychainId: attachedKeychainId,
      seed: readUInt32(gcItem, ATTRIBUTE_IDS.KEYCHAIN_SEED),
      offsetX: readFloat(gcItem, ATTRIBUTE_IDS.KEYCHAIN_OFFSET_X),
      offsetY: readFloat(gcItem, ATTRIBUTE_IDS.KEYCHAIN_OFFSET_Y),
      offsetZ: readFloat(gcItem, ATTRIBUTE_IDS.KEYCHAIN_OFFSET_Z),
      highlightReel: readUInt32(gcItem, ATTRIBUTE_IDS.KEYCHAIN_HIGHLIGHT),
    });
  }

  const standaloneFrom321 = readUInt32(gcItem, ATTRIBUTE_IDS.STANDALONE_KEYCHAIN_ID);
  const standaloneFrom322 = readUInt32(gcItem, ATTRIBUTE_IDS.DISPLAY_CASE_KEYCHAIN_ID);
  const standaloneKeychainId = standaloneFrom321 ?? standaloneFrom322;
  const standaloneSourceAttribute = standaloneFrom321 != null
    ? ATTRIBUTE_IDS.STANDALONE_KEYCHAIN_ID
    : standaloneFrom322 != null
      ? ATTRIBUTE_IDS.DISPLAY_CASE_KEYCHAIN_ID
      : null;

  const isRentalValue = readUInt32(gcItem, ATTRIBUTE_IDS.IS_RENTAL);
  const escrowDate = readUnixDate(gcItem, ATTRIBUTE_IDS.TRADE_PROTECTED_ESCROW_DATE);

  return {
    attachedKeychains,
    standaloneKeychainId,
    standaloneKeychainSeed: readUInt32(gcItem, ATTRIBUTE_IDS.KEYCHAIN_SEED),
    standaloneHighlightReel: readUInt32(gcItem, ATTRIBUTE_IDS.KEYCHAIN_HIGHLIGHT),
    standaloneSourceAttribute,
    isRental: isRentalValue == null ? null : isRentalValue > 0,
    escrowTime: escrowDate ? escrowDate.toISOString() : null,
  };
}

function readAttributeEntry(gcItem, attributeId) {
  return (gcItem.attribute ?? []).find((entry) => Number(entry.def_index) === Number(attributeId)) ?? null;
}

function readAttributeBytes(gcItem, attributeId) {
  const attribute = readAttributeEntry(gcItem, attributeId);
  if (!attribute?.value_bytes) {
    return null;
  }

  if (Buffer.isBuffer(attribute.value_bytes)) {
    return attribute.value_bytes;
  }

  return Buffer.from(attribute.value_bytes);
}

function readUInt32(gcItem, attributeId) {
  const bytes = readAttributeBytes(gcItem, attributeId);
  if (bytes && bytes.length >= 4) {
    return bytes.readUInt32LE(0);
  }

  const attribute = readAttributeEntry(gcItem, attributeId);
  if (attribute?.value == null) {
    return null;
  }

  const numeric = Number(attribute.value);
  if (!Number.isFinite(numeric)) {
    return null;
  }

  return Math.round(numeric) >>> 0;
}

function readFloat(gcItem, attributeId) {
  const bytes = readAttributeBytes(gcItem, attributeId);
  if (bytes && bytes.length >= 4) {
    return Number(bytes.readFloatLE(0).toFixed(6));
  }

  const attribute = readAttributeEntry(gcItem, attributeId);
  if (attribute?.value == null) {
    return null;
  }

  const numeric = Number(attribute.value);
  if (!Number.isFinite(numeric)) {
    return null;
  }

  return Number(numeric.toFixed(6));
}

function readUnixDate(gcItem, attributeId) {
  const seconds = readUInt32(gcItem, attributeId);
  if (seconds == null || seconds === 0) {
    return null;
  }

  return new Date(seconds * 1000);
}

module.exports = {
  ATTRIBUTE_IDS,
  decodeGcItemAttributes,
};
