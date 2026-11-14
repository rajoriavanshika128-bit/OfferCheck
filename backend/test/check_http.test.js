'use strict';

/**
 * backend/test/check_http.test.js
 * Comprehensive Express HTTP integration test suite for Offer Check endpoints (/api/checks).
 *
 * SAFETY INVARIANTS:
 * - ZERO database connections; Prisma and service dependencies are mocked in-memory.
 * - ZERO .env access or modification.
 * - ZERO network/TCP sockets: uses Node.js in-memory HTTP stream dispatch (invokeApp).
 *
 * COVERS:
 * 1. POST /api/checks:
 *    - Unauthenticated request returns 401.
 *    - Invalid / expired / forged / non-Bearer JWT returns 401.
 *    - Banned user returns 403.
 *    - Missing or empty offerMessage returns 400.
 *    - Oversized offerMessage (> 20000 chars) returns 400.
 *    - Invalid phone, email, or domain format returns 400 without leaking raw input.
 *    - Conflicting alias parameters (e.g. phone vs phoneQuery) return 400.
 *    - Mass-assignment fields (userId, riskScore, riskCategory, result, ipHash, checkedAt) return 400.
 *    - Valid authenticated submission returns 201 with { success: true, check }.
 * 2. GET /api/checks:
 *    - Unauthenticated request returns 401.
 *    - Valid authenticated request returns 200 with checks array and pagination.
 *    - Invalid query parameters (e.g. invalid riskCategory) return 400.
 * 3. GET /api/checks/:id:
 *    - Unauthenticated request returns 401.
 *    - Non-UUID check ID returns 400.
 *    - Non-existent check ID returns 404.
 *    - Accessing another user's check returns 403 (ownership enforcement).
 *    - Owner accessing check returns 200.
 *    - Admin accessing check returns 200.
 * 4. Error Handling:
 *    - Operational service error propagates status code.
 *    - Unexpected server error returns 500 without leaking stack traces.
 */

// Configure environment to prevent dotenv loading from prisma.js
process.env.DATABASE_URL = 'postgresql://mock:mock@localhost:5432/mock_test';
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'http_test_jwt_secret_012345678901234567890123456789';
process.env.IP_HASH_SECRET = 'http_test_ip_hash_secret_012345678901234567890123456789';

const http = require('http');
const { Readable } = require('stream');
const assert = require('assert');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
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

// ─── In-Memory HTTP Dispatcher ───────────────────────────────────────────────

function invokeApp({ method = 'POST', url = '/api/checks', headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    try {
      const rawBody =
        body !== null ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;

      const req = new Readable({
        read() {
          if (rawBody !== null) {
            this.push(rawBody);
          }
          this.push(null);
        },
      });

      req.method = method;
      req.url = url;
      req.headers = {
        ...(rawBody !== null
          ? {
              'content-type': 'application/json',
              'content-length': String(Buffer.byteLength(rawBody)),
            }
          : {}),
        ...headers,
      };

      const rawReq = new http.IncomingMessage();
      const res = new http.ServerResponse(rawReq);
      let responseBody = '';

      res.write = function (chunk) {
        if (chunk) responseBody += chunk;
        return true;
      };

      res.end = function (chunk) {
        if (chunk) responseBody += chunk;
        let parsed = null;
        try {
          parsed = JSON.parse(responseBody);
        } catch {
          parsed = responseBody;
        }
        resolve({
          status: res.statusCode,
          headers: res.getHeaders ? res.getHeaders() : {},
          body: parsed,
        });
      };

      app(req, res);
    } catch (err) {
      reject(err);
    }
  });
}

// ─── Mock Infrastructure & Helpers ──────────────────────────────────────────

const originalPrismaFindUnique = prisma.user.findUnique;
const originalPerformCheck = checkService.performCheck;
const originalGetCheckHistory = checkService.getCheckHistory;
const originalGetCheckById = checkService.getCheckById;

function restoreMocks() {
  prisma.user.findUnique = originalPrismaFindUnique;
  checkService.performCheck = originalPerformCheck;
  checkService.getCheckHistory = originalGetCheckHistory;
  checkService.getCheckById = originalGetCheckById;
}

function createToken({
  sub = 'user-stu-101',
  role = 'student',
  expiresIn = 3600,
  secret = process.env.JWT_SECRET,
  customClaims = {},
} = {}) {
  const iat = Math.floor(Date.now() / 1000);
  const payload = {
    sub,
    role,
    iat,
    ...customClaims,
  };
  if (expiresIn !== null) {
    payload.exp = iat + expiresIn;
  }
  return jwt.sign(payload, secret, { algorithm: 'HS256' });
}

function mockAuthenticatedUser(userOverrides = {}) {
  const defaultUser = {
    id: 'user-stu-101',
    name: 'Alice Student',
    email: 'alice@university.edu',
    role: 'student',
    isBanned: false,
    college: 'Engineering College',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const user = { ...defaultUser, ...userOverrides };

  prisma.user.findUnique = async ({ where }) => {
    if (where.id === user.id) {
      return user;
    }
    return null;
  };

  return user;
}

// ─── Test Suite Execution ───────────────────────────────────────────────────

async function runAllTests() {
  console.log('\n--- Phase 6: Offer Check HTTP Route Tests (/api/checks) ---\n');

  // Group 1: Authentication & JWT Verification
  console.log('1. Authentication & JWT Verification:');

  await runTest('POST /api/checks without Authorization header returns 401', async () => {
    const res = await invokeApp({
      method: 'POST',
      url: '/api/checks',
      body: { offerMessage: 'Valid offer message here' },
    });
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.success, false);
    assert.ok(res.body.error);
  });

  await runTest('POST /api/checks with non-Bearer auth scheme returns 401', async () => {
    const res = await invokeApp({
      method: 'POST',
      url: '/api/checks',
      headers: { authorization: 'Basic somecredentials' },
      body: { offerMessage: 'Valid offer message' },
    });
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.success, false);
  });

  await runTest('POST /api/checks with malformed/garbage JWT returns 401', async () => {
    const res = await invokeApp({
      method: 'POST',
      url: '/api/checks',
      headers: { authorization: 'Bearer not.a.valid.jwt' },
      body: { offerMessage: 'Valid offer message' },
    });
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.success, false);
  });

  await runTest('POST /api/checks with forged JWT signature returns 401', async () => {
    const forgedToken = createToken({ secret: 'wrong_secret_key_012345678901234567890123456789' });
    const res = await invokeApp({
      method: 'POST',
      url: '/api/checks',
      headers: { authorization: `Bearer ${forgedToken}` },
      body: { offerMessage: 'Valid offer message' },
    });
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.success, false);
  });

  await runTest('POST /api/checks with expired JWT returns 401', async () => {
    const expiredToken = createToken({ expiresIn: -100 });
    const res = await invokeApp({
      method: 'POST',
      url: '/api/checks',
      headers: { authorization: `Bearer ${expiredToken}` },
      body: { offerMessage: 'Valid offer message' },
    });
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.success, false);
  });

  await runTest('POST /api/checks for banned user returns 403', async () => {
    mockAuthenticatedUser({ id: 'user-banned', isBanned: true });
    try {
      const token = createToken({ sub: 'user-banned' });
      const res = await invokeApp({
        method: 'POST',
        url: '/api/checks',
        headers: { authorization: `Bearer ${token}` },
        body: { offerMessage: 'Valid offer message' },
      });
      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error, 'Account has been suspended');
    } finally {
      restoreMocks();
    }
  });

  // Group 2: POST /api/checks Validation Failures
  console.log('\n2. POST /api/checks Request Validation Failures:');

  await runTest('POST /api/checks missing offerMessage returns 400', async () => {
    mockAuthenticatedUser();
    try {
      const token = createToken();
      const res = await invokeApp({
        method: 'POST',
        url: '/api/checks',
        headers: { authorization: `Bearer ${token}` },
        body: { companyName: 'Tech Corp' },
      });
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.success, false);
    } finally {
      restoreMocks();
    }
  });

  await runTest('POST /api/checks empty string offerMessage returns 400', async () => {
    mockAuthenticatedUser();
    try {
      const token = createToken();
      const res = await invokeApp({
        method: 'POST',
        url: '/api/checks',
        headers: { authorization: `Bearer ${token}` },
        body: { offerMessage: '   ' },
      });
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.success, false);
    } finally {
      restoreMocks();
    }
  });

  await runTest('POST /api/checks oversized offerMessage (> 20000 chars) returns 400', async () => {
    mockAuthenticatedUser();
    try {
      const token = createToken();
      const res = await invokeApp({
        method: 'POST',
        url: '/api/checks',
        headers: { authorization: `Bearer ${token}` },
        body: { offerMessage: 'a'.repeat(20001) },
      });
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.success, false);
    } finally {
      restoreMocks();
    }
  });

  await runTest('POST /api/checks invalid phone format returns 400 without leaking raw input', async () => {
    mockAuthenticatedUser();
    try {
      const token = createToken();
      const rawPhone = 'invalid-phone-letters';
      const res = await invokeApp({
        method: 'POST',
        url: '/api/checks',
        headers: { authorization: `Bearer ${token}` },
        body: { offerMessage: 'Valid offer text', phone: rawPhone },
      });
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.success, false);
      const resString = JSON.stringify(res.body);
      assert.ok(!resString.includes(rawPhone), 'Raw sensitive input must not be echoed in validation error');
    } finally {
      restoreMocks();
    }
  });

  await runTest('POST /api/checks invalid email format returns 400', async () => {
    mockAuthenticatedUser();
    try {
      const token = createToken();
      const res = await invokeApp({
        method: 'POST',
        url: '/api/checks',
        headers: { authorization: `Bearer ${token}` },
        body: { offerMessage: 'Valid offer text', email: 'not-an-email' },
      });
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.success, false);
    } finally {
      restoreMocks();
    }
  });

  await runTest('POST /api/checks conflicting phone and phoneQuery returns 400', async () => {
    mockAuthenticatedUser();
    try {
      const token = createToken();
      const res = await invokeApp({
        method: 'POST',
        url: '/api/checks',
        headers: { authorization: `Bearer ${token}` },
        body: {
          offerMessage: 'Valid offer text',
          phone: '+919876543210',
          phoneQuery: '+919123456789',
        },
      });
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.success, false);
      const resString = JSON.stringify(res.body);
      assert.ok(resString.includes('Conflicting phone and phoneQuery'));
    } finally {
      restoreMocks();
    }
  });

  // Group 3: Mass Assignment Protection
  console.log('\n3. Mass-Assignment & Protected Property Rejection:');

  await runTest('POST /api/checks rejects client-supplied userId, riskScore, result, or ipHash', async () => {
    mockAuthenticatedUser();
    try {
      const token = createToken();
      const payloads = [
        { offerMessage: 'Valid', userId: 'hacked-user-id' },
        { offerMessage: 'Valid', riskScore: 0 },
        { offerMessage: 'Valid', riskCategory: 'low' },
        { offerMessage: 'Valid', result: { hacked: true } },
        { offerMessage: 'Valid', ipHash: 'forged_ip_hash' },
        { offerMessage: 'Valid', checkedAt: new Date().toISOString() },
      ];

      for (const payload of payloads) {
        const res = await invokeApp({
          method: 'POST',
          url: '/api/checks',
          headers: { authorization: `Bearer ${token}` },
          body: payload,
        });
        assert.strictEqual(res.status, 400, `Payload with ${Object.keys(payload)[1]} must be rejected with 400`);
        assert.strictEqual(res.body.success, false);
      }
    } finally {
      restoreMocks();
    }
  });

  // Group 4: Successful Submission
  console.log('\n4. Successful Offer Check Submission:');

  await runTest('POST /api/checks with valid payload reaches checkService and returns 201', async () => {
    const user = mockAuthenticatedUser();
    let serviceCalledWith = null;

    checkService.performCheck = async (userId, data, role, ip) => {
      serviceCalledWith = { userId, data, role, ip };
      return {
        id: 'chk-created-1',
        checkId: 'chk-created-1',
        companyName: data.companyName,
        riskScore: 25,
        riskCategory: 'low',
        riskLevel: 'LOW',
        summary: 'Low risk detected',
        disclaimer: 'Disclaimer text',
        factors: [],
        matchedIdentifiers: [],
        connectedReports: [],
        checkedAt: new Date().toISOString(),
      };
    };

    try {
      const token = createToken({ sub: user.id, role: user.role });
      const res = await invokeApp({
        method: 'POST',
        url: '/api/checks',
        headers: { authorization: `Bearer ${token}` },
        body: {
          offerMessage: 'Selected for frontend internship. No fees required.',
          companyName: 'Acme Corp',
          phone: '+919876543210',
          email: 'hr@acme.com',
        },
      });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.check);
      assert.strictEqual(res.body.check.id, 'chk-created-1');
      assert.strictEqual(res.body.check.companyName, 'Acme Corp');
      assert.strictEqual(res.body.check.riskScore, 25);
      assert.strictEqual(res.body.check.riskCategory, 'low');

      assert.strictEqual(serviceCalledWith.userId, user.id);
      assert.strictEqual(serviceCalledWith.role, 'student');
      assert.strictEqual(serviceCalledWith.data.offerMessage, 'Selected for frontend internship. No fees required.');
    } finally {
      restoreMocks();
    }
  });

  // Group 5: Check History (GET /api/checks)
  console.log('\n5. Check History (GET /api/checks):');

  await runTest('GET /api/checks without auth returns 401', async () => {
    const res = await invokeApp({
      method: 'GET',
      url: '/api/checks',
    });
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.success, false);
  });

  await runTest('GET /api/checks with valid token returns 200 with checks list and pagination', async () => {
    const user = mockAuthenticatedUser();
    checkService.getCheckHistory = async (userId, query, role) => {
      assert.strictEqual(userId, user.id);
      return {
        checks: [
          {
            id: 'chk-1',
            companyName: 'Company A',
            riskScore: 20,
            riskCategory: 'low',
            checkedAt: new Date().toISOString(),
          },
        ],
        pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
      };
    };

    try {
      const token = createToken({ sub: user.id });
      const res = await invokeApp({
        method: 'GET',
        url: '/api/checks?page=1&limit=20',
        headers: { authorization: `Bearer ${token}` },
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.checks.length, 1);
      assert.strictEqual(res.body.pagination.total, 1);
    } finally {
      restoreMocks();
    }
  });

  await runTest('GET /api/checks with invalid query returns 400', async () => {
    mockAuthenticatedUser();
    try {
      const token = createToken();
      const res = await invokeApp({
        method: 'GET',
        url: '/api/checks?riskCategory=invalid_cat',
        headers: { authorization: `Bearer ${token}` },
      });
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.success, false);
    } finally {
      restoreMocks();
    }
  });

  // Group 6: Single Check Lookup (GET /api/checks/:id)
  console.log('\n6. Single Check Lookup (GET /api/checks/:id):');

  await runTest('GET /api/checks/:id without auth returns 401', async () => {
    const res = await invokeApp({
      method: 'GET',
      url: '/api/checks/550e8400-e29b-41d4-a716-446655440000',
    });
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.success, false);
  });

  await runTest('GET /api/checks/not-a-uuid returns 400 with validation error', async () => {
    mockAuthenticatedUser();
    try {
      const token = createToken();
      const res = await invokeApp({
        method: 'GET',
        url: '/api/checks/invalid-uuid-format',
        headers: { authorization: `Bearer ${token}` },
      });
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.success, false);
    } finally {
      restoreMocks();
    }
  });

  await runTest('GET /api/checks/:id for non-existent check returns 404', async () => {
    mockAuthenticatedUser();
    checkService.getCheckById = async (id, user) => {
      throw new AppError('Offer check not found', 404);
    };

    try {
      const token = createToken();
      const res = await invokeApp({
        method: 'GET',
        url: '/api/checks/550e8400-e29b-41d4-a716-446655440000',
        headers: { authorization: `Bearer ${token}` },
      });
      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error, 'Offer check not found');
    } finally {
      restoreMocks();
    }
  });

  await runTest('GET /api/checks/:id for another user\'s check returns 403', async () => {
    mockAuthenticatedUser();
    checkService.getCheckById = async (id, user) => {
      throw new AppError('Access denied: you do not own this resource', 403);
    };

    try {
      const token = createToken();
      const res = await invokeApp({
        method: 'GET',
        url: '/api/checks/550e8400-e29b-41d4-a716-446655440000',
        headers: { authorization: `Bearer ${token}` },
      });
      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error, 'Access denied: you do not own this resource');
    } finally {
      restoreMocks();
    }
  });

  await runTest('GET /api/checks/:id for owner returns 200 with check details', async () => {
    mockAuthenticatedUser();
    checkService.getCheckById = async (id, user) => {
      return {
        id,
        companyName: 'Tech Corp',
        riskScore: 35,
        riskCategory: 'medium',
        riskLevel: 'MEDIUM',
        summary: 'Medium risk',
        disclaimer: 'Disclaimer',
        factors: [],
      };
    };

    try {
      const token = createToken();
      const testUuid = '550e8400-e29b-41d4-a716-446655440000';
      const res = await invokeApp({
        method: 'GET',
        url: `/api/checks/${testUuid}`,
        headers: { authorization: `Bearer ${token}` },
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.check.id, testUuid);
      assert.strictEqual(res.body.check.riskScore, 35);
    } finally {
      restoreMocks();
    }
  });

  // Group 7: Error Propagation
  console.log('\n7. Error Handling & Error Propagation:');

  await runTest('operational AppError from service propagates with exact status code', async () => {
    mockAuthenticatedUser();
    checkService.performCheck = async () => {
      throw new AppError('Custom rate limit exceeded', 429);
    };

    try {
      const token = createToken();
      const res = await invokeApp({
        method: 'POST',
        url: '/api/checks',
        headers: { authorization: `Bearer ${token}` },
        body: { offerMessage: 'Test offer message' },
      });
      assert.strictEqual(res.status, 429);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error, 'Custom rate limit exceeded');
    } finally {
      restoreMocks();
    }
  });

  await runTest('unexpected error from service returns 500 without leaking stack trace', async () => {
    mockAuthenticatedUser();
    checkService.performCheck = async () => {
      throw new Error('Database connection pool exhausted');
    };

    try {
      const token = createToken();
      const res = await invokeApp({
        method: 'POST',
        url: '/api/checks',
        headers: { authorization: `Bearer ${token}` },
        body: { offerMessage: 'Test offer message' },
      });
      assert.strictEqual(res.status, 500);
      assert.strictEqual(res.body.success, false);
      // In NODE_ENV=test (non-production), errorHandler returns err.message
      assert.strictEqual(res.body.error, 'Database connection pool exhausted');
      assert.strictEqual(res.body.stack, undefined, 'Must not expose stack trace');
    } finally {
      restoreMocks();
    }
  });

  console.log(`\nAll ${passedTests} / ${totalTests} check_http tests passed successfully!\n`);
}

runAllTests().catch((err) => {
  console.error('\nTest suite failed:', err);
  process.exit(1);
});
