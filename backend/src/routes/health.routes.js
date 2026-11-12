'use strict';

/**
 * src/routes/health.routes.js
 * GET /health — liveness probe.
 * Never exposes secrets, database credentials or internal config.
 */

const { Router } = require('express');

const router = Router();

router.get('/', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'offercheck-api',
    env: process.env.NODE_ENV || 'unknown',
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;

