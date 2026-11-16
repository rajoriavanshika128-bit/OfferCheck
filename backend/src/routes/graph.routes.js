'use strict';

/**
 * backend/src/routes/graph.routes.js
 * Express routing for Trust Graph and public platform statistics.
 *
 * ENDPOINTS:
 * - GET /api/graph/stats - Public aggregated counts based strictly on verified reports.
 * - GET /api/graph       - Public verified trust graph and subgraph exploration.
 */

const { Router } = require('express');
const { optionalAuth } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { graphLimiter } = require('../middleware/rateLimiter');
const { graphQuerySchema } = require('../validations/graph.validation');
const graphController = require('../controllers/graph.controller');

const router = Router();

// Rate limit all public graph and statistics operations
router.use(graphLimiter);

// GET /api/graph/stats - Public platform metrics summary
router.get('/stats', graphController.getStats);

// GET /api/graph - Verified trust graph or connected subgraph
router.get('/', optionalAuth, validate.query(graphQuerySchema), graphController.getGraph);

module.exports = router;
