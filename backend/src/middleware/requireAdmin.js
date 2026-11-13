'use strict';

/**
 * src/middleware/requireAdmin.js
 * Role-guard middleware. Must be used after auth middleware.
 * Preserves 100% backward compatibility with Phase 4A/4B tests and imports.
 */

const { requireAdmin } = require('./authorize');

module.exports = requireAdmin;
