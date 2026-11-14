'use strict';

/**
 * backend/test/integration/admin_moderation.integration.test.js
 * Real PostgreSQL integration test suite for Phase 8 Admin Moderation.
 *
 * SAFETY INVARIANTS:
 * 1. Strictly requires explicitly provided TEST_DATABASE_URL.
 * 2. Enforced by testDbGuard: host MUST be localhost; db name MUST be 'offercheck_test'.
 * 3. Never connects to 'offercheck_dev' or production databases.
 * 4. Non-destructive cleanup: only cleans up test-created records by ID.
 * 5. Dynamic cryptographic run nonce ensures isolation.
 *
 * COVERS:
 * 1. Atomic moderation persistence: sets status='verified', isVerified=true, reviewedBy, reviewedAt, and creates AuditLog.
 * 2. Database constraint enforcement: satisfies chk_reviewed and audit_logs_has_target.
 * 3. Immediate public intelligence reflection: verified report discoverable in getPublicReports and matched in check.service.
 * 4. Atomic transaction rollback in PostgreSQL: forced audit-log failure rolls back report status update.
 * 5. Finalized state protection: verified report cannot be modified (400 Bad Request).
 * 6. Genuine concurrent PostgreSQL race: two simultaneous moderation attempts on the same pending report.
 *    Exactly one decision succeeds; exactly one conflicting decision is rejected with 409; exactly one audit log row exists.
 */

const assert = require('assert');
const crypto = require('crypto');
const { validateTestDatabaseUrl } = require('../helpers/testDbGuard');

const testDbUrl = process.env.TEST_DATABASE_URL;

if (!testDbUrl) {
  console.error('\n[FATAL TEST RUNNER] No test database URL provided in environment.');
  console.error('Integration tests require an explicit TEST_DATABASE_URL.');
  console.error('To run safely against offercheck_test:');
  console.error('  TEST_DATABASE_URL="postgresql://localhost:5432/offercheck_test?schema=public" node test/integration/admin_moderation.integration.test.js\n');
  process.exit(1);
}

// Safety check
const guard = validateTestDatabaseUrl(testDbUrl);

process.env.DATABASE_URL = guard.url;
process.env.NODE_ENV = 'test';
if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'test_jwt_secret_012345678901234567890123456789';

const prisma = require('../../src/utils/prisma');
const { createReport, moderateReport, getPublicReports } = require('../../src/services/report.service');
const { performCheck } = require('../../src/services/check.service');
const { offerCheckSchema } = require('../../src/validations/check.validation');
const { createReportSchema } = require('../../src/validations/report.validation');
const { AppError } = require('../../src/utils/errors');

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

const runNonce = crypto.randomBytes(4).toString('hex');
const createdUserIds = new Set();
const createdReportIds = new Set();
const createdIdentifierIds = new Set();
const createdCheckIds = new Set();

async function runTest(num, name, fn) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`  ✅ [PASS] #${num}: ${name}`);
  } catch (err) {
    failedTests++;
    console.error(`  ❌ [FAIL] #${num}: ${name}:`, err.message);
    throw err;
  }
}

async function main() {
  console.log(`\n--- Phase 8: Real PostgreSQL Admin Moderation Integration Tests [nonce=${runNonce}] ---\n`);

  // Verify connection
  await prisma.$connect();

  // Create test student user and two test admin users
  const student = await prisma.user.create({
    data: {
      email: `student_${runNonce}@test.offercheck`,
      name: `Student Test ${runNonce}`,
      passwordHash: '$2a$12$e80/bY0139G/1l9pT3.B9O9Qz0y2eX8e9V6f7g8h9i0j1k2l3m4n5',
      role: 'student',
      college: 'Engineering Institute',
    },
  });
  createdUserIds.add(student.id);

  const admin1 = await prisma.user.create({
    data: {
      email: `admin1_${runNonce}@test.offercheck`,
      name: `Admin One ${runNonce}`,
      passwordHash: '$2a$12$e80/bY0139G/1l9pT3.B9O9Qz0y2eX8e9V6f7g8h9i0j1k2l3m4n5',
      role: 'admin',
    },
  });
  createdUserIds.add(admin1.id);

  const admin2 = await prisma.user.create({
    data: {
      email: `admin2_${runNonce}@test.offercheck`,
      name: `Admin Two ${runNonce}`,
      passwordHash: '$2a$12$e80/bY0139G/1l9pT3.B9O9Qz0y2eX8e9V6f7g8h9i0j1k2l3m4n5',
      role: 'admin',
    },
  });
  createdUserIds.add(admin2.id);

  try {
    // ─── Case 1: Atomic moderation verification in PostgreSQL ───────────────
    let testReport1Id = null;
    await runTest(1, 'Atomically moderates pending report to verified with reviewer and AuditLog in PostgreSQL', async () => {
      const uniquePhone = `+919876${Math.floor(100000 + Math.random() * 900000)}`;
      const validatedReport = createReportSchema.parse({
        companyName: `ScamCorp_${runNonce}`,
        companyNameRaw: `ScamCorp_${runNonce}`,
        phone: uniquePhone,
        phoneRaw: uniquePhone,
        offerMessage: 'Pay 10000 registration fee immediately to secure your internship.',
        paymentRequest: '10000 INR registration fee',
      });
      const submission = await createReport(student.id, validatedReport, 'student');

      testReport1Id = submission.id;
      createdReportIds.add(testReport1Id);

      // Verify initial pending state in PostgreSQL
      const initialReport = await prisma.report.findUnique({ where: { id: testReport1Id } });
      assert.strictEqual(initialReport.status, 'pending');
      assert.strictEqual(initialReport.isVerified, false);
      assert.strictEqual(initialReport.reviewedBy, null);
      assert.strictEqual(initialReport.reviewedAt, null);

      // Moderate to verified
      const modResult = await moderateReport(
        testReport1Id,
        'verified',
        admin1.id,
        `Confirmed fraud for ${runNonce}`
      );

      assert.strictEqual(modResult.report.status, 'verified');
      assert.strictEqual(modResult.report.isVerified, true);
      assert.strictEqual(modResult.auditLog.action, 'STATUS_CHANGED');

      // Verify directly from PostgreSQL database
      const dbReport = await prisma.report.findUnique({
        where: { id: testReport1Id },
        include: { reviewer: true }
      });
      assert.strictEqual(dbReport.status, 'verified');
      assert.strictEqual(dbReport.isVerified, true);
      assert.strictEqual(dbReport.reviewedBy, admin1.id);
      assert.ok(dbReport.reviewedAt instanceof Date);
      assert.strictEqual(dbReport.reviewer.id, admin1.id);

      // Verify AuditLog in PostgreSQL
      const dbAuditLogs = await prisma.auditLog.findMany({
        where: { reportId: testReport1Id, action: 'STATUS_CHANGED' }
      });
      assert.strictEqual(dbAuditLogs.length, 1);
      assert.strictEqual(dbAuditLogs[0].actorId, admin1.id);
      assert.strictEqual(dbAuditLogs[0].oldValue, 'pending');
      assert.strictEqual(dbAuditLogs[0].newValue, 'verified');
      assert.strictEqual(dbAuditLogs[0].notes, `Confirmed fraud for ${runNonce}`);
    });

    // ─── Case 2: Public visibility & check intelligence reflection ───────────
    await runTest(2, 'Verified report immediately surfaces in public discovery and matches in offer check', async () => {
      // 1. Discoverable in public reports
      const publicReportsRes = await getPublicReports({ search: `ScamCorp_${runNonce}` }, 'student');
      const foundInPublic = publicReportsRes.reports.some(r => r.id === testReport1Id);
      assert.strictEqual(foundInPublic, true, 'Verified report must be discoverable in public reports');

      // 2. Fetch linked phone identifier from report
      const junctions = await prisma.reportIdentifier.findMany({
        where: { reportId: testReport1Id },
        include: { identifier: true }
      });
      assert.ok(junctions.length > 0);
      const phoneIdent = junctions.find(j => j.identifier.type === 'phone');
      assert.ok(phoneIdent);
      createdIdentifierIds.add(phoneIdent.identifier.id);

      // 3. Run performCheck with this phone
      const validatedCheck = offerCheckSchema.parse({
        offerMessage: 'Suspicious offer message referencing candidate phone',
        phone: phoneIdent.identifier.value,
      });
      const checkRes = await performCheck(
        student.id,
        validatedCheck,
        'student',
        '127.0.0.1'
      );
      if (checkRes && checkRes.id) createdCheckIds.add(checkRes.id);

      assert.ok(checkRes.riskScore > 0, 'Risk score must be elevated by matched verified report');
      assert.ok(checkRes.connectedReports.some(cr => cr.id === testReport1Id), 'Connected reports must include verified report');
    });

    // ─── Case 3: Finalized report cannot be modified in PostgreSQL ───────────
    await runTest(3, 'Attempt to modify finalized verified report returns 400 Bad Request', async () => {
      await assert.rejects(
        async () => moderateReport(testReport1Id, 'rejected', admin1.id),
        (err) => err instanceof AppError && err.statusCode === 400 && err.message.includes('Verified reports are finalized')
      );

      // Confirm in PostgreSQL that status remained 'verified'
      const unchanged = await prisma.report.findUnique({ where: { id: testReport1Id } });
      assert.strictEqual(unchanged.status, 'verified');
    });

    // ─── Case 4: Real PostgreSQL Rollback on Audit Log Failure ──────────────
    await runTest(4, 'PostgreSQL rolls back report status update when audit log creation fails', async () => {
      const validatedReport2 = createReportSchema.parse({
        companyName: `RollbackCorp_${runNonce}`,
        companyNameRaw: `RollbackCorp_${runNonce}`,
        offerMessage: 'Transfer 500 processing charges to bank account.',
      });
      const submission2 = await createReport(student.id, validatedReport2, 'student');
      const testReport2Id = submission2.id;
      createdReportIds.add(testReport2Id);

      // Attempt moderation with a non-existent actorId that violates foreign key constraint on audit_logs.actor_id
      const fakeAdminId = '00000000-0000-4000-8000-000000000000';
      await assert.rejects(
        async () => moderateReport(testReport2Id, 'verified', fakeAdminId),
        (err) => err !== undefined // Foreign key constraint error
      );

      // Verify in PostgreSQL that status update was rolled back
      const rolledBackReport = await prisma.report.findUnique({ where: { id: testReport2Id } });
      assert.strictEqual(rolledBackReport.status, 'pending');
      assert.strictEqual(rolledBackReport.isVerified, false);
      assert.strictEqual(rolledBackReport.reviewedBy, null);
      assert.strictEqual(rolledBackReport.reviewedAt, null);
    });

    // ─── Case 5: Genuine Concurrent Moderation Race in PostgreSQL ───────────
    await runTest(5, 'Concurrent race: exactly one of two simultaneous moderation decisions succeeds with 409 conflict for loser', async () => {
      const validatedReport3 = createReportSchema.parse({
        companyName: `RaceCorp_${runNonce}`,
        companyNameRaw: `RaceCorp_${runNonce}`,
        offerMessage: 'Simultaneous admin moderation race test incident.',
      });
      const raceSubmission = await createReport(student.id, validatedReport3, 'student');
      const raceReportId = raceSubmission.id;
      createdReportIds.add(raceReportId);

      // Launch two conflicting moderation requests simultaneously at the same millisecond
      const decision1Promise = moderateReport(raceReportId, 'verified', admin1.id, 'Decision: Verified by Admin 1');
      const decision2Promise = moderateReport(raceReportId, 'rejected', admin2.id, 'Decision: Rejected by Admin 2');

      const results = await Promise.allSettled([decision1Promise, decision2Promise]);

      const fulfilled = results.filter(r => r.status === 'fulfilled');
      const rejected = results.filter(r => r.status === 'rejected');

      // Assert exactly one succeeded and exactly one was rejected
      assert.strictEqual(fulfilled.length, 1, 'Exactly one concurrent moderation request must succeed');
      assert.strictEqual(rejected.length, 1, 'Exactly one concurrent moderation request must be rejected');

      // Assert the loser was rejected with 409 Conflict
      const loserError = rejected[0].reason;
      assert.ok(loserError instanceof AppError, 'Loser error must be an AppError');
      assert.strictEqual(loserError.statusCode, 409, 'Loser error must be HTTP 409 Conflict');
      assert.ok(
        loserError.message.includes('modified by another administrator') ||
        loserError.message.includes('already'),
        `Error message must indicate conflict: ${loserError.message}`
      );

      // Verify database state in PostgreSQL
      const winnerDecision = fulfilled[0].value;
      const winnerStatus = winnerDecision.report.status;
      const winnerAdminId = winnerDecision.report.reviewedBy;

      const finalDbReport = await prisma.report.findUnique({ where: { id: raceReportId } });
      assert.strictEqual(finalDbReport.status, winnerStatus);
      assert.strictEqual(finalDbReport.reviewedBy, winnerAdminId);

      // Verify that EXACTLY ONE STATUS_CHANGED audit log row exists in PostgreSQL
      const auditRows = await prisma.auditLog.findMany({
        where: { reportId: raceReportId, action: 'STATUS_CHANGED' }
      });
      assert.strictEqual(auditRows.length, 1, 'Exactly one STATUS_CHANGED audit log row must exist in PostgreSQL');
      assert.strictEqual(auditRows[0].newValue, winnerStatus);
    });

  } finally {
    // ─── Scoped Non-Destructive Teardown ─────────────────────────────────────
    console.log('\n--- Teardown: Scoped Non-Destructive Cleanup ---');
    try {
      if (createdReportIds.size > 0) {
        const reportIds = Array.from(createdReportIds);
        await prisma.auditLog.deleteMany({ where: { reportId: { in: reportIds } } });
        await prisma.reportIdentifier.deleteMany({ where: { reportId: { in: reportIds } } });
        await prisma.riskFactor.deleteMany({ where: { assessment: { reportId: { in: reportIds } } } });
        await prisma.riskAssessment.deleteMany({ where: { reportId: { in: reportIds } } });
        await prisma.report.deleteMany({ where: { id: { in: reportIds } } });
      }

      if (createdIdentifierIds.size > 0) {
        const idList = Array.from(createdIdentifierIds);
        for (const id of idList) {
          const count = await prisma.reportIdentifier.count({ where: { identifierId: id } });
          if (count === 0) {
            await prisma.auditLog.deleteMany({ where: { identifierId: id } });
            await prisma.identifier.delete({ where: { id } }).catch(() => {});
          }
        }
      }

      if (createdCheckIds.size > 0) {
        await prisma.offerCheck.deleteMany({ where: { id: { in: Array.from(createdCheckIds) } } });
      }

      if (createdUserIds.size > 0) {
        const userIds = Array.from(createdUserIds);
        await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
        await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      }
      console.log('  Cleaned up all test-created records by exact ID.');
    } catch (cleanupErr) {
      console.error('  Cleanup error:', cleanupErr.message);
    }

    await prisma.$disconnect();
  }

  console.log(`\nAll ${passedTests} / ${totalTests} admin_moderation integration tests passed successfully!\n`);
}

main().catch(async (err) => {
  console.error('\n[FATAL] Integration test error:', err);
  process.exit(1);
});
