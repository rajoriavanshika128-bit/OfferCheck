'use strict';

/**
 * src/routes/report.routes.js
 * Report submission and discovery route definitions.
 */

const { Router } = require('express');
const reportController = require('../controllers/report.controller');
const auth = require('../middleware/auth');
const validate = require('../middleware/validate');
const { createReportSchema } = require('../validations/report.validation');

const router = Router();

// POST /api/reports - Authenticated report submission
router.post('/', auth, validate(createReportSchema), reportController.submitReport);

module.exports = router;
