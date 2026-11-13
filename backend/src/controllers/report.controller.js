'use strict';

/**
 * src/controllers/report.controller.js
 * HTTP route handlers for report submission and management.
 */

const path = require('path');
const fs = require('fs');
const { AppError } = require('../utils/errors');

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

module.exports = {
  submitReport,
};
