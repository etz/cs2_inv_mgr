function errorHandler(err, req, res, next) {
  console.error(`[${req.method} ${req.path}]`, err.message);

  // Steam eresult errors
  if (err.eresult !== undefined) {
    const messages = {
      5: 'Invalid password',
      17: 'Account not found',
      65: 'Invalid Steam Guard code',
      84: 'Rate limited — try again later',
      88: 'Two-factor code mismatch',
    };
    return res.status(401).json({
      error: messages[err.eresult] || `Steam error (code ${err.eresult})`,
      eresult: err.eresult,
    });
  }

  if (err.message?.toLowerCase().includes('timeout')) {
    return res.status(504).json({ error: err.message });
  }

  if (err.message?.includes('full')) {
    return res.status(409).json({ error: err.message });
  }

  res.status(500).json({ error: err.message || 'Internal server error' });
}

module.exports = errorHandler;
