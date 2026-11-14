'use strict';

/**
 * backend/test/report_management.test.js
 * Comprehensive unit test suite for Phase 7 Report Management service layer.
 *
 * SAFETY INVARIANTS:
 * - ZERO database connections: Prisma client is deterministically mocked in-memory.
 * - ZERO .env access or modification.
 * - Independent and repeatable: mocks are isolated and restored after each test.
 *
 * COVERS:
 * 1. Public Discovery (getPublicReports):
 *    - Query strictly enforces status = 'verified' at database level.
 *    - Search filters companyNameRaw, recruiterNameRaw, domainRaw.
 *    - Identifier search normalizes input and filters via junction.
 *    - Stable pagination with deterministic secondary tie-breaker ({ id: 'asc' }).
 *    - Primary sort field allowlisting and companyName -> companyNameRaw mapping.
 * 2. Single Report Details (getReportById):
 *    - Verified report accessible without credentials (anonymous visitor).
 *    - Non-verified report throws 401 when unauthenticated.
 *    - Non-verified report throws 403 when accessed by another student.
 *    - Non-verified report accessible to original submitter (author).
 *    - Non-verified report accessible to admin via bypass.
 *    - isSaved flag accurate based on saved_reports lookup.
 *    - Non-existent report throws 404 AppError.
 * 3. User Submissions (getMyReports):
 *    - Strictly queries where.submittedBy = userId.
 *    - Author can view all report statuses (pending, verified, rejected, investigating).
 * 4. Bookmarks / Saved Reports:
 *    - saveReport upserts into saved_reports idempotently.
 *    - saveReport rejects saving another user's private report with 403.
 *    - removeSavedReport deletes from saved_reports idempotently.
 *    - getUserSavedReports enforces non-public leak protection: reports that lose verified
 *      status are excluded for non-author students, while authors and admins retain access.
 * 5. Related Reports (getRelatedReports):
 *    - Evaluates source report access first: rejects unauthenticated (401) and unauthorized students (403) on private reports.
 *    - Queries other verified reports sharing identifiers, excluding the source report itself.
 * 6. Privacy Masking:
 *    - Students receive masked PII and masked identifiers.
 *    - Admins receive unmasked data.
 */

// Configure environment to prevent dotenv loading from prisma.js
process.env.DATABASE_URL = 'postgresql://mock:mock@localhost:5432/mock_test';
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'mock_jwt_secret_at_least_32_characters_long_0123456789';

const assert = require('assert');
const prisma = require('../src/utils/prisma');
const reportService = require('../src/services/report.service');
const { AppError } = require('../src/utils/errors');

// ─── Test Harness ────────────────────────────────────────────────────────────

let totalTests = 0;
let passedTests = 0;

async function runTest(name, fn) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`  ✅ [PASS] ${name}`);
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}:`, err.message);
    throw err;
  }
}

// ─── Mock Infrastructure ────────────────────────────────────────────────────

const originalPrismaMethods = {
  reportCount: prisma.report.count,
  reportFindMany: prisma.report.findMany,
  reportFindUnique: prisma.report.findUnique,
  reportIdentifierFindMany: prisma.reportIdentifier.findMany,
  savedReportUpsert: prisma.savedReport.upsert,
  savedReportDeleteMany: prisma.savedReport.deleteMany,
  savedReportCount: prisma.savedReport.count,
  savedReportFindMany: prisma.savedReport.findMany,
  savedReportFindUnique: prisma.savedReport.findUnique,
};

function restorePrisma() {
  prisma.report.count = originalPrismaMethods.reportCount;
  prisma.report.findMany = originalPrismaMethods.reportFindMany;
  prisma.report.findUnique = originalPrismaMethods.reportFindUnique;
  prisma.reportIdentifier.findMany = originalPrismaMethods.reportIdentifierFindMany;
  prisma.savedReport.upsert = originalPrismaMethods.savedReportUpsert;
  prisma.savedReport.deleteMany = originalPrismaMethods.savedReportDeleteMany;
  prisma.savedReport.count = originalPrismaMethods.savedReportCount;
  prisma.savedReport.findMany = originalPrismaMethods.savedReportFindMany;
  prisma.savedReport.findUnique = originalPrismaMethods.savedReportFindUnique;
}

function createMockPrisma(options = {}) {
  const calls = {
    reportCount: [],
    reportFindMany: [],
    reportFindUnique: [],
    reportIdentifierFindMany: [],
    savedReportUpsert: [],
    savedReportDeleteMany: [],
    savedReportCount: [],
    savedReportFindMany: [],
    savedReportFindUnique: [],
  };

  prisma.report.count = async (args) => {
    calls.reportCount.push(args);
    if (options.onReportCount) return options.onReportCount(args);
    return options.count !== undefined ? options.count : (options.reports ? options.reports.length : 0);
  };

  prisma.report.findMany = async (args) => {
    calls.reportFindMany.push(args);
    if (options.onReportFindMany) return options.onReportFindMany(args);
    return options.reports || [];
  };

  prisma.report.findUnique = async (args) => {
    calls.reportFindUnique.push(args);
    if (options.onReportFindUnique) return options.onReportFindUnique(args);
    return options.report || null;
  };

  prisma.reportIdentifier.findMany = async (args) => {
    calls.reportIdentifierFindMany.push(args);
    if (options.onReportIdentifierFindMany) return options.onReportIdentifierFindMany(args);
    return options.junctions || [];
  };

  prisma.savedReport.upsert = async (args) => {
    calls.savedReportUpsert.push(args);
    if (options.onSavedReportUpsert) return options.onSavedReportUpsert(args);
    return { userId: args.create.userId, reportId: args.create.reportId, savedAt: new Date() };
  };

  prisma.savedReport.deleteMany = async (args) => {
    calls.savedReportDeleteMany.push(args);
    if (options.onSavedReportDeleteMany) return options.onSavedReportDeleteMany(args);
    return { count: 1 };
  };

  prisma.savedReport.count = async (args) => {
    calls.savedReportCount.push(args);
    if (options.onSavedReportCount) return options.onSavedReportCount(args);
    return options.savedCount !== undefined ? options.savedCount : 0;
  };

  prisma.savedReport.findMany = async (args) => {
    calls.savedReportFindMany.push(args);
    if (options.onSavedReportFindMany) return options.onSavedReportFindMany(args);
    return options.savedEntries || [];
  };

  prisma.savedReport.findUnique = async (args) => {
    calls.savedReportFindUnique.push(args);
    if (options.onSavedReportFindUnique) return options.onSavedReportFindUnique(args);
    return options.savedRecord || null;
  };

  return calls;
}

// ─── Test Suite Execution ───────────────────────────────────────────────────

async function runAllTests() {
  console.log('\n--- Phase 7: Report Management Service Unit Tests ---\n');

  // Group 1: Public Report Discovery
  console.log('1. Public Discovery & Filtering:');

  await runTest('getPublicReports strictly enforces status: "verified" at database level', async () => {
    const calls = createMockPrisma({
      reports: [
        {
          id: 'rep-1',
          companyNameRaw: 'FakeCorp',
          status: 'verified',
          submittedAt: new Date(),
          phoneRaw: '+919876543210',
          emailRaw: 'scam@fakecorp.com',
          riskAssessments: [{ id: 'ra-1', score: 85, category: 'critical', isCurrent: true }],
        },
      ],
      count: 1,
    });
    try {
      const result = await reportService.getPublicReports({}, 'student');
      assert.strictEqual(calls.reportCount.length, 1);
      assert.strictEqual(calls.reportCount[0].where.status, 'verified');
      assert.strictEqual(calls.reportFindMany.length, 1);
      assert.strictEqual(calls.reportFindMany[0].where.status, 'verified');
      assert.strictEqual(result.reports.length, 1);
      assert.strictEqual(result.pagination.total, 1);
    } finally {
      restorePrisma();
    }
  });

  await runTest('getPublicReports generates case-insensitive search clauses across company, recruiter, domain', async () => {
    const calls = createMockPrisma({ count: 0, reports: [] });
    try {
      await reportService.getPublicReports({ search: 'Acme' }, 'student');
      const where = calls.reportFindMany[0].where;
      assert.strictEqual(where.status, 'verified');
      assert.ok(Array.isArray(where.OR));
      assert.deepStrictEqual(where.OR, [
        { companyNameRaw: { contains: 'Acme', mode: 'insensitive' } },
        { recruiterNameRaw: { contains: 'Acme', mode: 'insensitive' } },
        { domainRaw: { contains: 'Acme', mode: 'insensitive' } },
      ]);
    } finally {
      restorePrisma();
    }
  });

  await runTest('getPublicReports normalizes identifier search and filters via junction', async () => {
    const calls = createMockPrisma({ count: 0, reports: [] });
    try {
      await reportService.getPublicReports(
        { identifierType: 'phone', identifierValue: '9876543210' },
        'student'
      );
      const where = calls.reportFindMany[0].where;
      assert.strictEqual(where.status, 'verified');
      assert.ok(where.identifiers);
      assert.strictEqual(where.identifiers.some.identifier.type, 'phone');
      assert.strictEqual(where.identifiers.some.identifier.normalizedValue, '+919876543210');
    } finally {
      restorePrisma();
    }
  });

  await runTest('getPublicReports applies deterministic pagination and secondary sort tie-breaker', async () => {
    const calls = createMockPrisma({ count: 50, reports: [] });
    try {
      const result = await reportService.getPublicReports(
        { page: 2, limit: 15, sortBy: 'companyName', sortOrder: 'asc' },
        'student'
      );
      const args = calls.reportFindMany[0];
      assert.strictEqual(args.skip, 15);
      assert.strictEqual(args.take, 15);
      // Verify primary sort companyName -> companyNameRaw and secondary { id: 'asc' }
      assert.deepStrictEqual(args.orderBy, [
        { companyNameRaw: 'asc' },
        { id: 'asc' },
      ]);
      assert.strictEqual(result.pagination.page, 2);
      assert.strictEqual(result.pagination.limit, 15);
      assert.strictEqual(result.pagination.total, 50);
      assert.strictEqual(result.pagination.totalPages, 4);
    } finally {
      restorePrisma();
    }
  });

  // Group 2: Single Report Details & Visibility Rules
  console.log('\n2. Single Report Details & Visibility Rules:');

  await runTest('getReportById succeeds for verified report without currentUser (anonymous visitor)', async () => {
    const calls = createMockPrisma({
      report: {
        id: 'rep-verified-1',
        companyNameRaw: 'Verified Scam Corp',
        status: 'verified',
        submittedBy: 'usr-author',
        phoneRaw: '+919876543210',
        emailRaw: 'hr@scam.com',
        offerMessage: 'Pay fee',
        riskAssessments: [{ id: 'ra-1', score: 70, category: 'high' }],
      },
    });
    try {
      const res = await reportService.getReportById('rep-verified-1', null);
      assert.strictEqual(res.id, 'rep-verified-1');
      assert.strictEqual(res.phoneRaw, '+9198XXXXX', 'Must mask phone for anonymous visitor');
      assert.strictEqual(res.isSaved, false);
    } finally {
      restorePrisma();
    }
  });

  await runTest('getReportById throws 401 when non-verified report requested without credentials', async () => {
    const calls = createMockPrisma({
      report: {
        id: 'rep-pending-1',
        companyNameRaw: 'Pending Tech',
        status: 'pending',
        submittedBy: 'usr-author',
      },
    });
    try {
      await assert.rejects(
        async () => reportService.getReportById('rep-pending-1', null),
        (err) => err instanceof AppError && err.statusCode === 401
      );
    } finally {
      restorePrisma();
    }
  });

  await runTest('getReportById throws 403 when non-verified report requested by another student', async () => {
    const calls = createMockPrisma({
      report: {
        id: 'rep-pending-1',
        companyNameRaw: 'Pending Tech',
        status: 'pending',
        submittedBy: 'usr-author',
      },
    });
    try {
      await assert.rejects(
        async () => reportService.getReportById('rep-pending-1', { id: 'usr-stranger', role: 'student' }),
        (err) => err instanceof AppError && err.statusCode === 403
      );
    } finally {
      restorePrisma();
    }
  });

  await runTest('getReportById succeeds for non-verified report when requested by author', async () => {
    const calls = createMockPrisma({
      report: {
        id: 'rep-pending-1',
        companyNameRaw: 'Pending Tech',
        status: 'pending',
        submittedBy: 'usr-author',
        phoneRaw: '+919876543210',
        riskAssessments: [],
      },
    });
    try {
      const res = await reportService.getReportById('rep-pending-1', { id: 'usr-author', role: 'student' });
      assert.strictEqual(res.id, 'rep-pending-1');
      assert.strictEqual(res.status, 'pending');
    } finally {
      restorePrisma();
    }
  });

  await runTest('getReportById succeeds for non-verified report when requested by admin', async () => {
    const calls = createMockPrisma({
      report: {
        id: 'rep-pending-1',
        companyNameRaw: 'Pending Tech',
        status: 'pending',
        submittedBy: 'usr-author',
        phoneRaw: '+919876543210',
        emailRaw: 'scam@tech.com',
        riskAssessments: [],
      },
    });
    try {
      const res = await reportService.getReportById('rep-pending-1', { id: 'admin-1', role: 'admin' });
      assert.strictEqual(res.id, 'rep-pending-1');
      assert.strictEqual(res.phoneRaw, '+919876543210', 'Admin must receive unmasked phone');
    } finally {
      restorePrisma();
    }
  });

  await runTest('getReportById throws 404 AppError when report does not exist', async () => {
    const calls = createMockPrisma({ report: null });
    try {
      await assert.rejects(
        async () => reportService.getReportById('rep-missing', null),
        (err) => err instanceof AppError && err.statusCode === 404
      );
    } finally {
      restorePrisma();
    }
  });

  // Group 3: User Submission History (getMyReports)
  console.log('\n3. Author Submission History (getMyReports):');

  await runTest('getMyReports strictly queries where.submittedBy = userId across all statuses', async () => {
    const calls = createMockPrisma({
      count: 2,
      reports: [
        { id: 'r1', companyNameRaw: 'Company 1', status: 'pending', submittedBy: 'usr-1', submittedAt: new Date(), phoneRaw: null, riskAssessments: [] },
        { id: 'r2', companyNameRaw: 'Company 2', status: 'rejected', submittedBy: 'usr-1', submittedAt: new Date(), phoneRaw: null, riskAssessments: [] },
      ],
    });
    try {
      const res = await reportService.getMyReports('usr-1', { status: 'rejected' }, 'student');
      assert.strictEqual(calls.reportCount[0].where.submittedBy, 'usr-1');
      assert.strictEqual(calls.reportCount[0].where.status, 'rejected');
      assert.strictEqual(calls.reportFindMany[0].where.submittedBy, 'usr-1');
      assert.strictEqual(res.reports.length, 2);
    } finally {
      restorePrisma();
    }
  });

  // Group 4: Bookmarks & Non-Public Leak Protection
  console.log('\n4. Bookmarks (Saved Reports) & Privacy Protection:');

  await runTest('saveReport upserts into saved_reports idempotently', async () => {
    const calls = createMockPrisma({
      report: { id: 'rep-verified-1', status: 'verified', submittedBy: 'usr-author' },
    });
    try {
      const res = await reportService.saveReport('usr-1', 'rep-verified-1', { id: 'usr-1', role: 'student' });
      assert.strictEqual(calls.savedReportUpsert.length, 1);
      assert.strictEqual(calls.savedReportUpsert[0].where.userId_reportId.userId, 'usr-1');
      assert.strictEqual(calls.savedReportUpsert[0].where.userId_reportId.reportId, 'rep-verified-1');
      assert.strictEqual(res.saved, true);
    } finally {
      restorePrisma();
    }
  });

  await runTest('saveReport rejects saving a private non-verified report of another user with 403', async () => {
    const calls = createMockPrisma({
      report: { id: 'rep-private-1', status: 'pending', submittedBy: 'usr-author' },
    });
    try {
      await assert.rejects(
        async () => reportService.saveReport('usr-attacker', 'rep-private-1', { id: 'usr-attacker', role: 'student' }),
        (err) => err instanceof AppError && err.statusCode === 403
      );
    } finally {
      restorePrisma();
    }
  });

  await runTest('removeSavedReport deletes from saved_reports idempotently', async () => {
    const calls = createMockPrisma();
    try {
      const res = await reportService.removeSavedReport('usr-1', 'rep-1');
      assert.strictEqual(calls.savedReportDeleteMany.length, 1);
      assert.deepStrictEqual(calls.savedReportDeleteMany[0].where, { userId: 'usr-1', reportId: 'rep-1' });
      assert.strictEqual(res.saved, false);
    } finally {
      restorePrisma();
    }
  });

  await runTest('getUserSavedReports enforces non-public leak protection in WHERE clause', async () => {
    const calls = createMockPrisma({
      savedCount: 1,
      savedEntries: [
        {
          savedAt: new Date(),
          report: {
            id: 'rep-v1',
            companyNameRaw: 'Verified Company',
            status: 'verified',
            phoneRaw: '+919876543210',
            riskAssessments: [],
          },
        },
      ],
    });
    try {
      const res = await reportService.getUserSavedReports('usr-student-1', {}, 'student');
      assert.strictEqual(calls.savedReportCount.length, 1);
      const where = calls.savedReportCount[0].where;
      assert.strictEqual(where.userId, 'usr-student-1');
      // Verify non-public protection rule: report must be verified OR submitted by the user
      assert.deepStrictEqual(where.report.OR, [
        { status: 'verified' },
        { submittedBy: 'usr-student-1' },
      ]);
      assert.strictEqual(res.reports[0].phoneRaw, '+9198XXXXX', 'Must mask PII in saved reports');
      assert.ok(res.reports[0].savedAt, 'Must include savedAt timestamp');
    } finally {
      restorePrisma();
    }
  });

  // Group 5: Related Reports & Source Report Authorization
  console.log('\n5. Related Reports & Source Authorization Gate:');

  await runTest('getRelatedReports rejects unauthenticated caller with 401 on non-verified source report', async () => {
    const calls = createMockPrisma({
      report: { id: 'rep-pending-1', status: 'pending', submittedBy: 'usr-author' },
    });
    try {
      await assert.rejects(
        async () => reportService.getRelatedReports('rep-pending-1', null),
        (err) => err instanceof AppError && err.statusCode === 401
      );
    } finally {
      restorePrisma();
    }
  });

  await runTest('getRelatedReports rejects unauthorized student with 403 on non-verified source report', async () => {
    const calls = createMockPrisma({
      report: { id: 'rep-pending-1', status: 'pending', submittedBy: 'usr-author' },
    });
    try {
      await assert.rejects(
        async () => reportService.getRelatedReports('rep-pending-1', { id: 'usr-stranger', role: 'student' }),
        (err) => err instanceof AppError && err.statusCode === 403
      );
    } finally {
      restorePrisma();
    }
  });

  await runTest('getRelatedReports queries verified related reports sharing identifiers, excluding self', async () => {
    const calls = createMockPrisma({
      report: { id: 'rep-src-1', status: 'verified', submittedBy: 'usr-author' },
      junctions: [{ identifierId: 'id-phone-1' }, { identifierId: 'id-upi-1' }],
      reports: [
        {
          id: 'rep-related-1',
          companyNameRaw: 'Related Fraudster',
          status: 'verified',
          submittedAt: new Date(),
          riskAssessments: [{ id: 'ra-1', score: 80, category: 'critical' }],
          identifiers: [
            {
              confidence: 'high',
              identifier: { id: 'id-phone-1', type: 'phone', value: '+919876543210', confidence: 'high' },
            },
          ],
        },
      ],
    });
    try {
      const res = await reportService.getRelatedReports('rep-src-1', null);
      assert.strictEqual(calls.reportIdentifierFindMany.length, 1);
      assert.strictEqual(calls.reportIdentifierFindMany[0].where.reportId, 'rep-src-1');

      const queryWhere = calls.reportFindMany[0].where;
      assert.deepStrictEqual(queryWhere.id, { not: 'rep-src-1' }, 'Must exclude source report itself');
      assert.strictEqual(queryWhere.status, 'verified', 'Must filter strictly for verified related reports');
      assert.deepStrictEqual(queryWhere.identifiers.some.identifierId, { in: ['id-phone-1', 'id-upi-1'] });

      assert.strictEqual(res.sourceReportId, 'rep-src-1');
      assert.strictEqual(res.relatedReports.length, 1);
      assert.strictEqual(res.relatedReports[0].id, 'rep-related-1');
      assert.strictEqual(res.relatedReports[0].sharedIdentifiers[0].value, '+9198XXXXX', 'Must mask shared identifier value for visitor');
    } finally {
      restorePrisma();
    }
  });

  await runTest('getRelatedReports returns empty list when source report has zero identifiers', async () => {
    const calls = createMockPrisma({
      report: { id: 'rep-src-1', status: 'verified', submittedBy: 'usr-author' },
      junctions: [], // Zero identifiers attached
    });
    try {
      const res = await reportService.getRelatedReports('rep-src-1', null);
      assert.strictEqual(calls.reportFindMany.length, 0, 'Should not query reports when zero identifiers exist');
      assert.strictEqual(res.relatedReports.length, 0);
    } finally {
      restorePrisma();
    }
  });

  console.log(`\nAll ${passedTests} / ${totalTests} report_management unit tests passed successfully!\n`);
}

runAllTests().catch((err) => {
  console.error('\nTest suite failed:', err);
  process.exit(1);
});
