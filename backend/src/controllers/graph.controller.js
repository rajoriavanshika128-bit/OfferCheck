'use strict';

/**
 * backend/src/controllers/graph.controller.js
 * HTTP route handlers for Trust Graph and public statistics endpoints.
 */

const graphService = require('../services/graph.service');

/**
 * GET /api/graph
 * Retrieve verified trust graph or connected subgraph.
 */
async function getGraph(req, res, next) {
  try {
    const result = await graphService.getTrustGraph(req.query);

    return res.status(200).json({
      success: true,
      nodes: result.nodes,
      edges: result.edges,
      truncated: Boolean(result.truncated),
      ...(result.startNodeId ? { startNodeId: result.startNodeId } : {}),
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/graph/stats
 * Retrieve public platform statistics based exclusively on verified reports.
 */
async function getStats(_req, res, next) {
  try {
    const stats = await graphService.getPublicStats();

    return res.status(200).json({
      success: true,
      stats,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getGraph,
  getStats,
};
