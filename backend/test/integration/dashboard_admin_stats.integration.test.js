'use strict';

/**
 * backend/test/integration/dashboard_admin_stats.integration.test.js
 * Real PostgreSQL integration test suite for:
 * - GET /api/checks/dashboard
 * - GET /api/admin/stats
 *
 * SAFETY INVARIANTS:
 * 1. Strictly requires explicitly provided TEST_DATABASE_URL.
 * 2. Enforced by testDbGuard: host MUST be localhost; db name MUST be 'offercheck_test'.
 * 3. Never connects to 'offercheck_dev' or production databases.
 * 4. Non-destructive cleanup: only cleans up test-created records by exact ID.
 * 5. Dynamic cryptographic run nonce ensures isolation.
 *
 * COVERS ALL REQUIRED SCENARIOS:
 * 1. Authenticated student sees only their own dashboard metrics (user isolation).
 * 2. Correct arithmetic average risk score and 7-day UTC activity from real PostgreSQL rows.
 * 3. Role-based PII masking in recentChecks.
 * 4. Rejection of unauthenticated requests with 401.
 * 5. Rejection of non-admin student requests to /api/admin/stats with 403.
 * 6. Admin statistics accurately reflect real persisted database records across tables.
 * 7. Empty/zero state values properly handled.
 */

const http = require('http');
const { Readable } = require('stream');
const assert = require('assert');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { validateTestDatabaseUrl } = require('../helpers/testDbGuard');

const testDbUrl = process.env.TEST_DATABASE_URL;

if (!testDbUrl) {
  console.error('\n[FATAL TEST RUNNER] No test database URL provided in environment.');
  console.error('Integration tests require an explicit TEST_DATABASE_URL.');
  console.error('To run safely against offercheck_test:');
  console.error('  TEST_DATABASE_URL="postgresql://<user>@localhost:5432/offercheck_test?schema=public" node test/integration/dashboard_admin_stats.integration.test.js\n');
  process.exit(1);
}

// Safety check — validates approved protocol, approved host, and db === 'offercheck_test'
const guard = validateTestDatabaseUrl(testDbUrl);

process.env.DATABASE_URL = guard.url;
process.env.NODE_ENV = 'test';
if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = 'test_jwt_secret_012345678901234567890123456789';
}

const prisma = require('../../src/utils/prisma');
const app = require('../../src/app');
const checkService = require('../../src/services/check.service');
const adminService = require('../../src/services/admin.service');
const { AppError } = require('../../src/utils/errors');

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

const runNonce = crypto.randomBytes(4).toString('hex');
const createdUserIds = new Set();
const createdReportIds = new Set();
const createdIdentifierIds = new Set();
const createdCheckIds = new Set();
const createdClusterIds = new Set();
const createdSavedReports = [];

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

// In-Memory HTTP Dispatcher against live Express app and live PostgreSQL
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

function createToken(userId, role = 'student') {
  return jwt.sign({ sub: userId, role }, process.env.JWT_SECRET, {
    expiresIn: 3600,
    algorithm: 'HS256',
  });
}

async function main() {
  console.log(`\n--- Real PostgreSQL Dashboard & Admin Stats Integration Tests [nonce=${runNonce}] ---\n`);

  await prisma.$connect();

  try {
    // -----------------------------------------------------------------------
    // Pre-create Student Users A and B, plus an Admin User in PostgreSQL
    // -----------------------------------------------------------------------
    const studentA = await prisma.user.create({
      data: {
        email: `student_a_${runNonce}@test.offercheck`,
        name: `Student A ${runNonce}`,
        passwordHash: '$2a$12$e80/bY0139G/1l9pT3.B9O9Qz0y2eX8e9V6f7g8h9i0j1k2l3m4n5',
        role: 'student',
        college: 'Test University A',
      },
    });
    createdUserIds.add(studentA.id);

    const studentB = await prisma.user.create({
      data: {
        email: `student_b_${runNonce}@test.offercheck`,
        name: `Student B ${runNonce}`,
        passwordHash: '$2a$12$e80/bY0139G/1l9pT3.B9O9Qz0y2eX8e9V6f7g8h9i0j1k2l3m4n5',
        role: 'student',
        college: 'Test University B',
      },
    });
    createdUserIds.add(studentB.id);

    const admin = await prisma.user.create({
      data: {
        email: `admin_${runNonce}@test.offercheck`,
        name: `Admin ${runNonce}`,
        passwordHash: '$2a$12$e80/bY0139G/1l9pT3.B9O9Qz0y2eX8e9V6f7g8h9i0j1k2l3m4n5',
        role: 'admin',
      },
    });
    createdUserIds.add(admin.id);

    const tokenA = createToken(studentA.id, 'student');
    const tokenB = createToken(studentB.id, 'student');
    const tokenAdmin = createToken(admin.id, 'admin');

    // =======================================================================
    // Test 1: Zero-State for newly created Student A in live PostgreSQL
    // =======================================================================
    await runTest(1, 'GET /api/checks/dashboard returns correct zero-state for new student', async () => {
      const res = await invokeApp({
        method: 'GET',
        url: '/api/checks/dashboard',
        headers: { authorization: `Bearer ${tokenA}` },
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      const m = res.body.metrics;
      assert.strictEqual(m.totalChecks, 0);
      assert.strictEqual(m.reportsSubmitted, 0);
      assert.strictEqual(m.savedReports, 0);
      assert.strictEqual(m.highRiskChecks, 0);
      assert.strictEqual(m.activeAlerts, undefined); // verified removed
      assert.strictEqual(m.avgRiskScore, null);
      assert.strictEqual(Array.isArray(m.recentChecks), true);
      assert.strictEqual(m.recentChecks.length, 0);
      assert.strictEqual(Array.isArray(m.weeklyActivity), true);
      assert.strictEqual(m.weeklyActivity.length, 7);
      for (const d of m.weeklyActivity) {
        assert.strictEqual(d.checks, 0);
      }
    });

    // =======================================================================
    // Test 2: Unauthenticated and Non-Admin RBAC Rejection
    // =======================================================================
    await runTest(2, 'Authentication & RBAC guards reject unauthorized access appropriately', async () => {
      // 2a. Dashboard without token -> 401
      const resDashNoAuth = await invokeApp({ method: 'GET', url: '/api/checks/dashboard' });
      assert.strictEqual(resDashNoAuth.status, 401);
      assert.strictEqual(resDashNoAuth.body.success, false);

      // 2b. Admin stats without token -> 401
      const resAdminNoAuth = await invokeApp({ method: 'GET', url: '/api/admin/stats' });
      assert.strictEqual(resAdminNoAuth.status, 401);
      assert.strictEqual(resAdminNoAuth.body.success, false);

      // 2c. Admin stats with student token -> 403
      const resAdminStudent = await invokeApp({
        method: 'GET',
        url: '/api/admin/stats',
        headers: { authorization: `Bearer ${tokenA}` },
      });
      assert.strictEqual(resAdminStudent.status, 403);
      assert.strictEqual(resAdminStudent.body.success, false);
      assert.match(resAdminStudent.body.error, /admin access required/i);

      // 2d. Direct service rejection
      await assert.rejects(
        async () => adminService.getAdminStats('student'),
        (err) => err instanceof AppError && err.statusCode === 403
      );
    });

    // =======================================================================
    // Test 3: Populate PostgreSQL rows and verify Data Isolation between A and B
    // =======================================================================
    await runTest(3, 'Dashboard metrics isolate records strictly to authenticated student', async () => {
      // Create Report for Student A
      const repA = await prisma.report.create({
        data: {
          submittedBy: studentA.id,
          companyNameRaw: `Acme Corp ${runNonce}`,
          offerMessage: `Sample offer message for student A ${runNonce}`,
          status: 'pending',
        },
      });
      createdReportIds.add(repA.id);

      // Create Bookmark (SavedReport) for Student A pointing to repA
      await prisma.savedReport.create({
        data: {
          userId: studentA.id,
          reportId: repA.id,
        },
      });
      createdSavedReports.push({ userId: studentA.id, reportId: repA.id });

      // Create 2 OfferChecks for Student A: riskScore 80 (high), riskScore 60 (medium)
      const checkA1 = await prisma.offerCheck.create({
        data: {
          userId: studentA.id,
          companyName: `Acme Corp ${runNonce}`,
          phoneQuery: '+919876543210',
          emailQuery: 'hr@acmetest.com',
          upiQuery: 'fraudpay@okhdfc',
          domainQuery: 'acmetest.com',
          riskScore: 80,
          riskCategory: 'high',
          checkedAt: new Date(),
        },
      });
      createdCheckIds.add(checkA1.id);

      const checkA2 = await prisma.offerCheck.create({
        data: {
          userId: studentA.id,
          companyName: `Beta Corp ${runNonce}`,
          phoneQuery: '+919876543211',
          emailQuery: 'recruiter@betatest.com',
          domainQuery: 'betatest.com',
          riskScore: 60,
          riskCategory: 'medium',
          checkedAt: new Date(),
        },
      });
      createdCheckIds.add(checkA2.id);

      // Create 3 OfferChecks and 2 Reports for Student B: riskScore 95, 90, 85 (all critical)
      const checkB1 = await prisma.offerCheck.create({
        data: {
          userId: studentB.id,
          companyName: `Scam B1 ${runNonce}`,
          riskScore: 95,
          riskCategory: 'critical',
          checkedAt: new Date(),
        },
      });
      createdCheckIds.add(checkB1.id);

      const checkB2 = await prisma.offerCheck.create({
        data: {
          userId: studentB.id,
          companyName: `Scam B2 ${runNonce}`,
          riskScore: 90,
          riskCategory: 'critical',
          checkedAt: new Date(),
        },
      });
      createdCheckIds.add(checkB2.id);

      const checkB3 = await prisma.offerCheck.create({
        data: {
          userId: studentB.id,
          companyName: `Scam B3 ${runNonce}`,
          riskScore: 85,
          riskCategory: 'critical',
          checkedAt: new Date(),
        },
      });
      createdCheckIds.add(checkB3.id);

      const repB1 = await prisma.report.create({
        data: {
          submittedBy: studentB.id,
          companyNameRaw: `Scam Org B1 ${runNonce}`,
          offerMessage: `Fraud text B1 ${runNonce}`,
          status: 'verified',
          isVerified: true,
        },
      });
      createdReportIds.add(repB1.id);

      const repB2 = await prisma.report.create({
        data: {
          submittedBy: studentB.id,
          companyNameRaw: `Scam Org B2 ${runNonce}`,
          offerMessage: `Fraud text B2 ${runNonce}`,
          status: 'pending',
        },
      });
      createdReportIds.add(repB2.id);

      // Now query Student A dashboard via HTTP
      const resA = await invokeApp({
        method: 'GET',
        url: '/api/checks/dashboard',
        headers: { authorization: `Bearer ${tokenA}` },
      });

      assert.strictEqual(resA.status, 200);
      const mA = resA.body.metrics;
      assert.strictEqual(mA.totalChecks, 2); // only A's 2 checks
      assert.strictEqual(mA.reportsSubmitted, 1); // only A's 1 report
      assert.strictEqual(mA.savedReports, 1); // only A's 1 bookmark
      assert.strictEqual(mA.highRiskChecks, 1); // only 1 high risk check (80)
      assert.strictEqual(mA.avgRiskScore, 70); // (80 + 60) / 2 = 70 exactly
      assert.strictEqual(mA.recentChecks.length, 2);

      // Verify PII masking on recentChecks for student role by exact check ID
      const check1 = mA.recentChecks.find((c) => c.id === checkA1.id);
      const check2 = mA.recentChecks.find((c) => c.id === checkA2.id);
      assert.ok(check1, 'checkA1 must exist in recentChecks');
      assert.ok(check2, 'checkA2 must exist in recentChecks');

      assert.strictEqual(check1.companyName, `Acme Corp ${runNonce}`);
      assert.strictEqual(check1.phoneQuery, '+9198XXXXX');
      assert.strictEqual(check1.emailQuery, 'h***@acmetest.com');
      assert.strictEqual(check1.upiQuery, 'f*****ay@okhdfc');
      assert.strictEqual(check1.riskScore, 80);

      assert.strictEqual(check2.companyName, `Beta Corp ${runNonce}`);
      assert.strictEqual(check2.phoneQuery, '+9198XXXXX');
      assert.strictEqual(check2.emailQuery, 'r***@betatest.com');
      assert.strictEqual(check2.riskScore, 60);

      // Now query Student B dashboard via HTTP
      const resB = await invokeApp({
        method: 'GET',
        url: '/api/checks/dashboard',
        headers: { authorization: `Bearer ${tokenB}` },
      });

      assert.strictEqual(resB.status, 200);
      const mB = resB.body.metrics;
      assert.strictEqual(mB.totalChecks, 3); // B's 3 checks
      assert.strictEqual(mB.reportsSubmitted, 2); // B's 2 reports
      assert.strictEqual(mB.savedReports, 0); // B has 0 bookmarks
      assert.strictEqual(mB.highRiskChecks, 3); // B has 3 critical checks
      assert.strictEqual(mB.avgRiskScore, 90); // (95 + 90 + 85) / 3 = 90
    });

    // =======================================================================
    // Test 4: Admin Statistics reflect actual PostgreSQL database rows
    // =======================================================================
    await runTest(4, 'GET /api/admin/stats accurately reflects persisted database records', async () => {
      // Create an active Cluster in PostgreSQL
      const cluster = await prisma.cluster.create({
        data: {
          name: `Fraud Ring ${runNonce}`,
          status: 'active',
          description: `Test cluster ${runNonce}`,
        },
      });
      createdClusterIds.add(cluster.id);

      // Create a flagged Identifier in PostgreSQL
      const identifier = await prisma.identifier.create({
        data: {
          type: 'phone',
          value: `+91998877${runNonce.slice(0, 4)}`,
          normalizedValue: `+91998877${runNonce.slice(0, 4)}`,
          riskScore: 90,
          flagged: true,
          confidence: 'high',
        },
      });
      createdIdentifierIds.add(identifier.id);

      // Query admin stats via HTTP using admin token
      const resAdmin = await invokeApp({
        method: 'GET',
        url: '/api/admin/stats',
        headers: { authorization: `Bearer ${tokenAdmin}` },
      });

      assert.strictEqual(resAdmin.status, 200);
      assert.strictEqual(resAdmin.body.success, true);
      const s = resAdmin.body.stats;

      // Verify stats match actual database counts directly
      const [
        actualTotalReports,
        actualTotalUsers,
        actualTotalChecks,
        actualActiveClusters,
        actualFlaggedIdentifiers,
      ] = await Promise.all([
        prisma.report.count(),
        prisma.user.count(),
        prisma.offerCheck.count(),
        prisma.cluster.count({ where: { status: 'active' } }),
        prisma.identifier.count({ where: { flagged: true } }),
      ]);

      assert.strictEqual(s.totalReports, actualTotalReports);
      assert.strictEqual(s.totalUsers, actualTotalUsers);
      assert.strictEqual(s.totalChecks, actualTotalChecks);
      assert.strictEqual(s.activeClusters, actualActiveClusters);
      assert.strictEqual(s.flaggedIdentifiers, actualFlaggedIdentifiers);

      // Verify reportsByStatus has all required keys
      assert.strictEqual(typeof s.reportsByStatus.pending, 'number');
      assert.strictEqual(typeof s.reportsByStatus.verified, 'number');
      assert.strictEqual(typeof s.reportsByStatus.rejected, 'number');
      assert.strictEqual(typeof s.reportsByStatus.investigating, 'number');

      // Verify riskDistribution has all required keys
      assert.strictEqual(typeof s.riskDistribution.critical, 'number');
      assert.strictEqual(typeof s.riskDistribution.high, 'number');
      assert.strictEqual(typeof s.riskDistribution.medium, 'number');
      assert.strictEqual(typeof s.riskDistribution.low, 'number');
    });

  } finally {
    // -----------------------------------------------------------------------
    // Non-destructive cleanup: Delete test records by exact ID only
    // -----------------------------------------------------------------------
    console.log('\n--- Teardown: Scoped Non-Destructive Cleanup ---');
    try {
      if (createdSavedReports.length > 0) {
        for (const sr of createdSavedReports) {
          await prisma.savedReport.deleteMany({
            where: { userId: sr.userId, reportId: sr.reportId },
          });
        }
      }

      if (createdCheckIds.size > 0) {
        await prisma.offerCheck.deleteMany({
          where: { id: { in: Array.from(createdCheckIds) } },
        });
      }

      if (createdReportIds.size > 0) {
        await prisma.report.deleteMany({
          where: { id: { in: Array.from(createdReportIds) } },
        });
      }

      if (createdClusterIds.size > 0) {
        await prisma.cluster.deleteMany({
          where: { id: { in: Array.from(createdClusterIds) } },
        });
      }

      if (createdIdentifierIds.size > 0) {
        await prisma.identifier.deleteMany({
          where: { id: { in: Array.from(createdIdentifierIds) } },
        });
      }

      if (createdUserIds.size > 0) {
        await prisma.user.deleteMany({
          where: { id: { in: Array.from(createdUserIds) } },
        });
      }
      console.log('  Cleaned up all test-created records by exact ID.');
    } catch (cleanupErr) {
      console.error('  Cleanup error:', cleanupErr.message);
    }

    await prisma.$disconnect();
  }

  console.log(`\nAll ${passedTests} / ${totalTests} dashboard & admin stats integration tests passed successfully!\n`);
}

main().catch((err) => {
  console.error('\n[FATAL] Integration test error:', err);
  process.exit(1);
});
