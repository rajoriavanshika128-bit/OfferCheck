'use strict';

/**
 * backend/test/integration/report_submission.integration.test.js
 * Real PostgreSQL integration test suite for Report Submission (Phase 5B.4).
 *
 * SAFETY INVARIANTS:
 * 1. Strictly requires explicitly provided TEST_DATABASE_URL.
 *    Refuses to connect or fall back to DATABASE_URL, .env, or default databases.
 * 2. Enforced by testDbGuard: host MUST be localhost/127.0.0.1/::1; database name MUST be exactly 'offercheck_test'.
 * 3. Never connects to 'offercheck_dev' or production databases.
 * 4. Single shared PrismaClient lifecycle (src/utils/prisma.js) initialized only after URL validation.
 * 5. Non-destructive scoped cleanup:
 *    - Tracks test-created records by exact ID.
 *    - NEVER executes TRUNCATE, TRUNCATE CASCADE, or table wiping.
 *    - Distinguishes newly created identifiers from pre-existing identifiers.
 *    - Deletes newly created identifiers only after confirming zero remaining ReportIdentifier links.
 * 6. Dynamic cryptographic run nonce (crypto.randomBytes) guarantees complete test isolation.
 *
 * COVERS ALL 13 REQUIRED SCENARIOS:
 * 1. Successful report submission and persistence across all tables.
 * 2. Submitter ownership derived exclusively from authenticated user ID.
 * 3. New reports remain pending and unverified (status: 'pending', isVerified: false, isInferred: false).
 * 4. Duplicate normalized identifiers within one submission (single upsert and junction).
 * 5. Concurrent submissions sharing one previously nonexistent identifier (atomic PostgreSQL ON CONFLICT handling).
 * 6. Verified historical reports influencing risk scoring; pending reports excluded.
 * 7. RiskAssessment and RiskFactor persistence with strictly mapped schema columns.
 * 8. Actual transaction rollback in PostgreSQL when RiskFactor persistence fails.
 * 9. Actual transaction rollback in PostgreSQL when AuditLog persistence fails.
 * 10. Correct AuditLog references and action (REPORT_SUBMITTED, actorId, reportId, newValue: 'pending').
 * 11. Bank account stored through Identifier and ReportIdentifier, never as a Report column.
 * 12. Student response masking, including nested identifiers.
 * 13. No password hashes or private user credentials in responses.
 */

const assert = require('assert');
const crypto = require('crypto');
const { validateTestDatabaseUrl } = require('../helpers/testDbGuard');

// ─── Pre-flight Safety Guard Check ──────────────────────────────────────────

const testDbUrl = process.env.TEST_DATABASE_URL;

if (!testDbUrl) {
  console.error('\n[FATAL TEST RUNNER] No test database URL provided in environment.');
  console.error('Integration tests require an explicit TEST_DATABASE_URL.');
  console.error('Refusing to connect or fall back to DATABASE_URL / .env / default database.');
  console.error('To run safely against offercheck_test:');
  console.error('  TEST_DATABASE_URL="postgresql://localhost:5432/offercheck_test?schema=public" node test/integration/report_submission.integration.test.js\n');
  process.exit(1);
}

// Enforce strict safety guard — throws immediately if unapproved host or not offercheck_test
const guard = validateTestDatabaseUrl(testDbUrl);

// Configure process.env for isolated test execution BEFORE loading prisma singleton
process.env.DATABASE_URL = guard.url;
process.env.NODE_ENV = 'test';
if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'test_jwt_secret_012345678901234567890123456789';

// Shared Prisma Singleton and Application Modules
const prisma = require('../../src/utils/prisma');
const { createReport } = require('../../src/services/report.service');
const { normalizePhone, normalizeEmail, normalizeUpi, normalizeDomain, normalizeBankAccount } = require('../../src/utils/normalize');

// ─── Test Harness & Cleanup Tracking ────────────────────────────────────────

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

const runNonce = crypto.randomBytes(4).toString('hex');
const createdUserIds = new Set();
const createdReportIds = new Set();
const newlyCreatedIdentifierKeys = new Set();
const newlyCreatedIdentifierIds = new Set();

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

/**
 * Helper to record pre-existence state of an identifier before submission.
 */
async function trackIdentifierPreExistence(type, normalizedValue) {
  const existing = await prisma.identifier.findUnique({
    where: {
      type_normalizedValue: {
        type,
        normalizedValue,
      },
    },
    select: { id: true },
  });

  const key = `${type}:${normalizedValue}`;
  if (!existing) {
    newlyCreatedIdentifierKeys.add(key);
  }
}

/**
 * Helper to resolve newly created identifier IDs from recorded keys.
 */
async function resolveNewlyCreatedIdentifiers() {
  if (newlyCreatedIdentifierKeys.size === 0) return;

  for (const key of newlyCreatedIdentifierKeys) {
    const colonIdx = key.indexOf(':');
    const type = key.slice(0, colonIdx);
    const normalizedValue = key.slice(colonIdx + 1);

    const record = await prisma.identifier.findUnique({
      where: {
        type_normalizedValue: {
          type,
          normalizedValue,
        },
      },
      select: { id: true },
    });

    if (record) {
      newlyCreatedIdentifierIds.add(record.id);
    }
  }
}

/**
 * Creates a unique authenticated test user directly in offercheck_test.
 */
async function createTestUser(label, role = 'student') {
  const email = `test-${label}-${runNonce}-${crypto.randomBytes(3).toString('hex')}@test.offercheck.org`;
  const user = await prisma.user.create({
    data: {
      name: `Test User ${label} ${runNonce}`,
      email,
      passwordHash: '$2a$10$abcdefghijklmnopqrstuvwxyz01234567890123456789012',
      role,
      college: 'Test Engineering College',
    },
  });
  createdUserIds.add(user.id);
  return user;
}

// ─── Main Integration Test Suite ─────────────────────────────────────────────

async function main() {
  console.log(`\n--- OfferCheck Phase 5B.4: Real PostgreSQL Integration Suite ---`);
  console.log(`Target: ${guard.dbName} on ${guard.host} (Verified Safe ✅)`);
  console.log(`Run Nonce: ${runNonce}\n`);

  try {
    // ══════════════════════════════════════════════════════════════════════════
    // Scenario 1, 2, 3: Successful Submission, Submitter Ownership & Pending Status
    // ══════════════════════════════════════════════════════════════════════════
    console.log('1. Report Submission, Ownership & Initial Pending Invariants:');

    const primaryUser = await createTestUser('primary');
    const s1Phone = '+9198' + crypto.randomInt(10000000, 99999999);
    const s1Email = `candidate-${runNonce}@fake-careers.org`;
    const s1Upi = `fee-${runNonce}@okhdfcbank`;

    await trackIdentifierPreExistence('phone', normalizePhone(s1Phone));
    await trackIdentifierPreExistence('email', normalizeEmail(s1Email));
    await trackIdentifierPreExistence('upi', normalizeUpi(s1Upi));

    let createdReport1 = null;

    await runTest(1, 'Successful report submission persists across all tables in PostgreSQL', async () => {
      createdReport1 = await createReport(
        primaryUser.id,
        {
          companyNameRaw: `Phishing Tech Ltd ${runNonce}`,
          phoneRaw: s1Phone,
          emailRaw: s1Email,
          upiRaw: s1Upi,
          offerMessage: 'Pay registration fee of Rs 2500 via UPI immediately to confirm slot.',
          paymentRequest: 'Rs 2500 registration deposit',
        },
        'student'
      );

      assert.ok(createdReport1 && createdReport1.id, 'Report ID must be returned');
      createdReportIds.add(createdReport1.id);
      await resolveNewlyCreatedIdentifiers();

      // Verify row persisted in real PostgreSQL reports table
      const reportRow = await prisma.report.findUnique({
        where: { id: createdReport1.id },
      });
      assert.ok(reportRow, 'Report row must exist in PostgreSQL');
      assert.strictEqual(reportRow.companyNameRaw, `Phishing Tech Ltd ${runNonce}`);
      assert.strictEqual(reportRow.offerMessage, 'Pay registration fee of Rs 2500 via UPI immediately to confirm slot.');
    });

    await runTest(2, 'Submitter ownership is derived exclusively from authenticated user ID', async () => {
      const reportRow = await prisma.report.findUnique({
        where: { id: createdReport1.id },
      });
      assert.strictEqual(reportRow.submittedBy, primaryUser.id);
      assert.strictEqual(reportRow.reviewedBy, null);
    });

    await runTest(3, 'New reports strictly remain pending and unverified', async () => {
      const reportRow = await prisma.report.findUnique({
        where: { id: createdReport1.id },
      });
      assert.strictEqual(reportRow.status, 'pending');
      assert.strictEqual(reportRow.isVerified, false);
      assert.strictEqual(reportRow.isInferred, false);
      assert.strictEqual(reportRow.reviewedAt, null);
    });

    // ══════════════════════════════════════════════════════════════════════════
    // Scenario 4: Duplicate Normalized Identifiers Within One Submission
    // ══════════════════════════════════════════════════════════════════════════
    console.log('\n2. Deduplication of Normalized Identifiers:');

    await runTest(4, 'Duplicate normalized identifiers within one submission produce exactly one Identifier row', async () => {
      const user = await createTestUser('dedup');
      const basePhoneDigits = String(crypto.randomInt(10000000, 99999999));
      const phoneA = `98${basePhoneDigits}`;
      const phoneB = `+91 98${basePhoneDigits}`;
      const phoneC = `098${basePhoneDigits}`;
      const normalizedExpected = `+9198${basePhoneDigits}`;

      await trackIdentifierPreExistence('phone', normalizedExpected);

      const report = await createReport(user.id, {
        companyNameRaw: `Dedup Test Corp ${runNonce}`,
        phone: phoneA,
        phoneRaw: phoneB,
        identifiers: [{ type: 'phone', value: phoneC }],
        offerMessage: 'Offer message with duplicate phone numbers',
      });

      createdReportIds.add(report.id);
      await resolveNewlyCreatedIdentifiers();

      // Query database for all identifiers matching normalized phone
      const matchingIdentifiers = await prisma.identifier.findMany({
        where: { type: 'phone', normalizedValue: normalizedExpected },
      });

      assert.strictEqual(
        matchingIdentifiers.length,
        1,
        'PostgreSQL must contain exactly one Identifier row for normalized phone'
      );

      // Junction table must contain exactly one link for this report and identifier
      const junctions = await prisma.reportIdentifier.findMany({
        where: { reportId: report.id },
      });
      assert.strictEqual(junctions.length, 1, 'Exactly one ReportIdentifier junction row must exist');
      assert.strictEqual(junctions[0].identifierId, matchingIdentifiers[0].id);
      assert.strictEqual(junctions[0].matchType, 'direct_submission');
    });

    // ══════════════════════════════════════════════════════════════════════════
    // Scenario 5: Concurrent Submissions Sharing One Previously Nonexistent Identifier
    // ══════════════════════════════════════════════════════════════════════════
    console.log('\n3. Real PostgreSQL Concurrency & Upsert Lock Safety:');

    await runTest(5, 'Concurrent submissions sharing one new identifier execute atomically without conflict errors', async () => {
      const userA = await createTestUser('concA');
      const userB = await createTestUser('concB');

      // Shared novel phone number guaranteed not to exist prior to this run
      const sharedPhone = '+9197' + crypto.randomInt(10000000, 99999999);
      const normalizedShared = normalizePhone(sharedPhone);

      // Verify non-existence prior to concurrent race
      const preExisting = await prisma.identifier.findUnique({
        where: { type_normalizedValue: { type: 'phone', normalizedValue: normalizedShared } },
      });
      assert.strictEqual(preExisting, null, 'Shared phone must not exist prior to test');
      await trackIdentifierPreExistence('phone', normalizedShared);

      // Concurrent report creation
      const [reportA, reportB] = await Promise.all([
        createReport(userA.id, {
          companyNameRaw: `Concurrent Alpha ${runNonce}`,
          phoneRaw: sharedPhone,
          offerMessage: 'Offer Alpha message',
        }),
        createReport(userB.id, {
          companyNameRaw: `Concurrent Beta ${runNonce}`,
          phoneRaw: sharedPhone,
          offerMessage: 'Offer Beta message',
        }),
      ]);

      assert.ok(reportA.id && reportB.id);
      assert.notStrictEqual(reportA.id, reportB.id);
      createdReportIds.add(reportA.id);
      createdReportIds.add(reportB.id);
      await resolveNewlyCreatedIdentifiers();

      // Invariant 1: Exactly ONE Identifier row exists in PostgreSQL
      const idRows = await prisma.identifier.findMany({
        where: { type: 'phone', normalizedValue: normalizedShared },
      });
      assert.strictEqual(idRows.length, 1, 'Exactly one Identifier row must be created in PostgreSQL');

      // Invariant 2: Exactly TWO distinct ReportIdentifier junction rows exist, referencing both reports
      const junctions = await prisma.reportIdentifier.findMany({
        where: { identifierId: idRows[0].id },
      });
      assert.strictEqual(junctions.length, 2, 'Exactly two junction rows must exist for the shared identifier');
      const linkedReportIds = junctions.map((j) => j.reportId).sort();
      assert.deepStrictEqual(linkedReportIds, [reportA.id, reportB.id].sort());
    });

    // ══════════════════════════════════════════════════════════════════════════
    // Scenario 6: Historical Verification Filtering
    // ══════════════════════════════════════════════════════════════════════════
    console.log('\n4. Historical Intelligence Filtering (Verified vs Pending):');

    await runTest(6, 'Verified historical reports influence risk score; pending reports contribute zero points', async () => {
      const user1 = await createTestUser('hist1');
      const user2 = await createTestUser('hist2');
      const user3 = await createTestUser('hist3');
      const adminReviewer = await createTestUser('histAdmin', 'admin');

      const sharedHistPhone = '+9196' + crypto.randomInt(10000000, 99999999);
      const normalizedHistPhone = normalizePhone(sharedHistPhone);
      await trackIdentifierPreExistence('phone', normalizedHistPhone);

      // Step A: Submit Report 1 (status: 'pending')
      const rep1 = await createReport(user1.id, {
        companyNameRaw: `Pending History Corp ${runNonce}`,
        phoneRaw: sharedHistPhone,
        offerMessage: 'Neutral offer text without fee keywords',
      });
      createdReportIds.add(rep1.id);
      await resolveNewlyCreatedIdentifiers();

      // Step B: Submit Report 2 while Report 1 is pending
      const rep2 = await createReport(user2.id, {
        companyNameRaw: `Evaluation Corp 1 ${runNonce}`,
        phoneRaw: sharedHistPhone,
        offerMessage: 'Neutral offer text without fee keywords',
      });
      createdReportIds.add(rep2.id);

      // Pending Report 1 must NOT contribute historical points to Report 2
      const rep2Assessment = await prisma.riskAssessment.findFirst({
        where: { reportId: rep2.id, isCurrent: true },
      });
      assert.strictEqual(rep2Assessment.score, 0, 'Pending reports must contribute 0 historical points');
      assert.strictEqual(rep2Assessment.category, 'low');

      // Step C: Simulate admin moderation by setting Report 1 to 'verified'
      await prisma.report.update({
        where: { id: rep1.id },
        data: {
          status: 'verified',
          isVerified: true,
          reviewedBy: adminReviewer.id,
          reviewedAt: new Date(),
        },
      });

      // Step D: Submit Report 3 with the same identifier
      const rep3 = await createReport(user3.id, {
        companyNameRaw: `Evaluation Corp 2 ${runNonce}`,
        phoneRaw: sharedHistPhone,
        offerMessage: 'Neutral offer text without fee keywords',
      });
      createdReportIds.add(rep3.id);
      await resolveNewlyCreatedIdentifiers();

      // Now that Report 1 is verified, it MUST contribute historical points (+15 points for 1 verified report)
      const rep3Assessment = await prisma.riskAssessment.findFirst({
        where: { reportId: rep3.id, isCurrent: true },
        include: { factors: true },
      });
      assert.strictEqual(rep3Assessment.score, 15, '1 verified report must contribute 15 historical points');
      assert.strictEqual(rep3Assessment.category, 'low');

      const histFactor = rep3Assessment.factors.find((f) => f.factorKey.includes('HISTORICAL'));
      assert.ok(histFactor, 'Historical verified factor must be present');
      assert.strictEqual(histFactor.weight, 15);
    });

    // ══════════════════════════════════════════════════════════════════════════
    // Scenario 7, 10: RiskAssessment, RiskFactor & AuditLog Persistence
    // ══════════════════════════════════════════════════════════════════════════
    console.log('\n5. Risk Assessment, Factor Columns & Audit Log Persistence:');

    await runTest(7, 'RiskAssessment and RiskFactors persist with strictly mapped schema columns', async () => {
      const user = await createTestUser('risk');
      const report = await createReport(user.id, {
        companyNameRaw: `Scam Signals Corp ${runNonce}`,
        offerMessage: 'Mandatory registration fee of Rs 5000 required. Pay via Google Pay today, limited seats!',
        paymentRequest: 'Rs 5000 fee',
      });
      createdReportIds.add(report.id);
      await resolveNewlyCreatedIdentifiers();

      const assessment = await prisma.riskAssessment.findFirst({
        where: { reportId: report.id, isCurrent: true },
        include: { factors: true },
      });

      assert.ok(assessment);
      assert.strictEqual(assessment.score, 35); // Fee (+20) + Payment (+10) + Urgency (+5)
      assert.strictEqual(assessment.category, 'medium');
      assert.strictEqual(assessment.assessedBy, 'system');
      assert.strictEqual(assessment.version, 1);
      assert.strictEqual(assessment.isCurrent, true);
      assert.ok(assessment.summary && assessment.summary.length > 0);
      assert.ok(assessment.disclaimer && assessment.disclaimer.length > 0);

      // Check RiskFactors columns
      assert.ok(assessment.factors.length >= 2);
      for (const f of assessment.factors) {
        assert.strictEqual(f.assessmentId, assessment.id);
        assert.ok(typeof f.factorKey === 'string' && f.factorKey.length > 0);
        assert.ok(typeof f.description === 'string' && f.description.length > 0);
        assert.ok(typeof f.weight === 'number');
        assert.strictEqual(f.evidenceText, null);
        assert.ok(['low', 'medium', 'high'].includes(f.confidence));
        assert.ok(typeof f.explanation === 'string');
      }
    });

    await runTest(10, 'AuditLog record references correct action, actorId, and newValue pending', async () => {
      const user = await createTestUser('audit');
      const report = await createReport(user.id, {
        companyNameRaw: `Audit Test Corp ${runNonce}`,
        offerMessage: 'Offer details for audit log verification',
      });
      createdReportIds.add(report.id);
      await resolveNewlyCreatedIdentifiers();

      const auditLogs = await prisma.auditLog.findMany({
        where: { reportId: report.id },
      });

      assert.strictEqual(auditLogs.length, 1, 'Exactly one AuditLog row must be recorded');
      assert.strictEqual(auditLogs[0].action, 'REPORT_SUBMITTED');
      assert.strictEqual(auditLogs[0].actorId, user.id);
      assert.strictEqual(auditLogs[0].newValue, 'pending');
      assert.strictEqual(auditLogs[0].oldValue, null);
      assert.ok(auditLogs[0].notes.includes(`Audit Test Corp ${runNonce}`));
    });

    // ══════════════════════════════════════════════════════════════════════════
    // Scenario 8, 9: Real PostgreSQL Transaction Rollback Verification
    // ══════════════════════════════════════════════════════════════════════════
    console.log('\n6. Real PostgreSQL Interactive Transaction Rollback:');

    await runTest(8, 'Actual transaction rollback in PostgreSQL when RiskFactor persistence fails', async () => {
      const user = await createTestUser('rollback1');
      const failCompanyName = `Rollback RiskFactor Corp ${runNonce}`;
      const failPhone = '+9195' + crypto.randomInt(10000000, 99999999);
      const normalizedFailPhone = normalizePhone(failPhone);
      await trackIdentifierPreExistence('phone', normalizedFailPhone);

      // Intercept interactive transaction client to force RiskFactor failure
      const originalTx = prisma.$transaction.bind(prisma);
      prisma.$transaction = async (fn, opts) => {
        return originalTx(async (tx) => {
          tx.riskFactor.createMany = async () => {
            throw new Error('FORCED_RISK_FACTOR_INSERTION_FAILURE');
          };
          return fn(tx);
        }, opts);
      };

      try {
        await assert.rejects(
          () =>
            createReport(user.id, {
              companyNameRaw: failCompanyName,
              phoneRaw: failPhone,
              offerMessage: 'Pay registration fee of Rs 1000', // triggers risk factors
            }),
          /FORCED_RISK_FACTOR_INSERTION_FAILURE/
        );
      } finally {
        prisma.$transaction = originalTx;
      }

      // Verify atomic rollback in PostgreSQL: NO partial rows persisted
      const orphanedReport = await prisma.report.findFirst({
        where: { companyNameRaw: failCompanyName },
      });
      assert.strictEqual(orphanedReport, null, 'Report row must be rolled back by PostgreSQL');

      const orphanedId = await prisma.identifier.findUnique({
        where: { type_normalizedValue: { type: 'phone', normalizedValue: normalizedFailPhone } },
      });
      assert.strictEqual(orphanedId, null, 'Identifier row must be rolled back by PostgreSQL');

      const orphanedAudit = await prisma.auditLog.findFirst({
        where: { notes: { contains: failCompanyName } },
      });
      assert.strictEqual(orphanedAudit, null, 'Audit log row must be rolled back by PostgreSQL');
    });

    await runTest(9, 'Actual transaction rollback in PostgreSQL when AuditLog persistence fails', async () => {
      const user = await createTestUser('rollback2');
      const failCompanyName = `Rollback AuditLog Corp ${runNonce}`;
      const failPhone = '+9194' + crypto.randomInt(10000000, 99999999);
      const normalizedFailPhone = normalizePhone(failPhone);
      await trackIdentifierPreExistence('phone', normalizedFailPhone);

      const originalTx = prisma.$transaction.bind(prisma);
      prisma.$transaction = async (fn, opts) => {
        return originalTx(async (tx) => {
          tx.auditLog.create = async () => {
            throw new Error('FORCED_AUDIT_LOG_INSERTION_FAILURE');
          };
          return fn(tx);
        }, opts);
      };

      try {
        await assert.rejects(
          () =>
            createReport(user.id, {
              companyNameRaw: failCompanyName,
              phoneRaw: failPhone,
              offerMessage: 'Offer details for audit rollback check',
            }),
          /FORCED_AUDIT_LOG_INSERTION_FAILURE/
        );
      } finally {
        prisma.$transaction = originalTx;
      }

      // Verify atomic rollback in PostgreSQL: NO partial rows persisted
      const orphanedReport = await prisma.report.findFirst({
        where: { companyNameRaw: failCompanyName },
      });
      assert.strictEqual(orphanedReport, null, 'Report row must be rolled back by PostgreSQL');

      const orphanedId = await prisma.identifier.findUnique({
        where: { type_normalizedValue: { type: 'phone', normalizedValue: normalizedFailPhone } },
      });
      assert.strictEqual(orphanedId, null, 'Identifier row must be rolled back by PostgreSQL');

      const orphanedAssessments = await prisma.riskAssessment.findMany({
        where: { summary: { contains: failCompanyName } },
      });
      assert.strictEqual(orphanedAssessments.length, 0, 'Risk assessment row must be rolled back');
    });

    // ══════════════════════════════════════════════════════════════════════════
    // Scenario 11: Bank Account Storage via Identifier (Never Report Column)
    // ══════════════════════════════════════════════════════════════════════════
    console.log('\n7. Bank Account Persistence Isolation:');

    await runTest(11, 'Bank account is stored strictly via Identifier and ReportIdentifier, never as a Report column', async () => {
      const user = await createTestUser('bank');
      const rawBank = '987654' + crypto.randomInt(100000, 999999);
      const normalizedBank = normalizeBankAccount(rawBank);
      await trackIdentifierPreExistence('bank_account', normalizedBank);

      const report = await createReport(user.id, {
        companyNameRaw: `Bank Persistence Corp ${runNonce}`,
        bankAccountRaw: rawBank,
        offerMessage: 'Offer with bank details for fee deposit',
      });
      createdReportIds.add(report.id);
      await resolveNewlyCreatedIdentifiers();

      // Check PostgreSQL Report record: NO bankAccount column exists
      const reportRow = await prisma.report.findUnique({
        where: { id: report.id },
      });
      assert.strictEqual('bankAccount' in reportRow, false);
      assert.strictEqual('bankAccountRaw' in reportRow, false);

      // Stored in Identifier table
      const bankIdRow = await prisma.identifier.findUnique({
        where: { type_normalizedValue: { type: 'bank_account', normalizedValue: normalizedBank } },
      });
      assert.ok(bankIdRow, 'Bank account must exist in Identifier table');
      assert.strictEqual(bankIdRow.type, 'bank_account');
      assert.strictEqual(bankIdRow.normalizedValue, normalizedBank);

      // Linked in ReportIdentifier table
      const junction = await prisma.reportIdentifier.findUnique({
        where: {
          reportId_identifierId: {
            reportId: report.id,
            identifierId: bankIdRow.id,
          },
        },
      });
      assert.ok(junction, 'Junction record must link report and bank account identifier');
      assert.strictEqual(junction.matchType, 'direct_submission');
    });

    // ══════════════════════════════════════════════════════════════════════════
    // Scenario 12, 13: Privacy Masking & Credential Security
    // ══════════════════════════════════════════════════════════════════════════
    console.log('\n8. Privacy Masking & Credential Shielding:');

    await runTest(12, 'Student response masking masks direct PII and nested bank account identifiers', async () => {
      const user = await createTestUser('privacy');
      const rawPhone = '+9193' + crypto.randomInt(10000000, 99999999);
      const rawEmail = `contact-${runNonce}@secure-test.org`;
      const rawUpi = `payment-${runNonce}@okhdfcbank`;
      const rawBank = '5555444433332222';

      await trackIdentifierPreExistence('phone', normalizePhone(rawPhone));
      await trackIdentifierPreExistence('email', normalizeEmail(rawEmail));
      await trackIdentifierPreExistence('upi', normalizeUpi(rawUpi));
      await trackIdentifierPreExistence('bank_account', normalizeBankAccount(rawBank));

      const sanitizedResult = await createReport(
        user.id,
        {
          companyNameRaw: `Privacy Corp ${runNonce}`,
          phoneRaw: rawPhone,
          emailRaw: rawEmail,
          upiRaw: rawUpi,
          bankAccountRaw: rawBank,
          offerMessage: 'Offer with multiple PII attributes',
        },
        'student'
      );
      createdReportIds.add(sanitizedResult.id);
      await resolveNewlyCreatedIdentifiers();

      // Report-level PII masked
      assert.ok(sanitizedResult.phoneRaw.includes('XXXXX'));
      assert.ok(sanitizedResult.emailRaw.includes('***@'));
      assert.ok(sanitizedResult.upiRaw.includes('***'));

      // Nested junction bank account masked
      const bankJunc = sanitizedResult.identifiers.find((i) => i.identifier.type === 'bank_account');
      assert.ok(bankJunc);
      assert.strictEqual(bankJunc.identifier.value, '************2222');
      assert.strictEqual(bankJunc.identifier.normalizedValue, '************2222');
    });

    await runTest(13, 'Responses contain no password hashes, private tokens, or credential leaks', async () => {
      const user = await createTestUser('cred');
      const result = await createReport(user.id, {
        companyNameRaw: `Credential Safe Corp ${runNonce}`,
        offerMessage: 'Offer text for credential leakage check',
      });
      createdReportIds.add(result.id);
      await resolveNewlyCreatedIdentifiers();

      const serialized = JSON.stringify(result);
      assert.strictEqual(serialized.includes('passwordHash'), false);
      assert.strictEqual(serialized.includes('$2a$10$'), false);
      assert.strictEqual(serialized.includes('tokenHash'), false);
    });

    console.log(`\n======================================================`);
    console.log(`Phase 5B.4 Real PostgreSQL Integration Suite Summary:`);
    console.log(`  Total Cases:   ${totalTests}`);
    console.log(`  Passed:        ${passedTests}`);
    console.log(`  Failed:        ${failedTests}`);
    console.log(`======================================================\n`);
  } finally {
    // ─── Scoped Non-Destructive Teardown ─────────────────────────────────────
    // Deletes ONLY records explicitly created during this test run.
    // NEVER TRUNCATE or touch pre-existing baseline/seed data.
    try {
      if (createdReportIds.size > 0) {
        const reportIds = Array.from(createdReportIds);

        // 1. Delete audit logs linked to test reports
        await prisma.auditLog.deleteMany({
          where: { reportId: { in: reportIds } },
        });

        // 2. Delete report-identifier junction rows for test reports
        await prisma.reportIdentifier.deleteMany({
          where: { reportId: { in: reportIds } },
        });

        // 3. Delete risk factors for test assessments
        await prisma.riskFactor.deleteMany({
          where: { assessment: { reportId: { in: reportIds } } },
        });

        // 4. Delete risk assessments for test reports
        await prisma.riskAssessment.deleteMany({
          where: { reportId: { in: reportIds } },
        });

        // 5. Delete test reports
        await prisma.report.deleteMany({
          where: { id: { in: reportIds } },
        });
      }

      // 6. Delete newly created identifiers ONLY if zero remaining junction links
      if (newlyCreatedIdentifierIds.size > 0) {
        for (const id of newlyCreatedIdentifierIds) {
          const remainingLinks = await prisma.reportIdentifier.count({
            where: { identifierId: id },
          });
          if (remainingLinks === 0) {
            await prisma.auditLog.deleteMany({ where: { identifierId: id } });
            await prisma.identifier.delete({ where: { id } }).catch(() => {});
          }
        }
      }

      // 7. Delete test users
      if (createdUserIds.size > 0) {
        const userIds = Array.from(createdUserIds);
        await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
        await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      }
    } catch (cleanupErr) {
      console.error('\n[FATAL] Teardown record cleanup failed:', cleanupErr.message || cleanupErr);
      process.exitCode = 1;
    }

    try {
      await prisma.$disconnect();
    } catch {}
  }
}

main().catch(async (err) => {
  console.error('\n[FATAL] Unhandled integration test runner error:', err);
  process.exitCode = 1;
  try {
    await prisma.$disconnect();
  } catch {}
});
