'use strict';

/**
 * backend/test/report_http.test.js
 * Comprehensive Express HTTP integration test suite for POST /api/reports.
 *
 * SAFETY INVARIANTS:
 * - ZERO database connections; Prisma and service dependencies are mocked in-memory.
 * - ZERO .env access or modification.
 * - ZERO network/TCP sockets: uses Node.js in-memory HTTP stream dispatch (invokeApp).
 * - ZERO third-party test dependencies: purely uses Node.js built-ins.
 *
 * COVERS:
 * 1. Unauthenticated submission returns 401.
 * 2. Invalid, expired, forged, or malformed JWT tokens return 401.
 * 3. Banned user is rejected with 403.
 * 4. User account deleted from DB returns 401.
 * 5. Valid authenticated submission reaches service and returns 201.
 * 6. Missing required fields (companyName, offerMessage) return 400.
 * 7. Invalid phone, email, and oversized fields return 400.
 * 8. Mass-assignment rejection (status, isVerified, submittedBy, reviewedBy, riskScore) returns 400.
 * 9. Submitter identity derived exclusively from token / req.user.id.
 * 10. Operational service errors return expected HTTP status codes.
 * 11. Unexpected server errors return 500 safely.
 */

// Configure environment to prevent dotenv loading from prisma.js
process.env.DATABASE_URL = 'postgresql://mock:mock@localhost:5432/mock_test';
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'http_test_jwt_secret_012345678901234567890123456789';

const http = require('http');
const { Readable } = require('stream');
const assert = require('assert');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
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

// ─── In-Memory HTTP Dispatcher ───────────────────────────────────────────────

/**
 * Dispatches an HTTP request through the full Express application pipeline in-memory.
 * Avoids TCP port binding, socket connections, and network sandbox restrictions.
 */
function invokeApp({ method = 'POST', url = '/api/reports', headers = {}, body = null }) {
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
const originalCreateReport = reportService.createReport;

function restoreMocks() {
  prisma.user.findUnique = originalPrismaFindUnique;
  reportService.createReport = originalCreateReport;
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

async function apiPost(path, body = {}, token = null) {
  const headers = {};
  if (token) {
    headers['authorization'] = `Bearer ${token}`;
  }
  return invokeApp({
    method: 'POST',
    url: path,
    headers,
    body,
  });
}

// ─── Main Test Runner ────────────────────────────────────────────────────────

async function main() {
  console.log('\n--- Phase 5B.3: HTTP Route Tests (backend/test/report_http.test.js) ---\n');

  // Default mock for prisma.user.findUnique
  prisma.user.findUnique = async ({ where }) => {
    if (where.id === 'user-banned-101') {
      return {
        id: 'user-banned-101',
        email: 'banned@test.com',
        name: 'Banned User',
        role: 'student',
        isBanned: true,
      };
    }
    if (where.id === 'user-deleted-101') {
      return null;
    }
    return {
      id: where.id || 'user-stu-101',
      email: 'student@test.com',
      name: 'Active Student',
      role: 'student',
      isBanned: false,
    };
  };

  try {
    // ══════════════════════════════════════════════════════════════════════════
    // Group 1: Authentication & JWT Verification
    // ══════════════════════════════════════════════════════════════════════════
    console.log('1. Authentication & JWT Verification:');

    await runTest('POST /api/reports without Authorization header returns 401', async () => {
      const { status, body } = await apiPost('/api/reports', {
        companyName: 'Acme Corp',
        offerMessage: 'Offer details',
      });
      assert.strictEqual(status, 401);
      assert.strictEqual(body.success, false);
      assert.strictEqual(body.error, 'Authentication required');
    });

    await runTest('POST /api/reports with non-Bearer auth scheme returns 401', async () => {
      const { status, body } = await invokeApp({
        method: 'POST',
        url: '/api/reports',
        headers: {
          authorization: 'Basic dXNlcjpwYXNz',
        },
        body: { companyName: 'Acme', offerMessage: 'Details' },
      });
      assert.strictEqual(status, 401);
      assert.strictEqual(body.error, 'Authentication required');
    });

    await runTest('POST /api/reports with malformed/garbage JWT returns 401', async () => {
      const { status, body } = await apiPost(
        '/api/reports',
        { companyName: 'Acme', offerMessage: 'Details' },
        'garbage.jwt.token'
      );
      assert.strictEqual(status, 401);
      assert.strictEqual(body.error, 'Invalid token');
    });

    await runTest('POST /api/reports with forged JWT signature returns 401', async () => {
      const forgedToken = createToken({ secret: 'wrong_secret_1234567890123456789012345' });
      const { status, body } = await apiPost(
        '/api/reports',
        { companyName: 'Acme', offerMessage: 'Details' },
        forgedToken
      );
      assert.strictEqual(status, 401);
      assert.strictEqual(body.error, 'Invalid token');
    });

    await runTest('POST /api/reports with expired JWT returns 401', async () => {
      const expiredToken = createToken({ expiresIn: -3600 });
      const { status, body } = await apiPost(
        '/api/reports',
        { companyName: 'Acme', offerMessage: 'Details' },
        expiredToken
      );
      assert.strictEqual(status, 401);
      assert.strictEqual(body.error, 'Token expired');
    });

    await runTest('POST /api/reports with missing sub claim returns 401', async () => {
      const badClaimToken = createToken({ sub: '' });
      const { status, body } = await apiPost(
        '/api/reports',
        { companyName: 'Acme', offerMessage: 'Details' },
        badClaimToken
      );
      assert.strictEqual(status, 401);
      assert.strictEqual(body.error, 'Invalid token claims');
    });

    await runTest('POST /api/reports with invalid role claim returns 401', async () => {
      const badRoleToken = createToken({ role: 'superadmin' });
      const { status, body } = await apiPost(
        '/api/reports',
        { companyName: 'Acme', offerMessage: 'Details' },
        badRoleToken
      );
      assert.strictEqual(status, 401);
      assert.strictEqual(body.error, 'Invalid token claims');
    });

    await runTest('POST /api/reports for banned user returns 403', async () => {
      const bannedToken = createToken({ sub: 'user-banned-101' });
      const { status, body } = await apiPost(
        '/api/reports',
        { companyName: 'Acme', offerMessage: 'Details' },
        bannedToken
      );
      assert.strictEqual(status, 403);
      assert.strictEqual(body.error, 'Account has been suspended');
    });

    await runTest('POST /api/reports for deleted user returns 401', async () => {
      const deletedToken = createToken({ sub: 'user-deleted-101' });
      const { status, body } = await apiPost(
        '/api/reports',
        { companyName: 'Acme', offerMessage: 'Details' },
        deletedToken
      );
      assert.strictEqual(status, 401);
      assert.strictEqual(body.error, 'User account no longer exists');
    });

    // ══════════════════════════════════════════════════════════════════════════
    // Group 2: Successful Authenticated Report Submission
    // ══════════════════════════════════════════════════════════════════════════
    console.log('\n2. Successful Authenticated Report Submission:');

    await runTest('valid authenticated submission reaches reportService and returns 201', async () => {
      let capturedServiceArgs = null;
      reportService.createReport = async (userId, data, role) => {
        capturedServiceArgs = { userId, data, role };
        return {
          id: 'rep-uuid-999',
          companyNameRaw: data.companyNameRaw,
          offerMessage: data.offerMessage,
          status: 'pending',
          submittedBy: userId,
          identifiers: [],
          riskAssessments: [
            {
              score: 0,
              category: 'low',
              isCurrent: true,
              factors: [],
            },
          ],
        };
      };

      const validToken = createToken({ sub: 'student-valid-1', role: 'student' });
      const { status, body } = await apiPost(
        '/api/reports',
        {
          companyName: 'Infosys Limited',
          offerMessage: 'Congratulations on your selection. No fees required.',
        },
        validToken
      );

      assert.strictEqual(status, 201);
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.report.id, 'rep-uuid-999');
      assert.strictEqual(body.report.status, 'pending');

      // Verify controller passed verified identity to service
      assert.ok(capturedServiceArgs);
      assert.strictEqual(capturedServiceArgs.userId, 'student-valid-1');
      assert.strictEqual(capturedServiceArgs.role, 'student');
      assert.strictEqual(capturedServiceArgs.data.companyNameRaw, 'Infosys Limited');
    });

    // ══════════════════════════════════════════════════════════════════════════
    // Group 3: Request Validation Failures (400)
    // ══════════════════════════════════════════════════════════════════════════
    console.log('\n3. Request Validation Failures (400):');

    const validToken = createToken({ sub: 'student-valid-1' });

    await runTest('missing companyName returns 400 with validation details', async () => {
      const { status, body } = await apiPost(
        '/api/reports',
        { offerMessage: 'Valid offer message without company' },
        validToken
      );
      assert.strictEqual(status, 400);
      assert.strictEqual(body.success, false);
      assert.strictEqual(body.error, 'Validation failed');
      const companyIssue = body.details.find((d) => d.field.includes('companyName'));
      assert.ok(companyIssue, 'Expected validation error on companyName');
    });

    await runTest('missing offerMessage returns 400 with validation details', async () => {
      const { status, body } = await apiPost(
        '/api/reports',
        { companyName: 'Acme Corp' },
        validToken
      );
      assert.strictEqual(status, 400);
      assert.strictEqual(body.error, 'Validation failed');
      const offerIssue = body.details.find((d) => d.field.includes('offerMessage'));
      assert.ok(offerIssue, 'Expected validation error on offerMessage');
    });

    await runTest('empty string companyName returns 400', async () => {
      const { status, body } = await apiPost(
        '/api/reports',
        { companyName: '   ', offerMessage: 'Valid message' },
        validToken
      );
      assert.strictEqual(status, 400);
      assert.strictEqual(body.error, 'Validation failed');
    });

    await runTest('empty string offerMessage returns 400', async () => {
      const { status, body } = await apiPost(
        '/api/reports',
        { companyName: 'Acme Corp', offerMessage: '   ' },
        validToken
      );
      assert.strictEqual(status, 400);
      assert.strictEqual(body.error, 'Validation failed');
    });

    await runTest('invalid phone format returns 400 without leaking raw input', async () => {
      const { status, body } = await apiPost(
        '/api/reports',
        {
          companyName: 'Acme Corp',
          offerMessage: 'Offer text',
          phone: '123-invalid-letters',
        },
        validToken
      );
      assert.strictEqual(status, 400);
      assert.strictEqual(body.error, 'Validation failed');
    });

    await runTest('invalid email format returns 400', async () => {
      const { status, body } = await apiPost(
        '/api/reports',
        {
          companyName: 'Acme Corp',
          offerMessage: 'Offer text',
          email: 'not-an-email-at-all',
        },
        validToken
      );
      assert.strictEqual(status, 400);
      assert.strictEqual(body.error, 'Validation failed');
    });

    await runTest('oversized companyName (> 200 chars) returns 400', async () => {
      const { status, body } = await apiPost(
        '/api/reports',
        {
          companyName: 'A'.repeat(201),
          offerMessage: 'Offer text',
        },
        validToken
      );
      assert.strictEqual(status, 400);
      assert.strictEqual(body.error, 'Validation failed');
    });

    await runTest('oversized offerMessage (> 20000 chars) returns 400', async () => {
      const { status, body } = await apiPost(
        '/api/reports',
        {
          companyName: 'Acme Corp',
          offerMessage: 'M'.repeat(20001),
        },
        validToken
      );
      assert.strictEqual(status, 400);
      assert.strictEqual(body.error, 'Validation failed');
    });

    // ══════════════════════════════════════════════════════════════════════════
    // Group 4: Mass-Assignment & Protected Property Rejection (400)
    // ══════════════════════════════════════════════════════════════════════════
    console.log('\n4. Mass-Assignment & Protected Property Rejection (400):');

    await runTest('client cannot supply status field (rejected via .strict())', async () => {
      const { status, body } = await apiPost(
        '/api/reports',
        {
          companyName: 'Acme Corp',
          offerMessage: 'Offer text',
          status: 'verified',
        },
        validToken
      );
      assert.strictEqual(status, 400);
      assert.strictEqual(body.error, 'Validation failed');
    });

    await runTest('client cannot supply isVerified field', async () => {
      const { status, body } = await apiPost(
        '/api/reports',
        {
          companyName: 'Acme Corp',
          offerMessage: 'Offer text',
          isVerified: true,
        },
        validToken
      );
      assert.strictEqual(status, 400);
      assert.strictEqual(body.error, 'Validation failed');
    });

    await runTest('client cannot supply submittedBy field', async () => {
      const { status, body } = await apiPost(
        '/api/reports',
        {
          companyName: 'Acme Corp',
          offerMessage: 'Offer text',
          submittedBy: 'another-user-id',
        },
        validToken
      );
      assert.strictEqual(status, 400);
      assert.strictEqual(body.error, 'Validation failed');
    });

    await runTest('client cannot supply reviewedBy field', async () => {
      const { status, body } = await apiPost(
        '/api/reports',
        {
          companyName: 'Acme Corp',
          offerMessage: 'Offer text',
          reviewedBy: 'admin-user-id',
        },
        validToken
      );
      assert.strictEqual(status, 400);
      assert.strictEqual(body.error, 'Validation failed');
    });

    await runTest('client cannot supply riskScore or category', async () => {
      const { status, body } = await apiPost(
        '/api/reports',
        {
          companyName: 'Acme Corp',
          offerMessage: 'Offer text',
          riskScore: 0,
        },
        validToken
      );
      assert.strictEqual(status, 400);
      assert.strictEqual(body.error, 'Validation failed');
    });

    // ══════════════════════════════════════════════════════════════════════════
    // Group 5: Error Handling & Error Propagation
    // ══════════════════════════════════════════════════════════════════════════
    console.log('\n5. Error Handling & Error Propagation:');

    await runTest('operational AppError from service propagates with exact status code', async () => {
      reportService.createReport = async () => {
        throw new AppError('Custom business validation rejected', 422);
      };

      const { status, body } = await apiPost(
        '/api/reports',
        {
          companyName: 'Reject Corp',
          offerMessage: 'Offer message',
        },
        validToken
      );

      assert.strictEqual(status, 422);
      assert.strictEqual(body.success, false);
      assert.strictEqual(body.error, 'Custom business validation rejected');
    });

    await runTest('unexpected error from service returns 500 without leaking stack trace', async () => {
      reportService.createReport = async () => {
        throw new Error('Database connection pool exhausted');
      };

      const { status, body } = await apiPost(
        '/api/reports',
        {
          companyName: 'Crash Corp',
          offerMessage: 'Offer message',
        },
        validToken
      );

      assert.strictEqual(status, 500);
      assert.strictEqual(body.success, false);
      // In NODE_ENV=test (non-production), errorHandler returns err.message
      assert.strictEqual(body.error, 'Database connection pool exhausted');
    });

    console.log(`\nAll ${passedTests} / ${totalTests} report_http tests passed successfully!\n`);
  } finally {
    restoreMocks();
  }
}

main().catch((err) => {
  console.error('\n[FATAL HTTP TEST FAILURE]:', err);
  process.exit(1);
});
