'use strict';

/**
 * backend/src/controllers/admin.controller.js
 * HTTP route handlers for administrative endpoints.
 */

const adminService = require('../services/admin.service');
const { AppError } = require('../utils/errors');

/**
 * GET /api/admin/stats
 * Retrieve aggregated platform statistics for admin dashboard.
 */
async function getStats(req, res, next) {
  try {
    if (!req.user || !req.user.id) {
      return next(new AppError('Authentication required', 401));
    }

    const stats = await adminService.getAdminStats(req.user.role);

    return res.status(200).json({
      success: true,
      stats,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/admin/identifiers
 * Retrieve paginated identifiers for admin management.
 */
async function getIdentifiers(req, res, next) {
  try {
    if (!req.user || !req.user.id) {
      return next(new AppError('Authentication required', 401));
    }

    const result = await adminService.getIdentifiers(req.query, req.user.role);

    return res.status(200).json({
      success: true,
      identifiers: result.identifiers,
      pagination: result.pagination,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/admin/clusters
 * Retrieve clusters for admin inspection.
 */
async function getClusters(req, res, next) {
  try {
    if (!req.user || !req.user.id) {
      return next(new AppError('Authentication required', 401));
    }

    const result = await adminService.getClusters(req.user.role);

    return res.status(200).json({
      success: true,
      clusters: result.clusters,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/admin/audit-logs
 * Retrieve audit logs with action filtering and pagination.
 */
async function getAuditLogs(req, res, next) {
  try {
    if (!req.user || !req.user.id) {
      return next(new AppError('Authentication required', 401));
    }

    const result = await adminService.getAuditLogs(req.query, req.user.role);

    return res.status(200).json({
      success: true,
      logs: result.logs,
      pagination: result.pagination,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getStats,
  getIdentifiers,
  getClusters,
  getAuditLogs,
};
