'use strict';

/**
 * backend/test/check_service.test.js
 * Comprehensive unit test suite for check.service.js.
 *
 * SAFETY INVARIANTS:
 * - ZERO database connections: Prisma client is deterministically mocked in-memory.
 * - ZERO .env access or modification.
 * - Independent and repeatable: mocks are isolated and restored after each test.
 *
 * COVERS:
 * 1. Missing or invalid user ID / input payload.
 * 2. Minimal offer check with zero identifiers (evaluates intrinsic signals only, no identifier query).
 * 3. All five supported identifier types (phone, email, upi, domain, bank_account).
 * 4. Deduplication of normalized identifiers.
 * 5. Verified-only historical matching (DB query-level status: 'verified' filter).
 * 6. Unverified reports (pending, rejected, investigating) contribute zero points to historical score.
 * 7. Correct risk engine integration and factor mapping.
 * 8. Persistence verification: OfferCheck creation with exact schema fields and JSON snapshot.
 * 9. HMAC-SHA256 client IP hashing for rate-limiting.
 * 10. Role-based privacy masking (student masked, admin unmasked, internal ipHash excluded).
 * 11. Authenticated check history retrieval with user isolation, pagination, and sorting.
 * 12. Single check retrieval with ownership enforcement (owner allowed, admin allowed, non-owner 403).
 * 13. Non-existent check ID handling (404).
 * 14. Error handling and failure propagation.
 */

// Configure environment to prevent dotenv loading from prisma.js
process.env.DATABASE_URL = 'postgresql://mock:mock@localhost:5432/mock_test';
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'mock_jwt_secret_at_least_32_characters_long_0123456789';
process.env.IP_HASH_SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const assert = require('assert');
const crypto = require('crypto');
const prisma = require('../src/utils/prisma');
const checkService = require('../src/services/check.service');
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
  identifierFindMany: prisma.identifier.findMany,
  offerCheckCreate: prisma.offerCheck.create,
  offerCheckCount: prisma.offerCheck.count,
  offerCheckFindMany: prisma.offerCheck.findMany,
  offerCheckFindUnique: prisma.offerCheck.findUnique,
};

function restorePrisma() {
  prisma.identifier.findMany = originalPrismaMethods.identifierFindMany;
  prisma.offerCheck.create = originalPrismaMethods.offerCheckCreate;
  prisma.offerCheck.count = originalPrismaMethods.offerCheckCount;
  prisma.offerCheck.findMany = originalPrismaMethods.offerCheckFindMany;
  prisma.offerCheck.findUnique = originalPrismaMethods.offerCheckFindUnique;
}

function createMockPrisma(options = {}) {
  const calls = {
    identifierFindMany: [],
    offerCheckCreate: [],
    offerCheckCount: [],
    offerCheckFindMany: [],
    offerCheckFindUnique: [],
  };

  prisma.identifier.findMany = async (args) => {
    calls.identifierFindMany.push(args);
    if (options.onIdentifierFindMany) return options.onIdentifierFindMany(args);
    return options.existingIdentifiers || [];
  };

  prisma.offerCheck.create = async (args) => {
    calls.offerCheckCreate.push(args);
    if (options.onOfferCheckCreate) return options.onOfferCheckCreate(args);
    return {
      id: 'mock-check-uuid-1',
      userId: args.data.userId,
      companyName: args.data.companyName,
      phoneQuery: args.data.phoneQuery,
      emailQuery: args.data.emailQuery,
      upiQuery: args.data.upiQuery,
      domainQuery: args.data.domainQuery,
      riskScore: args.data.riskScore,
      riskCategory: args.data.riskCategory,
      result: args.data.result,
      ipHash: args.data.ipHash,
      checkedAt: new Date('2026-11-14T10:00:00.000Z'),
    };
  };

  prisma.offerCheck.count = async (args) => {
    calls.offerCheckCount.push(args);
    if (options.onOfferCheckCount) return options.onOfferCheckCount(args);
    return options.count !== undefined ? options.count : 0;
  };

  prisma.offerCheck.findMany = async (args) => {
    calls.offerCheckFindMany.push(args);
    if (options.onOfferCheckFindMany) return options.onOfferCheckFindMany(args);
    return options.checks || [];
  };

  prisma.offerCheck.findUnique = async (args) => {
    calls.offerCheckFindUnique.push(args);
    if (options.onOfferCheckFindUnique) return options.onOfferCheckFindUnique(args);
    return options.checkRecord || null;
  };

  return calls;
}

// ─── Test Suite Execution ───────────────────────────────────────────────────

async function runAllTests() {
  console.log('\n--- Phase 6: Offer Check Service Unit Tests ---\n');

  // Group 1: Input Validation & Boundary Guards
  console.log('1. Input Validation & Parameter Guards:');

  await runTest('performCheck rejects missing or empty userId with 400 AppError', async () => {
    await assert.rejects(
      async () => checkService.performCheck('', { offerMessage: 'Test' }),
      (err) => err instanceof AppError && err.statusCode === 400
    );
    await assert.rejects(
      async () => checkService.performCheck(null, { offerMessage: 'Test' }),
      (err) => err instanceof AppError && err.statusCode === 400
    );
  });

  await runTest('performCheck rejects null or non-object validatedData with 400 AppError', async () => {
    await assert.rejects(
      async () => checkService.performCheck('usr-1', null),
      (err) => err instanceof AppError && err.statusCode === 400
    );
    await assert.rejects(
      async () => checkService.performCheck('usr-1', 'string'),
      (err) => err instanceof AppError && err.statusCode === 400
    );
  });

  // Group 2: Minimal Check (Zero Identifiers)
  console.log('\n2. Minimal Offer Check (Zero Identifiers):');

  await runTest('minimal offer check succeeds without querying historical DB', async () => {
    const calls = createMockPrisma();
    try {
      const result = await checkService.performCheck(
        'usr-1',
        {
          offerMessage: 'Congratulations! You have been selected for software intern. No fees required.',
        },
        'student',
        '127.0.0.1'
      );

      assert.strictEqual(calls.identifierFindMany.length, 0, 'Should not query identifiers when none provided');
      assert.strictEqual(calls.offerCheckCreate.length, 1, 'Must persist offer check');
      assert.strictEqual(result.riskScore, 0);
      assert.strictEqual(result.riskCategory, 'low');
      assert.strictEqual(result.riskLevel, 'LOW');
      assert.ok(result.disclaimer, 'Disclaimer must be present');
      assert.ok(result.summary, 'Summary must be present');
    } finally {
      restorePrisma();
    }
  });

  // Group 3: Identifier Extraction & All Supported Types
  console.log('\n3. All Supported Identifier Types & Deduplication:');

  await runTest('extracts and queries all five supported identifier types', async () => {
    const calls = createMockPrisma();
    try {
      await checkService.performCheck(
        'usr-1',
        {
          offerMessage: 'Pay training fee of Rs 5000 to fraud@upi or transfer to bank.',
          paymentRequest: 'Transfer 5000',
          companyName: 'FakeTech',
          phone: '+919876543210',
          email: 'recruiter@faketech.com',
          upi: 'fraud@upi',
          domain: 'faketech.com',
          bankAccount: '123456789012',
        },
        'student'
      );

      assert.strictEqual(calls.identifierFindMany.length, 1);
      const orClauses = calls.identifierFindMany[0].where.OR;
      const types = orClauses.map((c) => c.type);
      assert.ok(types.includes('phone'), 'Must include phone');
      assert.ok(types.includes('email'), 'Must include email');
      assert.ok(types.includes('upi'), 'Must include upi');
      assert.ok(types.includes('domain'), 'Must include domain');
      assert.ok(types.includes('bank_account'), 'Must include bank_account');
    } finally {
      restorePrisma();
    }
  });

  await runTest('deduplicates duplicate normalized identifiers across scalar fields and array', async () => {
    const calls = createMockPrisma();
    try {
      await checkService.performCheck(
        'usr-1',
        {
          offerMessage: 'Job offer',
          phone: '9876543210',
          phoneQuery: '+919876543210',
          email: 'test@example.com',
          identifiers: [
            { type: 'phone', value: '+91 98765 43210' },
            { type: 'email', value: 'TEST@example.com' },
          ],
        },
        'student'
      );

      assert.strictEqual(calls.identifierFindMany.length, 1);
      const orClauses = calls.identifierFindMany[0].where.OR;
      assert.strictEqual(orClauses.length, 2, 'Should deduplicate phone and email to exactly 2 unique identifiers');
    } finally {
      restorePrisma();
    }
  });

  // Group 4: Verified-Only Historical Matching
  console.log('\n4. Verified-Only Historical Matching:');

  await runTest('historical matching strictly enforces report: { status: "verified" } at DB query level', async () => {
    const calls = createMockPrisma();
    try {
      await checkService.performCheck(
        'usr-1',
        {
          offerMessage: 'Job offer with phone',
          phone: '9876543210',
        },
        'student'
      );

      assert.strictEqual(calls.identifierFindMany.length, 1);
      const query = calls.identifierFindMany[0];
      assert.deepStrictEqual(
        query.select.reports.where,
        { report: { status: 'verified' } },
        'Must filter reports by status = "verified" at database query level'
      );
    } finally {
      restorePrisma();
    }
  });

  await runTest('unverified reports contribute zero points to historical score', async () => {
    const calls = createMockPrisma({
      existingIdentifiers: [
        {
          id: 'id-phone-1',
          type: 'phone',
          value: '+919876543210',
          normalizedValue: '+919876543210',
          riskScore: 30,
          confidence: 'medium',
          reports: [], // No verified reports
        },
      ],
    });
    try {
      const result = await checkService.performCheck(
        'usr-1',
        {
          offerMessage: 'Legitimate interview offer without suspicious language.',
          phone: '9876543210',
        },
        'student'
      );

      assert.strictEqual(result.riskScore, 0, 'Unverified identifier must not add historical points');
      assert.strictEqual(result.riskCategory, 'low');
      assert.strictEqual(result.matchedIdentifiers.length, 0, 'Should not report as matched identifier if 0 verified reports');
    } finally {
      restorePrisma();
    }
  });

  await runTest('verified reports contribute historical score and populate matchedIdentifiers and connectedReports', async () => {
    const calls = createMockPrisma({
      existingIdentifiers: [
        {
          id: 'id-upi-1',
          type: 'upi',
          value: 'scam@upi',
          normalizedValue: 'scam@upi',
          riskScore: 80,
          confidence: 'high',
          reports: [
            {
              report: {
                id: 'rep-verified-1',
                companyNameRaw: 'Fake Corp',
                status: 'verified',
                isVerified: true,
                riskAssessments: [{ score: 85, category: 'critical' }],
              },
            },
            {
              report: {
                id: 'rep-verified-2',
                companyNameRaw: 'Fraud LLC',
                status: 'verified',
                isVerified: true,
                riskAssessments: [{ score: 80, category: 'critical' }],
              },
            },
          ],
        },
      ],
    });
    try {
      const result = await checkService.performCheck(
        'usr-1',
        {
          offerMessage: 'Pay mandatory training fee of Rs 2000 to scam@upi immediately.',
          paymentRequest: 'Pay Rs 2000',
          upi: 'scam@upi',
        },
        'student'
      );

      assert.ok(result.riskScore >= 50, `Score must reflect historical match + fee demand, got ${result.riskScore}`);
      assert.ok(result.matchedIdentifiers.length === 1, 'Must include matched identifier');
      assert.strictEqual(result.matchedIdentifiers[0].verifiedReportsCount, 2);
      assert.strictEqual(result.connectedReports.length, 2, 'Must include 2 connected verified reports');
      assert.strictEqual(result.connectedReports[0].id, 'rep-verified-1');
    } finally {
      restorePrisma();
    }
  });

  // Group 5: Persistence & IP Hashing
  console.log('\n5. Persistence in OfferCheck Model & IP Hashing:');

  await runTest('persists check with exact schema fields, JSON result, and hashed IP', async () => {
    const clientIp = '203.0.113.195';
    const calls = createMockPrisma();
    try {
      const result = await checkService.performCheck(
        'usr-1',
        {
          offerMessage: 'Offer text here',
          companyName: 'Acme Inc',
          phone: '+919876543210',
          email: 'hr@acme.com',
          upi: 'acme@upi',
          domain: 'acme.com',
        },
        'student',
        clientIp
      );

      assert.strictEqual(calls.offerCheckCreate.length, 1);
      const createData = calls.offerCheckCreate[0].data;

      assert.strictEqual(createData.userId, 'usr-1');
      assert.strictEqual(createData.companyName, 'Acme Inc');
      assert.strictEqual(createData.phoneQuery, '+919876543210');
      assert.strictEqual(createData.emailQuery, 'hr@acme.com');
      assert.strictEqual(createData.upiQuery, 'acme@upi');
      assert.strictEqual(createData.domainQuery, 'acme.com');
      assert.strictEqual(typeof createData.riskScore, 'number');
      assert.ok(['low', 'medium', 'high', 'critical'].includes(createData.riskCategory));

      // Result JSON verification
      assert.strictEqual(typeof createData.result, 'object');
      assert.strictEqual(createData.result.score, createData.riskScore);
      assert.strictEqual(createData.result.riskCategory, createData.riskCategory);
      assert.ok(Array.isArray(createData.result.factors));
      assert.ok(createData.result.disclaimer);

      // IP Hash verification (HMAC-SHA256)
      const expectedIpHash = crypto
        .createHmac('sha256', process.env.IP_HASH_SECRET)
        .update(clientIp)
        .digest('hex');
      assert.strictEqual(createData.ipHash, expectedIpHash);
      assert.strictEqual(createData.ipHash.length, 64);

      // Verify ipHash is NOT exposed in the returned result
      assert.strictEqual(result.ipHash, undefined, 'Internal ipHash must not leak in response');
    } finally {
      restorePrisma();
    }
  });

  await runTest('hashClientIp returns null when IP or IP_HASH_SECRET is missing', async () => {
    assert.strictEqual(checkService.hashClientIp(null), null);
    assert.strictEqual(checkService.hashClientIp(''), null);

    const oldSecret = process.env.IP_HASH_SECRET;
    delete process.env.IP_HASH_SECRET;
    try {
      assert.strictEqual(checkService.hashClientIp('127.0.0.1'), null);
    } finally {
      process.env.IP_HASH_SECRET = oldSecret;
    }
  });

  // Group 6: Role-Based Privacy Masking
  console.log('\n6. Role-Based Privacy Masking:');

  await runTest('student role receives masked queries and masked matched identifiers', async () => {
    const calls = createMockPrisma({
      existingIdentifiers: [
        {
          id: 'id-phone-1',
          type: 'phone',
          value: '+919876543210',
          normalizedValue: '+919876543210',
          riskScore: 50,
          confidence: 'high',
          reports: [{ report: { id: 'r1', status: 'verified', isVerified: true, companyNameRaw: 'Test' } }],
        },
      ],
    });
    try {
      const studentResult = await checkService.performCheck(
        'usr-1',
        {
          offerMessage: 'Sample message',
          phone: '+919876543210',
          email: 'student@example.com',
          upi: 'payment@upi',
        },
        'student'
      );

      assert.strictEqual(studentResult.phoneQuery, '+9198XXXXX');
      assert.strictEqual(studentResult.emailQuery, 's***@example.com');
      assert.strictEqual(studentResult.upiQuery, 'p****nt@upi');
      assert.strictEqual(studentResult.matchedIdentifiers[0].value, '+9198XXXXX');
    } finally {
      restorePrisma();
    }
  });

  await runTest('admin role receives unmasked queries and unmasked matched identifiers', async () => {
    const calls = createMockPrisma({
      existingIdentifiers: [
        {
          id: 'id-phone-1',
          type: 'phone',
          value: '+919876543210',
          normalizedValue: '+919876543210',
          riskScore: 50,
          confidence: 'high',
          reports: [{ report: { id: 'r1', status: 'verified', isVerified: true, companyNameRaw: 'Test' } }],
        },
      ],
    });
    try {
      const adminResult = await checkService.performCheck(
        'admin-1',
        {
          offerMessage: 'Sample message',
          phone: '+919876543210',
          email: 'student@example.com',
          upi: 'payment@upi',
        },
        'admin'
      );

      assert.strictEqual(adminResult.phoneQuery, '+919876543210');
      assert.strictEqual(adminResult.emailQuery, 'student@example.com');
      assert.strictEqual(adminResult.upiQuery, 'payment@upi');
      assert.strictEqual(adminResult.matchedIdentifiers[0].value, '+919876543210');
    } finally {
      restorePrisma();
    }
  });

  // Group 7: Check History Retrieval
  console.log('\n7. Authenticated Check History Retrieval:');

  await runTest('getCheckHistory queries by authenticated userId with pagination and masking', async () => {
    const calls = createMockPrisma({
      count: 25,
      checks: [
        {
          id: 'chk-1',
          userId: 'usr-1',
          companyName: 'Company A',
          phoneQuery: '+919876543210',
          emailQuery: 'test@companya.com',
          upiQuery: null,
          domainQuery: 'companya.com',
          riskScore: 10,
          riskCategory: 'low',
          checkedAt: new Date(),
          result: {
            score: 10,
            riskCategory: 'low',
            riskLevel: 'LOW',
            summary: 'Low risk',
            disclaimer: 'Disclaimer text',
            factors: [],
          },
        },
      ],
    });
    try {
      const history = await checkService.getCheckHistory(
        'usr-1',
        { page: 2, limit: 10, sortBy: 'riskScore', sortOrder: 'asc' },
        'student'
      );

      assert.strictEqual(calls.offerCheckCount.length, 1);
      assert.strictEqual(calls.offerCheckCount[0].where.userId, 'usr-1');

      assert.strictEqual(calls.offerCheckFindMany.length, 1);
      const findArgs = calls.offerCheckFindMany[0];
      assert.strictEqual(findArgs.where.userId, 'usr-1');
      assert.strictEqual(findArgs.skip, 10);
      assert.strictEqual(findArgs.take, 10);
      assert.deepStrictEqual(findArgs.orderBy, { riskScore: 'asc' });

      assert.strictEqual(history.pagination.total, 25);
      assert.strictEqual(history.pagination.page, 2);
      assert.strictEqual(history.pagination.limit, 10);
      assert.strictEqual(history.pagination.totalPages, 3);

      assert.strictEqual(history.checks.length, 1);
      assert.strictEqual(history.checks[0].phoneQuery, '+9198XXXXX', 'Must mask phone for student role');
    } finally {
      restorePrisma();
    }
  });

  await runTest('getCheckHistory filters by riskCategory when provided', async () => {
    const calls = createMockPrisma({ count: 5, checks: [] });
    try {
      await checkService.getCheckHistory('usr-1', { riskCategory: 'critical' }, 'student');

      assert.strictEqual(calls.offerCheckCount[0].where.riskCategory, 'critical');
      assert.strictEqual(calls.offerCheckFindMany[0].where.riskCategory, 'critical');
    } finally {
      restorePrisma();
    }
  });

  // Group 8: Single Check Retrieval & Ownership Safeguards
  console.log('\n8. Single Check Retrieval & Ownership Safeguards:');

  await runTest('getCheckById succeeds for the resource owner', async () => {
    const calls = createMockPrisma({
      checkRecord: {
        id: 'chk-100',
        userId: 'usr-owner',
        companyName: 'Tech Corp',
        phoneQuery: '+919876543210',
        emailQuery: 'hr@techcorp.com',
        upiQuery: null,
        domainQuery: null,
        riskScore: 20,
        riskCategory: 'low',
        checkedAt: new Date(),
        result: { score: 20, riskCategory: 'low', riskLevel: 'LOW', factors: [] },
      },
    });
    try {
      const check = await checkService.getCheckById('chk-100', { id: 'usr-owner', role: 'student' });
      assert.strictEqual(check.id, 'chk-100');
      assert.strictEqual(check.phoneQuery, '+9198XXXXX');
    } finally {
      restorePrisma();
    }
  });

  await runTest('getCheckById succeeds for admin via bypass', async () => {
    const calls = createMockPrisma({
      checkRecord: {
        id: 'chk-100',
        userId: 'usr-owner',
        companyName: 'Tech Corp',
        phoneQuery: '+919876543210',
        emailQuery: 'hr@techcorp.com',
        upiQuery: null,
        domainQuery: null,
        riskScore: 20,
        riskCategory: 'low',
        checkedAt: new Date(),
        result: { score: 20, riskCategory: 'low', riskLevel: 'LOW', factors: [] },
      },
    });
    try {
      const check = await checkService.getCheckById('chk-100', { id: 'admin-1', role: 'admin' });
      assert.strictEqual(check.id, 'chk-100');
      assert.strictEqual(check.phoneQuery, '+919876543210', 'Admin must receive unmasked phone');
    } finally {
      restorePrisma();
    }
  });

  await runTest('getCheckById throws 403 Forbidden when a student accesses another user\'s check', async () => {
    const calls = createMockPrisma({
      checkRecord: {
        id: 'chk-100',
        userId: 'usr-other',
        companyName: 'Tech Corp',
        phoneQuery: null,
        emailQuery: null,
        upiQuery: null,
        domainQuery: null,
        riskScore: 0,
        riskCategory: 'low',
        checkedAt: new Date(),
        result: null,
      },
    });
    try {
      await assert.rejects(
        async () => checkService.getCheckById('chk-100', { id: 'usr-attacker', role: 'student' }),
        (err) => err instanceof AppError && err.statusCode === 403
      );
    } finally {
      restorePrisma();
    }
  });

  await runTest('getCheckById throws 404 AppError when check record does not exist', async () => {
    const calls = createMockPrisma({ checkRecord: null });
    try {
      await assert.rejects(
        async () => checkService.getCheckById('chk-missing', { id: 'usr-1', role: 'student' }),
        (err) => err instanceof AppError && err.statusCode === 404
      );
    } finally {
      restorePrisma();
    }
  });

  // Group 9: Failure Propagation
  console.log('\n9. Failure Propagation:');

  await runTest('database error during creation rejects cleanly', async () => {
    const calls = createMockPrisma({
      onOfferCheckCreate: async () => {
        throw new Error('Database disk full');
      },
    });
    try {
      await assert.rejects(
        async () => checkService.performCheck('usr-1', { offerMessage: 'Test offer' }, 'student'),
        (err) => err.message === 'Database disk full'
      );
    } finally {
      restorePrisma();
    }
  });

  console.log(`\nAll ${passedTests} / ${totalTests} check_service unit tests passed successfully!\n`);
}

runAllTests().catch((err) => {
  console.error('\nTest suite failed:', err);
  process.exit(1);
});
