'use strict';

/**
 * backend/test/admin_stats.test.js
 * Comprehensive unit and HTTP integration test suite for GET /api/admin/stats.
 *
 * SAFETY INVARIANTS:
 * - ZERO database connections: in-memory mock dispatch (invokeApp).
 * - ZERO network/TCP sockets.
 * - ZERO .env modifications.
 *
 * COVERS:
 * 1. Authentication & RBAC Route Protection:
 *    - Rejects unauthenticated requests with 401.
 *    - Rejects student role with 403 ("Admin access required").
 *    - Rejects banned admin user with 403.
 * 2. HTTP Admin Stats Aggregation:
 *    - Returns HTTP 200 with accurate stats for valid admin.
 *    - Safe defaults for zero-state / empty database (all counts 0).
 * 3. Service Layer Protection & Precision:
 *    - Rejects non-admin roles directly in service with 403.
 *    - Accurately maps groupBy results into reportsByStatus and riskDistribution dictionaries.
 */

process.env.DATABASE_URL = 'postgresql://mock:mock@localhost:5432/mock_test';
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'http_admin_stats_test_jwt_secret_01234567890123456789';

const http = require('http');
const { Readable } = require('stream');
const assert = require('assert');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const prisma = require('../src/utils/prisma');
const adminService = require('../src/services/admin.service');
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

function invokeApp({ method = 'GET', url = '/api/admin/stats', headers = {}, body = null }) {
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

// ─── Mock Infrastructure ─────────────────────────────────────────────────────

const originalUserFindUnique = prisma.user.findUnique;
const originalUserCount = prisma.user.count;
const originalReportCount = prisma.report.count;
const originalReportGroupBy = prisma.report.groupBy;
const originalRiskAssessmentGroupBy = prisma.riskAssessment.groupBy;
const originalIdentifierCount = prisma.identifier.count;
const originalClusterCount = prisma.cluster.count;
const originalOfferCheckCount = prisma.offerCheck.count;

function restoreMocks() {
  prisma.user.findUnique = originalUserFindUnique;
  prisma.user.count = originalUserCount;
  prisma.report.count = originalReportCount;
  prisma.report.groupBy = originalReportGroupBy;
  prisma.riskAssessment.groupBy = originalRiskAssessmentGroupBy;
  prisma.identifier.count = originalIdentifierCount;
  prisma.cluster.count = originalClusterCount;
  prisma.offerCheck.count = originalOfferCheckCount;
}

function createToken({
  sub = 'admin-user-1',
  role = 'admin',
  expiresIn = 3600,
  secret = process.env.JWT_SECRET,
} = {}) {
  return jwt.sign({ sub, role }, secret, { expiresIn, algorithm: 'HS256' });
}

function mockUserLookup({ id = 'admin-user-1', role = 'admin', isBanned = false } = {}) {
  prisma.user.findUnique = async ({ where }) => {
    if (where.id === id) {
      return { id, role, isBanned };
    }
    return null;
  };
}

// ─── Main Test Runner ────────────────────────────────────────────────────────

async function main() {
  console.log('\n--- Phase 9: Admin Stats Service & HTTP Route Tests ---');

  // =========================================================================
  // 1. Authentication & RBAC Route Protection
  // =========================================================================
  console.log('\n1. Authentication & RBAC Route Protection:');

  await runTest('GET /api/admin/stats without auth returns 401', async () => {
    restoreMocks();
    const res = await invokeApp({ method: 'GET', url: '/api/admin/stats' });
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.success, false);
  });

  await runTest('GET /api/admin/stats with invalid token returns 401', async () => {
    restoreMocks();
    const res = await invokeApp({
      method: 'GET',
      url: '/api/admin/stats',
      headers: { authorization: 'Bearer bad-token' },
    });
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.success, false);
  });

  await runTest('GET /api/admin/stats with student token returns 403', async () => {
    restoreMocks();
    const token = createToken({ sub: 'stu-user-1', role: 'student' });
    mockUserLookup({ id: 'stu-user-1', role: 'student', isBanned: false });

    const res = await invokeApp({
      method: 'GET',
      url: '/api/admin/stats',
      headers: { authorization: `Bearer ${token}` },
    });
    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.body.success, false);
    assert.match(res.body.error, /admin access required/i);
  });

  await runTest('GET /api/admin/stats with banned admin token returns 403', async () => {
    restoreMocks();
    const token = createToken({ sub: 'banned-admin', role: 'admin' });
    mockUserLookup({ id: 'banned-admin', role: 'admin', isBanned: true });

    const res = await invokeApp({
      method: 'GET',
      url: '/api/admin/stats',
      headers: { authorization: `Bearer ${token}` },
    });
    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.body.success, false);
    assert.match(res.body.error, /suspended/i);
  });

  // =========================================================================
  // 2. HTTP Admin Stats Aggregation
  // =========================================================================
  console.log('\n2. HTTP Admin Stats Aggregation:');

  await runTest('GET /api/admin/stats returns 200 with populated database stats', async () => {
    restoreMocks();
    const adminId = 'admin-active-1';
    const token = createToken({ sub: adminId, role: 'admin' });
    mockUserLookup({ id: adminId, role: 'admin', isBanned: false });

    prisma.report.count = async () => 25;
    prisma.report.groupBy = async () => [
      { status: 'pending', _count: { id: 8 } },
      { status: 'verified', _count: { id: 12 } },
      { status: 'rejected', _count: { id: 3 } },
      { status: 'investigating', _count: { id: 2 } },
    ];
    prisma.riskAssessment.groupBy = async ({ where }) => {
      assert.strictEqual(where.isCurrent, true);
      return [
        { category: 'critical', _count: { id: 6 } },
        { category: 'high', _count: { id: 9 } },
        { category: 'medium', _count: { id: 7 } },
        { category: 'low', _count: { id: 3 } },
      ];
    };
    prisma.identifier.count = async (args) => {
      if (args && args.where && args.where.flagged) return 14;
      return 52;
    };
    prisma.cluster.count = async ({ where }) => {
      assert.strictEqual(where.status, 'active');
      return 5;
    };
    prisma.user.count = async () => 120;
    prisma.offerCheck.count = async () => 88;

    const res = await invokeApp({
      method: 'GET',
      url: '/api/admin/stats',
      headers: { authorization: `Bearer ${token}` },
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    const s = res.body.stats;
    assert.strictEqual(s.totalReports, 25);
    assert.deepStrictEqual(s.reportsByStatus, {
      pending: 8,
      verified: 12,
      rejected: 3,
      investigating: 2,
    });
    assert.deepStrictEqual(s.riskDistribution, {
      critical: 6,
      high: 9,
      medium: 7,
      low: 3,
    });
    assert.strictEqual(s.totalIdentifiers, 52);
    assert.strictEqual(s.flaggedIdentifiers, 14);
    assert.strictEqual(s.activeClusters, 5);
    assert.strictEqual(s.totalUsers, 120);
    assert.strictEqual(s.totalChecks, 88);
  });

  await runTest('GET /api/admin/stats returns safe defaults on empty database', async () => {
    restoreMocks();
    const adminId = 'admin-active-2';
    const token = createToken({ sub: adminId, role: 'admin' });
    mockUserLookup({ id: adminId, role: 'admin', isBanned: false });

    prisma.report.count = async () => 0;
    prisma.report.groupBy = async () => [];
    prisma.riskAssessment.groupBy = async () => [];
    prisma.identifier.count = async () => 0;
    prisma.cluster.count = async () => 0;
    prisma.user.count = async () => 0;
    prisma.offerCheck.count = async () => 0;

    const res = await invokeApp({
      method: 'GET',
      url: '/api/admin/stats',
      headers: { authorization: `Bearer ${token}` },
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    const s = res.body.stats;
    assert.strictEqual(s.totalReports, 0);
    assert.deepStrictEqual(s.reportsByStatus, {
      pending: 0,
      verified: 0,
      rejected: 0,
      investigating: 0,
    });
    assert.deepStrictEqual(s.riskDistribution, {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
    });
    assert.strictEqual(s.totalIdentifiers, 0);
    assert.strictEqual(s.flaggedIdentifiers, 0);
    assert.strictEqual(s.activeClusters, 0);
    assert.strictEqual(s.totalUsers, 0);
    assert.strictEqual(s.totalChecks, 0);
  });

  // =========================================================================
  // 3. Service Layer Protection & Precision
  // =========================================================================
  console.log('\n3. Service Layer Protection & Precision:');

  await runTest('adminService.getAdminStats rejects non-admin roles directly with 403', async () => {
    restoreMocks();
    await assert.rejects(
      async () => adminService.getAdminStats('student'),
      (err) => err instanceof AppError && err.statusCode === 403
    );
    await assert.rejects(
      async () => adminService.getAdminStats('anonymous'),
      (err) => err instanceof AppError && err.statusCode === 403
    );
    await assert.rejects(
      async () => adminService.getAdminStats(null),
      (err) => err instanceof AppError && err.statusCode === 403
    );
  });

  // Cleanup
  restoreMocks();
  console.log(`\nAll ${passedTests} / ${totalTests} admin_stats tests passed successfully!`);
}

main().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
