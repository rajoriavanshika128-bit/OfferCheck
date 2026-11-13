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
const { errorHandler } = require('./utils/errors');

const app = express();

// ─── Security middleware ──────────────────────────────────────────────────────
app.use(helmet());                // sets secure HTTP headers

app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173', // Vite dev server
  credentials: true,
}));

// ─── Body parsing ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: '50kb' }));      // reject oversized payloads
app.use(express.urlencoded({ extended: false, limit: '50kb' }));

// ─── Routes ──────────────────────────────────────────────────────────────────
app.use('/health', healthRouter);
app.use('/api/auth', authRouter);

// 404 handler for unmatched routes
app.use((_req, res) => {
  res.status(404).json({ success: false, error: 'Route not found' });
});

// ─── Centralised error handler (must be last) ─────────────────────────────────
app.use(errorHandler);

module.exports = app;

