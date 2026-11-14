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

module.exports = {
  getStats,
};
