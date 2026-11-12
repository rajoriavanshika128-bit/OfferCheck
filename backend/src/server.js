'use strict';

/**
 * src/server.js
 * Entry point: loads env, starts the HTTP server.
 * Application logic lives in app.js — this file only calls listen().
 */

// Load environment variables from root .env (or backend/.env fallback)
const path = require('path');
const fs = require('fs');
const rootEnv = path.resolve(__dirname, '../../.env');
const backendEnv = path.resolve(__dirname, '../.env');
const envPath = fs.existsSync(rootEnv) ? rootEnv : backendEnv;
require('dotenv').config({ path: envPath });

// Validate required env vars before starting — fail fast, never log values
const REQUIRED = ['DATABASE_URL', 'IP_HASH_SECRET', 'JWT_SECRET', 'JWT_REFRESH_SECRET'];
const missing = REQUIRED.filter(k => !process.env[k]);
if (missing.length > 0) {
  console.error('[FATAL] Missing required environment variables:', missing.join(', '));
  process.exit(1);
}

const app  = require('./app');
const PORT = parseInt(process.env.PORT, 10) || 3000;

const server = app.listen(PORT, () => {
  console.log(`[offercheck-api] running on port ${PORT} (${process.env.NODE_ENV || 'development'})`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[offercheck-api] SIGTERM received — shutting down gracefully');
  server.close(() => process.exit(0));
});
process.on('SIGINT', () => {
  server.close(() => process.exit(0));
});

