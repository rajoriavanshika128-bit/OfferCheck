'use strict';

/**
 * src/middleware/rateLimiter.js
 * Rate-limiting middleware for sensitive OfferCheck endpoints.
 *
 * PROTECTS:
 * - POST /api/auth/login: max 5 attempts per 15 minutes per IP.
 * - POST /api/auth/signup: max 3 attempts per hour per IP.
 * - POST /api/checks: max 30 attempts per 15 minutes per authenticated user (falls back to IP).
 *
 * ARCHITECTURAL NOTES & IN-MEMORY LIMITATIONS:
 * express-rate-limit uses an in-memory store (MemoryStore) by default.
 * - Single persistent Render Web Service: MemoryStore provides effective, zero-dependency protection.
 * - Multi-instance / Horizontal Scaling: If OfferCheck scales horizontally across multiple Render instances,
 *   hit counters are isolated per process and not synchronized across instances.
 * - Restarts: Counters reset when the server restarts or redeploys.
 * - Scale-Out Path: When horizontal autoscaling is enabled in future phases, replace MemoryStore
 *   with a shared Redis store (e.g., rate-limit-redis) without changing the route definitions.
 */

const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

/**
 * Test bypass guard:
 * Only allows bypass when explicitly in test environment AND DISABLE_RATE_LIMITING === 'true'.
 * In production and development, this always returns false.
 */
function shouldSkip(_req) {
  return process.env.NODE_ENV === 'test' && process.env.DISABLE_RATE_LIMITING === 'true';
}

/**
 * Standardized JSON response handler for rate limit violations.
 */
function rateLimitResponseHandler(req, res, _next, options) {
  return res.status(options.statusCode).json({
    success: false,
    error: options.message,
  });
}

/**
 * Helper to construct rate limiters with unified OfferCheck defaults.
 */
function createLimiter(options = {}) {
  return rateLimit({
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: rateLimitResponseHandler,
    skip: shouldSkip,
    ...options,
  });
}

/**
 * 1. Login Rate Limiter:
 * Maximum 5 attempts per 15 minutes per IP address.
 */
const loginLimiter = createLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  message: 'Too many login attempts from this IP. Please try again after 15 minutes.',
});

/**
 * 2. Signup Rate Limiter:
 * Maximum 3 account creations per hour per IP address.
 */
const signupLimiter = createLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3,
  message: 'Too many accounts created from this IP. Please try again after an hour.',
});

/**
 * 3. Offer Check Flooding Limiter:
 * Maximum 30 checks per 15 minutes per authenticated user (falls back to IP).
 */
const checkLimiter = createLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30,
  keyGenerator: (req) => {
    // Prefer authenticated user ID for accurate per-student quotas across shared campus IPs
    if (req.user && req.user.id) {
      return `user_${req.user.id}`;
    }
    return ipKeyGenerator(req);
  },
  message: 'Too many offer checks submitted. Please try again after 15 minutes.',
});

/**
 * 4. Public Trust Graph & Stats Limiter:
 * Maximum 60 requests per 15 minutes per IP address.
 */
const graphLimiter = createLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 60,
  message: 'Too many graph queries requested from this IP. Please try again after 15 minutes.',
});

module.exports = {
  createLimiter,
  loginLimiter,
  signupLimiter,
  checkLimiter,
  graphLimiter,
};
