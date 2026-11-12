'use strict';

/**
 * src/middleware/auth.js
 * JWT access-token verification middleware.
 * Attaches req.user = { id, role } on success.
 * Phase 2A stub — full implementation in Phase 2B with auth routes.
 */

const jwt = require('jsonwebtoken');
const { AppError } = require('../utils/errors');

function auth(req, _res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return next(new AppError('Authentication required', 401));
  }
  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { id: payload.sub, role: payload.role };
    next();
  } catch (err) {
    next(err); // JsonWebTokenError / TokenExpiredError handled in errorHandler
  }
}

module.exports = auth;

