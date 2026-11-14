'use strict';

/**
 * src/services/report.service.js
 * Core domain service for report submission and fraud-risk orchestration.
 *
 * Implements Phase 5B business logic:
 * 1. Extraction and deduplication of identifiers via Phase 5A normalizer.
 * 2. Pre-scoring historical intelligence read restricted strictly to VERIFIED reports.
 * 3. Pure deterministic fraud risk calculation via Phase 5A risk engine.
 * 4. Atomic multi-table persistence via single Prisma interactive transaction:
 *    - Identifier upserts (using type_normalizedValue compound key)
 *    - Report creation (status = 'pending', submittedBy = userId)
 *    - ReportIdentifier junction linking (including bank_account)
 *    - RiskAssessment creation (isCurrent = true, version = 1)
 *    - RiskFactor batch creation (mapped strictly to schema columns)
 *    - AuditLog creation (action = 'REPORT_SUBMITTED')
 * 5. Role-based response sanitization via maskReportForRole.
 */

const prisma = require('../utils/prisma');
const { AppError } = require('../utils/errors');
const { extractIdentifiersFromReport, normalizeIdentifier } = require('../utils/normalize');
const { calculateRiskAssessment } = require('./risk.service');
const { maskReportForRole, maskIdentifierForRole } = require('../utils/privacy');

/**
 * Create and persist a new fraud incident report.
 *
 * @param {string} userId - Authenticated user ID (derived strictly from req.user.id)
 * @param {object} validatedData - Canonical validated report data from createReportSchema
 * @param {string} [userRole='student'] - Role of the submitting user ('student' | 'admin')
 * @returns {Promise<object>} Sanitized created report record with relations
 */
async function createReport(userId, validatedData, userRole = 'student') {
  if (!userId || typeof userId !== 'string') {
    throw new AppError('Submitter user ID is required and must be a string', 400);
  }

  if (!validatedData || typeof validatedData !== 'object') {
    throw new AppError('Report data is required and must be an object', 400);
  }

  // 1. Extract and normalize all supplied contact identifiers (Phase 5A normalizer)
  // Deduplicates in-memory by composite key `${type}:${normalized}`
  const extractedIdentifiers = extractIdentifiersFromReport(validatedData);

  // 2. Query historical verified reports linked to these identifiers (outside transaction)
  // Consistency limitation note: Pre-scoring read is performed outside the write transaction to
  // prevent holding database row locks during CPU-intensive regex matching in calculateRiskAssessment.
  // Any concurrent verification committed during this brief window will be captured during Phase 8 moderation.
  let historicalMatches = [];
  if (extractedIdentifiers.length > 0) {
    const existingRecords = await prisma.identifier.findMany({
      where: {
        OR: extractedIdentifiers.map((i) => ({
          type: i.type,
          normalizedValue: i.normalized,
        })),
      },
      select: {
        type: true,
        normalizedValue: true,
        reports: {
          where: {
            report: {
              status: 'verified', // Database-query level filter: VERIFIED reports only
            },
          },
          select: {
            report: {
              select: {
                id: true,
                status: true,
              },
            },
          },
        },
      },
    });

    historicalMatches = existingRecords.map((idRec) => ({
      type: idRec.type,
      normalizedValue: idRec.normalizedValue,
      reports: idRec.reports.map((r) => ({
        id: r.report.id,
        status: r.report.status,
      })),
    }));
  }

  // 3. Pure deterministic risk calculation using Phase 5A risk engine
  const assessmentResult = calculateRiskAssessment({
    offerMessage: validatedData.offerMessage,
    paymentRequest: validatedData.paymentRequest || undefined,
    historicalMatches,
  });

  // 4. Atomic multi-table persistence in a single Prisma interactive transaction
  const createdReportGraph = await prisma.$transaction(async (tx) => {
    // Operation 1: Native PostgreSQL Identifier Upserts
    const upsertedIdentifiers = [];
    for (const idObj of extractedIdentifiers) {
      const idRecord = await tx.identifier.upsert({
        where: {
          type_normalizedValue: {
            type: idObj.type,
            normalizedValue: idObj.normalized,
          },
        },
        update: {
          lastSeen: new Date(),
        },
        create: {
          type: idObj.type,
          value: idObj.raw,
          normalizedValue: idObj.normalized,
          confidence: 'medium',
          firstSeen: new Date(),
          lastSeen: new Date(),
        },
      });
      upsertedIdentifiers.push(idRecord);
    }

    // Operation 2: Create Report (pending status, submittedBy = userId)
    // Note: bank accounts are NOT stored as a column on reports (handled via identifiers)
    const report = await tx.report.create({
      data: {
        submittedBy: userId,
        companyNameRaw: validatedData.companyNameRaw,
        recruiterNameRaw: validatedData.recruiterNameRaw || null,
        domainRaw: validatedData.domainRaw || null,
        phoneRaw: validatedData.phoneRaw || null,
        emailRaw: validatedData.emailRaw || null,
        upiRaw: validatedData.upiRaw || null,
        offerMessage: validatedData.offerMessage,
        paymentRequest: validatedData.paymentRequest || null,
        additionalNotes: validatedData.additionalNotes || null,
        status: 'pending',
        isVerified: false,
        isInferred: false,
      },
    });

    // Operation 3: Create ReportIdentifier junction records
    for (const idRecord of upsertedIdentifiers) {
      await tx.reportIdentifier.create({
        data: {
          reportId: report.id,
          identifierId: idRecord.id,
          confidence: 'medium',
          matchType: 'direct_submission',
          matchDescription: `Submitted directly in candidate fraud report for ${validatedData.companyNameRaw}`,
          addedBy: userId,
        },
      });
    }

    // Operation 4: Create RiskAssessment (version 1, isCurrent = true)
    const riskAssessment = await tx.riskAssessment.create({
      data: {
        reportId: report.id,
        score: assessmentResult.score,
        category: assessmentResult.riskCategory,
        summary: assessmentResult.summary,
        disclaimer: assessmentResult.disclaimer,
        assessedBy: 'system',
        isCurrent: true,
        version: 1,
      },
    });

    // Operation 5: Batch Create RiskFactors (mapped strictly to schema columns)
    // Explicitly excludes non-schema properties (evidenceCategory, provenance) from risk.service
    if (assessmentResult.factors && assessmentResult.factors.length > 0) {
      await tx.riskFactor.createMany({
        data: assessmentResult.factors.map((f) => ({
          assessmentId: riskAssessment.id,
          factorKey: f.factorKey,
          description: f.description,
          weight: f.weight,
          evidenceText: null,
          confidence: f.confidence || 'medium',
          explanation: f.explanation,
        })),
      });
    }

    // Operation 6: Create AuditLog record
    await tx.auditLog.create({
      data: {
        actorId: userId,
        action: 'REPORT_SUBMITTED',
        reportId: report.id,
        newValue: 'pending',
        notes: `Report submitted for ${validatedData.companyNameRaw}`,
      },
    });

    // Fetch the created report graph with relations for response formatting
    return tx.report.findUnique({
      where: { id: report.id },
      include: {
        identifiers: {
          include: { identifier: true },
        },
        riskAssessments: {
          where: { isCurrent: true },
          include: { factors: true },
        },
      },
    });
  });

  // 5. Sanitize created report based on caller role before returning
  return maskReportForRole(createdReportGraph, userRole);
}

/**
 * Browse, search, filter and paginate verified reports publicly.
 *
 * Invariants:
 * - Public callers can access VERIFIED reports only (database-query level filter).
 * - Stable pagination using deterministic secondary sort key ({ id: 'asc' }).
 * - Role-based PII masking via maskReportForRole.
 *
 * @param {object} [queryOptions={}] - Validated query parameters
 * @param {string} [userRole='student'] - Caller role
 * @returns {Promise<{ reports: Array<object>, pagination: object }>}
 */
async function getPublicReports(queryOptions = {}, userRole = 'student') {
  const page = Number(queryOptions.page) || 1;
  const limit = Number(queryOptions.limit) || 20;
  const skip = (page - 1) * limit;

  const primarySortField = queryOptions.sortBy === 'companyName'
    ? 'companyNameRaw'
    : (queryOptions.sortBy || 'submittedAt');
  const sortDirection = (queryOptions.sortOrder || 'desc').toLowerCase();

  const orderBy = [
    { [primarySortField]: sortDirection },
    { id: 'asc' }, // Stable tie-breaker
  ];

  // Database-query level filter: public discovery strictly permits verified reports only
  const where = {
    status: 'verified',
  };

  if (queryOptions.search && queryOptions.search.trim()) {
    const term = queryOptions.search.trim();
    where.OR = [
      { companyNameRaw: { contains: term, mode: 'insensitive' } },
      { recruiterNameRaw: { contains: term, mode: 'insensitive' } },
      { domainRaw: { contains: term, mode: 'insensitive' } },
    ];
  }

  if (queryOptions.companyId) {
    where.companyId = queryOptions.companyId;
  }

  if (queryOptions.recruiterId) {
    where.recruiterId = queryOptions.recruiterId;
  }

  if (queryOptions.identifierType && queryOptions.identifierValue) {
    let normalized = queryOptions.identifierValue.trim();
    try {
      normalized = normalizeIdentifier(queryOptions.identifierType, normalized);
    } catch {
      // If normalization fails, fall back to trimmed lowercase
      normalized = normalized.toLowerCase();
    }

    where.identifiers = {
      some: {
        identifier: {
          type: queryOptions.identifierType,
          normalizedValue: normalized,
        },
      },
    };
  }

  const [total, reports] = await Promise.all([
    prisma.report.count({ where }),
    prisma.report.findMany({
      where,
      skip,
      take: limit,
      orderBy,
      include: {
        company: { select: { id: true, name: true, domain: true, flagged: true } },
        recruiter: true,
        riskAssessments: {
          where: { isCurrent: true },
          select: { id: true, score: true, category: true, summary: true, assessedAt: true },
        },
        identifiers: {
          include: {
            identifier: true,
          },
        },
      },
    }),
  ]);

  const sanitizedReports = reports.map((r) => maskReportForRole(r, userRole));

  return {
    reports: sanitizedReports,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    },
  };
}

/**
 * Retrieve a single report by ID with visibility and ownership authorization.
 *
 * Rules:
 * - Verified reports are public intelligence (accessible to visitors and students).
 * - Non-verified reports (pending, rejected, investigating) require authentication
 *   and are accessible ONLY to the author or an administrator.
 *
 * @param {string} reportId - Report UUID
 * @param {object|null} [currentUser=null] - Authenticated user { id, role } or null
 * @returns {Promise<object>} Sanitized report with isSaved flag
 */
async function getReportById(reportId, currentUser = null) {
  if (!reportId || typeof reportId !== 'string') {
    throw new AppError('Report ID is required', 400);
  }

  const report = await prisma.report.findUnique({
    where: { id: reportId },
    include: {
      company: { select: { id: true, name: true, domain: true, flagged: true } },
      recruiter: true,
      submitter: true,
      reviewer: true,
      identifiers: {
        include: {
          identifier: true,
        },
      },
      riskAssessments: {
        where: { isCurrent: true },
        include: {
          factors: true,
        },
      },
    },
  });

  if (!report) {
    throw new AppError('Report not found', 404);
  }

  // Authorization check
  if (report.status !== 'verified') {
    if (!currentUser || !currentUser.id) {
      throw new AppError('Authentication required to view non-verified reports', 401);
    }
    const isOwner = report.submittedBy === currentUser.id;
    const isAdmin = currentUser.role === 'admin';
    if (!isOwner && !isAdmin) {
      throw new AppError('Access denied: you do not have permission to view this report', 403);
    }
  }

  const callerRole = currentUser ? currentUser.role : 'student';
  const sanitizedReport = maskReportForRole(report, callerRole);

  // Check if report is bookmarked by the current user
  let isSaved = false;
  if (currentUser && currentUser.id) {
    const saved = await prisma.savedReport.findUnique({
      where: {
        userId_reportId: {
          userId: currentUser.id,
          reportId: report.id,
        },
      },
    });
    isSaved = Boolean(saved);
  }
  sanitizedReport.isSaved = isSaved;

  return sanitizedReport;
}

/**
 * Retrieve the authenticated user's submitted reports across all statuses.
 *
 * @param {string} userId - Authenticated user ID (req.user.id)
 * @param {object} [queryOptions={}] - Query options
 * @param {string} [userRole='student'] - Caller role
 * @returns {Promise<{ reports: Array<object>, pagination: object }>}
 */
async function getMyReports(userId, queryOptions = {}, userRole = 'student') {
  if (!userId || typeof userId !== 'string') {
    throw new AppError('User ID is required', 400);
  }

  const page = Number(queryOptions.page) || 1;
  const limit = Number(queryOptions.limit) || 20;
  const skip = (page - 1) * limit;

  const primarySortField = queryOptions.sortBy === 'companyName'
    ? 'companyNameRaw'
    : (queryOptions.sortBy || 'submittedAt');
  const sortDirection = (queryOptions.sortOrder || 'desc').toLowerCase();

  const orderBy = [
    { [primarySortField]: sortDirection },
    { id: 'asc' },
  ];

  const where = {
    submittedBy: userId,
  };

  if (queryOptions.status) {
    where.status = queryOptions.status;
  }

  if (queryOptions.search && queryOptions.search.trim()) {
    const term = queryOptions.search.trim();
    where.OR = [
      { companyNameRaw: { contains: term, mode: 'insensitive' } },
      { recruiterNameRaw: { contains: term, mode: 'insensitive' } },
      { domainRaw: { contains: term, mode: 'insensitive' } },
    ];
  }

  const [total, reports] = await Promise.all([
    prisma.report.count({ where }),
    prisma.report.findMany({
      where,
      skip,
      take: limit,
      orderBy,
      include: {
        company: { select: { id: true, name: true, domain: true, flagged: true } },
        recruiter: true,
        riskAssessments: {
          where: { isCurrent: true },
          select: { id: true, score: true, category: true, summary: true, assessedAt: true },
        },
        identifiers: {
          include: {
            identifier: true,
          },
        },
      },
    }),
  ]);

  const sanitizedReports = reports.map((r) => maskReportForRole(r, userRole));

  return {
    reports: sanitizedReports,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    },
  };
}

/**
 * Bookmark / save a report idempotently for the authenticated user.
 *
 * @param {string} userId - Authenticated user ID
 * @param {string} reportId - Report UUID to bookmark
 * @param {object} currentUser - Authenticated user { id, role }
 * @returns {Promise<{ saved: boolean, reportId: string }>}
 */
async function saveReport(userId, reportId, currentUser) {
  if (!userId || typeof userId !== 'string') {
    throw new AppError('User ID is required', 400);
  }
  if (!reportId || typeof reportId !== 'string') {
    throw new AppError('Report ID is required', 400);
  }

  const report = await prisma.report.findUnique({
    where: { id: reportId },
    select: { id: true, status: true, submittedBy: true },
  });

  if (!report) {
    throw new AppError('Report not found', 404);
  }

  // A student cannot bookmark another user's private report
  if (report.status !== 'verified') {
    const isOwner = report.submittedBy === userId;
    const isAdmin = currentUser && currentUser.role === 'admin';
    if (!isOwner && !isAdmin) {
      throw new AppError('Cannot save a private report belonging to another user', 403);
    }
  }

  await prisma.savedReport.upsert({
    where: {
      userId_reportId: { userId, reportId },
    },
    create: { userId, reportId },
    update: {}, // Idempotent no-op
  });

  return { saved: true, reportId };
}

/**
 * Remove a saved report bookmark idempotently.
 *
 * @param {string} userId - Authenticated user ID
 * @param {string} reportId - Report UUID to unbookmark
 * @returns {Promise<{ saved: boolean, reportId: string }>}
 */
async function removeSavedReport(userId, reportId) {
  if (!userId || typeof userId !== 'string') {
    throw new AppError('User ID is required', 400);
  }
  if (!reportId || typeof reportId !== 'string') {
    throw new AppError('Report ID is required', 400);
  }

  await prisma.savedReport.deleteMany({
    where: { userId, reportId },
  });

  return { saved: false, reportId };
}

/**
 * Retrieve saved reports for the authenticated user with non-public leak protection.
 *
 * Invariant:
 * Saved reports that are no longer verified are NOT exposed to other users.
 * The user may retrieve their own non-verified reports only.
 *
 * @param {string} userId - Authenticated user ID
 * @param {object} [queryOptions={}] - Pagination and sorting options
 * @param {string} [userRole='student'] - Caller role
 * @returns {Promise<{ reports: Array<object>, pagination: object }>}
 */
async function getUserSavedReports(userId, queryOptions = {}, userRole = 'student') {
  if (!userId || typeof userId !== 'string') {
    throw new AppError('User ID is required', 400);
  }

  const page = Number(queryOptions.page) || 1;
  const limit = Number(queryOptions.limit) || 20;
  const skip = (page - 1) * limit;
  const sortDirection = (queryOptions.sortOrder || 'desc').toLowerCase();

  // Non-public leak protection
  const where = {
    userId,
    report: {
      OR: [
        { status: 'verified' },
        { submittedBy: userId },
        ...(userRole === 'admin' ? [{}] : []),
      ],
    },
  };

  const [total, savedEntries] = await Promise.all([
    prisma.savedReport.count({ where }),
    prisma.savedReport.findMany({
      where,
      skip,
      take: limit,
      orderBy: [
        { savedAt: sortDirection },
        { reportId: 'asc' },
      ],
      include: {
        report: {
          include: {
            company: { select: { id: true, name: true, domain: true, flagged: true } },
            recruiter: true,
            riskAssessments: {
              where: { isCurrent: true },
              select: { id: true, score: true, category: true, summary: true, assessedAt: true },
            },
            identifiers: {
              include: {
                identifier: true,
              },
            },
          },
        },
      },
    }),
  ]);

  const sanitizedReports = savedEntries.map((entry) => {
    const masked = maskReportForRole(entry.report, userRole);
    return {
      ...masked,
      savedAt: entry.savedAt,
    };
  });

  return {
    reports: sanitizedReports,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    },
  };
}

/**
 * Retrieve related verified reports sharing contact identifiers with source report.
 *
 * Invariant:
 * Evaluates the source report with the exact same authorization rules as GET /:id before
 * querying relationships, preventing probing of private reports.
 *
 * @param {string} reportId - Source report UUID
 * @param {object|null} [currentUser=null] - Requesting user { id, role } or null
 * @returns {Promise<{ sourceReportId: string, relatedReports: Array<object> }>}
 */
async function getRelatedReports(reportId, currentUser = null) {
  if (!reportId || typeof reportId !== 'string') {
    throw new AppError('Report ID is required', 400);
  }

  // 1. Authorize access to source report
  const sourceReport = await prisma.report.findUnique({
    where: { id: reportId },
    select: { id: true, status: true, submittedBy: true },
  });

  if (!sourceReport) {
    throw new AppError('Report not found', 404);
  }

  if (sourceReport.status !== 'verified') {
    if (!currentUser || !currentUser.id) {
      throw new AppError('Authentication required to view non-verified reports', 401);
    }
    const isOwner = sourceReport.submittedBy === currentUser.id;
    const isAdmin = currentUser.role === 'admin';
    if (!isOwner && !isAdmin) {
      throw new AppError('Access denied: you do not have permission to view this report', 403);
    }
  }

  // 2. Fetch linked identifier IDs for source report
  const junctions = await prisma.reportIdentifier.findMany({
    where: { reportId },
    select: { identifierId: true },
  });

  const identifierIds = junctions.map((j) => j.identifierId);
  if (identifierIds.length === 0) {
    return {
      sourceReportId: reportId,
      relatedReports: [],
    };
  }

  // 3. Query other verified reports sharing any of these identifiers
  const relatedReports = await prisma.report.findMany({
    where: {
      id: { not: reportId }, // Exclude source report
      status: 'verified',    // Verified reports only contribute to public intelligence
      identifiers: {
        some: {
          identifierId: { in: identifierIds },
        },
      },
    },
    take: 10,
    orderBy: [
      { submittedAt: 'desc' },
      { id: 'asc' },
    ],
    include: {
      company: { select: { id: true, name: true, domain: true, flagged: true } },
      riskAssessments: {
        where: { isCurrent: true },
        select: { id: true, score: true, category: true, summary: true },
      },
      identifiers: {
        where: { identifierId: { in: identifierIds } },
        include: {
          identifier: {
            select: { id: true, type: true, value: true, confidence: true },
          },
        },
      },
    },
  });

  const callerRole = currentUser ? currentUser.role : 'student';

  const sanitizedRelated = relatedReports.map((r) => {
    const masked = maskReportForRole(r, callerRole);
    const sharedIdentifiers = (r.identifiers || []).map((j) => {
      const maskedIdent = maskIdentifierForRole(j.identifier, callerRole);
      return {
        id: j.identifier.id,
        type: j.identifier.type,
        value: maskedIdent.value,
        confidence: j.confidence,
      };
    });

    return {
      id: masked.id,
      companyName: masked.companyNameRaw,
      companyNameRaw: masked.companyNameRaw,
      status: masked.status,
      submittedAt: masked.submittedAt,
      currentRisk: masked.riskAssessments?.[0] || null,
      sharedIdentifiers,
    };
  });

  return {
    sourceReportId: reportId,
    relatedReports: sanitizedRelated,
  };
}

/**
 * Permitted status transitions for Phase 8 Admin Moderation.
 * Terminal states (verified, rejected) cannot be transitioned.
 */
const PERMITTED_MODERATION_TRANSITIONS = Object.freeze({
  pending: ['verified', 'rejected', 'investigating'],
  investigating: ['verified', 'rejected'],
  verified: [],
  rejected: [],
});

/**
 * Retrieve paginated reports for administrators across moderation statuses.
 * Default filter is status = 'pending' (the moderation queue).
 *
 * @param {object} [queryOptions={}] - Validated query parameters
 * @param {string} [callerRole='admin'] - Role of requesting user
 * @returns {Promise<{ reports: Array<object>, pagination: object }>}
 */
async function getAdminReports(queryOptions = {}, callerRole = 'admin') {
  if (callerRole !== 'admin') {
    throw new AppError('Admin access required', 403);
  }

  const page = Number(queryOptions.page) || 1;
  const limit = Number(queryOptions.limit) || 20;
  const skip = (page - 1) * limit;

  const primarySortField = queryOptions.sortBy === 'companyName'
    ? 'companyNameRaw'
    : (queryOptions.sortBy || 'submittedAt');
  const sortDirection = (queryOptions.sortOrder || 'desc').toLowerCase();

  const orderBy = [
    { [primarySortField]: sortDirection },
    { id: 'asc' }, // Stable tie-breaker
  ];

  const where = {};

  // Default admin listing filter is 'pending'
  where.status = queryOptions.status || 'pending';

  if (queryOptions.search && queryOptions.search.trim()) {
    const term = queryOptions.search.trim();
    where.OR = [
      { companyNameRaw: { contains: term, mode: 'insensitive' } },
      { recruiterNameRaw: { contains: term, mode: 'insensitive' } },
      { domainRaw: { contains: term, mode: 'insensitive' } },
    ];
  }

  if (queryOptions.companyId) {
    where.companyId = queryOptions.companyId;
  }

  if (queryOptions.recruiterId) {
    where.recruiterId = queryOptions.recruiterId;
  }

  if (queryOptions.identifierType && queryOptions.identifierValue) {
    let normalized = queryOptions.identifierValue.trim();
    try {
      normalized = normalizeIdentifier(queryOptions.identifierType, normalized);
    } catch {
      normalized = normalized.toLowerCase();
    }

    where.identifiers = {
      some: {
        identifier: {
          type: queryOptions.identifierType,
          normalizedValue: normalized,
        },
      },
    };
  }

  const [total, reports] = await Promise.all([
    prisma.report.count({ where }),
    prisma.report.findMany({
      where,
      skip,
      take: limit,
      orderBy,
      include: {
        company: { select: { id: true, name: true, domain: true, flagged: true } },
        recruiter: true,
        submitter: { select: { id: true, name: true, college: true, role: true } },
        reviewer: { select: { id: true, name: true, role: true } },
        riskAssessments: {
          where: { isCurrent: true },
          select: { id: true, score: true, category: true, summary: true, assessedAt: true },
        },
        identifiers: {
          include: {
            identifier: true,
          },
        },
      },
    }),
  ]);

  const sanitizedReports = reports.map((r) => maskReportForRole(r, 'admin'));

  return {
    reports: sanitizedReports,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    },
  };
}

/**
 * Execute an atomic report moderation status transition.
 *
 * Rules:
 * - Reviewer ID is derived strictly from server-authenticated adminId.
 * - Same-status requests throw HTTP 409 Conflict.
 * - Attempts to modify finalized verified/rejected reports throw HTTP 400 Bad Request.
 * - Uses conditional updateMany with the expected current status to prevent concurrent races.
 * - Verifies affected row count === 1. If 0, throws HTTP 409 Conflict without writing audit log.
 * - Creates STATUS_CHANGED AuditLog row in the same transaction.
 *
 * @param {string} reportId - Target report UUID
 * @param {string} targetStatus - Target status ('verified', 'rejected', 'investigating')
 * @param {string} adminId - Authenticated administrator user ID
 * @param {string|null} [notes=null] - Optional moderation notes
 * @returns {Promise<{ report: object, auditLog: object }>}
 */
async function moderateReport(reportId, targetStatus, adminId, notes = null) {
  if (!reportId || typeof reportId !== 'string') {
    throw new AppError('Report ID is required and must be a string', 400);
  }
  if (!adminId || typeof adminId !== 'string') {
    throw new AppError('Admin ID is required and must be a string', 400);
  }
  if (!['verified', 'rejected', 'investigating'].includes(targetStatus)) {
    throw new AppError('Invalid target moderation status', 400);
  }

  return await prisma.$transaction(async (tx) => {
    // 1. Fetch current report status inside the transaction
    const currentReport = await tx.report.findUnique({
      where: { id: reportId },
      select: {
        id: true,
        status: true,
        companyNameRaw: true,
        reviewedBy: true,
        reviewedAt: true,
      },
    });

    if (!currentReport) {
      throw new AppError('Report not found', 404);
    }

    // 2. Same-status request returns 409 Conflict
    if (currentReport.status === targetStatus) {
      throw new AppError(`Report is already ${targetStatus}`, 409);
    }

    // 3. Finalized status check: verified / rejected cannot be modified
    if (currentReport.status === 'verified' || currentReport.status === 'rejected') {
      const message = currentReport.status === 'verified'
        ? 'Verified reports are finalized and cannot be modified'
        : 'Rejected reports are finalized and cannot be reopened';
      throw new AppError(message, 400);
    }

    // 4. Permitted status transition check
    const allowedTargets = PERMITTED_MODERATION_TRANSITIONS[currentReport.status] || [];
    if (!allowedTargets.includes(targetStatus)) {
      throw new AppError(
        `Invalid status transition from '${currentReport.status}' to '${targetStatus}'`,
        400
      );
    }

    const expectedCurrentStatus = currentReport.status;
    const now = new Date();
    const isVerified = targetStatus === 'verified';

    // 5. Conditional updateMany protecting against concurrent moderation
    const updateResult = await tx.report.updateMany({
      where: {
        id: reportId,
        status: expectedCurrentStatus,
      },
      data: {
        status: targetStatus,
        isVerified,
        reviewedBy: adminId,
        reviewedAt: now,
      },
    });

    // 6. Check affected row count: must be exactly 1
    if (updateResult.count === 0) {
      throw new AppError(
        'Report was modified by another administrator or is no longer in expected status',
        409
      );
    }

    // 7. Create STATUS_CHANGED AuditLog entry inside the same transaction
    const auditLog = await tx.auditLog.create({
      data: {
        actorId: adminId,
        action: 'STATUS_CHANGED',
        reportId: currentReport.id,
        oldValue: expectedCurrentStatus,
        newValue: targetStatus,
        notes: notes && typeof notes === 'string' && notes.trim()
          ? notes.trim()
          : `Status updated from ${expectedCurrentStatus} to ${targetStatus}`,
      },
    });

    // 8. Fetch full updated report graph with relations for response
    const updatedReport = await tx.report.findUnique({
      where: { id: reportId },
      include: {
        company: { select: { id: true, name: true, domain: true, flagged: true } },
        recruiter: true,
        submitter: { select: { id: true, name: true, college: true, role: true } },
        reviewer: { select: { id: true, name: true, role: true } },
        riskAssessments: {
          where: { isCurrent: true },
          select: { id: true, score: true, category: true, summary: true, assessedAt: true },
        },
        identifiers: {
          include: {
            identifier: true,
          },
        },
      },
    });

    return {
      report: maskReportForRole(updatedReport, 'admin'),
      auditLog,
    };
  });
}

module.exports = {
  createReport,
  getPublicReports,
  getReportById,
  getMyReports,
  saveReport,
  removeSavedReport,
  getUserSavedReports,
  getRelatedReports,
  getAdminReports,
  moderateReport,
  PERMITTED_MODERATION_TRANSITIONS,
};
