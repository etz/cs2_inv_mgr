const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { buildSchema, parseCdn } = require('../src/schema/generator');
const { createSchemaResolver, STORAGE_UNIT_DEF_INDEX } = require('../src/schema/resolver');

const ITEMS_GAME_FIXTURE = `
"items_game"
{
  "qualities"
  {
    "normal" { "value" "0" }
    "strange" { "value" "9" }
    "tournament" { "value" "12" }
  }
  "colors"
  {
    "desc_common" { "hex_color" "#5e98d9" }
    "desc_rare" { "hex_color" "#eb4b4b" }
  }
  "rarities"
  {
    "common"
    {
      "value" "2"
      "loc_key" "#Rarity_Common"
      "loc_key_weapon" "#Rarity_Common_Weapon"
      "color" "desc_common"
    }
    "rare"
    {
      "value" "5"
      "loc_key" "#Rarity_Rare"
      "loc_key_weapon" "#Rarity_Rare_Weapon"
      "color" "desc_rare"
    }
  }
  "prefabs"
  {
    "secondary"
    {
      "item_type_name" "#CSGO_Type_Pistol"
    }
    "weapon_test_prefab"
    {
      "prefab" "secondary"
      "item_name" "#SFUI_WPNHUD_Test"
      "item_rarity" "common"
      "image_inventory" "econ/weapons/base_weapons/weapon_test"
      "paint_data"
      {
        "PaintableMaterial0"
        {
          "Name" "weapon_test"
        }
      }
    }
    "csgo_tool"
    {
      "item_type_name" "#Type_Tool"
      "item_name" "#Tool_Name"
    }
  }
  "items"
  {
    "1"
    {
      "name" "weapon_test"
      "prefab" "weapon_test_prefab"
      "item_quality" "normal"
    }
    "1201"
    {
      "name" "casket"
      "prefab" "valve csgo_tool"
      "item_name" "#CSGO_Tool_Casket_Tag"
      "image_inventory" "econ/tools/casket"
    }
  }
  "paint_kits"
  {
    "44"
    {
      "name" "paint_red"
      "description_tag" "#Paint_Red"
      "wear_remap_min" "0.00"
      "wear_remap_max" "0.70"
    }
  }
  "paint_kits_rarity"
  {
    "paint_red" "rare"
  }
  "sticker_kits"
  {
    "228"
    {
      "name" "test_sticker"
      "item_name" "#Sticker_Test"
      "image_inventory" "econ/stickers/test_sticker"
    }
  }
}
`;

const ENGLISH_FIXTURE = `
"lang"
{
  "Tokens"
  {
    "normal" "Normal"
    "strange" "StatTrak™"
    "tournament" "Souvenir"
    "Rarity_Common" "Base Grade"
    "Rarity_Common_Weapon" "Industrial Grade"
    "Rarity_Rare" "Exotic"
    "Rarity_Rare_Weapon" "Covert"
    "CSGO_Type_Pistol" "Pistol"
    "Type_Tool" "Tool"
    "SFUI_WPNHUD_Test" "Test Pistol"
    "Tool_Name" "Tool"
    "CSGO_Tool_Casket_Tag" "Storage Unit"
    "Paint_Red" "Crimson Web"
    "Sticker_Test" "Test Sticker"
  }
}
`;

const CDN_FIXTURE = `
# comment
weapon_test=http://example.com/base.png
weapon_test_paint_red=http://example.com/paint.png
test_sticker=http://example.com/sticker.png
`;

test('parseCdn normalizes URLs and ignores comments', () => {
  const parsed = parseCdn(CDN_FIXTURE);
  assert.equal(parsed.weapon_test, 'https://example.com/base.png');
  assert.equal(parsed.weapon_test_paint_red, 'https://example.com/paint.png');
  assert.equal(Object.keys(parsed).length, 3);
});

test('buildSchema resolves localized definitions, variants, and stickers', () => {
  const schema = buildSchema({
    itemsGameText: ITEMS_GAME_FIXTURE,
    csgoEnglishText: ENGLISH_FIXTURE,
    itemsCdnText: CDN_FIXTURE,
  });

  assert.equal(schema.definitionsByDefIndex['1'].localizedName, 'Test Pistol');
  assert.equal(schema.definitionsByDefIndex['1'].itemUrl, 'https://example.com/base.png');
  assert.equal(schema.definitionsByDefIndex['1'].category, 'Pistol');
  assert.equal(schema.variantsByKey['[44]1'].localizedName, 'Test Pistol | Crimson Web');
  assert.equal(schema.variantsByKey['[44]1'].itemUrl, 'https://example.com/paint.png');
  assert.equal(schema.stickerKitsById['228'].localizedName, 'Test Sticker');
  assert.equal(schema.stickerKitsById['228'].itemUrl, 'https://example.com/sticker.png');
});

test('resolver returns enriched API shape with compatibility aliases', () => {
  const schema = buildSchema({
    itemsGameText: ITEMS_GAME_FIXTURE,
    csgoEnglishText: ENGLISH_FIXTURE,
    itemsCdnText: CDN_FIXTURE,
  });
  const resolver = createSchemaResolver(schema);
  const inventoryById = new Map([
    ['9001', { id: '9001', def_index: STORAGE_UNIT_DEF_INDEX, custom_name: 'Main SU' }],
  ]);

  const item = resolver.formatItem({
    id: '123',
    def_index: 1,
    paint_index: 44,
    quality: 9,
    rarity: 5,
    paint_wear: 0.2,
    paint_seed: 777,
    kill_eater_value: 12,
    casket_id: '9001',
    stickers: [{ slot: 0, sticker_id: 228, wear: 0.1 }],
    equipped_state: [{ new_class: 2 }, { new_class: 3 }],
  }, { inventoryById });

  assert.equal(item.marketHashName, 'StatTrak™ Test Pistol | Crimson Web (Field-Tested)');
  assert.equal(item.localizedName, 'Test Pistol | Crimson Web');
  assert.equal(item.itemUrl, 'https://example.com/paint.png');
  assert.equal(item.name, item.marketHashName);
  assert.equal(item.imageUrl, item.itemUrl);
  assert.equal(item.rarityName, 'Covert');
  assert.equal(item.localizedQuality, 'StatTrak™');
  assert.equal(item.itemWearName, 'field_tested');
  assert.equal(item.itemWearNameLocalized, 'Field-Tested');
  assert.equal(item.isEquippedT, true);
  assert.equal(item.isEquippedCT, true);
  assert.equal(item.hasStickers, true);
  assert.equal(item.stickerId, 228);
  assert.equal(item.casketName, 'Main SU');
  assert.equal(item.isTradeUp, false);
  assert.equal(item.isMoveable, true);
  assert.equal(item.isOnMarket, null);
  assert.equal(item.hasKeychain, null);
  assert.equal(item.highlightReelLink, null);
  assert.equal(item.stickers[0].localizedName, 'Test Sticker');
});

test('resolver formats storage units with counts', () => {
  const schema = buildSchema({
    itemsGameText: ITEMS_GAME_FIXTURE,
    csgoEnglishText: ENGLISH_FIXTURE,
    itemsCdnText: CDN_FIXTURE,
  });
  const resolver = createSchemaResolver(schema);

  const storageUnit = resolver.formatStorageUnit({
    id: '9001',
    def_index: STORAGE_UNIT_DEF_INDEX,
    custom_name: 'Archive Box',
    casket_contained_item_count: 7,
  });

  assert.equal(storageUnit.name, 'Archive Box');
  assert.equal(storageUnit.itemCount, 7);
  assert.equal(storageUnit.maxItems, 1000);
  assert.equal(storageUnit.isMoveable, false);
});

test('committed schema snapshot exists', () => {
  const snapshotPath = path.join(__dirname, '..', 'src', 'data', 'cs2-schema.json');
  assert.equal(fs.existsSync(snapshotPath), true);
});
