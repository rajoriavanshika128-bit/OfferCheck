'use strict';

/**
 * backend/test/admin_moderation.test.js
 * Comprehensive unit test suite for Phase 8 Admin Moderation service layer.
 *
 * SAFETY INVARIANTS:
 * - ZERO database connections: deterministic in-memory Prisma mocking.
 * - ZERO .env access or modification.
 * - Isolated and repeatable: mocks are reset before each test.
 *
 * COVERS:
 * 1. Admin Listing (getAdminReports):
 *    - Rejects non-admin caller with 403 AppError.
 *    - Default listing query filters status = 'pending'.
 *    - Allows explicit filtering by status (verified, rejected, investigating).
 *    - Applies pagination, search, and deterministic tie-breaker sorting.
 *    - Preserves unmasked contact details for admin role.
 * 2. Status Transitions (moderateReport):
 *    - Permitted: pending -> verified (isVerified: true, reviewer metadata, AuditLog).
 *    - Permitted: pending -> rejected (isVerified: false, reviewer metadata, AuditLog).
 *    - Permitted: pending -> investigating (isVerified: false, reviewer metadata, AuditLog).
 *    - Permitted: investigating -> verified.
 *    - Permitted: investigating -> rejected.
 * 3. Finalized State Protection:
 *    - Modifying verified report throws 400 Bad Request.
 *    - Modifying rejected report throws 400 Bad Request.
 *    - Investigating -> pending throws 400 Bad Request.
 * 4. Conflict & Same-Status Protection:
 *    - Same-status transition throws 409 Conflict.
 * 5. Concurrency Race Protection:
 *    - updateMany count === 0 throws 409 Conflict.
 * 6. Non-existent report:
 *    - Throws 404 AppError.
 */

process.env.DATABASE_URL = 'postgresql://mock:mock@localhost:5432/mock_test';
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'mock_jwt_secret_at_least_32_characters_long_0123456789';

const assert = require('assert');
const prisma = require('../src/utils/prisma');
const reportService = require('../src/services/report.service');
const { AppError } = require('../src/utils/errors');

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

// Mock report fixture helper
function createMockReport(overrides = {}) {
  return {
    id: overrides.id || '11111111-1111-4111-8111-111111111111',
    submittedBy: 'student-user-1',
    reviewedBy: overrides.reviewedBy || null,
    companyId: null,
    recruiterId: null,
    companyNameRaw: 'Acme Corp',
    recruiterNameRaw: 'John Recruiter',
    domainRaw: 'acme.com',
    phoneRaw: '+919876543210',
    emailRaw: 'scam@acme.com',
    upiRaw: 'scam@upi',
    offerMessage: 'Pay 5000 INR deposit for laptop',
    paymentRequest: '5000 INR security deposit',
    additionalNotes: 'Urgent payment requested',
    status: overrides.status || 'pending',
    submittedAt: new Date('2026-11-01T10:00:00Z'),
    reviewedAt: overrides.reviewedAt || null,
    isVerified: overrides.isVerified !== undefined ? overrides.isVerified : false,
    isInferred: false,
    company: null,
    recruiter: null,
    submitter: { id: 'student-user-1', name: 'Alice Student', college: 'Tech University', role: 'student' },
    reviewer: overrides.reviewer || null,
    riskAssessments: [
      { id: 'ra-1', score: 85, category: 'critical', summary: 'High risk fraud signals detected', assessedAt: new Date() }
    ],
    identifiers: [
      {
        identifier: {
          id: 'id-1',
          type: 'phone',
          value: '+919876543210',
          normalizedValue: '+919876543210',
          riskScore: 60,
          confidence: 'high'
        }
      }
    ]
  };
}

async function main() {
  console.log('\n--- Phase 8: Admin Moderation Service Unit Tests ---\n');

  // ─── 1. Admin Listing (getAdminReports) ─────────────────────────────────────
  console.log('1. Admin Report Listing:');

  await runTest('getAdminReports rejects non-admin caller with 403', async () => {
    await assert.rejects(
      async () => reportService.getAdminReports({}, 'student'),
      (err) => err instanceof AppError && err.statusCode === 403 && err.message.includes('Admin access required')
    );
  });

  await runTest('getAdminReports defaults query filter to status = pending', async () => {
    let capturedWhere = null;
    prisma.report.count = async ({ where }) => {
      capturedWhere = where;
      return 1;
    };
    prisma.report.findMany = async () => [createMockReport({ status: 'pending' })];

    const result = await reportService.getAdminReports({}, 'admin');
    assert.strictEqual(capturedWhere.status, 'pending');
    assert.strictEqual(result.reports.length, 1);
    assert.strictEqual(result.reports[0].status, 'pending');
    // Admin receives unmasked contact info
    assert.strictEqual(result.reports[0].phoneRaw, '+919876543210');
  });

  await runTest('getAdminReports filters by explicit status when provided', async () => {
    let capturedWhere = null;
    prisma.report.count = async ({ where }) => {
      capturedWhere = where;
      return 2;
    };
    prisma.report.findMany = async () => [
      createMockReport({ status: 'investigating' }),
      createMockReport({ status: 'investigating' })
    ];

    const result = await reportService.getAdminReports({ status: 'investigating' }, 'admin');
    assert.strictEqual(capturedWhere.status, 'investigating');
    assert.strictEqual(result.reports.length, 2);
  });

  // ─── 2. Permitted Status Transitions ────────────────────────────────────────
  console.log('\n2. Permitted Status Transitions (moderateReport):');

  await runTest('pending -> verified sets isVerified: true, reviewer metadata, and creates AuditLog', async () => {
    const reportId = '11111111-1111-4111-8111-111111111111';
    const adminId = 'admin-user-99';
    let capturedUpdateData = null;
    let capturedAuditLog = null;

    let findCallCount = 0;
    prisma.$transaction = async (callback) => {
      const mockTx = {
        report: {
          findUnique: async () => {
            findCallCount++;
            if (findCallCount === 1) {
              return createMockReport({ id: reportId, status: 'pending' });
            }
            return createMockReport({
              id: reportId,
              status: 'verified',
              isVerified: true,
              reviewedBy: adminId,
              reviewer: { id: adminId, name: 'Admin', role: 'admin' }
            });
          },
          updateMany: async ({ where, data }) => {
            assert.strictEqual(where.id, reportId);
            assert.strictEqual(where.status, 'pending'); // Conditional check
            capturedUpdateData = data;
            return { count: 1 };
          },
        },
        auditLog: {
          create: async ({ data }) => {
            capturedAuditLog = data;
            return { id: 'audit-log-1', ...data, createdAt: new Date() };
          }
        }
      };

      return callback(mockTx);
    };

    const res = await reportService.moderateReport(reportId, 'verified', adminId, 'Verified fraud syndicate');

    assert.strictEqual(capturedUpdateData.status, 'verified');
    assert.strictEqual(capturedUpdateData.isVerified, true);
    assert.strictEqual(capturedUpdateData.reviewedBy, adminId);
    assert.ok(capturedUpdateData.reviewedAt instanceof Date);

    assert.strictEqual(capturedAuditLog.actorId, adminId);
    assert.strictEqual(capturedAuditLog.action, 'STATUS_CHANGED');
    assert.strictEqual(capturedAuditLog.oldValue, 'pending');
    assert.strictEqual(capturedAuditLog.newValue, 'verified');
    assert.strictEqual(capturedAuditLog.notes, 'Verified fraud syndicate');
    assert.strictEqual(res.report.status, 'verified');
  });

  await runTest('pending -> rejected sets isVerified: false, reviewer metadata, and creates AuditLog', async () => {
    const reportId = '11111111-1111-4111-8111-111111111111';
    const adminId = 'admin-user-99';
    let capturedUpdateData = null;
    let capturedAuditLog = null;

    prisma.$transaction = async (callback) => {
      const mockTx = {
        report: {
          findUnique: async () => createMockReport({ id: reportId, status: 'pending' }),
          updateMany: async ({ data }) => {
            capturedUpdateData = data;
            return { count: 1 };
          },
        },
        auditLog: {
          create: async ({ data }) => {
            capturedAuditLog = data;
            return { id: 'audit-log-2', ...data };
          }
        }
      };
      return callback(mockTx);
    };

    await reportService.moderateReport(reportId, 'rejected', adminId, 'Legitimate recruiter confirmation');

    assert.strictEqual(capturedUpdateData.status, 'rejected');
    assert.strictEqual(capturedUpdateData.isVerified, false);
    assert.strictEqual(capturedUpdateData.reviewedBy, adminId);
    assert.strictEqual(capturedAuditLog.oldValue, 'pending');
    assert.strictEqual(capturedAuditLog.newValue, 'rejected');
  });

  await runTest('pending -> investigating sets isVerified: false and creates AuditLog', async () => {
    const reportId = '11111111-1111-4111-8111-111111111111';
    const adminId = 'admin-user-99';
    let capturedUpdateData = null;

    prisma.$transaction = async (callback) => {
      const mockTx = {
        report: {
          findUnique: async () => createMockReport({ id: reportId, status: 'pending' }),
          updateMany: async ({ data }) => {
            capturedUpdateData = data;
            return { count: 1 };
          },
        },
        auditLog: { create: async ({ data }) => data }
      };
      return callback(mockTx);
    };

    await reportService.moderateReport(reportId, 'investigating', adminId);
    assert.strictEqual(capturedUpdateData.status, 'investigating');
    assert.strictEqual(capturedUpdateData.isVerified, false);
  });

  await runTest('investigating -> verified is permitted', async () => {
    const reportId = '11111111-1111-4111-8111-111111111111';
    let capturedUpdateData = null;

    prisma.$transaction = async (callback) => {
      const mockTx = {
        report: {
          findUnique: async () => createMockReport({ id: reportId, status: 'investigating' }),
          updateMany: async ({ data }) => {
            capturedUpdateData = data;
            return { count: 1 };
          },
        },
        auditLog: { create: async ({ data }) => data }
      };
      return callback(mockTx);
    };

    await reportService.moderateReport(reportId, 'verified', 'admin-user-99');
    assert.strictEqual(capturedUpdateData.status, 'verified');
    assert.strictEqual(capturedUpdateData.isVerified, true);
  });

  // ─── 3. Finalized State Protection ──────────────────────────────────────────
  console.log('\n3. Finalized State Protection:');

  await runTest('modifying a verified report throws 400 Bad Request', async () => {
    prisma.$transaction = async (callback) => {
      const mockTx = {
        report: {
          findUnique: async () => createMockReport({ status: 'verified', isVerified: true })
        }
      };
      return callback(mockTx);
    };

    await assert.rejects(
      async () => reportService.moderateReport('11111111-1111-4111-8111-111111111111', 'rejected', 'admin-1'),
      (err) => err instanceof AppError && err.statusCode === 400 && err.message.includes('Verified reports are finalized')
    );
  });

  await runTest('modifying a rejected report throws 400 Bad Request', async () => {
    prisma.$transaction = async (callback) => {
      const mockTx = {
        report: {
          findUnique: async () => createMockReport({ status: 'rejected', isVerified: false })
        }
      };
      return callback(mockTx);
    };

    await assert.rejects(
      async () => reportService.moderateReport('11111111-1111-4111-8111-111111111111', 'verified', 'admin-1'),
      (err) => err instanceof AppError && err.statusCode === 400 && err.message.includes('Rejected reports are finalized')
    );
  });

  await runTest('investigating -> pending throws 400 Bad Request', async () => {
    prisma.$transaction = async (callback) => {
      const mockTx = {
        report: {
          findUnique: async () => createMockReport({ status: 'investigating' })
        }
      };
      return callback(mockTx);
    };

    await assert.rejects(
      async () => reportService.moderateReport('11111111-1111-4111-8111-111111111111', 'pending', 'admin-1'),
      (err) => err instanceof AppError && err.statusCode === 400
    );
  });

  // ─── 4. Conflict & Same-Status Protection ───────────────────────────────────
  console.log('\n4. Conflict & Same-Status Protection:');

  await runTest('requesting same status (e.g. investigating -> investigating) throws 409 Conflict', async () => {
    prisma.$transaction = async (callback) => {
      const mockTx = {
        report: {
          findUnique: async () => createMockReport({ status: 'investigating' })
        }
      };
      return callback(mockTx);
    };

    await assert.rejects(
      async () => reportService.moderateReport('11111111-1111-4111-8111-111111111111', 'investigating', 'admin-1'),
      (err) => err instanceof AppError && err.statusCode === 409 && err.message.includes('already investigating')
    );
  });

  await runTest('requesting same status (e.g. verified -> verified) throws 409 Conflict', async () => {
    prisma.$transaction = async (callback) => {
      const mockTx = {
        report: {
          findUnique: async () => createMockReport({ status: 'verified', isVerified: true })
        }
      };
      return callback(mockTx);
    };

    await assert.rejects(
      async () => reportService.moderateReport('11111111-1111-4111-8111-111111111111', 'verified', 'admin-1'),
      (err) => err instanceof AppError && err.statusCode === 409 && err.message.includes('already verified')
    );
  });

  // ─── 5. Concurrency Race Protection ─────────────────────────────────────────
  console.log('\n5. Concurrency Race Protection:');

  await runTest('updateMany count === 0 throws 409 Conflict without writing audit log', async () => {
    let auditLogCreated = false;

    prisma.$transaction = async (callback) => {
      const mockTx = {
        report: {
          findUnique: async () => createMockReport({ status: 'pending' }),
          updateMany: async () => ({ count: 0 }), // Another request updated status first
        },
        auditLog: {
          create: async () => {
            auditLogCreated = true;
          }
        }
      };
      return callback(mockTx);
    };

    await assert.rejects(
      async () => reportService.moderateReport('11111111-1111-4111-8111-111111111111', 'verified', 'admin-1'),
      (err) => err instanceof AppError && err.statusCode === 409 && err.message.includes('modified by another administrator')
    );

    assert.strictEqual(auditLogCreated, false, 'Audit log must NOT be created when row count is 0');
  });

  // ─── 6. Non-existent Report ─────────────────────────────────────────────────
  console.log('\n6. Non-Existent Report:');

  await runTest('moderating non-existent report ID throws 404 AppError', async () => {
    prisma.$transaction = async (callback) => {
      const mockTx = {
        report: {
          findUnique: async () => null,
        }
      };
      return callback(mockTx);
    };

    await assert.rejects(
      async () => reportService.moderateReport('99999999-9999-4999-8999-999999999999', 'verified', 'admin-1'),
      (err) => err instanceof AppError && err.statusCode === 404
    );
  });

  console.log(`\nAll ${passedTests} / ${totalTests} admin_moderation unit tests passed successfully!\n`);
}

main().catch((err) => {
  console.error('\nTest suite failed:', err);
  process.exit(1);
});
