function requireAuth(req, res, next) {
  const client = req.app.locals.steamClient;
  if (!client || !client.isLoggedIn || !client.isConnectedToGC) {
    return res.status(401).json({
      error: 'Not connected to CS2 Game Coordinator',
      loggedIn: client?.isLoggedIn ?? false,
      connectedToGC: client?.isConnectedToGC ?? false,
    });
  }
  next();
}

module.exports = requireAuth;
