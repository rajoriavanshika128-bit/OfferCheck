'use strict';

/**
 * backend/src/routes/check.routes.js
 * Route definitions for offer checking and check history endpoints.
 */

const { Router } = require('express');
const checkController = require('../controllers/check.controller');
const auth = require('../middleware/auth');
const validate = require('../middleware/validate');
const { checkLimiter } = require('../middleware/rateLimiter');
const {
  offerCheckSchema,
  offerCheckQuerySchema,
} = require('../validations/check.validation');

const router = Router();

// All offer check routes require authentication
router.use(auth);

// POST /api/checks - Authenticated offer check (with rate limiting per authenticated user)
router.post('/', checkLimiter, validate(offerCheckSchema), checkController.checkOffer);

// GET /api/checks - Authenticated user check history
router.get('/', validate.query(offerCheckQuerySchema), checkController.getHistory);

// GET /api/checks/dashboard - Authenticated user dashboard metrics
router.get('/dashboard', checkController.getDashboardMetrics);

// GET /api/checks/:id - Authenticated single check retrieval
router.get('/:id', checkController.getCheckById);

module.exports = router;
