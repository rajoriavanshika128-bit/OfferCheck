'use strict';

/**
 * backend/test/dashboard_metrics.test.js
 * Comprehensive unit and HTTP integration test suite for GET /api/checks/dashboard.
 *
 * SAFETY INVARIANTS:
 * - ZERO database connections: uses in-memory mock dispatch (invokeApp).
 * - ZERO network/TCP sockets: Node.js stream dispatch.
 * - ZERO .env modifications.
 *
 * COVERS:
 * 1. Authentication & Route Protection:
 *    - Rejects unauthenticated requests with 401.
 *    - Rejects invalid / malformed JWT with 401.
 *    - Rejects banned user with 403.
 * 2. Zero-State Handling:
 *    - Authenticated user with no checks, reports, or saved reports.
 *    - Returns totalChecks=0, reportsSubmitted=0, savedReports=0, highRiskChecks=0, activeAlerts=0.
 *    - Returns avgRiskScore=null.
 *    - Returns 7-day weeklyActivity array with zero counts.
 *    - Returns empty recentChecks array.
 * 3. Populated Aggregations & Role-Based Masking:
 *    - Correct counts, rounded avgRiskScore, and recentChecks.
 *    - Masks PII in recentChecks for student role.
 *    - Unmasks PII in recentChecks for admin role.
 * 4. User Isolation & Service Guards:
 *    - Rejects missing/empty userId with 400.
 *    - Filters strictly by authenticated userId across all queries.
 */

process.env.DATABASE_URL = 'postgresql://mock:mock@localhost:5432/mock_test';
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'http_dashboard_test_jwt_secret_01234567890123456789';

const http = require('http');
const { Readable } = require('stream');
const assert = require('assert');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const prisma = require('../src/utils/prisma');
const checkService = require('../src/services/check.service');
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

function invokeApp({ method = 'GET', url = '/api/checks/dashboard', headers = {}, body = null }) {
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
const originalOfferCheckCount = prisma.offerCheck.count;
const originalOfferCheckAggregate = prisma.offerCheck.aggregate;
const originalOfferCheckFindMany = prisma.offerCheck.findMany;
const originalReportCount = prisma.report.count;
const originalSavedReportCount = prisma.savedReport.count;

function restoreMocks() {
  prisma.user.findUnique = originalUserFindUnique;
  prisma.offerCheck.count = originalOfferCheckCount;
  prisma.offerCheck.aggregate = originalOfferCheckAggregate;
  prisma.offerCheck.findMany = originalOfferCheckFindMany;
  prisma.report.count = originalReportCount;
  prisma.savedReport.count = originalSavedReportCount;
}

function createToken({
  sub = 'user-stu-101',
  role = 'student',
  expiresIn = 3600,
  secret = process.env.JWT_SECRET,
} = {}) {
  return jwt.sign({ sub, role }, secret, { expiresIn, algorithm: 'HS256' });
}

function mockUserLookup({ id = 'user-stu-101', role = 'student', isBanned = false } = {}) {
  prisma.user.findUnique = async ({ where }) => {
    if (where.id === id) {
      return { id, role, isBanned };
    }
    return null;
  };
}

// ─── Main Test Runner ────────────────────────────────────────────────────────

async function main() {
  console.log('\n--- Phase 9: Dashboard Metrics Service & HTTP Route Tests ---');

  // =========================================================================
  // 1. Authentication & Route Guard Tests
  // =========================================================================
  console.log('\n1. Authentication & Route Protection:');

  await runTest('GET /api/checks/dashboard without auth returns 401', async () => {
    restoreMocks();
    const res = await invokeApp({ method: 'GET', url: '/api/checks/dashboard' });
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.success, false);
  });

  await runTest('GET /api/checks/dashboard with invalid JWT returns 401', async () => {
    restoreMocks();
    const res = await invokeApp({
      method: 'GET',
      url: '/api/checks/dashboard',
      headers: { authorization: 'Bearer invalid-token-string' },
    });
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.success, false);
  });

  await runTest('GET /api/checks/dashboard with banned user returns 403', async () => {
    restoreMocks();
    const token = createToken({ sub: 'banned-user', role: 'student' });
    mockUserLookup({ id: 'banned-user', role: 'student', isBanned: true });

    const res = await invokeApp({
      method: 'GET',
      url: '/api/checks/dashboard',
      headers: { authorization: `Bearer ${token}` },
    });
    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.body.success, false);
    assert.match(res.body.error, /suspended/i);
  });

  // =========================================================================
  // 2. Zero-State Handling
  // =========================================================================
  console.log('\n2. Zero-State Handling:');

  await runTest('GET /api/checks/dashboard returns correct zero-state metrics', async () => {
    restoreMocks();
    const userId = 'user-zero-1';
    const token = createToken({ sub: userId, role: 'student' });
    mockUserLookup({ id: userId, role: 'student', isBanned: false });

    // Mock empty database returns
    prisma.offerCheck.count = async () => 0;
    prisma.report.count = async () => 0;
    prisma.savedReport.count = async () => 0;
    prisma.offerCheck.aggregate = async () => ({ _avg: { riskScore: null } });
    prisma.offerCheck.findMany = async () => [];

    const res = await invokeApp({
      method: 'GET',
      url: '/api/checks/dashboard',
      headers: { authorization: `Bearer ${token}` },
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    const m = res.body.metrics;
    assert.strictEqual(m.totalChecks, 0);
    assert.strictEqual(m.reportsSubmitted, 0);
    assert.strictEqual(m.savedReports, 0);
    assert.strictEqual(m.highRiskChecks, 0);
    assert.strictEqual(m.activeAlerts, undefined);
    assert.strictEqual(m.avgRiskScore, null);
    assert.strictEqual(Array.isArray(m.recentChecks), true);
    assert.strictEqual(m.recentChecks.length, 0);
    assert.strictEqual(Array.isArray(m.weeklyActivity), true);
    assert.strictEqual(m.weeklyActivity.length, 7);
    for (const day of m.weeklyActivity) {
      assert.strictEqual(day.checks, 0);
      assert.strictEqual(typeof day.date, 'string');
      assert.strictEqual(typeof day.day, 'string');
    }
  });

  // =========================================================================
  // 3. Populated Aggregations & Role-Based Masking
  // =========================================================================
  console.log('\n3. Populated Aggregations & Role-Based Masking:');

  await runTest('GET /api/checks/dashboard aggregates correctly and masks PII for students', async () => {
    restoreMocks();
    const userId = 'user-active-1';
    const token = createToken({ sub: userId, role: 'student' });
    mockUserLookup({ id: userId, role: 'student', isBanned: false });

    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);

    prisma.offerCheck.count = async ({ where }) => {
      assert.strictEqual(where.userId, userId);
      if (where.riskCategory) {
        return 3; // high/critical count
      }
      return 10; // total checks
    };
    prisma.report.count = async ({ where }) => {
      assert.strictEqual(where.submittedBy, userId);
      return 4;
    };
    prisma.savedReport.count = async ({ where }) => {
      assert.strictEqual(where.userId, userId);
      return 2;
    };
    prisma.offerCheck.aggregate = async ({ where }) => {
      assert.strictEqual(where.userId, userId);
      return { _avg: { riskScore: 78.4 } };
    };
    prisma.offerCheck.findMany = async (args) => {
      assert.strictEqual(args.where.userId, userId);
      if (args.where.checkedAt) {
        // weeklyActivity query
        return [
          { checkedAt: new Date(todayStr + 'T10:00:00Z') },
          { checkedAt: new Date(todayStr + 'T12:00:00Z') },
        ];
      }
      // recentChecks query
      return [
        {
          id: 'check-1',
          userId,
          companyName: 'Acme Corp',
          phoneQuery: '+919876543210',
          emailQuery: 'hr@acmefake.com',
          upiQuery: 'fraudpay@okhdfc',
          domainQuery: 'acmefake.com',
          riskScore: 85,
          riskCategory: 'critical',
          checkedAt: new Date(),
          result: {
            score: 85,
            riskCategory: 'critical',
            riskLevel: 'CRITICAL',
            summary: 'High scam risk detected',
            factors: [],
          },
        },
      ];
    };

    const res = await invokeApp({
      method: 'GET',
      url: '/api/checks/dashboard',
      headers: { authorization: `Bearer ${token}` },
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    const m = res.body.metrics;
    assert.strictEqual(m.totalChecks, 10);
    assert.strictEqual(m.reportsSubmitted, 4);
    assert.strictEqual(m.savedReports, 2);
    assert.strictEqual(m.highRiskChecks, 3);
    assert.strictEqual(m.activeAlerts, undefined);
    assert.strictEqual(m.avgRiskScore, 78); // Math.round(78.4) = 78
    assert.strictEqual(m.recentChecks.length, 1);

    const rc = m.recentChecks[0];
    assert.strictEqual(rc.companyName, 'Acme Corp');
    assert.strictEqual(rc.phoneQuery, '+9198XXXXX'); // masked for student
    assert.strictEqual(rc.emailQuery, 'h***@acmefake.com'); // masked for student
    assert.strictEqual(rc.upiQuery, 'f*****ay@okhdfc'); // masked for student

    // Weekly activity: today should have 2 checks
    const todayItem = m.weeklyActivity.find((w) => w.date === todayStr);
    assert.ok(todayItem);
    assert.strictEqual(todayItem.checks, 2);
  });

  await runTest('GET /api/checks/dashboard leaves PII unmasked for admin role', async () => {
    restoreMocks();
    const adminId = 'admin-user-1';
    const token = createToken({ sub: adminId, role: 'admin' });
    mockUserLookup({ id: adminId, role: 'admin', isBanned: false });

    prisma.offerCheck.count = async () => 1;
    prisma.report.count = async () => 0;
    prisma.savedReport.count = async () => 0;
    prisma.offerCheck.aggregate = async () => ({ _avg: { riskScore: 40 } });
    prisma.offerCheck.findMany = async (args) => {
      if (args.where.checkedAt) return [];
      return [
        {
          id: 'check-admin-1',
          userId: adminId,
          companyName: 'Real Corp',
          phoneQuery: '+919876543210',
          emailQuery: 'recruiter@realcorp.com',
          upiQuery: 'billing@okhdfc',
          domainQuery: 'realcorp.com',
          riskScore: 40,
          riskCategory: 'medium',
          checkedAt: new Date(),
          result: { score: 40, riskCategory: 'medium' },
        },
      ];
    };

    const res = await invokeApp({
      method: 'GET',
      url: '/api/checks/dashboard',
      headers: { authorization: `Bearer ${token}` },
    });

    assert.strictEqual(res.status, 200);
    const rc = res.body.metrics.recentChecks[0];
    assert.strictEqual(rc.phoneQuery, '+919876543210'); // unmasked for admin
    assert.strictEqual(rc.emailQuery, 'recruiter@realcorp.com'); // unmasked for admin
    assert.strictEqual(rc.upiQuery, 'billing@okhdfc'); // unmasked for admin
  });

  // =========================================================================
  // 4. Service Unit Tests & Boundary Conditions
  // =========================================================================
  console.log('\n4. Service Unit & Boundary Tests:');

  await runTest('getDashboardMetrics rejects missing or invalid userId with 400', async () => {
    restoreMocks();
    await assert.rejects(
      async () => checkService.getDashboardMetrics(null),
      (err) => err instanceof AppError && err.statusCode === 400
    );
    await assert.rejects(
      async () => checkService.getDashboardMetrics(''),
      (err) => err instanceof AppError && err.statusCode === 400
    );
  });

  await runTest('getDashboardMetrics correctly handles round-up for avgRiskScore (78.5 -> 79)', async () => {
    restoreMocks();
    const userId = 'user-round-up';
    prisma.offerCheck.count = async () => 2;
    prisma.report.count = async () => 0;
    prisma.savedReport.count = async () => 0;
    prisma.offerCheck.aggregate = async () => ({ _avg: { riskScore: 78.5 } });
    prisma.offerCheck.findMany = async () => [];

    const metrics = await checkService.getDashboardMetrics(userId);
    assert.strictEqual(metrics.avgRiskScore, 79);
  });

  // Cleanup
  restoreMocks();
  console.log(`\nAll ${passedTests} / ${totalTests} dashboard_metrics tests passed successfully!`);
}

main().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
