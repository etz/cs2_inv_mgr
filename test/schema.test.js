const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { buildSchema, parseCdn } = require('../src/schema/generator');
const { createSchemaResolver, STORAGE_UNIT_DEF_INDEX } = require('../src/schema/resolver');
const {
  buildEconomyImageUrl,
  buildKeychainDescriptionByName,
  buildStickerDescriptionByName,
} = require('../src/steam/assetDescriptions');

const ITEMS_GAME_FIXTURE = `
"items_game"
{
  "qualities"
  {
    "normal" { "value" "0" }
    "unique" { "value" "4" }
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
  "attributes"
  {
    "297"
    {
      "name" "is rental"
      "attribute_class" "is_rental"
      "stored_as_integer" "1"
    }
    "299"
    {
      "name" "keychain slot 0 id"
      "attribute_class" "keychain_slot_id"
      "stored_as_integer" "1"
    }
    "300"
    {
      "name" "keychain slot 0 offset x"
      "attribute_class" "keychain_slot_offset"
      "stored_as_integer" "0"
    }
    "301"
    {
      "name" "keychain slot 0 offset y"
      "attribute_class" "keychain_slot_offset"
      "stored_as_integer" "0"
    }
    "302"
    {
      "name" "keychain slot 0 offset z"
      "attribute_class" "keychain_slot_offset"
      "stored_as_integer" "0"
    }
    "306"
    {
      "name" "keychain slot 0 seed"
      "attribute_class" "keychain_slot_seed"
      "description_string" "#Attrib_KeychainSeed"
      "stored_as_integer" "1"
    }
    "312"
    {
      "name" "trade protected escrow date"
      "attribute_class" "trade_protected_escrow_date"
      "stored_as_integer" "1"
    }
    "314"
    {
      "name" "keychain slot 0 highlight"
      "attribute_class" "keychain_slot_highlight"
      "description_string" "#Attrib_HighlightReel"
      "stored_as_integer" "1"
    }
    "321"
    {
      "name" "keychain slot 0 sticker"
      "attribute_class" "keychain_slot_id"
      "stored_as_integer" "1"
    }
    "322"
    {
      "name" "display case keychain id"
      "attribute_class" "keychain_slot_id"
      "stored_as_integer" "1"
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
    "glove_prefab"
    {
      "item_type_name" "#Type_Gloves"
      "item_rarity" "rare"
    }
    "collectible_prefab"
    {
      "item_type_name" "#Type_Collectible"
      "item_rarity" "rare"
    }
    "key_prefab"
    {
      "item_type_name" "#Type_Key"
      "item_rarity" "common"
    }
    "csgo_tool"
    {
      "item_type_name" "#Type_Tool"
      "item_name" "#Tool_Name"
    }
    "weapon_case_base"
    {
      "item_type_name" "#Type_Container"
    }
    "pricing_overlay"
    {
      "item_rarity" "common"
    }
  }
  "keychain_definitions"
  {
    "18"
    {
      "name" "kc_wpn_ak_jelly"
      "loc_name" "#keychain_kc_wpn_ak_jelly"
      "loc_description" "#keychain_kc_wpn_ak_jelly_desc"
      "item_rarity" "rare"
      "item_quality" "unique"
      "image_inventory" "econ/keychains/weapon_1/kc_wpn_ak_jelly"
      "display_seed" "777"
      "keychain_material" "weapon_1/jelly"
      "is commodity" "1"
      "tags"
      {
        "Type"
        {
          "tag_value" "keychain"
        }
      }
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
    "874"
    {
      "name" "Five Year Service Coin"
      "prefab" "collectible_prefab"
      "item_name" "#Coin_Five_Year"
      "image_inventory" "econ/status_icons/5yearcoin"
      "item_quality" "unique"
    }
    "1201"
    {
      "name" "casket"
      "prefab" "valve csgo_tool"
      "item_name" "#CSGO_Tool_Casket_Tag"
      "image_inventory" "econ/tools/casket"
    }
    "1203"
    {
      "name" "Weapon Case Key"
      "prefab" "key_prefab"
      "item_name" "#Weapon_Case_Key"
      "image_inventory" "econ/tools/weapon_case_key"
      "item_quality" "unique"
    }
    "1355"
    {
      "name" "keychain"
      "prefab" "csgo_tool"
      "item_name" "#CSGO_Tool_Keychain"
      "item_type_name" "#CSGO_Tool_Keychain"
      "item_description" "#CSGO_Tool_Keychain_Desc"
    }
    "4000"
    {
      "name" "sticker_display_case"
      "prefab" "csgo_tool"
      "item_name" "#CSGO_Tool_Keychain"
      "item_type_name" "#CSGO_Tool_Keychain"
      "item_description" "#CSGO_Tool_StickerDisplayCase_Desc"
    }
    "5030"
    {
      "name" "sporty_gloves"
      "prefab" "glove_prefab"
      "item_name" "#Sporty_Gloves"
      "item_quality" "unique"
    }
    "6000"
    {
      "name" "volatile_case_test"
      "prefab" "pricing_overlay weapon_case_base"
      "item_name" "#Volatile_Case_Test"
      "item_description" "#Volatile_Case_Test_Desc"
      "loot_list_name" "lootlist_test"
      "inv_container_and_tools" "tool"
      "first_sale_date" "2026/03/01"
      "image_inventory" "econ/weapon_cases/volatile_case_test_closed"
      "image_inventory^volatile" "econ/weapon_cases/volatile_case_test_open"
      "model_player" "models/props/test_case.vmdl"
      "tool"
      {
        "type" "volatile_case_tool"
        "use_string" "#UseItem"
      }
      "capabilities"
      {
        "usable_gc" "1"
      }
      "associated_items"
      {
        "item" "12345"
      }
      "tags"
      {
        "ItemSet"
        {
          "tag_value" "set_test"
        }
      }
      "attributes"
      {
        "set supply crate series"
        {
          "attribute_class" "supply_crate_series"
          "value" "273"
        }
        "can open for rental" "1"
        "volatile container" "1"
      }
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
    "45"
    {
      "name" "paint_blue"
      "description_tag" "#Paint_Blue"
      "wear_remap_min" "0.00"
      "wear_remap_max" "0.70"
    }
    "1001"
    {
      "name" "motorcycle_basic_black"
      "description_tag" "#Paint_Glove_Black"
      "wear_remap_min" "0.06"
      "wear_remap_max" "0.80"
    }
  }
  "paint_kits_rarity"
  {
    "paint_red" "rare"
    "paint_blue" "rare"
    "motorcycle_basic_black" "rare"
  }
  "sticker_kits"
  {
    "228"
    {
      "name" "test_sticker"
      "item_name" "#Sticker_Test"
      "image_inventory" "econ/stickers/test_sticker"
      "sticker_material" "standard/test_sticker"
      "patch_material" "standard/test_patch"
      "tournament_event_id" "99"
      "tournament_team_id" "88"
      "tournament_player_id" "77"
      "item_rarity" "common"
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
    "unique" "Unique"
    "strange" "StatTrak™"
    "tournament" "Souvenir"
    "Rarity_Common" "Base Grade"
    "Rarity_Common_Weapon" "Industrial Grade"
    "Rarity_Rare" "Exotic"
    "Rarity_Rare_Weapon" "Covert"
    "CSGO_Type_Pistol" "Pistol"
    "Type_Gloves" "Gloves"
    "Type_Collectible" "Collectible"
    "Type_Key" "Key"
    "Type_Tool" "Tool"
    "Type_Container" "Container"
    "SFUI_WPNHUD_Test" "Test Pistol"
    "Tool_Name" "Tool"
    "CSGO_Tool_Casket_Tag" "Storage Unit"
    "CSGO_Tool_Keychain" "Charm"
    "CSGO_Tool_Keychain_Desc" "Charm description"
    "CSGO_Tool_StickerDisplayCase_Desc" "Sticker slab description"
    "Paint_Red" "Crimson Web"
    "Paint_Blue" "Blue Laminate"
    "Paint_Glove_Black" "Nocts"
    "Sticker_Test" "Test Sticker"
    "Coin_Five_Year" "5 Year Veteran Coin"
    "Weapon_Case_Key" "CS:GO Case Key"
    "Sporty_Gloves" "Sport Gloves"
    "Volatile_Case_Test" "Sealed Test Terminal"
    "Volatile_Case_Test_Desc" "A volatile test container"
    "keychain_kc_wpn_ak_jelly" "Die-cast AK"
    "keychain_kc_wpn_ak_jelly_desc" "Charm description"
    "Attrib_KeychainSeed" "Charm Template: %s1"
    "Attrib_HighlightReel" "Highlight: %s1"
  }
}
`;

const CDN_FIXTURE = `
# comment
weapon_test=http://example.com/base.png
weapon_test_paint_red=http://example.com/paint.png
sporty_gloves_motorcycle_basic_black=http://example.com/gloves.png
`;

function buildTestSchema() {
  return buildSchema({
    itemsGameText: ITEMS_GAME_FIXTURE,
    csgoEnglishText: ENGLISH_FIXTURE,
    itemsCdnText: CDN_FIXTURE,
  });
}

function uint32Bytes(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value, 0);
  return buffer;
}

function floatBytes(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeFloatLE(value, 0);
  return buffer;
}

test('parseCdn normalizes URLs and ignores comments', () => {
  const parsed = parseCdn(CDN_FIXTURE);
  assert.equal(parsed.weapon_test, 'https://example.com/base.png');
  assert.equal(parsed.weapon_test_paint_red, 'https://example.com/paint.png');
  assert.equal(Object.keys(parsed).length, 3);
});

test('buildSchema resolves paint variants and keeps image_inventory metadata for non-cdn items', () => {
  const schema = buildTestSchema();

  assert.equal(schema.definitionsByDefIndex['1'].localizedName, 'Test Pistol');
  assert.equal(schema.definitionsByDefIndex['1'].itemUrl, 'https://example.com/base.png');
  assert.equal(schema.definitionsByDefIndex['874'].itemUrl, null);
  assert.equal(schema.definitionsByDefIndex['1203'].itemUrl, null);
  assert.equal(schema.imagePathIndex['econ/status_icons/5yearcoin'], 'econ/status_icons/5yearcoin');
  assert.equal(schema.imagePathIndex['econ/tools/weapon_case_key'], 'econ/tools/weapon_case_key');
  assert.equal(schema.definitionsByDefIndex['6000'].localizedName, 'Sealed Test Terminal');
  assert.equal(schema.definitionsByDefIndex['6000'].category, 'Container');
  assert.equal(schema.definitionsByDefIndex['6000'].itemDescription, 'A volatile test container');
  assert.equal(schema.definitionsByDefIndex['6000'].lootListName, 'lootlist_test');
  assert.equal(schema.definitionsByDefIndex['6000'].supplyCrateSeries, 273);
  assert.equal(schema.definitionsByDefIndex['6000'].canOpenForRental, true);
  assert.equal(schema.definitionsByDefIndex['6000'].volatileContainer, true);
  assert.equal(schema.definitionsByDefIndex['6000'].toolType, 'volatile_case_tool');
  assert.equal(schema.definitionsByDefIndex['6000'].itemSetTag, 'set_test');
  assert.equal(schema.definitionsByDefIndex['6000'].image_inventory_volatile, 'econ/weapon_cases/volatile_case_test_open');
  assert.equal(schema.keychainDefinitionsById['18'].localizedName, 'Die-cast AK');
  assert.equal(schema.keychainDefinitionsById['18'].itemUrl, null);
  assert.equal(schema.keychainDefinitionsById['18'].displaySeed, 777);
  assert.equal(schema.keychainDefinitionsById['18'].keychainMaterial, 'weapon_1/jelly');
  assert.equal(schema.keychainDefinitionsById['18'].qualityValue, '4');
  assert.equal(schema.keychainDefinitionsById['18'].isCommodity, true);
  assert.equal(schema.attributeDefsById['306'].attributeClass, 'keychain_slot_seed');
  assert.equal(schema.stickerKitsById['228'].stickerMaterial, 'standard/test_sticker');
  assert.equal(schema.stickerKitsById['228'].patchMaterial, 'standard/test_patch');
  assert.equal(schema.stickerKitsById['228'].tournamentEventId, 99);
  assert.equal(schema.stickerKitsById['228'].tournamentTeamId, 88);
  assert.equal(schema.stickerKitsById['228'].tournamentPlayerId, 77);
  assert.deepEqual(schema.renderKeysByDefIndex['5030'], ['sporty_gloves']);
  assert.equal(schema.variantsByKey['[1001]5030'].localizedName, 'Sport Gloves | Nocts');
  assert.equal(schema.variantsByKey['[1001]5030'].itemUrl, 'https://example.com/gloves.png');
});

test('resolver returns enriched API shape with stickers and attached keychains', () => {
  const schema = buildTestSchema();
  const resolver = createSchemaResolver(schema);
  const assetDescriptionById = new Map([
    ['321', {
      marketHashName: 'Charm | Die-cast AK',
      localizedName: 'Charm | Die-cast AK',
      itemUrl: buildEconomyImageUrl('charm_icon_hash'),
      tags: [{ category_name: 'Rarity', name: 'Covert', color: 'eb4b4b' }],
    }],
    ['322', {
      marketHashName: 'Sticker | Test Sticker',
      localizedName: 'Sticker | Test Sticker',
      itemUrl: buildEconomyImageUrl('sticker_icon_hash'),
      tags: [{ category_name: 'Rarity', name: 'Industrial Grade', color: '5e98d9' }],
    }],
  ]);
  const keychainDescriptionByName = buildKeychainDescriptionByName(assetDescriptionById);
  const stickerDescriptionByName = buildStickerDescriptionByName(assetDescriptionById);
  const inventoryById = new Map([
    ['9001', { id: '9001', def_index: STORAGE_UNIT_DEF_INDEX, custom_name: 'Main SU' }],
  ]);

  const item = resolver.formatItem({
    id: '123',
    def_index: 1,
    quantity: 2,
    level: 5,
    flags: 9,
    in_use: true,
    style: 3,
    custom_desc: 'Test custom description',
    position: 42,
    kill_eater_score_type: 1,
    quest_id: 77,
    inventory: 90001,
    interior_item: { id: '999' },
    paint_index: 44,
    quality: 9,
    rarity: 5,
    paint_wear: 0.2,
    paint_seed: 777,
    kill_eater_value: 12,
    casket_id: '9001',
    stickers: [{ slot: 0, sticker_id: 228, wear: 0.1, tint_id: 5 }],
    equipped_state: [{ new_class: 2 }, { new_class: 3 }],
    attribute: [
      { def_index: 299, value_bytes: uint32Bytes(18) },
      { def_index: 300, value_bytes: floatBytes(0.125) },
      { def_index: 301, value_bytes: floatBytes(-0.25) },
      { def_index: 302, value_bytes: floatBytes(0.375) },
      { def_index: 306, value_bytes: uint32Bytes(93803) },
      { def_index: 314, value_bytes: uint32Bytes(22) },
    ],
  }, {
    inventoryById,
    assetDescriptionById,
    keychainDescriptionByName,
    stickerDescriptionByName,
  });

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
  assert.equal(item.stickers[0].localizedName, 'Test Sticker');
  assert.equal(item.stickers[0].itemUrl, buildEconomyImageUrl('sticker_icon_hash'));
  assert.equal(item.stickers[0].tintId, 5);
  assert.equal(item.stickers[0].tournamentEventId, 99);
  assert.equal(item.stickers[0].patchMaterial, 'standard/test_patch');
  assert.equal(item.hasKeychain, true);
  assert.equal(item.keychainSeed, 93803);
  assert.equal(item.highlightReelLink, 22);
  assert.equal(item.keychains[0].localizedName, 'Die-cast AK');
  assert.equal(item.keychains[0].itemUrl, buildEconomyImageUrl('charm_icon_hash'));
  assert.equal(item.keychains[0].offsetX, 0.125);
  assert.equal(item.keychains[0].offsetY, -0.25);
  assert.equal(item.keychains[0].offsetZ, 0.375);
  assert.equal(item.keychains[0].displaySeed, 777);
  assert.equal(item.keychains[0].keychainMaterial, 'weapon_1/jelly');
  assert.equal(item.keychains[0].qualityValue, '4');
  assert.equal(item.keychains[0].isCommodity, true);
  assert.equal(item.quantity, 2);
  assert.equal(item.level, 5);
  assert.equal(item.flags, 9);
  assert.equal(item.inUse, true);
  assert.equal(item.style, 3);
  assert.equal(item.customDescription, 'Test custom description');
  assert.equal(item.inventoryPosition, 42);
  assert.equal(item.killEaterScoreType, 1);
  assert.equal(item.questId, 77);
  assert.equal(item.itemDetails.inventoryValue, 90001);
  assert.equal(item.itemDetails.interiorItemId, '999');
});

test('resolver resolves standalone charms, escrow, rental, and sticker slab keychain ids', () => {
  const schema = buildTestSchema();
  const resolver = createSchemaResolver(schema);
  const escrowDate = Math.floor(new Date('2026-03-14T07:00:00.000Z').getTime() / 1000);
  const assetDescriptionById = new Map([
    ['321', {
      marketHashName: 'Charm | Die-cast AK',
      localizedName: 'Charm | Die-cast AK',
      itemUrl: buildEconomyImageUrl('charm_icon_hash'),
      tags: [{ category_name: 'Rarity', name: 'Covert', color: 'eb4b4b' }],
    }],
    ['4001', {
      marketHashName: 'Charm | Die-cast AK',
      localizedName: 'Charm | Die-cast AK',
      itemUrl: buildEconomyImageUrl('slab_icon_hash'),
      tags: [{ category_name: 'Rarity', name: 'Covert', color: 'eb4b4b' }],
    }],
  ]);
  const keychainDescriptionByName = buildKeychainDescriptionByName(assetDescriptionById);

  const charm = resolver.formatItem({
    id: '321',
    def_index: 1355,
    quality: 4,
    attribute: [
      { def_index: 321, value: 18 },
      { def_index: 306, value: 93803 },
      { def_index: 312, value: escrowDate },
      { def_index: 297, value: 1 },
    ],
  }, {
    assetDescriptionById,
    keychainDescriptionByName,
  });

  assert.equal(charm.marketHashName, 'Charm | Die-cast AK');
  assert.equal(charm.localizedName, 'Charm | Die-cast AK');
  assert.equal(charm.itemUrl, buildEconomyImageUrl('charm_icon_hash'));
  assert.equal(charm.rarityName, 'Covert');
  assert.equal(charm.escrowTime, '2026-03-14T07:00:00.000Z');
  assert.equal(charm.isRental, true);
  assert.equal(charm.hasKeychain, false);
  assert.equal(charm.keychainSeed, 93803);

  const slab = resolver.formatItem({
    id: '4001',
    def_index: 4000,
    quality: 4,
    attribute: [
      { def_index: 322, value_bytes: uint32Bytes(18) },
    ],
  }, {
    assetDescriptionById,
    keychainDescriptionByName,
  });

  assert.equal(slab.marketHashName, 'Charm | Die-cast AK');
  assert.equal(slab.itemUrl, buildEconomyImageUrl('slab_icon_hash'));
  assert.equal(slab.itemDetails.standaloneKeychainSourceAttribute, 322);
});

test('resolver formats storage units with counts', () => {
  const schema = buildTestSchema();
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

test('resolver builds painted market names even when cdn variant image is missing', () => {
  const schema = buildTestSchema();
  const resolver = createSchemaResolver(schema);

  const item = resolver.formatItem({
    id: '555',
    def_index: 1,
    paint_index: 45,
    quality: 4,
    paint_wear: 0.11,
  });

  assert.equal(item.localizedName, 'Test Pistol | Blue Laminate');
  assert.equal(item.marketHashName, 'Test Pistol | Blue Laminate (Minimal Wear)');
});

test('resolver prefers Steam asset image over base definition image when variant art is missing', () => {
  const schema = buildTestSchema();
  const resolver = createSchemaResolver(schema);
  const assetDescriptionById = new Map([
    ['777', {
      marketHashName: 'Test Pistol | Blue Laminate (Minimal Wear)',
      localizedName: 'Test Pistol | Blue Laminate',
      itemUrl: buildEconomyImageUrl('asset_image_hash'),
      tags: [{ category_name: 'Rarity', name: 'Covert', color: 'eb4b4b' }],
    }],
  ]);

  const item = resolver.formatItem({
    id: '777',
    def_index: 1,
    paint_index: 45,
    quality: 4,
    paint_wear: 0.11,
  }, {
    assetDescriptionById,
  });

  assert.equal(item.itemUrl, buildEconomyImageUrl('asset_image_hash'));
  assert.equal(item.imageUrl, buildEconomyImageUrl('asset_image_hash'));
});

test('resolver exposes preserved definition metadata for container-like items', () => {
  const schema = buildTestSchema();
  const resolver = createSchemaResolver(schema);

  const item = resolver.formatItem({
    id: '600001',
    def_index: 6000,
    quality: 4,
  });

  assert.equal(item.category, 'Container');
  assert.equal(item.definitionMetadata.lootListName, 'lootlist_test');
  assert.equal(item.definitionMetadata.supplyCrateSeries, 273);
  assert.equal(item.definitionMetadata.canOpenForRental, true);
  assert.equal(item.definitionMetadata.volatileContainer, true);
  assert.equal(item.definitionMetadata.toolType, 'volatile_case_tool');
  assert.equal(item.definitionMetadata.imageInventoryVolatile, 'econ/weapon_cases/volatile_case_test_open');
  assert.equal(item.itemDetails.definition.itemSetTag, 'set_test');
});

test('committed schema snapshot exists', () => {
  const snapshotPath = path.join(__dirname, '..', 'src', 'data', 'cs2-schema.json');
  assert.equal(fs.existsSync(snapshotPath), true);
});
