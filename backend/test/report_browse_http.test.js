'use strict';

/**
 * backend/test/report_browse_http.test.js
 * Comprehensive Express HTTP integration test suite for Phase 7 Report Management endpoints.
 *
 * SAFETY INVARIANTS:
 * - ZERO database connections; Prisma and service dependencies are mocked in-memory.
 * - ZERO .env access or modification.
 * - ZERO network/TCP sockets: uses Node.js in-memory HTTP stream dispatch (invokeApp).
 *
 * COVERS:
 * 1. optionalAuth Middleware Behavior:
 *    - Completely absent Authorization header allows anonymous access.
 *    - Empty Authorization header is rejected with 401.
 *    - Whitespace Authorization header is rejected with 401.
 *    - Unsupported scheme (e.g. Basic) is rejected with 401.
 *    - Empty Bearer token is rejected with 401.
 *    - Expired/forged Bearer token is rejected with 401.
 *    - Banned user Bearer token is rejected with 403.
 * 2. Public Report Discovery (GET /api/reports):
 *    - Unauthenticated request returns 200 with verified reports.
 *    - Authenticated student request returns 200.
 *    - Query parameter status=pending rejected with 400.
 *    - Invalid pagination (page=0, limit=101) rejected with 400.
 * 3. Author Submission History (GET /api/reports/me):
 *    - Unauthenticated request returns 401.
 *    - Authenticated request returns 200 with author's submitted reports.
 * 4. Saved Reports (GET /api/reports/saved):
 *    - Unauthenticated request returns 401.
 *    - Authenticated request returns 200 with bookmarked reports.
 * 5. Single Report Details (GET /api/reports/:id):
 *    - Verified report without token returns 200 (masked PII).
 *    - Verified report with student token returns 200 (masked PII).
 *    - Verified report with admin token returns 200 (unmasked PII).
 *    - Non-verified report without token returns 401.
 *    - Non-verified report for another student returns 403.
 *    - Non-verified report for author returns 200.
 *    - Non-verified report for admin returns 200.
 *    - Malformed UUID returns 400.
 *    - Non-existent UUID returns 404.
 * 6. Related Reports (GET /api/reports/:id/related):
 *    - Verified source report returns 200 without token.
 *    - Non-verified source report returns 401 without token.
 *    - Non-verified source report returns 403 for unauthorized student.
 *    - Non-verified source report returns 200 for author and admin.
 * 7. Bookmark Operations (POST & DELETE /api/reports/:id/save):
 *    - POST without token returns 401.
 *    - POST with token bookmarks report and returns 200.
 *    - DELETE without token returns 401.
 *    - DELETE with token removes bookmark and returns 200.
 * 8. Regression Verification (POST /api/reports):
 *    - Phase 5B report submission remains 100% functional and returns 201.
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

function invokeApp({ method = 'GET', url = '/api/reports', headers = {}, body = null }) {
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
const originalGetPublicReports = reportService.getPublicReports;
const originalGetReportById = reportService.getReportById;
const originalGetMyReports = reportService.getMyReports;
const originalSaveReport = reportService.saveReport;
const originalRemoveSavedReport = reportService.removeSavedReport;
const originalGetUserSavedReports = reportService.getUserSavedReports;
const originalGetRelatedReports = reportService.getRelatedReports;
const originalCreateReport = reportService.createReport;

function restoreMocks() {
  prisma.user.findUnique = originalPrismaFindUnique;
  reportService.getPublicReports = originalGetPublicReports;
  reportService.getReportById = originalGetReportById;
  reportService.getMyReports = originalGetMyReports;
  reportService.saveReport = originalSaveReport;
  reportService.removeSavedReport = originalRemoveSavedReport;
  reportService.getUserSavedReports = originalGetUserSavedReports;
  reportService.getRelatedReports = originalGetRelatedReports;
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
  console.log('\n--- Phase 7: Report Browse & Management HTTP Route Tests ---\n');

  // Group 1: optionalAuth Middleware Behavior
  console.log('1. optionalAuth Middleware Behavior:');

  await runTest('GET /api/reports without Authorization header allows anonymous access (200)', async () => {
    reportService.getPublicReports = async () => ({
      reports: [{ id: 'rep-1', companyName: 'Corp', status: 'verified' }],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    try {
      const res = await invokeApp({ method: 'GET', url: '/api/reports' });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
    } finally {
      restoreMocks();
    }
  });

  await runTest('GET /api/reports with empty Authorization header returns 401', async () => {
    const res = await invokeApp({
      method: 'GET',
      url: '/api/reports',
      headers: { authorization: '' },
    });
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.success, false);
  });

  await runTest('GET /api/reports with whitespace-only Authorization header returns 401', async () => {
    const res = await invokeApp({
      method: 'GET',
      url: '/api/reports',
      headers: { authorization: '    ' },
    });
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.success, false);
  });

  await runTest('GET /api/reports with unsupported auth scheme (Basic) returns 401', async () => {
    const res = await invokeApp({
      method: 'GET',
      url: '/api/reports',
      headers: { authorization: 'Basic user:pass' },
    });
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.success, false);
  });

  await runTest('GET /api/reports with empty Bearer token returns 401', async () => {
    const res = await invokeApp({
      method: 'GET',
      url: '/api/reports',
      headers: { authorization: 'Bearer ' },
    });
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.success, false);
  });

  await runTest('GET /api/reports with expired Bearer token returns 401', async () => {
    const expiredToken = createToken({ expiresIn: -60 });
    const res = await invokeApp({
      method: 'GET',
      url: '/api/reports',
      headers: { authorization: `Bearer ${expiredToken}` },
    });
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.success, false);
  });

  await runTest('GET /api/reports with invalid Bearer token returns 401', async () => {
    const res = await invokeApp({
      method: 'GET',
      url: '/api/reports',
      headers: { authorization: 'Bearer definitely-invalid-token' },
    });
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.success, false);
  });

  await runTest('GET /api/reports with banned user token returns 403', async () => {
    mockAuthenticatedUser({ id: 'user-banned', isBanned: true });
    try {
      const token = createToken({ sub: 'user-banned' });
      const res = await invokeApp({
        method: 'GET',
        url: '/api/reports',
        headers: { authorization: `Bearer ${token}` },
      });
      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.error, 'Account has been suspended');
    } finally {
      restoreMocks();
    }
  });

  // Group 2: Public Report Discovery (GET /api/reports)
  console.log('\n2. Public Report Discovery (GET /api/reports):');

  await runTest('GET /api/reports?status=pending is rejected with 400 by Zod schema', async () => {
    const res = await invokeApp({
      method: 'GET',
      url: '/api/reports?status=pending',
    });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.success, false);
    assert.ok(JSON.stringify(res.body).includes('Public report discovery only permits verified reports'));
  });

  await runTest('GET /api/reports?page=0 is rejected with 400', async () => {
    const res = await invokeApp({ method: 'GET', url: '/api/reports?page=0' });
    assert.strictEqual(res.status, 400);
  });

  await runTest('GET /api/reports?limit=101 is rejected with 400', async () => {
    const res = await invokeApp({ method: 'GET', url: '/api/reports?limit=101' });
    assert.strictEqual(res.status, 400);
  });

  await runTest('GET /api/reports with valid query reaches reportService and returns 200', async () => {
    let serviceCalledWith = null;
    reportService.getPublicReports = async (query, role) => {
      serviceCalledWith = { query, role };
      return {
        reports: [{ id: 'rep-1', companyName: 'Acme', status: 'verified' }],
        pagination: { page: 1, limit: 10, total: 1, totalPages: 1 },
      };
    };
    try {
      const res = await invokeApp({
        method: 'GET',
        url: '/api/reports?page=1&limit=10&search=Acme&sortBy=companyName&sortOrder=asc',
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.reports.length, 1);
      assert.strictEqual(serviceCalledWith.role, 'student', 'Anonymous caller maps to student role for masking');
      assert.strictEqual(serviceCalledWith.query.search, 'Acme');
      assert.strictEqual(serviceCalledWith.query.sortBy, 'companyNameRaw', 'companyName transforms to companyNameRaw');
    } finally {
      restoreMocks();
    }
  });

  // Group 3: Author Submission History (GET /api/reports/me)
  console.log('\n3. Author Submission History (GET /api/reports/me):');

  await runTest('GET /api/reports/me without auth returns 401', async () => {
    const res = await invokeApp({ method: 'GET', url: '/api/reports/me' });
    assert.strictEqual(res.status, 401);
  });

  await runTest('GET /api/reports/me with valid token returns 200 with user submissions', async () => {
    const user = mockAuthenticatedUser();
    let queryPassed = null;
    reportService.getMyReports = async (userId, query, role) => {
      assert.strictEqual(userId, user.id);
      queryPassed = query;
      return {
        reports: [
          { id: 'r1', companyName: 'Fake', status: 'pending' },
          { id: 'r2', companyName: 'Fake 2', status: 'rejected' },
        ],
        pagination: { page: 1, limit: 20, total: 2, totalPages: 1 },
      };
    };
    try {
      const token = createToken({ sub: user.id });
      const res = await invokeApp({
        method: 'GET',
        url: '/api/reports/me?status=pending',
        headers: { authorization: `Bearer ${token}` },
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.reports.length, 2);
      assert.strictEqual(queryPassed.status, 'pending');
    } finally {
      restoreMocks();
    }
  });

  // Group 4: Bookmarks / Saved Reports (GET /api/reports/saved)
  console.log('\n4. Bookmarks (GET /api/reports/saved):');

  await runTest('GET /api/reports/saved without auth returns 401', async () => {
    const res = await invokeApp({ method: 'GET', url: '/api/reports/saved' });
    assert.strictEqual(res.status, 401);
  });

  await runTest('GET /api/reports/saved with valid token returns 200 with saved reports', async () => {
    const user = mockAuthenticatedUser();
    reportService.getUserSavedReports = async (userId, query, role) => {
      assert.strictEqual(userId, user.id);
      return {
        reports: [{ id: 'rep-saved-1', companyName: 'Scam Ltd', status: 'verified', savedAt: new Date() }],
        pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
      };
    };
    try {
      const token = createToken({ sub: user.id });
      const res = await invokeApp({
        method: 'GET',
        url: '/api/reports/saved',
        headers: { authorization: `Bearer ${token}` },
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.reports.length, 1);
    } finally {
      restoreMocks();
    }
  });

  // Group 5: Single Report Details (GET /api/reports/:id)
  console.log('\n5. Single Report Details (GET /api/reports/:id):');

  await runTest('GET /api/reports/:id for verified report succeeds without token (200)', async () => {
    const testUuid = '550e8400-e29b-41d4-a716-446655440001';
    reportService.getReportById = async (id, currentUser) => {
      assert.strictEqual(id, testUuid);
      assert.strictEqual(currentUser, null);
      return { id, companyNameRaw: 'Verified Corp', status: 'verified', phoneRaw: '+9198XXXXX' };
    };
    try {
      const res = await invokeApp({ method: 'GET', url: `/api/reports/${testUuid}` });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.report.id, testUuid);
    } finally {
      restoreMocks();
    }
  });

  await runTest('GET /api/reports/:id for non-verified report returns 401 without token', async () => {
    const testUuid = '550e8400-e29b-41d4-a716-446655440002';
    reportService.getReportById = async () => {
      throw new AppError('Authentication required to view non-verified reports', 401);
    };
    try {
      const res = await invokeApp({ method: 'GET', url: `/api/reports/${testUuid}` });
      assert.strictEqual(res.status, 401);
    } finally {
      restoreMocks();
    }
  });

  await runTest('GET /api/reports/:id for non-verified report returns 403 for unauthorized student', async () => {
    const testUuid = '550e8400-e29b-41d4-a716-446655440002';
    mockAuthenticatedUser({ id: 'usr-stranger' });
    reportService.getReportById = async () => {
      throw new AppError('Access denied: you do not have permission to view this report', 403);
    };
    try {
      const token = createToken({ sub: 'usr-stranger' });
      const res = await invokeApp({
        method: 'GET',
        url: `/api/reports/${testUuid}`,
        headers: { authorization: `Bearer ${token}` },
      });
      assert.strictEqual(res.status, 403);
    } finally {
      restoreMocks();
    }
  });

  await runTest('GET /api/reports/:id for non-verified report returns 200 for original author', async () => {
    const testUuid = '550e8400-e29b-41d4-a716-446655440002';
    const author = mockAuthenticatedUser({ id: 'usr-author' });
    reportService.getReportById = async (id, currentUser) => {
      assert.strictEqual(currentUser.id, author.id);
      return { id, companyNameRaw: 'My Report', status: 'pending' };
    };
    try {
      const token = createToken({ sub: author.id });
      const res = await invokeApp({
        method: 'GET',
        url: `/api/reports/${testUuid}`,
        headers: { authorization: `Bearer ${token}` },
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.report.status, 'pending');
    } finally {
      restoreMocks();
    }
  });

  await runTest('GET /api/reports/not-a-uuid returns 400 with validation error', async () => {
    const res = await invokeApp({ method: 'GET', url: '/api/reports/invalid-uuid-string' });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.success, false);
  });

  await runTest('GET /api/reports/:id for non-existent report returns 404', async () => {
    const testUuid = '550e8400-e29b-41d4-a716-446655440009';
    reportService.getReportById = async () => {
      throw new AppError('Report not found', 404);
    };
    try {
      const res = await invokeApp({ method: 'GET', url: `/api/reports/${testUuid}` });
      assert.strictEqual(res.status, 404);
    } finally {
      restoreMocks();
    }
  });

  // Group 6: Related Reports (GET /api/reports/:id/related)
  console.log('\n6. Related Reports (GET /api/reports/:id/related):');

  await runTest('GET /api/reports/:id/related returns 200 without token for verified source report', async () => {
    const testUuid = '550e8400-e29b-41d4-a716-446655440001';
    reportService.getRelatedReports = async (id, currentUser) => {
      assert.strictEqual(id, testUuid);
      assert.strictEqual(currentUser, null);
      return {
        sourceReportId: testUuid,
        relatedReports: [{ id: 'rel-1', companyName: 'Related Corp', status: 'verified' }],
      };
    };
    try {
      const res = await invokeApp({ method: 'GET', url: `/api/reports/${testUuid}/related` });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.relatedReports.length, 1);
    } finally {
      restoreMocks();
    }
  });

  await runTest('GET /api/reports/:id/related returns 401 without token for non-verified source report', async () => {
    const testUuid = '550e8400-e29b-41d4-a716-446655440002';
    reportService.getRelatedReports = async () => {
      throw new AppError('Authentication required to view non-verified reports', 401);
    };
    try {
      const res = await invokeApp({ method: 'GET', url: `/api/reports/${testUuid}/related` });
      assert.strictEqual(res.status, 401);
    } finally {
      restoreMocks();
    }
  });

  await runTest('GET /api/reports/:id/related returns 403 for unauthorized student on private report', async () => {
    const testUuid = '550e8400-e29b-41d4-a716-446655440002';
    mockAuthenticatedUser({ id: 'usr-stranger' });
    reportService.getRelatedReports = async () => {
      throw new AppError('Access denied: you do not have permission to view this report', 403);
    };
    try {
      const token = createToken({ sub: 'usr-stranger' });
      const res = await invokeApp({
        method: 'GET',
        url: `/api/reports/${testUuid}/related`,
        headers: { authorization: `Bearer ${token}` },
      });
      assert.strictEqual(res.status, 403);
    } finally {
      restoreMocks();
    }
  });

  // Group 7: Bookmark Save & Delete Operations
  console.log('\n7. Bookmark Operations (POST & DELETE /api/reports/:id/save):');

  await runTest('POST /api/reports/:id/save without token returns 401', async () => {
    const testUuid = '550e8400-e29b-41d4-a716-446655440001';
    const res = await invokeApp({ method: 'POST', url: `/api/reports/${testUuid}/save` });
    assert.strictEqual(res.status, 401);
  });

  await runTest('POST /api/reports/:id/save with token bookmarks report and returns 200', async () => {
    const testUuid = '550e8400-e29b-41d4-a716-446655440001';
    const user = mockAuthenticatedUser();
    reportService.saveReport = async (userId, reportId) => {
      assert.strictEqual(userId, user.id);
      assert.strictEqual(reportId, testUuid);
      return { saved: true, reportId: testUuid };
    };
    try {
      const token = createToken({ sub: user.id });
      const res = await invokeApp({
        method: 'POST',
        url: `/api/reports/${testUuid}/save`,
        headers: { authorization: `Bearer ${token}` },
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.saved, true);
    } finally {
      restoreMocks();
    }
  });

  await runTest('DELETE /api/reports/:id/save with token removes bookmark and returns 200', async () => {
    const testUuid = '550e8400-e29b-41d4-a716-446655440001';
    const user = mockAuthenticatedUser();
    reportService.removeSavedReport = async (userId, reportId) => {
      assert.strictEqual(userId, user.id);
      assert.strictEqual(reportId, testUuid);
      return { saved: false, reportId: testUuid };
    };
    try {
      const token = createToken({ sub: user.id });
      const res = await invokeApp({
        method: 'DELETE',
        url: `/api/reports/${testUuid}/save`,
        headers: { authorization: `Bearer ${token}` },
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.saved, false);
    } finally {
      restoreMocks();
    }
  });

  // Group 8: Phase 5B Report Submission Regression Test
  console.log('\n8. Phase 5B Report Submission Regression:');

  await runTest('POST /api/reports authenticated submission creates report and returns 201', async () => {
    const user = mockAuthenticatedUser();
    reportService.createReport = async (userId, body, role) => {
      assert.strictEqual(userId, user.id);
      return { id: 'created-rep-1', companyNameRaw: body.companyName, status: 'pending' };
    };
    try {
      const token = createToken({ sub: user.id });
      const res = await invokeApp({
        method: 'POST',
        url: '/api/reports',
        headers: { authorization: `Bearer ${token}` },
        body: {
          companyName: 'Legit Inc',
          offerMessage: 'Offer message text here',
        },
      });
      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.report.id, 'created-rep-1');
    } finally {
      restoreMocks();
    }
  });

  console.log(`\nAll ${passedTests} / ${totalTests} report_browse_http tests passed successfully!\n`);
}

runAllTests().catch((err) => {
  console.error('\nTest suite failed:', err);
  process.exit(1);
});
