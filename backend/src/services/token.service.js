'use strict';

/**
 * src/services/token.service.js
 * Access token generation and cryptographic helper service.
 */

const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const ACCESS_TOKEN_EXPIRY = '15m';
const SIGNING_ALGORITHM = 'HS256';
const REFRESH_TOKEN_EXPIRY_DAYS = 7;

/**
 * Generate a cryptographically secure opaque refresh token (256-bit entropy).
 *
 * @returns {string} 64-character lowercase hex string
 */
function generateRefreshToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Calculate expiration timestamp for a new refresh token.
 *
 * @returns {Date} Date 7 days from now
 */
function calculateRefreshTokenExpiry() {
  return new Date(Date.now() + REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * Generate a short-lived access token.
 * Payload: { sub: user.id, role: user.role }
 * Expiry: 15 minutes.
 * Algorithm: HS256.
 *
 * @param {object} user - User record ({ id, role })
 * @returns {string} Signed JWT access token
 */
function generateAccessToken(user) {
  if (!user || !user.id || !user.role) {
    throw new Error('User id and role are required to generate access token');
  }

  return jwt.sign(
    {
      sub: user.id,
      role: user.role,
    },
    process.env.JWT_SECRET,
    {
      expiresIn: ACCESS_TOKEN_EXPIRY,
      algorithm: SIGNING_ALGORITHM,
    }
  );
}

/**
 * Verify an access token explicitly restricting accepted algorithms to HS256.
 *
 * @param {string} token - Raw JWT string
 * @returns {object} Decoded token payload
 */
function verifyAccessToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET, {
    algorithms: [SIGNING_ALGORITHM],
  });
}

/**
 * SHA-256 token hashing helper for tokens (e.g., refresh token hashes).
 *
 * @param {string} token - Raw token string
 * @returns {string} 64-character lowercase hex digest
 */
function hashToken(token) {
  if (!token || typeof token !== 'string') {
    throw new Error('Token string is required for hashing');
  }
  return crypto.createHash('sha256').update(token).digest('hex');
}

module.exports = {
  generateAccessToken,
  verifyAccessToken,
  hashToken,
  generateRefreshToken,
  calculateRefreshTokenExpiry,
  ACCESS_TOKEN_EXPIRY,
  SIGNING_ALGORITHM,
  REFRESH_TOKEN_EXPIRY_DAYS,
};
