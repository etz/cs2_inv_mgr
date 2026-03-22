const express = require('express');
const requireAuth = require('../middleware/requireAuth');
const {
  getArmoryState,
  redeemItem,
  redeemMissionReward,
  getCollections,
} = require('../steam/armory');

const router = express.Router();

router.use(requireAuth);

router.get('/state', async (req, res, next) => {
  try {
    const data = await getArmoryState(req.app.locals.steamClient);
    res.json(data);
  } catch (error) {
    next(error);
  }
});

router.get('/collections', async (req, res, next) => {
  try {
    const force = String(req.query.force ?? '').toLowerCase() === 'true';
    const data = await getCollections({ force });
    res.json(data);
  } catch (error) {
    next(error);
  }
});

router.post('/redeem', async (req, res, next) => {
  try {
    const result = await redeemItem(req.app.locals.steamClient, req.body ?? {});
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post('/redeem-mission', async (req, res, next) => {
  try {
    const result = await redeemMissionReward(req.app.locals.steamClient, req.body ?? {});
    res.json(result);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
