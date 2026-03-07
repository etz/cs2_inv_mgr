const express = require('express');
const router = express.Router();
const requireAuth = require('../middleware/requireAuth');
const { getInventory } = require('../steam/inventory');

// GET /api/inventory
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const data = await getInventory(req.app.locals.steamClient);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
