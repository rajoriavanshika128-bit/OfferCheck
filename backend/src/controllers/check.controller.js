'use strict';

/**
 * backend/src/controllers/check.controller.js
 * HTTP route handlers for offer checking and check history endpoints.
 */

const { AppError } = require('../utils/errors');
const checkService = require('../services/check.service');
const { checkIdParamSchema } = require('../validations/check.validation');

/**
 * Extract client IP safely without throwing if socket is uninitialized or mocked.
 */
function getClientIp(req) {
  try {
    return req.ip || req.socket?.remoteAddress || req.connection?.remoteAddress || null;
  } catch {
    return req.socket?.remoteAddress || req.connection?.remoteAddress || null;
  }
}

/**
 * POST /api/checks
 * Handle authenticated offer check request.
 *
 * Security guarantees:
 * - User identity is derived exclusively from verified req.user.id.
 * - Client-supplied scores, categories, timestamps, or IP hashes are rejected by schema.
 * - Canonical validated request data is passed to the service layer.
 */
async function checkOffer(req, res, next) {
  try {
    if (!req.user || !req.user.id) {
      return next(new AppError('Authentication required', 401));
    }

    const clientIp = getClientIp(req);
    const check = await checkService.performCheck(
      req.user.id,
      req.body,
      req.user.role,
      clientIp
    );

    return res.status(201).json({
      success: true,
      check,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/checks
 * Retrieve paginated offer check history for the authenticated user.
 */
async function getHistory(req, res, next) {
  try {
    if (!req.user || !req.user.id) {
      return next(new AppError('Authentication required', 401));
    }

    const result = await checkService.getCheckHistory(
      req.user.id,
      req.query,
      req.user.role
    );

    return res.status(200).json({
      success: true,
      checks: result.checks,
      pagination: result.pagination,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/checks/:id
 * Retrieve a specific offer check by ID with ownership verification.
 */
async function getCheckById(req, res, next) {
  try {
    if (!req.user || !req.user.id) {
      return next(new AppError('Authentication required', 401));
    }

    const paramResult = checkIdParamSchema.safeParse(req.params);
    if (!paramResult.success) {
      return next(paramResult.error);
    }

    const check = await checkService.getCheckById(paramResult.data.id, req.user);

    return res.status(200).json({
      success: true,
      check,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/checks/dashboard
 * Retrieve aggregated dashboard metrics for the authenticated user.
 */
async function getDashboardMetrics(req, res, next) {
  try {
    if (!req.user || !req.user.id) {
      return next(new AppError('Authentication required', 401));
    }

    const metrics = await checkService.getDashboardMetrics(req.user.id, req.user.role);

    return res.status(200).json({
      success: true,
      metrics,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  checkOffer,
  getHistory,
  getCheckById,
  getDashboardMetrics,
};
