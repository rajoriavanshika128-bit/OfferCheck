'use strict';

/**
 * backend/src/services/admin.service.js
 * Domain service for administrative operations and analytics aggregations.
 *
 * Implements Phase 9 Admin Stats:
 * - Aggregates platform-wide report statuses, risk distributions, identifiers, clusters, and users.
 * - Strictly enforces caller role authorization (callerRole === 'admin').
 * - Zero database mutations; pure analytical reads.
 */

const prisma = require('../utils/prisma');
const { AppError } = require('../utils/errors');

/**
 * Retrieve aggregated platform analytics for administrators.
 * Executes genuine database counts and groupings across PostgreSQL tables.
 *
 * @param {string} callerRole - Role of the requesting user
 * @returns {Promise<object>} Platform statistics summary
 */
async function getAdminStats(callerRole) {
  if (callerRole !== 'admin') {
    throw new AppError('Admin access required', 403);
  }

  const [
    totalReports,
    statusGroup,
    riskGroup,
    totalIdentifiers,
    flaggedIdentifiers,
    activeClusters,
    totalUsers,
    totalChecks,
  ] = await Promise.all([
    prisma.report.count(),
    prisma.report.groupBy({
      by: ['status'],
      _count: { id: true },
    }),
    prisma.riskAssessment.groupBy({
      where: { isCurrent: true },
      by: ['category'],
      _count: { id: true },
    }),
    prisma.identifier.count(),
    prisma.identifier.count({ where: { flagged: true } }),
    prisma.cluster.count({ where: { status: 'active' } }),
    prisma.user.count(),
    prisma.offerCheck.count(),
  ]);

  const reportsByStatus = {
    pending: 0,
    verified: 0,
    rejected: 0,
    investigating: 0,
  };
  for (const item of statusGroup) {
    if (reportsByStatus[item.status] !== undefined) {
      reportsByStatus[item.status] = item._count.id;
    }
  }

  const riskDistribution = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
  };
  for (const item of riskGroup) {
    if (riskDistribution[item.category] !== undefined) {
      riskDistribution[item.category] = item._count.id;
    }
  }

  return {
    totalReports,
    reportsByStatus,
    riskDistribution,
    totalIdentifiers,
    flaggedIdentifiers,
    activeClusters,
    totalUsers,
    totalChecks,
  };
}

module.exports = {
  getAdminStats,
};
