'use strict';

/**
 * backend/test/report_submission.test.js
 * Comprehensive unit test suite for report.service.js.
 *
 * SAFETY INVARIANTS:
 * - ZERO database connections; Prisma client is deterministically mocked in-memory.
 * - ZERO .env access or modification.
 * - Independent and repeatable: mocks are isolated and restored after each test.
 *
 * COVERS:
 * 1. Missing or invalid user ID / input payload.
 * 2. Minimal report with zero identifiers (bypasses identifier queries).
 * 3. All five supported identifier types (phone, email, upi, domain, bank_account).
 * 4. Deduplication of normalized identifiers across scalar fields and arrays.
 * 5. Verified-only historical matching (DB query-level status: 'verified' filter).
 * 6. Correct risk engine input and output mapping.
 * 7. Exclusion of evidenceCategory and provenance from RiskFactor persistence.
 * 8. Correct six-step transaction sequence.
 * 9. Failure propagation at each persistence stage.
 * 10. Student role PII masking, including nested bank account and junction records.
 * 11. Admin role unmasked response.
 * 12. Optional and null field handling.
 * 13. Client-controlled ownership, status, and verification fields cannot influence persistence.
 */

// Configure environment to prevent dotenv loading from prisma.js
process.env.DATABASE_URL = 'postgresql://mock:mock@localhost:5432/mock_test';
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'mock_jwt_secret_at_least_32_characters_long_0123456789';

const assert = require('assert');
const prisma = require('../src/utils/prisma');
const { createReport } = require('../src/services/report.service');
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

// ─── Deterministic Mock Infrastructure ───────────────────────────────────────

const originalPrismaMethods = {
  findMany: prisma.identifier.findMany,
  $transaction: prisma.$transaction,
};

function restorePrisma() {
  prisma.identifier.findMany = originalPrismaMethods.findMany;
  prisma.$transaction = originalPrismaMethods.$transaction;
}

/**
 * Creates a mock Prisma environment tracking calls and providing customizable hooks.
 */
function createMockPrisma(options = {}) {
  const calls = {
    findMany: [],
    upsert: [],
    reportCreate: [],
    reportIdentifierCreate: [],
    riskAssessmentCreate: [],
    riskFactorCreateMany: [],
    auditLogCreate: [],
    reportFindUnique: [],
    executionOrder: [],
  };

  prisma.identifier.findMany = async (args) => {
    calls.findMany.push(args);
    calls.executionOrder.push('identifier.findMany');
    if (options.onFindMany) return options.onFindMany(args);
    return options.existingIdentifiers || [];
  };

  prisma.$transaction = async (fn) => {
    const tx = {
      identifier: {
        upsert: async (args) => {
          calls.upsert.push(args);
          calls.executionOrder.push('identifier.upsert');
          if (options.onUpsert) return options.onUpsert(args);
          return {
            id: `id-${args.create.type}-${args.create.normalizedValue}`,
            type: args.create.type,
            value: args.create.value,
            normalizedValue: args.create.normalizedValue,
            confidence: args.create.confidence,
            firstSeen: new Date(),
            lastSeen: new Date(),
          };
        },
      },
      report: {
        create: async (args) => {
          calls.reportCreate.push(args);
          calls.executionOrder.push('report.create');
          if (options.onReportCreate) return options.onReportCreate(args);
          return {
            id: 'rep-uuid-101',
            ...args.data,
            submittedAt: new Date(),
          };
        },
        findUnique: async (args) => {
          calls.reportFindUnique.push(args);
          calls.executionOrder.push('report.findUnique');
          if (options.onReportFindUnique) return options.onReportFindUnique(args);

          // Build realistic graph based on recorded calls
          const identifiers = calls.upsert.map((u) => ({
            reportId: 'rep-uuid-101',
            identifierId: `id-${u.create.type}-${u.create.normalizedValue}`,
            confidence: 'medium',
            matchType: 'direct_submission',
            matchDescription: 'Submitted directly',
            identifier: {
              id: `id-${u.create.type}-${u.create.normalizedValue}`,
              type: u.create.type,
              value: u.create.value,
              normalizedValue: u.create.normalizedValue,
              confidence: 'medium',
            },
          }));

          const assessmentData = calls.riskAssessmentCreate[0]?.data || {};
          const factorData = (calls.riskFactorCreateMany[0]?.data || []).map((f, idx) => ({
            id: `factor-${idx + 1}`,
            ...f,
          }));

          const createdReport = calls.reportCreate[0]?.data || {};

          return {
            id: 'rep-uuid-101',
            ...createdReport,
            submittedAt: new Date(),
            identifiers,
            riskAssessments: [
              {
                id: 'risk-uuid-201',
                reportId: 'rep-uuid-101',
                score: assessmentData.score,
                category: assessmentData.category,
                summary: assessmentData.summary,
                disclaimer: assessmentData.disclaimer,
                assessedBy: assessmentData.assessedBy,
                isCurrent: true,
                version: 1,
                factors: factorData,
              },
            ],
          };
        },
      },
      reportIdentifier: {
        create: async (args) => {
          calls.reportIdentifierCreate.push(args);
          calls.executionOrder.push('reportIdentifier.create');
          if (options.onReportIdentifierCreate) return options.onReportIdentifierCreate(args);
          return args.data;
        },
      },
      riskAssessment: {
        create: async (args) => {
          calls.riskAssessmentCreate.push(args);
          calls.executionOrder.push('riskAssessment.create');
          if (options.onRiskAssessmentCreate) return options.onRiskAssessmentCreate(args);
          return {
            id: 'risk-uuid-201',
            ...args.data,
          };
        },
      },
      riskFactor: {
        createMany: async (args) => {
          calls.riskFactorCreateMany.push(args);
          calls.executionOrder.push('riskFactor.createMany');
          if (options.onRiskFactorCreateMany) return options.onRiskFactorCreateMany(args);
          return { count: args.data.length };
        },
      },
      auditLog: {
        create: async (args) => {
          calls.auditLogCreate.push(args);
          calls.executionOrder.push('auditLog.create');
          if (options.onAuditLogCreate) return options.onAuditLogCreate(args);
          return { id: 'audit-uuid-301', ...args.data };
        },
      },
    };

    return fn(tx);
  };

  return calls;
}

// ─── Test Suite Execution ───────────────────────────────────────────────────

async function main() {
  console.log('\n--- Phase 5B.3: Service Unit Tests (backend/test/report_submission.test.js) ---\n');

  try {
    // ══════════════════════════════════════════════════════════════════════════
    // Group 1: Submitter User ID & Input Validation
    // ══════════════════════════════════════════════════════════════════════════
    console.log('1. Submitter User ID & Input Validation:');

    await runTest('createReport rejects missing userId (null) with 400 AppError', async () => {
      await assert.rejects(
        () => createReport(null, { companyNameRaw: 'Acme', offerMessage: 'Sample' }),
        (err) => err instanceof AppError && err.statusCode === 400 && err.message.includes('Submitter user ID is required')
      );
    });

    await runTest('createReport rejects undefined userId with 400 AppError', async () => {
      await assert.rejects(
        () => createReport(undefined, { companyNameRaw: 'Acme', offerMessage: 'Sample' }),
        (err) => err instanceof AppError && err.statusCode === 400
      );
    });

    await runTest('createReport rejects non-string userId with 400 AppError', async () => {
      await assert.rejects(
        () => createReport(12345, { companyNameRaw: 'Acme', offerMessage: 'Sample' }),
        (err) => err instanceof AppError && err.statusCode === 400
      );
    });

    await runTest('createReport rejects empty string userId with 400 AppError', async () => {
      await assert.rejects(
        () => createReport('', { companyNameRaw: 'Acme', offerMessage: 'Sample' }),
        (err) => err instanceof AppError && err.statusCode === 400
      );
    });

    await runTest('createReport rejects null validatedData with 400 AppError', async () => {
      await assert.rejects(
        () => createReport('user-1', null),
        (err) => err instanceof AppError && err.statusCode === 400 && err.message.includes('Report data is required')
      );
    });

    await runTest('createReport rejects non-object validatedData with 400 AppError', async () => {
      await assert.rejects(
        () => createReport('user-1', 'not-an-object'),
        (err) => err instanceof AppError && err.statusCode === 400
      );
    });

    // ══════════════════════════════════════════════════════════════════════════
    // Group 2: Minimal Report Submission (Zero Identifiers)
    // ══════════════════════════════════════════════════════════════════════════
    console.log('\n2. Minimal Report Submission (Zero Identifiers):');

    await runTest('minimal report with zero identifiers succeeds without querying historical DB', async () => {
      const calls = createMockPrisma();
      const result = await createReport('user-stu-1', {
        companyNameRaw: 'Pure Minimal Corp',
        offerMessage: 'Legitimate interview offer without suspicious terms',
      });

      // Assert historical query was bypassed
      assert.strictEqual(calls.findMany.length, 0, 'findMany should not be called when 0 identifiers exist');
      // Assert identifier upserts were bypassed
      assert.strictEqual(calls.upsert.length, 0);
      assert.strictEqual(calls.reportIdentifierCreate.length, 0);

      // Assert report was created
      assert.strictEqual(calls.reportCreate.length, 1);
      assert.strictEqual(calls.reportCreate[0].data.companyNameRaw, 'Pure Minimal Corp');
      assert.strictEqual(calls.reportCreate[0].data.status, 'pending');
      assert.strictEqual(calls.reportCreate[0].data.submittedBy, 'user-stu-1');

      // Assert risk assessment was created
      assert.strictEqual(calls.riskAssessmentCreate.length, 1);
      assert.strictEqual(calls.riskAssessmentCreate[0].data.score, 0);
      assert.strictEqual(calls.riskAssessmentCreate[0].data.category, 'low');
      assert.strictEqual(calls.riskAssessmentCreate[0].data.assessedBy, 'system');

      // Assert risk factors were skipped (empty)
      assert.strictEqual(calls.riskFactorCreateMany.length, 0);

      // Assert audit log was recorded
      assert.strictEqual(calls.auditLogCreate.length, 1);
      assert.strictEqual(calls.auditLogCreate[0].data.action, 'REPORT_SUBMITTED');
      assert.strictEqual(calls.auditLogCreate[0].data.actorId, 'user-stu-1');

      assert.strictEqual(result.companyNameRaw, 'Pure Minimal Corp');
      assert.strictEqual(result.status, 'pending');
    });

    // ══════════════════════════════════════════════════════════════════════════
    // Group 3: All Five Supported Identifier Types
    // ══════════════════════════════════════════════════════════════════════════
    console.log('\n3. All Five Supported Identifier Types:');

    await runTest('extracts and upserts all 5 supported types including bank_account', async () => {
      const calls = createMockPrisma();
      await createReport('user-stu-1', {
        companyNameRaw: 'Multi Identifier Tech',
        phoneRaw: '9876543210',
        emailRaw: 'contact@multi-tech.org',
        upiRaw: 'payment@okhdfcbank',
        domainRaw: 'multi-tech.org',
        bankAccountRaw: '12345678901234',
        offerMessage: 'Offer details with multiple contacts',
      });

      // 5 identifiers extracted and upserted
      assert.strictEqual(calls.upsert.length, 5);
      const upsertedTypes = calls.upsert.map((u) => u.where.type_normalizedValue.type).sort();
      assert.deepStrictEqual(upsertedTypes, ['bank_account', 'domain', 'email', 'phone', 'upi']);

      // Compound unique selector type_normalizedValue verification
      const phoneUpsert = calls.upsert.find((u) => u.where.type_normalizedValue.type === 'phone');
      assert.strictEqual(phoneUpsert.where.type_normalizedValue.normalizedValue, '+919876543210');
      assert.strictEqual(phoneUpsert.create.confidence, 'medium');

      const bankUpsert = calls.upsert.find((u) => u.where.type_normalizedValue.type === 'bank_account');
      assert.strictEqual(bankUpsert.where.type_normalizedValue.normalizedValue, '12345678901234');

      // Junction linking
      assert.strictEqual(calls.reportIdentifierCreate.length, 5);
      for (const junc of calls.reportIdentifierCreate) {
        assert.strictEqual(junc.data.matchType, 'direct_submission');
        assert.strictEqual(junc.data.addedBy, 'user-stu-1');
        assert.strictEqual(junc.data.reportId, 'rep-uuid-101');
      }

      // CRITICAL: bankAccount is NOT stored as a column on the Report table
      const reportCreateData = calls.reportCreate[0].data;
      assert.strictEqual('bankAccount' in reportCreateData, false);
      assert.strictEqual('bankAccountRaw' in reportCreateData, false);
    });

    // ══════════════════════════════════════════════════════════════════════════
    // Group 4: Identifier Deduplication
    // ══════════════════════════════════════════════════════════════════════════
    console.log('\n4. Identifier Deduplication:');

    await runTest('deduplicates duplicate normalized identifiers across contact fields and identifiers array', async () => {
      const calls = createMockPrisma();
      await createReport('user-stu-1', {
        companyNameRaw: 'Deduplication Corp',
        phone: '+91 98765 43210',
        phoneRaw: '9876543210', // Identical phone
        email: 'TEST@example.com',
        emailRaw: 'test@example.com', // Identical email
        identifiers: [
          { type: 'phone', value: '09876543210' }, // Leading zero Indian phone -> +919876543210
          { type: 'email', value: 'Test@Example.com' }, // Same email
          { type: 'upi', value: 'fraud@upi' },
        ],
        offerMessage: 'Offer message with duplicate contacts',
      });

      // Deduplicated: 1 phone (+919876543210), 1 email (test@example.com), 1 upi (fraud@upi) = 3 total
      assert.strictEqual(calls.upsert.length, 3);
      assert.strictEqual(calls.reportIdentifierCreate.length, 3);

      const types = calls.upsert.map((u) => u.where.type_normalizedValue.type).sort();
      assert.deepStrictEqual(types, ['email', 'phone', 'upi']);
    });

    // ══════════════════════════════════════════════════════════════════════════
    // Group 5: Verified-Only Historical Matching
    // ══════════════════════════════════════════════════════════════════════════
    console.log('\n5. Verified-Only Historical Matching:');

    await runTest('historical matching strictly enforces report: { status: "verified" } filter at DB query level', async () => {
      let capturedFindManyArgs = null;
      const calls = createMockPrisma({
        onFindMany: (args) => {
          capturedFindManyArgs = args;
          return [
            {
              type: 'phone',
              normalizedValue: '+919876543210',
              reports: [
                { report: { id: 'verified-rep-1', status: 'verified' } },
                { report: { id: 'verified-rep-2', status: 'verified' } },
              ],
            },
          ];
        },
      });

      await createReport('user-stu-1', {
        companyNameRaw: 'Scam Network Corp',
        phoneRaw: '9876543210',
        offerMessage: 'Offer message with verified historical link',
      });

      // Check query arguments
      assert.ok(capturedFindManyArgs, 'findMany was called');
      assert.strictEqual(
        capturedFindManyArgs.select.reports.where.report.status,
        'verified',
        'Database query filter MUST be status: verified'
      );

      // Verify that verified reports contributed historical score:
      // 2 verified reports for 1 identifier = +25 points (< 35 threshold = 'low' category)
      const assessmentData = calls.riskAssessmentCreate[0].data;
      assert.strictEqual(assessmentData.score, 25);
      assert.strictEqual(assessmentData.category, 'low');
    });

    await runTest('unverified reports contribute zero points to historical score', async () => {
      const calls = createMockPrisma({
        existingIdentifiers: [
          {
            type: 'phone',
            normalizedValue: '+919876543210',
            reports: [], // DB filter stripped all pending/rejected reports
          },
        ],
      });

      await createReport('user-stu-1', {
        companyNameRaw: 'Clean Corp',
        phoneRaw: '9876543210',
        offerMessage: 'Clean offer without suspicious signals',
      });

      const assessmentData = calls.riskAssessmentCreate[0].data;
      assert.strictEqual(assessmentData.score, 0);
      assert.strictEqual(assessmentData.category, 'low');
    });

    // ══════════════════════════════════════════════════════════════════════════
    // Group 6: Risk Engine Integration & Factor Mapping
    // ══════════════════════════════════════════════════════════════════════════
    console.log('\n6. Risk Engine Integration & Factor Mapping:');

    await runTest('routes offerMessage and paymentRequest, persisting factors strictly matching schema columns', async () => {
      const calls = createMockPrisma();
      await createReport('user-stu-1', {
        companyNameRaw: 'High Pressure Hiring',
        offerMessage: 'Pay registration fee of Rs 2000 immediately via UPI, seats filling fast!',
        paymentRequest: 'Send Rs 2000 security deposit',
      });

      // Intrinsic signals should trigger:
      // FEE_DEMAND (+20), PAYMENT_INSTRUCTIONS (+10), URGENCY (+5) = 35 points
      const assessmentData = calls.riskAssessmentCreate[0].data;
      assert.strictEqual(assessmentData.score, 35);
      assert.strictEqual(assessmentData.category, 'medium');
      assert.strictEqual(assessmentData.assessedBy, 'system');
      assert.strictEqual(assessmentData.isCurrent, true);
      assert.strictEqual(assessmentData.version, 1);
      assert.ok(assessmentData.summary && assessmentData.summary.length > 0);
      assert.ok(assessmentData.disclaimer && assessmentData.disclaimer.length > 0);

      // Check RiskFactors batch create
      assert.strictEqual(calls.riskFactorCreateMany.length, 1);
      const factorsData = calls.riskFactorCreateMany[0].data;
      assert.ok(factorsData.length >= 2, 'Should have multiple factors');

      for (const factor of factorsData) {
        assert.strictEqual(factor.assessmentId, 'risk-uuid-201');
        assert.ok(typeof factor.factorKey === 'string' && factor.factorKey.length > 0);
        assert.ok(typeof factor.description === 'string' && factor.description.length > 0);
        assert.ok(typeof factor.weight === 'number');
        assert.strictEqual(factor.evidenceText, null);
        assert.ok(['low', 'medium', 'high'].includes(factor.confidence));
        assert.ok(typeof factor.explanation === 'string');

        // CRITICAL: Non-schema fields emitted by risk engine MUST be excluded
        assert.strictEqual('evidenceCategory' in factor, false, 'evidenceCategory must NOT be passed to Prisma');
        assert.strictEqual('provenance' in factor, false, 'provenance must NOT be passed to Prisma');
      }
    });

    // ══════════════════════════════════════════════════════════════════════════
    // Group 7: Transaction Sequence & Failure Propagation
    // ══════════════════════════════════════════════════════════════════════════
    console.log('\n7. Transaction Sequence & Failure Propagation:');

    await runTest('executes the 6 transaction operations in the strict approved sequence', async () => {
      const calls = createMockPrisma();
      await createReport('user-stu-1', {
        companyNameRaw: 'Sequence Corp',
        phoneRaw: '9876543210',
        offerMessage: 'Pay fee of Rs 500',
      });

      assert.deepStrictEqual(calls.executionOrder, [
        'identifier.findMany', // Outside transaction
        'identifier.upsert',   // Op 1
        'report.create',       // Op 2
        'reportIdentifier.create', // Op 3
        'riskAssessment.create',   // Op 4
        'riskFactor.createMany',   // Op 5
        'auditLog.create',     // Op 6
        'report.findUnique',   // Post-transaction reload
      ]);
    });

    await runTest('failure at Op 1 (identifier.upsert) rejects transaction', async () => {
      createMockPrisma({
        onUpsert: () => {
          throw new Error('Database disk full on identifier upsert');
        },
      });

      await assert.rejects(
        () =>
          createReport('user-stu-1', {
            companyNameRaw: 'Fail Corp',
            phoneRaw: '9876543210',
            offerMessage: 'Offer text',
          }),
        /Database disk full on identifier upsert/
      );
    });

    await runTest('failure at Op 2 (report.create) rejects transaction', async () => {
      createMockPrisma({
        onReportCreate: () => {
          throw new Error('Foreign key violation on submittedBy');
        },
      });

      await assert.rejects(
        () =>
          createReport('user-stu-1', {
            companyNameRaw: 'Fail Corp',
            phoneRaw: '9876543210',
            offerMessage: 'Offer text',
          }),
        /Foreign key violation on submittedBy/
      );
    });

    await runTest('failure at Op 3 (reportIdentifier.create) rejects transaction', async () => {
      createMockPrisma({
        onReportIdentifierCreate: () => {
          throw new Error('Deadlock on report_identifiers junction');
        },
      });

      await assert.rejects(
        () =>
          createReport('user-stu-1', {
            companyNameRaw: 'Fail Corp',
            phoneRaw: '9876543210',
            offerMessage: 'Offer text',
          }),
        /Deadlock on report_identifiers junction/
      );
    });

    await runTest('failure at Op 4 (riskAssessment.create) rejects transaction', async () => {
      createMockPrisma({
        onRiskAssessmentCreate: () => {
          throw new Error('Risk assessment unique constraint violation');
        },
      });

      await assert.rejects(
        () =>
          createReport('user-stu-1', {
            companyNameRaw: 'Fail Corp',
            phoneRaw: '9876543210',
            offerMessage: 'Offer text',
          }),
        /Risk assessment unique constraint violation/
      );
    });

    await runTest('failure at Op 5 (riskFactor.createMany) rejects transaction', async () => {
      createMockPrisma({
        onRiskFactorCreateMany: () => {
          throw new Error('Batch insert timeout');
        },
      });

      await assert.rejects(
        () =>
          createReport('user-stu-1', {
            companyNameRaw: 'Fail Corp',
            offerMessage: 'Pay registration fee of Rs 1000', // generates factors
          }),
        /Batch insert timeout/
      );
    });

    await runTest('failure at Op 6 (auditLog.create) rejects transaction', async () => {
      createMockPrisma({
        onAuditLogCreate: () => {
          throw new Error('Audit log write failure');
        },
      });

      await assert.rejects(
        () =>
          createReport('user-stu-1', {
            companyNameRaw: 'Fail Corp',
            phoneRaw: '9876543210',
            offerMessage: 'Offer text',
          }),
        /Audit log write failure/
      );
    });

    // ══════════════════════════════════════════════════════════════════════════
    // Group 8: Privacy Masking & Response Sanitization
    // ══════════════════════════════════════════════════════════════════════════
    console.log('\n8. Privacy Masking & Response Sanitization:');

    await runTest('masks direct PII and nested bank-account identifiers for student role', async () => {
      createMockPrisma();
      const result = await createReport(
        'user-stu-1',
        {
          companyNameRaw: 'Secret Scam Corp',
          phoneRaw: '+919876543210',
          emailRaw: 'scam@secretscam.org',
          upiRaw: 'fraudster@okhdfcbank',
          bankAccountRaw: '12345678901234',
          offerMessage: 'Offer with sensitive payment details',
        },
        'student' // Student role
      );

      // Report-level PII masked
      assert.strictEqual(result.phoneRaw, '+9198XXXXX');
      assert.strictEqual(result.emailRaw, 's***@secretscam.org');
      assert.strictEqual(result.upiRaw, 'f******er@okhdfcbank');

      // Nested junction identifiers masked
      const bankJunction = result.identifiers.find((i) => i.identifier.type === 'bank_account');
      assert.ok(bankJunction, 'Bank account identifier junction exists');
      assert.strictEqual(bankJunction.identifier.value, '**********1234');
      assert.strictEqual(bankJunction.identifier.normalizedValue, '**********1234');

      const phoneJunction = result.identifiers.find((i) => i.identifier.type === 'phone');
      assert.strictEqual(phoneJunction.identifier.value, '+9198XXXXX');

      const emailJunction = result.identifiers.find((i) => i.identifier.type === 'email');
      assert.strictEqual(emailJunction.identifier.value, 's***@secretscam.org');
    });

    await runTest('preserves unmasked PII for admin role', async () => {
      createMockPrisma();
      const result = await createReport(
        'admin-user-1',
        {
          companyNameRaw: 'Secret Scam Corp',
          phoneRaw: '+919876543210',
          emailRaw: 'scam@secretscam.org',
          upiRaw: 'fraudster@okhdfcbank',
          bankAccountRaw: '12345678901234',
          offerMessage: 'Offer with sensitive payment details',
        },
        'admin' // Admin role
      );

      // Report-level PII unmasked for admin
      assert.strictEqual(result.phoneRaw, '+919876543210');
      assert.strictEqual(result.emailRaw, 'scam@secretscam.org');
      assert.strictEqual(result.upiRaw, 'fraudster@okhdfcbank');

      // Nested identifiers unmasked for admin
      const bankJunction = result.identifiers.find((i) => i.identifier.type === 'bank_account');
      assert.strictEqual(bankJunction.identifier.value, '12345678901234');
      assert.strictEqual(bankJunction.identifier.normalizedValue, '12345678901234');
    });

    // ══════════════════════════════════════════════════════════════════════════
    // Group 9: Optional, Null & Immutability Invariants
    // ══════════════════════════════════════════════════════════════════════════
    console.log('\n9. Optional, Null & Immutability Invariants:');

    await runTest('coalesces undefined optional fields to explicit null for Prisma', async () => {
      const calls = createMockPrisma();
      await createReport('user-stu-1', {
        companyNameRaw: 'Minimal Optional Corp',
        offerMessage: 'Valid text',
        // All optional fields omitted
      });

      const data = calls.reportCreate[0].data;
      assert.strictEqual(data.recruiterNameRaw, null);
      assert.strictEqual(data.domainRaw, null);
      assert.strictEqual(data.phoneRaw, null);
      assert.strictEqual(data.emailRaw, null);
      assert.strictEqual(data.upiRaw, null);
      assert.strictEqual(data.paymentRequest, null);
      assert.strictEqual(data.additionalNotes, null);
      assert.strictEqual(data.status, 'pending');
      assert.strictEqual(data.isVerified, false);
      assert.strictEqual(data.isInferred, false);
    });

    await runTest('client-controlled ownership, status, and verification fields cannot influence persistence', async () => {
      const calls = createMockPrisma();
      await createReport('genuine-user-id', {
        companyNameRaw: 'Spoof Attack Corp',
        offerMessage: 'Offer text',
        // Attacker attempts mass-assignment:
        submittedBy: 'spoofed-attacker-id',
        status: 'verified',
        isVerified: true,
        isInferred: true,
        reviewedBy: 'spoofed-admin-id',
        reviewedAt: new Date(),
        companyId: 'fake-company-id',
        recruiterId: 'fake-recruiter-id',
      });

      const reportData = calls.reportCreate[0].data;
      assert.strictEqual(reportData.submittedBy, 'genuine-user-id', 'submittedBy must strictly match function argument');
      assert.strictEqual(reportData.status, 'pending', 'status must be hardcoded pending');
      assert.strictEqual(reportData.isVerified, false, 'isVerified must be false');
      assert.strictEqual(reportData.isInferred, false, 'isInferred must be false');
      assert.strictEqual('reviewedBy' in reportData, false, 'reviewedBy must NOT be passed to report.create');
      assert.strictEqual('reviewedAt' in reportData, false, 'reviewedAt must NOT be passed to report.create');
      assert.strictEqual('companyId' in reportData, false, 'companyId must NOT be passed to report.create');
      assert.strictEqual('recruiterId' in reportData, false, 'recruiterId must NOT be passed to report.create');

      const auditData = calls.auditLogCreate[0].data;
      assert.strictEqual(auditData.actorId, 'genuine-user-id');
      assert.strictEqual(auditData.newValue, 'pending');

      const riskData = calls.riskAssessmentCreate[0].data;
      assert.strictEqual(riskData.assessedBy, 'system');
    });

    console.log(`\nAll ${passedTests} / ${totalTests} report_submission unit tests passed successfully!\n`);
  } finally {
    restorePrisma();
  }
}

main().catch((err) => {
  console.error('\n[FATAL TEST RUNNER FAILURE]:', err);
  process.exit(1);
});
