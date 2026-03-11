function collectMissingMarketHashNames(items) {
  const hashNames = new Set();

  for (const item of items ?? []) {
    if (!item.itemUrl && item.marketHashName) {
      hashNames.add(item.marketHashName);
    }

    for (const sticker of item.stickers ?? []) {
      if (sticker.itemUrl || !sticker.localizedName) {
        continue;
      }

      hashNames.add(toStickerHashName(sticker.localizedName));
    }

    for (const keychain of item.keychains ?? []) {
      if (keychain.itemUrl || !keychain.localizedName) {
        continue;
      }

      hashNames.add(toCharmHashName(keychain.localizedName));
    }
  }

  return [...hashNames];
}

function applyMarketDescriptions(items, marketDescriptionsByHash) {
  for (const item of items ?? []) {
    if (!item.itemUrl && item.marketHashName) {
      const fallback = marketDescriptionsByHash.get(item.marketHashName) ?? null;
      if (fallback?.itemUrl) {
        item.itemUrl = fallback.itemUrl;
        item.imageUrl = fallback.itemUrl;
      }
      if (!item.rarityName && fallback?.rarityName) {
        item.rarityName = fallback.rarityName;
        item.rarity = fallback.rarityName;
      }
      if (!item.rarityColor && fallback?.rarityColor) {
        item.rarityColor = fallback.rarityColor;
      }
    }

    for (const sticker of item.stickers ?? []) {
      if (sticker.itemUrl || !sticker.localizedName) {
        continue;
      }

      const fallback = marketDescriptionsByHash.get(toStickerHashName(sticker.localizedName)) ?? null;
      if (fallback?.itemUrl) {
        sticker.itemUrl = fallback.itemUrl;
      }
      if (!sticker.rarityName && fallback?.rarityName) {
        sticker.rarityName = fallback.rarityName;
      }
      if (!sticker.rarityColor && fallback?.rarityColor) {
        sticker.rarityColor = fallback.rarityColor;
      }
    }

    for (const keychain of item.keychains ?? []) {
      if (keychain.itemUrl || !keychain.localizedName) {
        continue;
      }

      const fallback = marketDescriptionsByHash.get(toCharmHashName(keychain.localizedName)) ?? null;
      if (fallback?.itemUrl) {
        keychain.itemUrl = fallback.itemUrl;
      }
      if (!keychain.rarityName && fallback?.rarityName) {
        keychain.rarityName = fallback.rarityName;
      }
      if (!keychain.rarityColor && fallback?.rarityColor) {
        keychain.rarityColor = fallback.rarityColor;
      }
    }
  }

  return items;
}

function toStickerHashName(localizedName) {
  if (localizedName.startsWith('Sticker | ')) {
    return localizedName;
  }

  return `Sticker | ${localizedName}`;
}

function toCharmHashName(localizedName) {
  if (localizedName.startsWith('Charm | ')) {
    return localizedName;
  }

  return `Charm | ${localizedName}`;
}

module.exports = {
  applyMarketDescriptions,
  collectMissingMarketHashNames,
  toCharmHashName,
  toStickerHashName,
};
