const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { error: 'Too many login attempts, please try again in a minute' },
});

// GET /api/auth/status
router.get('/status', (req, res) => {
  const client = req.app.locals.steamClient;
  res.json({
    loggedIn: client.isLoggedIn,
    connectedToGC: client.isConnectedToGC,
    steamId: client.steamId,
    username: client.username,
  });
});

// POST /api/auth/login  (credentials)
router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'username and password are required' });
    }
    const client = req.app.locals.steamClient;
    const result = await client.startCredentialLogin(username, password);
    if (result.requiresGuard) {
      return res.status(202).json(result);
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/steam-guard
router.post('/steam-guard', async (req, res, next) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: 'code is required' });
    const client = req.app.locals.steamClient;
    const result = await client.submitGuardCode(code);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/qr  — start QR login, returns QR image data URL
router.post('/qr', loginLimiter, async (req, res, next) => {
  try {
    const client = req.app.locals.steamClient;
    const result = await client.startQRLogin();
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/qr/status  — poll for QR auth progress
router.get('/qr/status', (req, res) => {
  const client = req.app.locals.steamClient;
  res.json(client.getQRStatus());
});

// POST /api/auth/token  — browser token login
router.post('/token', loginLimiter, async (req, res, next) => {
  try {
    const { token, steamId, accountName } = req.body;
    if (!token || !steamId || !accountName) {
      return res.status(400).json({ error: 'token, steamId and accountName are required' });
    }
    const client = req.app.locals.steamClient;
    const result = await client.startTokenLogin(token, steamId, accountName);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  req.app.locals.steamClient.logout();
  res.json({ success: true });
});

module.exports = router;
