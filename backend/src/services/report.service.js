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
const { extractIdentifiersFromReport } = require('../utils/normalize');
const { calculateRiskAssessment } = require('./risk.service');
const { maskReportForRole } = require('../utils/privacy');

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

module.exports = {
  createReport,
};
