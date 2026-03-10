const schema = require('../data/cs2-schema.json');
const { createSchemaResolver, STORAGE_UNIT_DEF_INDEX } = require('../schema/resolver');

const resolver = createSchemaResolver(schema);

function formatItem(gcItem, inventoryById) {
  return resolver.formatItem(gcItem, { inventoryById });
}

function formatStorageUnit(gcItem, inventoryById) {
  return resolver.formatStorageUnit(gcItem, { inventoryById });
}

module.exports = {
  formatItem,
  formatStorageUnit,
  STORAGE_UNIT_DEF_INDEX,
};
