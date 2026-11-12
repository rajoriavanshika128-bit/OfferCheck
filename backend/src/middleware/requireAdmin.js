'use strict';

/**
 * src/middleware/requireAdmin.js
 * Role-guard middleware. Must be used after auth middleware.
 * Role is derived from the JWT payload — never from the request body.
 */

const { AppError } = require('../utils/errors');

function requireAdmin(req, _res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return next(new AppError('Admin access required', 403));
  }
  next();
}

module.exports = requireAdmin;

