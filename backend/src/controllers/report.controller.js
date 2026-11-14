'use strict';

/**
 * src/controllers/report.controller.js
 * HTTP route handlers for report submission and management.
 */

const path = require('path');
const fs = require('fs');
const { AppError } = require('../utils/errors');
const { reportIdParamSchema } = require('../validations/report.validation');

const REPORT_SERVICE_PATH = path.resolve(__dirname, '../services/report.service.js');

/**
 * Safely resolves the report service dependency.
 * Distinguishes the genuinely missing service file (Phase 5B.1 boundary)
 * from syntax, evaluation, or dependency errors originating inside that module.
 *
 * @returns {object|null} The report service module, or null if the file does not exist.
 */
function getReportService() {
  if (!fs.existsSync(REPORT_SERVICE_PATH)) {
    return null;
  }
  // Let require() execute naturally so internal syntax or dependency errors
  // propagate cleanly to next(err) rather than being swallowed as a 501.
  return require('../services/report.service');
}

/**
 * POST /api/reports
 * Handle authenticated report submission.
 *
 * Security guarantees:
 * - Submitter identity is derived EXCLUSIVELY from verified req.user.id.
 * - Client-supplied ownership, status, reviewer, or moderation fields are ignored/rejected.
 * - Canonical validated request data is passed to the service layer.
 * - Errors are forwarded through next(err) without leaking internal database details.
 */
async function submitReport(req, res, next) {
  try {
    if (!req.user || !req.user.id) {
      return next(new AppError('Authentication required', 401));
    }

    const reportService = getReportService();
    if (!reportService || typeof reportService.createReport !== 'function') {
      return next(new AppError('Report service not implemented', 501));
    }

    const report = await reportService.createReport(req.user.id, req.body, req.user.role);
    return res.status(201).json({
      success: true,
      report,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/reports
 * Public verified-report discovery (browse, search, filter, paginate).
 */
async function getReports(req, res, next) {
  try {
    const reportService = getReportService();
    if (!reportService || typeof reportService.getPublicReports !== 'function') {
      return next(new AppError('Report service not implemented', 501));
    }

    const callerRole = req.user ? req.user.role : 'student';
    const result = await reportService.getPublicReports(req.query, callerRole);

    return res.status(200).json({
      success: true,
      reports: result.reports,
      pagination: result.pagination,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/reports/me
 * Retrieve the authenticated user's submitted reports across all statuses.
 */
async function getMyReports(req, res, next) {
  try {
    if (!req.user || !req.user.id) {
      return next(new AppError('Authentication required', 401));
    }

    const reportService = getReportService();
    if (!reportService || typeof reportService.getMyReports !== 'function') {
      return next(new AppError('Report service not implemented', 501));
    }

    const result = await reportService.getMyReports(req.user.id, req.query, req.user.role);

    return res.status(200).json({
      success: true,
      reports: result.reports,
      pagination: result.pagination,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/reports/:id
 * Retrieve a single report by ID (verified public, non-verified author/admin).
 */
async function getReportById(req, res, next) {
  try {
    const paramResult = reportIdParamSchema.safeParse(req.params);
    if (!paramResult.success) {
      return next(paramResult.error);
    }

    const reportService = getReportService();
    if (!reportService || typeof reportService.getReportById !== 'function') {
      return next(new AppError('Report service not implemented', 501));
    }

    const report = await reportService.getReportById(paramResult.data.id, req.user || null);

    return res.status(200).json({
      success: true,
      report,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/reports/:id/related
 * Retrieve related verified reports sharing contact identifiers with source report.
 */
async function getRelatedReports(req, res, next) {
  try {
    const paramResult = reportIdParamSchema.safeParse(req.params);
    if (!paramResult.success) {
      return next(paramResult.error);
    }

    const reportService = getReportService();
    if (!reportService || typeof reportService.getRelatedReports !== 'function') {
      return next(new AppError('Report service not implemented', 501));
    }

    const result = await reportService.getRelatedReports(paramResult.data.id, req.user || null);

    return res.status(200).json({
      success: true,
      sourceReportId: result.sourceReportId,
      relatedReports: result.relatedReports,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/reports/:id/save
 * Bookmark / save a report idempotently for the authenticated user.
 */
async function saveReport(req, res, next) {
  try {
    if (!req.user || !req.user.id) {
      return next(new AppError('Authentication required', 401));
    }

    const paramResult = reportIdParamSchema.safeParse(req.params);
    if (!paramResult.success) {
      return next(paramResult.error);
    }

    const reportService = getReportService();
    if (!reportService || typeof reportService.saveReport !== 'function') {
      return next(new AppError('Report service not implemented', 501));
    }

    const result = await reportService.saveReport(req.user.id, paramResult.data.id, req.user);

    return res.status(200).json({
      success: true,
      ...result,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /api/reports/:id/save
 * Remove a saved report bookmark idempotently.
 */
async function removeSavedReport(req, res, next) {
  try {
    if (!req.user || !req.user.id) {
      return next(new AppError('Authentication required', 401));
    }

    const paramResult = reportIdParamSchema.safeParse(req.params);
    if (!paramResult.success) {
      return next(paramResult.error);
    }

    const reportService = getReportService();
    if (!reportService || typeof reportService.removeSavedReport !== 'function') {
      return next(new AppError('Report service not implemented', 501));
    }

    const result = await reportService.removeSavedReport(req.user.id, paramResult.data.id);

    return res.status(200).json({
      success: true,
      ...result,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/reports/saved
 * Retrieve saved reports for the authenticated user with non-public leak protection.
 */
async function getSavedReports(req, res, next) {
  try {
    if (!req.user || !req.user.id) {
      return next(new AppError('Authentication required', 401));
    }

    const reportService = getReportService();
    if (!reportService || typeof reportService.getUserSavedReports !== 'function') {
      return next(new AppError('Report service not implemented', 501));
    }

    const result = await reportService.getUserSavedReports(req.user.id, req.query, req.user.role);

    return res.status(200).json({
      success: true,
      reports: result.reports,
      pagination: result.pagination,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/admin/reports
 * Retrieve paginated reports for administrators across moderation statuses.
 */
async function getAdminReports(req, res, next) {
  try {
    if (!req.user || req.user.role !== 'admin') {
      return next(new AppError('Admin access required', 403));
    }

    const reportService = getReportService();
    if (!reportService || typeof reportService.getAdminReports !== 'function') {
      return next(new AppError('Report service not implemented', 501));
    }

    const result = await reportService.getAdminReports(req.query, req.user.role);

    return res.status(200).json({
      success: true,
      reports: result.reports,
      pagination: result.pagination,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/admin/reports/:id
 * Retrieve unmasked report details for administrators before moderation.
 */
async function getAdminReportById(req, res, next) {
  try {
    if (!req.user || req.user.role !== 'admin') {
      return next(new AppError('Admin access required', 403));
    }

    const paramResult = reportIdParamSchema.safeParse(req.params);
    if (!paramResult.success) {
      return next(paramResult.error);
    }

    const reportService = getReportService();
    if (!reportService || typeof reportService.getReportById !== 'function') {
      return next(new AppError('Report service not implemented', 501));
    }

    const report = await reportService.getReportById(paramResult.data.id, req.user);

    return res.status(200).json({
      success: true,
      report,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /api/admin/reports/:id
 * Atomic report moderation decision (verify, reject, investigate).
 */
async function moderateReport(req, res, next) {
  try {
    if (!req.user || req.user.role !== 'admin') {
      return next(new AppError('Admin access required', 403));
    }

    const paramResult = reportIdParamSchema.safeParse(req.params);
    if (!paramResult.success) {
      return next(paramResult.error);
    }

    const reportService = getReportService();
    if (!reportService || typeof reportService.moderateReport !== 'function') {
      return next(new AppError('Report service not implemented', 501));
    }

    const { status, notes } = req.body;
    const adminId = req.user.id;

    const result = await reportService.moderateReport(
      paramResult.data.id,
      status,
      adminId,
      notes
    );

    return res.status(200).json({
      success: true,
      report: result.report,
      auditLog: result.auditLog,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  submitReport,
  getReports,
  getMyReports,
  getReportById,
  getRelatedReports,
  saveReport,
  removeSavedReport,
  getSavedReports,
  getAdminReports,
  getAdminReportById,
  moderateReport,
};
