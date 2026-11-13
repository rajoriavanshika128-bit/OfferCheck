'use strict';

/**
 * src/middleware/auth.js
 * JWT access-token verification middleware.
 * Verifies signature, validates claims, fetches fresh user from PostgreSQL,
 * enforces account active/ban status, and attaches authenticated identity to req.user.
 */

const jwt = require('jsonwebtoken');
const prisma = require('../utils/prisma');
const { AppError } = require('../utils/errors');
const { SIGNING_ALGORITHM } = require('../services/token.service');

const VALID_ROLES = ['student', 'admin'];

async function auth(req, _res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return next(new AppError('Authentication required', 401));
  }

  const token = header.slice(7).trim();
  if (!token) {
    return next(new AppError('Authentication required', 401));
  }

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: [SIGNING_ALGORITHM],
    });
  } catch (err) {
    // JsonWebTokenError / TokenExpiredError are handled by centralised errorHandler
    return next(err);
  }

  // Validate required JWT claims
  if (!payload || typeof payload !== 'object') {
    return next(new AppError('Malformed token payload', 401));
  }

  if (
    !payload.sub ||
    typeof payload.sub !== 'string' ||
    !payload.role ||
    typeof payload.role !== 'string' ||
    !VALID_ROLES.includes(payload.role) ||
    typeof payload.iat !== 'number' ||
    typeof payload.exp !== 'number'
  ) {
    return next(new AppError('Invalid token claims', 401));
  }

  try {
    // Fetch current user from PostgreSQL to verify existence, ban status, and fresh role
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isBanned: true,
      },
    });

    if (!user) {
      return next(new AppError('User account no longer exists', 401));
    }

    if (user.isBanned) {
      return next(new AppError('Account has been suspended', 403));
    }

    // Attach verified identity and current database role (never trust body or query params)
    req.user = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role, // Live role from database
    };

    next();
  } catch (err) {
    next(err);
  }
}

module.exports = auth;
