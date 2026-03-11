const schema = require('../data/cs2-schema.json');
const { createSchemaResolver, STORAGE_UNIT_DEF_INDEX } = require('../schema/resolver');

const resolver = createSchemaResolver(schema);

function formatItem(gcItem, options = {}) {
  return resolver.formatItem(gcItem, options);
}

function formatStorageUnit(gcItem, options = {}) {
  return resolver.formatStorageUnit(gcItem, options);
}

module.exports = {
  formatItem,
  formatStorageUnit,
  STORAGE_UNIT_DEF_INDEX,
};
