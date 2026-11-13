'use strict';

/**
 * src/middleware/authorize.js
 * Role-Based Access Control (RBAC) middleware factory.
 * Enforces permissions based on authenticated user identity attached by auth middleware.
 */

const { AppError } = require('../utils/errors');

/**
 * Middleware factory requiring that the authenticated user has one of the allowed roles.
 * Must be mounted after auth middleware.
 *
 * @param {...string} allowedRoles - e.g. 'admin', 'student'
 * @returns {Function} Express middleware (req, res, next)
 */
function requireRole(...allowedRoles) {
  if (allowedRoles.length === 0) {
    throw new Error('requireRole requires at least one role argument');
  }

  return function roleMiddleware(req, _res, next) {
    if (!req.user) {
      return next(new AppError('Authentication required', 401));
    }

    if (!allowedRoles.includes(req.user.role)) {
      // If specifically requiring admin, maintain standard message for consistency
      if (allowedRoles.length === 1 && allowedRoles[0] === 'admin') {
        return next(new AppError('Admin access required', 403));
      }
      return next(new AppError('Forbidden: insufficient permissions', 403));
    }

    next();
  };
}

/**
 * Standard admin guard. Backward-compatible with existing requireAdmin usage.
 */
const requireAdmin = requireRole('admin');

module.exports = {
  requireRole,
  requireAdmin,
};
