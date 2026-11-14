'use strict';

/**
 * backend/test/admin_moderation_http.test.js
 * Comprehensive Express HTTP integration test suite for Phase 8 Admin Moderation endpoints.
 *
 * SAFETY INVARIANTS:
 * - ZERO database connections: uses in-memory mock dispatch (invokeApp).
 * - ZERO network/TCP sockets: Node.js stream dispatch.
 * - ZERO .env modifications.
 *
 * COVERS:
 * 1. Global /api/admin Guard Enforcement:
 *    - Rejects unauthenticated requests with 401.
 *    - Rejects student role with 403 ("Admin access required").
 *    - Rejects banned admin user with 403.
 * 2. GET /api/admin/reports:
 *    - Valid admin token returns 200 with reports array and pagination metadata.
 *    - Invalid pagination (page=0, limit=101) rejected with 400.
 * 3. GET /api/admin/reports/:id:
 *    - Malformed UUID rejected with 400.
 *    - Non-existent report returns 404.
 *    - Valid admin token returns 200 with unmasked report.
 * 4. PATCH /api/admin/reports/:id:
 *    - Malformed UUID rejected with 400.
 *    - Missing status rejected with 400.
 *    - Invalid status enum rejected with 400.
 *    - Extraneous fields rejected by .strict() with 400.
 *    - Notes > 1000 chars rejected with 400.
 *    - Valid transition returns 200 with report and auditLog.
 *    - Same-status request returns 409 Conflict.
 *    - Finalized report modification returns 400 Bad Request.
 *    - Concurrent modification collision returns 409 Conflict.
 */

process.env.DATABASE_URL = 'postgresql://mock:mock@localhost:5432/mock_test';
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'http_admin_test_jwt_secret_012345678901234567890123456789';

const http = require('http');
const { Readable } = require('stream');
const assert = require('assert');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
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

// ─── In-Memory HTTP Dispatcher ───────────────────────────────────────────────

function invokeApp({ method = 'GET', url = '/api/admin/reports', headers = {}, body = null }) {
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

// ─── Token Generators ────────────────────────────────────────────────────────

const adminUser = {
  id: 'admin-user-uuid-1',
  email: 'admin@offercheck.org',
  name: 'Admin User',
  role: 'admin',
  isBanned: false,
};

const studentUser = {
  id: 'student-user-uuid-2',
  email: 'student@college.edu',
  name: 'Student User',
  role: 'student',
  isBanned: false,
};

function generateToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, email: user.email },
    process.env.JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '1h' }
  );
}

const adminToken = generateToken(adminUser);
const studentToken = generateToken(studentUser);

async function main() {
  console.log('\n--- Phase 8: Admin Moderation HTTP Route Tests ---\n');

  // Set up Prisma user lookup mock for auth middleware
  prisma.user.findUnique = async ({ where }) => {
    if (where.id === adminUser.id) return adminUser;
    if (where.id === studentUser.id) return studentUser;
    if (where.id === 'banned-admin-id') return { ...adminUser, id: 'banned-admin-id', isBanned: true };
    return null;
  };

  const validReportId = '11111111-1111-4111-8111-111111111111';

  // ─── 1. Authentication & RBAC Guards ────────────────────────────────────────
  console.log('1. Authentication & RBAC Route Protection:');

  await runTest('GET /api/admin/reports without auth returns 401', async () => {
    const res = await invokeApp({ method: 'GET', url: '/api/admin/reports' });
    assert.strictEqual(res.status, 401);
  });

  await runTest('GET /api/admin/reports with student token returns 403', async () => {
    const res = await invokeApp({
      method: 'GET',
      url: '/api/admin/reports',
      headers: { authorization: `Bearer ${studentToken}` }
    });
    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.body.error, 'Admin access required');
  });

  await runTest('GET /api/admin/reports with banned admin token returns 403', async () => {
    const bannedToken = jwt.sign(
      { sub: 'banned-admin-id', role: 'admin' },
      process.env.JWT_SECRET,
      { algorithm: 'HS256', expiresIn: '1h' }
    );
    const res = await invokeApp({
      method: 'GET',
      url: '/api/admin/reports',
      headers: { authorization: `Bearer ${bannedToken}` }
    });
    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.body.error, 'Account has been suspended');
  });

  await runTest('PATCH /api/admin/reports/:id without auth returns 401', async () => {
    const res = await invokeApp({
      method: 'PATCH',
      url: `/api/admin/reports/${validReportId}`,
      body: { status: 'verified' }
    });
    assert.strictEqual(res.status, 401);
  });

  await runTest('PATCH /api/admin/reports/:id with student token returns 403', async () => {
    const res = await invokeApp({
      method: 'PATCH',
      url: `/api/admin/reports/${validReportId}`,
      headers: { authorization: `Bearer ${studentToken}` },
      body: { status: 'verified' }
    });
    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.body.error, 'Admin access required');
  });

  // ─── 2. GET /api/admin/reports (Listing) ────────────────────────────────────
  console.log('\n2. GET /api/admin/reports (Listing & Query Validation):');

  await runTest('GET /api/admin/reports with valid admin token returns 200', async () => {
    reportService.getAdminReports = async (query, role) => {
      assert.strictEqual(role, 'admin');
      return {
        reports: [{ id: validReportId, status: 'pending', companyNameRaw: 'Fake Corp' }],
        pagination: { page: 1, limit: 20, total: 1, totalPages: 1 }
      };
    };

    const res = await invokeApp({
      method: 'GET',
      url: '/api/admin/reports',
      headers: { authorization: `Bearer ${adminToken}` }
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.reports.length, 1);
    assert.strictEqual(res.body.pagination.total, 1);
  });

  await runTest('GET /api/admin/reports?limit=101 rejected with 400', async () => {
    const res = await invokeApp({
      method: 'GET',
      url: '/api/admin/reports?limit=101',
      headers: { authorization: `Bearer ${adminToken}` }
    });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error, 'Validation failed');
  });

  await runTest('GET /api/admin/reports?status=invalid_status rejected with 400', async () => {
    const res = await invokeApp({
      method: 'GET',
      url: '/api/admin/reports?status=invalid_status',
      headers: { authorization: `Bearer ${adminToken}` }
    });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error, 'Validation failed');
  });

  // ─── 3. GET /api/admin/reports/:id (Inspection) ─────────────────────────────
  console.log('\n3. GET /api/admin/reports/:id (Report Details Inspection):');

  await runTest('GET /api/admin/reports/:id with invalid UUID returns 400', async () => {
    const res = await invokeApp({
      method: 'GET',
      url: '/api/admin/reports/not-a-valid-uuid',
      headers: { authorization: `Bearer ${adminToken}` }
    });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error, 'Validation failed');
  });

  await runTest('GET /api/admin/reports/:id with valid admin token returns 200 unmasked report', async () => {
    reportService.getReportById = async (id, user) => {
      assert.strictEqual(id, validReportId);
      assert.strictEqual(user.role, 'admin');
      return { id, companyNameRaw: 'Fake Corp', phoneRaw: '+919876543210', status: 'pending' };
    };

    const res = await invokeApp({
      method: 'GET',
      url: `/api/admin/reports/${validReportId}`,
      headers: { authorization: `Bearer ${adminToken}` }
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.report.phoneRaw, '+919876543210');
  });

  await runTest('GET /api/admin/reports/:id for non-existent report returns 404', async () => {
    reportService.getReportById = async () => {
      throw new AppError('Report not found', 404);
    };

    const res = await invokeApp({
      method: 'GET',
      url: `/api/admin/reports/${validReportId}`,
      headers: { authorization: `Bearer ${adminToken}` }
    });

    assert.strictEqual(res.status, 404);
    assert.strictEqual(res.body.error, 'Report not found');
  });

  // ─── 4. PATCH /api/admin/reports/:id (Moderation Action) ────────────────────
  console.log('\n4. PATCH /api/admin/reports/:id (Moderation & Concurrency):');

  await runTest('PATCH /api/admin/reports/:id with invalid UUID returns 400', async () => {
    const res = await invokeApp({
      method: 'PATCH',
      url: '/api/admin/reports/not-a-valid-uuid',
      headers: { authorization: `Bearer ${adminToken}` },
      body: { status: 'verified' }
    });
    assert.strictEqual(res.status, 400);
  });

  await runTest('PATCH /api/admin/reports/:id with missing status returns 400', async () => {
    const res = await invokeApp({
      method: 'PATCH',
      url: `/api/admin/reports/${validReportId}`,
      headers: { authorization: `Bearer ${adminToken}` },
      body: { notes: 'Missing status property' }
    });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error, 'Validation failed');
  });

  await runTest('PATCH /api/admin/reports/:id with invalid status enum returns 400', async () => {
    const res = await invokeApp({
      method: 'PATCH',
      url: `/api/admin/reports/${validReportId}`,
      headers: { authorization: `Bearer ${adminToken}` },
      body: { status: 'approved' } // 'approved' is not a valid enum
    });
    assert.strictEqual(res.status, 400);
  });

  await runTest('PATCH /api/admin/reports/:id with client-supplied reviewerId rejected with 400 (.strict())', async () => {
    const res = await invokeApp({
      method: 'PATCH',
      url: `/api/admin/reports/${validReportId}`,
      headers: { authorization: `Bearer ${adminToken}` },
      body: { status: 'verified', reviewerId: 'hacker-supplied-id' }
    });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error, 'Validation failed');
  });

  await runTest('PATCH /api/admin/reports/:id with notes > 1000 chars rejected with 400', async () => {
    const res = await invokeApp({
      method: 'PATCH',
      url: `/api/admin/reports/${validReportId}`,
      headers: { authorization: `Bearer ${adminToken}` },
      body: { status: 'verified', notes: 'a'.repeat(1001) }
    });
    assert.strictEqual(res.status, 400);
  });

  await runTest('PATCH /api/admin/reports/:id successful verify returns 200 with report and auditLog', async () => {
    reportService.moderateReport = async (reportId, status, adminId, notes) => {
      assert.strictEqual(reportId, validReportId);
      assert.strictEqual(status, 'verified');
      assert.strictEqual(adminId, adminUser.id);
      assert.strictEqual(notes, 'Confirmed fraudulent activity');
      return {
        report: { id: reportId, status: 'verified', isVerified: true, reviewedBy: adminId },
        auditLog: { id: 'al-1', actorId: adminId, action: 'STATUS_CHANGED', oldValue: 'pending', newValue: 'verified' }
      };
    };

    const res = await invokeApp({
      method: 'PATCH',
      url: `/api/admin/reports/${validReportId}`,
      headers: { authorization: `Bearer ${adminToken}` },
      body: { status: 'verified', notes: 'Confirmed fraudulent activity' }
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.report.status, 'verified');
    assert.strictEqual(res.body.auditLog.action, 'STATUS_CHANGED');
  });

  await runTest('PATCH /api/admin/reports/:id same status transition returns 409 Conflict', async () => {
    reportService.moderateReport = async () => {
      throw new AppError('Report is already verified', 409);
    };

    const res = await invokeApp({
      method: 'PATCH',
      url: `/api/admin/reports/${validReportId}`,
      headers: { authorization: `Bearer ${adminToken}` },
      body: { status: 'verified' }
    });

    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.error, 'Report is already verified');
  });

  await runTest('PATCH /api/admin/reports/:id modifying finalized report returns 400 Bad Request', async () => {
    reportService.moderateReport = async () => {
      throw new AppError('Verified reports are finalized and cannot be modified', 400);
    };

    const res = await invokeApp({
      method: 'PATCH',
      url: `/api/admin/reports/${validReportId}`,
      headers: { authorization: `Bearer ${adminToken}` },
      body: { status: 'rejected' }
    });

    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error, 'Verified reports are finalized and cannot be modified');
  });

  await runTest('PATCH /api/admin/reports/:id concurrent modification conflict returns 409 Conflict', async () => {
    reportService.moderateReport = async () => {
      throw new AppError('Report was modified by another administrator or is no longer in expected status', 409);
    };

    const res = await invokeApp({
      method: 'PATCH',
      url: `/api/admin/reports/${validReportId}`,
      headers: { authorization: `Bearer ${adminToken}` },
      body: { status: 'verified' }
    });

    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.error, 'Report was modified by another administrator or is no longer in expected status');
  });

  console.log(`\nAll ${passedTests} / ${totalTests} admin_moderation HTTP route tests passed successfully!\n`);
}

main().catch((err) => {
  console.error('\nHTTP test suite failed:', err);
  process.exit(1);
});
