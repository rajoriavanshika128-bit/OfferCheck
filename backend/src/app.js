'use strict';

/**
 * src/app.js
 * Express application setup: middleware, routes, error handler.
 * Keeps configuration separate from server startup (src/server.js).
 */

const express = require('express');
const cors    = require('cors');
const helmet  = require('helmet');

const healthRouter = require('./routes/health.routes');
const authRouter = require('./routes/auth.routes');
const reportRouter = require('./routes/report.routes');
const checkRouter = require('./routes/check.routes');
const adminRouter = require('./routes/admin.routes');
const { errorHandler } = require('./utils/errors');
const { resolveCorsOrigin } = require('./utils/cors');

const app = express();

// Trust the first reverse-proxy hop strictly in production (e.g. Render Web Service).
// In development/test, keep proxy trust disabled so clients cannot spoof X-Forwarded-For.
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

// Seamless client IP fallback for in-memory stream dispatch test harnesses (where req.socket is undefined)
app.use((req, _res, next) => {
  if (!req.socket) {
    const forwarded = req.headers['x-forwarded-for'];
    const ip = forwarded ? String(forwarded).split(',')[0].trim() : '127.0.0.1';
    Object.defineProperty(req, 'ip', { value: ip, configurable: true });
  }
  next();
});

// ─── Security middleware ──────────────────────────────────────────────────────
app.use(helmet());                // sets secure HTTP headers

app.use(cors({
  origin: resolveCorsOrigin(),
  credentials: true,
}));

// ─── Body parsing ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: '50kb' }));      // reject oversized payloads
app.use(express.urlencoded({ extended: false, limit: '50kb' }));

// ─── Routes ──────────────────────────────────────────────────────────────────
app.use('/health', healthRouter);
app.use('/api/auth', authRouter);
app.use('/api/reports', reportRouter);
app.use('/api/checks', checkRouter);
app.use('/api/admin', adminRouter);

// 404 handler for unmatched routes
app.use((_req, res) => {
  res.status(404).json({ success: false, error: 'Route not found' });
});

// ─── Centralised error handler (must be last) ─────────────────────────────────
app.use(errorHandler);

module.exports = app;

