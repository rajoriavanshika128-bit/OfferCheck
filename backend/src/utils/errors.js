'use strict';

/**
 * src/utils/errors.js
 * Centralised error types and Express error-handler middleware.
 */

class AppError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true; // distinguishes expected errors from bugs
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Express error-handler middleware (must be registered last in app.js).
 * Never exposes stack traces or internal details in production.
 */
function errorHandler(err, req, res, _next) {
  // Zod validation errors
  if (err.name === 'ZodError') {
    const issues = err.issues || err.errors || [];
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: issues.map(e => ({ field: e.path ? e.path.join('.') : '', message: e.message })),
    });
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({ success: false, error: 'Invalid token' });
  }
  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({ success: false, error: 'Token expired' });
  }

  // Known operational errors (thrown via AppError)
  if (err.isOperational) {
    return res.status(err.statusCode).json({ success: false, error: err.message });
  }

  // Unknown / programmer errors — log internally, return generic message
  console.error('[ERROR]', err);
  return res.status(500).json({
    success: false,
    error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
  });
}

module.exports = { AppError, errorHandler };

