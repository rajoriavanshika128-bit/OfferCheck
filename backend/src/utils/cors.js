'use strict';

/**
 * src/utils/cors.js
 * Centralized CORS origin validation and resolution utilities.
 * Enforces canonical RFC 6454 / W3C origin semantics: scheme "://" host [ ":" port ].
 * Rejects paths, trailing slashes, query strings, fragments, credentials, and invalid schemes.
 */

/**
 * Validates a single canonical origin string.
 * Must match standard origin structure exactly (e.g., https://example.com or http://localhost:5173).
 *
 * @param {string} str - Raw origin string
 * @returns {boolean}
 */
function isSingleCanonicalOrigin(str) {
  if (typeof str !== 'string' || !str.trim()) return false;
  const trimmed = str.trim();
  try {
    const u = new URL(trimmed);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    return u.origin === trimmed;
  } catch {
    return false;
  }
}

/**
 * Validates CORS_ORIGIN value. Supports single canonical origin or comma-separated list of origins.
 *
 * @param {string} val - Raw CORS_ORIGIN string from environment
 * @returns {boolean}
 */
function isValidCorsOrigin(val) {
  if (typeof val !== 'string' || !val.trim()) return false;
  const rawParts = val.split(',');
  if (rawParts.length === 0) return false;
  for (const part of rawParts) {
    const trimmed = part.trim();
    if (!trimmed) return false; // Reject empty entries or trailing/leading commas
    if (!isSingleCanonicalOrigin(trimmed)) return false;
  }
  return true;
}

/**
 * Resolves CORS origins for Express cors() middleware.
 * Ensures consistent behavior between startup validation and runtime handling.
 *
 * @param {string} [originEnv] - Value of process.env.CORS_ORIGIN
 * @param {string} [nodeEnv] - Value of process.env.NODE_ENV
 * @returns {string|string[]}
 */
function resolveCorsOrigin(originEnv = process.env.CORS_ORIGIN, nodeEnv = process.env.NODE_ENV) {
  const trimmed = originEnv ? originEnv.trim() : '';

  if (nodeEnv === 'production') {
    if (!trimmed) {
      throw new Error('CORS_ORIGIN environment variable is required in production');
    }
    if (!isValidCorsOrigin(trimmed)) {
      throw new Error(
        'CORS_ORIGIN environment variable is invalid: must be one or more valid canonical http(s) origin URLs (no paths, queries, or trailing slashes)'
      );
    }
    const origins = trimmed.split(',').map((s) => s.trim());
    return origins.length === 1 ? origins[0] : origins;
  }

  // Development and test fallback
  if (trimmed) {
    if (!isValidCorsOrigin(trimmed)) {
      throw new Error(
        'CORS_ORIGIN environment variable is invalid: must be one or more valid canonical http(s) origin URLs (no paths, queries, or trailing slashes)'
      );
    }
    const origins = trimmed.split(',').map((s) => s.trim());
    return origins.length === 1 ? origins[0] : origins;
  }

  return 'http://localhost:5173';
}

module.exports = {
  isSingleCanonicalOrigin,
  isValidCorsOrigin,
  resolveCorsOrigin,
};
