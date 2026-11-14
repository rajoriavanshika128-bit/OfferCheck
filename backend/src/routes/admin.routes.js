'use strict';

/**
 * src/routes/admin.routes.js
 * Admin moderation route definitions for OfferCheck Phase 8.
 *
 * Mandatory invariants:
 * - All endpoints strictly enforce JWT authentication (auth) and admin role (requireAdmin).
 * - Endpoints:
 *   1. GET   /api/admin/stats        - Aggregated platform analytics summary
 *   2. GET   /api/admin/reports      - List paginated reports (defaults to pending queue)
 *   3. GET   /api/admin/reports/:id  - Unmasked report inspection before moderation
 *   4. PATCH /api/admin/reports/:id  - Atomic moderation decision (verify, reject, investigate)
 */

const { Router } = require('express');
const auth = require('../middleware/auth');
const requireAdmin = require('../middleware/requireAdmin');
const validate = require('../middleware/validate');
const reportController = require('../controllers/report.controller');
const adminController = require('../controllers/admin.controller');
const {
  adminReportQuerySchema,
  reportIdParamSchema,
  moderateReportSchema,
} = require('../validations/report.validation');
const {
  adminIdentifierQuerySchema,
  adminAuditQuerySchema,
} = require('../validations/admin.validation');

const router = Router();

// Enforce auth and requireAdmin globally across all /api/admin routes
router.use(auth, requireAdmin);

// GET /api/admin/stats - Aggregated platform statistics
router.get('/stats', adminController.getStats);

// GET /api/admin/reports - Paginated report listing (defaults to pending queue)
router.get(
  '/reports',
  validate.query(adminReportQuerySchema),
  reportController.getAdminReports
);

// GET /api/admin/reports/:id - Unmasked report inspection before moderation
router.get(
  '/reports/:id',
  validate.params(reportIdParamSchema),
  reportController.getAdminReportById
);

// PATCH /api/admin/reports/:id - Atomic report moderation decision
router.patch(
  '/reports/:id',
  validate.params(reportIdParamSchema),
  validate(moderateReportSchema),
  reportController.moderateReport
);

// GET /api/admin/identifiers - Paginated identifiers with type and flagged filters
router.get(
  '/identifiers',
  validate.query(adminIdentifierQuerySchema),
  adminController.getIdentifiers
);

// GET /api/admin/clusters - Discovered fraud clusters with report relationships
router.get(
  '/clusters',
  adminController.getClusters
);

// GET /api/admin/audit-logs - Immutable administrative audit logs
router.get(
  '/audit-logs',
  validate.query(adminAuditQuerySchema),
  adminController.getAuditLogs
);

module.exports = router;
