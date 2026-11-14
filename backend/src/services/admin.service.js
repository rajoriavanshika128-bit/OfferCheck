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

/**
 * Retrieve paginated identifiers for administrative management.
 * Unmasked identifier values are preserved exclusively for admins.
 * Uses _count to prevent N+1 queries.
 *
 * @param {object} [queryOptions={}] - Filtering and pagination options
 * @param {string} callerRole - Role of the requesting user
 * @returns {Promise<object>}
 */
async function getIdentifiers(queryOptions = {}, callerRole) {
  if (callerRole !== 'admin') {
    throw new AppError('Admin access required', 403);
  }

  const page = Number(queryOptions.page) || 1;
  const limit = Number(queryOptions.limit) || 20;
  const skip = (page - 1) * limit;

  const primarySortField = queryOptions.sortBy || 'lastSeen';
  const sortDirection = (queryOptions.sortOrder || 'desc').toLowerCase();

  const orderBy = [
    { [primarySortField]: sortDirection },
    { id: 'asc' }, // Stable tie-breaker
  ];

  const where = {};

  if (queryOptions.type && queryOptions.type !== 'all') {
    where.type = queryOptions.type;
  }

  if (queryOptions.flagged !== undefined && queryOptions.flagged !== null && queryOptions.flagged !== 'all') {
    where.flagged = Boolean(queryOptions.flagged);
  }

  if (queryOptions.search && queryOptions.search.trim()) {
    const term = queryOptions.search.trim();
    where.OR = [
      { value: { contains: term, mode: 'insensitive' } },
      { normalizedValue: { contains: term, mode: 'insensitive' } },
    ];
  }

  const [total, items] = await Promise.all([
    prisma.identifier.count({ where }),
    prisma.identifier.findMany({
      where,
      skip,
      take: limit,
      orderBy,
      include: {
        _count: {
          select: { reports: true },
        },
      },
    }),
  ]);

  const identifiers = items.map((id) => ({
    id: id.id,
    type: id.type,
    value: id.value, // unmasked for admin
    normalizedValue: id.normalizedValue,
    riskScore: id.riskScore,
    flagged: id.flagged,
    confidence: id.confidence,
    reportCount: id._count.reports,
    notes: id.notes,
    firstSeen: id.firstSeen,
    lastSeen: id.lastSeen,
  }));

  return {
    identifiers,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    },
  };
}

/**
 * Retrieve fraud clusters for administrative inspection.
 * Aggregates linked reports and computes average risk scores on-demand via JOINs.
 *
 * @param {string} callerRole - Role of the requesting user
 * @returns {Promise<object>}
 */
async function getClusters(callerRole) {
  if (callerRole !== 'admin') {
    throw new AppError('Admin access required', 403);
  }

  const clusters = await prisma.cluster.findMany({
    orderBy: { discoveredAt: 'desc' },
    include: {
      reports: {
        include: {
          report: {
            select: {
              id: true,
              status: true,
              companyNameRaw: true,
              riskAssessments: {
                where: { isCurrent: true },
                select: { score: true },
              },
              identifiers: {
                select: { identifierId: true },
              },
            },
          },
        },
      },
    },
  });

  const formattedClusters = clusters.map((c) => {
    const reportList = c.reports.map((cr) => cr.report).filter(Boolean);
    const reportIds = reportList.map((r) => r.id);

    let scoreSum = 0;
    let scoreCount = 0;
    const identifierIdSet = new Set();

    for (const r of reportList) {
      if (r.riskAssessments && r.riskAssessments.length > 0) {
        scoreSum += r.riskAssessments[0].score;
        scoreCount++;
      }
      if (r.identifiers) {
        for (const ri of r.identifiers) {
          identifierIdSet.add(ri.identifierId);
        }
      }
    }

    const avgRiskScore = scoreCount > 0 ? Math.round(scoreSum / scoreCount) : 0;

    return {
      id: c.id,
      name: c.name,
      description: c.description || '',
      confidence: c.confidence,
      status: c.status,
      connectionBasis: c.connectionBasis || '',
      totalReports: reportList.length,
      riskScore: avgRiskScore,
      reportIds,
      identifierIds: Array.from(identifierIdSet),
      discoveredAt: c.discoveredAt,
      updatedAt: c.updatedAt,
    };
  });

  return {
    clusters: formattedClusters,
  };
}

/**
 * Retrieve immutable audit logs with optional action filtering and pagination.
 * Resolves actor names cleanly.
 *
 * @param {object} [queryOptions={}] - Filtering and pagination options
 * @param {string} callerRole - Role of the requesting user
 * @returns {Promise<object>}
 */
async function getAuditLogs(queryOptions = {}, callerRole) {
  if (callerRole !== 'admin') {
    throw new AppError('Admin access required', 403);
  }

  const page = Number(queryOptions.page) || 1;
  const limit = Number(queryOptions.limit) || 50;
  const skip = (page - 1) * limit;

  const sortDirection = (queryOptions.sortOrder || 'desc').toLowerCase();

  const where = {};

  if (queryOptions.action && queryOptions.action !== 'all') {
    where.action = queryOptions.action;
  }

  if (queryOptions.reportId) {
    where.reportId = queryOptions.reportId;
  }

  const [total, items] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      skip,
      take: limit,
      orderBy: [
        { createdAt: sortDirection },
        { id: 'asc' }, // Stable tie-breaker
      ],
      include: {
        actor: {
          select: {
            id: true,
            name: true,
            role: true,
          },
        },
      },
    }),
  ]);

  const logs = items.map((log) => ({
    id: log.id,
    action: log.action,
    reportId: log.reportId,
    identifierId: log.identifierId,
    clusterId: log.clusterId,
    userId: log.actorId,
    userName: log.actor?.name || 'System Admin',
    oldStatus: log.oldValue,
    newStatus: log.newValue,
    notes: log.notes || '',
    timestamp: log.createdAt,
  }));

  return {
    logs,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    },
  };
}

module.exports = {
  getAdminStats,
  getIdentifiers,
  getClusters,
  getAuditLogs,
};
