'use strict';

/**
 * src/routes/report.routes.js
 * Report submission and discovery route definitions.
 */

const { Router } = require('express');
const reportController = require('../controllers/report.controller');
const auth = require('../middleware/auth');
const { optionalAuth } = require('../middleware/auth');
const validate = require('../middleware/validate');
const {
  createReportSchema,
  publicReportQuerySchema,
  myReportsQuerySchema,
  savedReportsQuerySchema,
} = require('../validations/report.validation');

const router = Router();

// ─── 1. Static Sub-Paths First ───────────────────────────────────────────────

// POST /api/reports - Authenticated report submission (Phase 5B)
router.post('/', auth, validate(createReportSchema), reportController.submitReport);

// GET /api/reports - Public verified report discovery (browse, search, filter, paginate)
router.get('/', optionalAuth, validate.query(publicReportQuerySchema), reportController.getReports);

// GET /api/reports/me - Authenticated user's submitted reports across all statuses
router.get('/me', auth, validate.query(myReportsQuerySchema), reportController.getMyReports);

// GET /api/reports/saved - Authenticated user's bookmarked reports (with non-public leak protection)
router.get('/saved', auth, validate.query(savedReportsQuerySchema), reportController.getSavedReports);

// ─── 2. Dynamic Parameter Sub-Paths Second ───────────────────────────────────

// GET /api/reports/:id - Individual report details (verified public; non-verified author/admin)
router.get('/:id', optionalAuth, reportController.getReportById);

// GET /api/reports/:id/related - Related reports sharing identifiers (enforcing source-report access)
router.get('/:id/related', optionalAuth, reportController.getRelatedReports);

// POST /api/reports/:id/save - Bookmark / save a report
router.post('/:id/save', auth, reportController.saveReport);

// DELETE /api/reports/:id/save - Remove saved bookmark
router.delete('/:id/save', auth, reportController.removeSavedReport);

module.exports = router;
