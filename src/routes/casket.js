const express = require('express');
const router = express.Router();
const requireAuth = require('../middleware/requireAuth');
const { getCasketContents, addItemToCasket, removeItemFromCasket } = require('../steam/casket');

router.use(requireAuth);

// GET /api/caskets/:casketId/contents
router.get('/:casketId/contents', async (req, res, next) => {
  try {
    const items = await getCasketContents(req.app.locals.steamClient, req.params.casketId);
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

// POST /api/caskets/:casketId/add
router.post('/:casketId/add', async (req, res, next) => {
  try {
    const { itemId } = req.body;
    if (!itemId) return res.status(400).json({ error: 'itemId is required' });
    const result = await addItemToCasket(
      req.app.locals.steamClient.csgo,
      req.params.casketId,
      itemId
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST /api/caskets/:casketId/remove
router.post('/:casketId/remove', async (req, res, next) => {
  try {
    const { itemId } = req.body;
    if (!itemId) return res.status(400).json({ error: 'itemId is required' });
    const result = await removeItemFromCasket(
      req.app.locals.steamClient.csgo,
      req.params.casketId,
      itemId
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
