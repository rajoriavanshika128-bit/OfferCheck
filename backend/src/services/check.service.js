'use strict';

/**
 * backend/src/services/check.service.js
 * Core domain service for offer checking, fraud-risk assessment, and check history.
 *
 * Implements Phase 6 business logic:
 * 1. Extraction and normalization of identifiers using existing Phase 5A normalizer.
 * 2. Pre-scoring historical intelligence read restricted strictly to VERIFIED reports.
 * 3. Pure deterministic fraud risk calculation via Phase 5A risk engine (calculateRiskAssessment).
 * 4. Persistence of the check and assessment snapshot in OfferCheck model.
 * 5. HMAC-SHA256 client IP hashing for privacy-safe rate limiting without Redis.
 * 6. Authenticated check history retrieval with ownership isolation and pagination.
 * 7. Single check retrieval with ownership enforcement (assertOwnership) and role-based PII masking.
 */

const crypto = require('crypto');
const prisma = require('../utils/prisma');
const { AppError } = require('../utils/errors');
const { extractIdentifiersFromReport } = require('../utils/normalize');
const { calculateRiskAssessment } = require('./risk.service');
const {
  maskPhone,
  maskEmail,
  maskUpi,
  maskIdentifierForRole,
} = require('../utils/privacy');
const { assertOwnership } = require('../utils/rbac');

/**
 * Compute HMAC-SHA256 hash of client IP using server-side IP_HASH_SECRET.
 * Enables rate-limiting without storing identifiable client IPs or PII.
 *
 * @param {string|null} ip - Client IP address
 * @returns {string|null} 64-character hex hash or null if ip/secret unavailable
 */
function hashClientIp(ip) {
  const secret = process.env.IP_HASH_SECRET;
  if (!secret || !ip) {
    return null;
  }
  return crypto.createHmac('sha256', secret).update(String(ip).trim()).digest('hex');
}

/**
 * Sanitize an offer check record and its result snapshot based on user role.
 * Protects PII: non-admin roles (students) receive masked contact queries and identifiers.
 * Internal rate-limiting ipHash is strictly excluded from responses.
 *
 * @param {object} check - Raw OfferCheck record from database
 * @param {string} [role='student'] - Caller role ('student' | 'admin')
 * @returns {object} Sanitized offer check object
 */
function sanitizeCheckForRole(check, role = 'student') {
  if (!check || typeof check !== 'object') return check;

  const isStudent = role !== 'admin';

  const sanitized = {
    id: check.id,
    checkId: check.id, // alias for frontend compatibility
    companyName: check.companyName || null,
    phoneQuery: isStudent ? maskPhone(check.phoneQuery) : check.phoneQuery,
    emailQuery: isStudent ? maskEmail(check.emailQuery) : check.emailQuery,
    upiQuery: isStudent ? maskUpi(check.upiQuery) : check.upiQuery,
    domainQuery: check.domainQuery || null,
    riskScore: check.riskScore !== undefined ? check.riskScore : null,
    riskCategory: check.riskCategory || null,
    checkedAt: check.checkedAt,
  };

  if (check.result && typeof check.result === 'object') {
    const res = check.result;
    const matchedIdentifiers = Array.isArray(res.matchedIdentifiers)
      ? res.matchedIdentifiers.map((idObj) => maskIdentifierForRole(idObj, role))
      : [];

    sanitized.result = {
      score: res.score,
      riskCategory: res.riskCategory,
      riskLevel: res.riskLevel,
      summary: res.summary,
      disclaimer: res.disclaimer,
      factors: res.factors || [],
      policyVersion: res.policyVersion,
      metadata: res.metadata,
      matchedIdentifiers,
      connectedReports: res.connectedReports || [],
    };

    // Flatten top-level convenience properties
    sanitized.riskLevel = res.riskLevel;
    sanitized.summary = res.summary;
    sanitized.disclaimer = res.disclaimer;
    sanitized.factors = res.factors || [];
    sanitized.riskFactors = res.factors || []; // alias for frontend
    sanitized.matchedIdentifiers = matchedIdentifiers;
    sanitized.connectedReports = res.connectedReports || [];
    sanitized.metadata = res.metadata;
    sanitized.policyVersion = res.policyVersion;
  }

  return sanitized;
}

/**
 * Perform an authenticated offer check.
 *
 * Steps:
 * 1. Validate inputs.
 * 2. Extract and normalize contact identifiers (phone, email, upi, domain, bank_account).
 * 3. Query historical reports matching extracted identifiers — strictly VERIFIED reports only.
 * 4. Run calculateRiskAssessment() with intrinsic signals and verified historical matches.
 * 5. Compute HMAC-SHA256 of client IP for privacy-preserving rate-limiting.
 * 6. Persist the check and assessment snapshot in the offer_checks table.
 * 7. Return sanitized result matching caller role.
 *
 * @param {string} userId - Authenticated user ID (req.user.id)
 * @param {object} validatedData - Canonical validated data from offerCheckSchema
 * @param {string} [userRole='student'] - Caller role ('student' | 'admin')
 * @param {string|null} [clientIp=null] - Request IP address
 * @returns {Promise<object>} Sanitized offer check assessment result
 */
async function performCheck(userId, validatedData, userRole = 'student', clientIp = null) {
  if (!userId || typeof userId !== 'string') {
    throw new AppError('User ID is required and must be a string', 400);
  }

  if (!validatedData || typeof validatedData !== 'object') {
    throw new AppError('Offer check data is required and must be an object', 400);
  }

  // 1. Extract and normalize all supplied contact identifiers (Phase 5A normalizer)
  // Deduplicates in-memory by composite key `${type}:${normalized}`
  const extractedIdentifiers = extractIdentifiersFromReport(validatedData);

  // 2. Query historical verified reports linked to these identifiers
  // Strict provenance: database-query level filter restricts matches strictly to status = 'verified'
  let historicalMatches = [];
  let existingRecords = [];

  if (extractedIdentifiers.length > 0) {
    existingRecords = await prisma.identifier.findMany({
      where: {
        OR: extractedIdentifiers.map((i) => ({
          type: i.type,
          normalizedValue: i.normalized,
        })),
      },
      select: {
        id: true,
        type: true,
        value: true,
        normalizedValue: true,
        riskScore: true,
        confidence: true,
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
                companyNameRaw: true,
                status: true,
                isVerified: true,
                riskAssessments: {
                  where: { isCurrent: true },
                  select: {
                    score: true,
                    category: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    historicalMatches = existingRecords.map((idRec) => ({
      type: idRec.type,
      normalizedValue: idRec.normalizedValue,
      reports: (idRec.reports || []).map((r) => ({
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

  // 4. Extract distinct connected verified reports for explanation (zero submitter PII)
  const connectedReportMap = new Map();
  for (const idRec of existingRecords) {
    if (Array.isArray(idRec.reports)) {
      for (const rItem of idRec.reports) {
        const rep = rItem.report;
        if (rep && rep.status === 'verified' && !connectedReportMap.has(rep.id)) {
          const currentAssessment = rep.riskAssessments?.[0] || null;
          connectedReportMap.set(rep.id, {
            id: rep.id,
            companyName: rep.companyNameRaw,
            status: rep.status,
            isVerified: rep.isVerified,
            riskScore: currentAssessment ? currentAssessment.score : null,
            riskCategory: currentAssessment ? currentAssessment.category : null,
          });
        }
      }
    }
  }
  const connectedReports = Array.from(connectedReportMap.values());

  // 5. Matched identifiers with verified report links (masked for role)
  const matchedIdentifiers = existingRecords
    .filter((idRec) => Array.isArray(idRec.reports) && idRec.reports.length > 0)
    .map((idRec) => {
      const masked = maskIdentifierForRole(idRec, userRole);
      return {
        id: idRec.id,
        type: idRec.type,
        value: masked.value,
        riskScore: idRec.riskScore,
        confidence: idRec.confidence,
        verifiedReportsCount: idRec.reports.length,
      };
    });

  // 6. Compute HMAC-SHA256 client IP hash
  const ipHash = hashClientIp(clientIp);

  // 7. Persist check and assessment snapshot in OfferCheck model
  const checkRecord = await prisma.offerCheck.create({
    data: {
      userId,
      companyName: validatedData.companyName || null,
      phoneQuery: validatedData.phone || validatedData.phoneQuery || null,
      emailQuery: validatedData.email || validatedData.emailQuery || null,
      upiQuery: validatedData.upi || validatedData.upiQuery || null,
      domainQuery: validatedData.domain || validatedData.domainQuery || null,
      riskScore: assessmentResult.score,
      riskCategory: assessmentResult.riskCategory,
      result: {
        score: assessmentResult.score,
        riskCategory: assessmentResult.riskCategory,
        riskLevel: assessmentResult.riskLevel,
        summary: assessmentResult.summary,
        disclaimer: assessmentResult.disclaimer,
        factors: assessmentResult.factors,
        policyVersion: assessmentResult.policyVersion,
        metadata: assessmentResult.metadata,
        matchedIdentifiers,
        connectedReports,
      },
      ipHash,
    },
  });

  // 8. Return role-sanitized result
  return sanitizeCheckForRole(checkRecord, userRole);
}

/**
 * Retrieve paginated offer check history for the authenticated user.
 *
 * @param {string} userId - Authenticated user ID (req.user.id)
 * @param {object} [queryOptions={}] - Pagination and filter options from offerCheckQuerySchema
 * @param {string} [userRole='student'] - Caller role ('student' | 'admin')
 * @returns {Promise<{ checks: Array<object>, pagination: object }>}
 */
async function getCheckHistory(userId, queryOptions = {}, userRole = 'student') {
  if (!userId || typeof userId !== 'string') {
    throw new AppError('User ID is required', 400);
  }

  const page = Number(queryOptions.page) || 1;
  const limit = Number(queryOptions.limit) || 20;
  const skip = (page - 1) * limit;
  const sortBy = queryOptions.sortBy || 'checkedAt';
  const sortOrder = (queryOptions.sortOrder || 'desc').toLowerCase();

  const where = {
    userId,
  };

  if (queryOptions.riskCategory) {
    where.riskCategory = queryOptions.riskCategory;
  }

  const [total, records] = await Promise.all([
    prisma.offerCheck.count({ where }),
    prisma.offerCheck.findMany({
      where,
      orderBy: {
        [sortBy]: sortOrder,
      },
      skip,
      take: limit,
      select: {
        id: true,
        companyName: true,
        phoneQuery: true,
        emailQuery: true,
        upiQuery: true,
        domainQuery: true,
        riskScore: true,
        riskCategory: true,
        checkedAt: true,
        result: true,
      },
    }),
  ]);

  const sanitizedChecks = records.map((record) => sanitizeCheckForRole(record, userRole));

  return {
    checks: sanitizedChecks,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    },
  };
}

/**
 * Retrieve a single offer check by ID with ownership enforcement.
 *
 * @param {string} checkId - Check UUID
 * @param {object} currentUser - Authenticated user object (req.user: { id, role })
 * @returns {Promise<object>} Sanitized offer check record
 */
async function getCheckById(checkId, currentUser) {
  if (!checkId || typeof checkId !== 'string') {
    throw new AppError('Check ID is required', 400);
  }

  if (!currentUser || !currentUser.id) {
    throw new AppError('Authentication required', 401);
  }

  const check = await prisma.offerCheck.findUnique({
    where: { id: checkId },
    select: {
      id: true,
      userId: true,
      companyName: true,
      phoneQuery: true,
      emailQuery: true,
      upiQuery: true,
      domainQuery: true,
      riskScore: true,
      riskCategory: true,
      checkedAt: true,
      result: true,
    },
  });

  if (!check) {
    throw new AppError('Offer check not found', 404);
  }

  // Enforce ownership: caller must own resource or be an administrator
  assertOwnership(check.userId, currentUser);

  return sanitizeCheckForRole(check, currentUser.role);
}

/**
 * Retrieve aggregated dashboard metrics for an authenticated user.
 * Executes genuine database counts, averages, and 7-day UTC activity.
 *
 * @param {string} userId - Authenticated user UUID
 * @param {string} [role='student'] - Authenticated user role
 * @returns {Promise<object>} Aggregated dashboard metrics object
 */
async function getDashboardMetrics(userId, role = 'student') {
  if (!userId || typeof userId !== 'string') {
    throw new AppError('User ID is required', 400);
  }

  const now = new Date();
  const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const startDateUtc = new Date(todayUtc);
  startDateUtc.setUTCDate(todayUtc.getUTCDate() - 6);

  const [
    totalChecks,
    reportsSubmitted,
    savedReports,
    highRiskChecks,
    avgResult,
    weeklyChecks,
    recent,
  ] = await Promise.all([
    prisma.offerCheck.count({ where: { userId } }),
    prisma.report.count({ where: { submittedBy: userId } }),
    prisma.savedReport.count({ where: { userId } }),
    prisma.offerCheck.count({
      where: {
        userId,
        riskCategory: { in: ['critical', 'high'] },
      },
    }),
    prisma.offerCheck.aggregate({
      where: { userId, riskScore: { not: null } },
      _avg: { riskScore: true },
    }),
    prisma.offerCheck.findMany({
      where: {
        userId,
        checkedAt: { gte: startDateUtc },
      },
      select: { checkedAt: true },
    }),
    prisma.offerCheck.findMany({
      where: { userId },
      orderBy: { checkedAt: 'desc' },
      take: 5,
      select: {
        id: true,
        userId: true,
        companyName: true,
        phoneQuery: true,
        emailQuery: true,
        upiQuery: true,
        domainQuery: true,
        riskScore: true,
        riskCategory: true,
        checkedAt: true,
        result: true,
      },
    }),
  ]);

  // Construct continuous 7-day UTC activity array
  const countsByDate = {};
  for (const c of weeklyChecks) {
    if (c.checkedAt) {
      const dStr = c.checkedAt.toISOString().slice(0, 10);
      countsByDate[dStr] = (countsByDate[dStr] || 0) + 1;
    }
  }

  const weeklyActivity = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(startDateUtc);
    d.setUTCDate(startDateUtc.getUTCDate() + i);
    const dateStr = d.toISOString().slice(0, 10);
    const day = d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
    weeklyActivity.push({
      date: dateStr,
      day,
      checks: countsByDate[dateStr] || 0,
    });
  }

  const sanitizedRecentChecks = recent.map((item) => sanitizeCheckForRole(item, role));
  const avgRiskScore = avgResult._avg?.riskScore !== null && avgResult._avg?.riskScore !== undefined
    ? Math.round(avgResult._avg.riskScore)
    : null;

  return {
    totalChecks,
    reportsSubmitted,
    savedReports,
    highRiskChecks,
    avgRiskScore,
    weeklyActivity,
    recentChecks: sanitizedRecentChecks,
  };
}

module.exports = {
  hashClientIp,
  sanitizeCheckForRole,
  performCheck,
  getCheckHistory,
  getCheckById,
  getDashboardMetrics,
};
