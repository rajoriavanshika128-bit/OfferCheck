'use strict';

/**
 * backend/test/admin_dashboard.test.js
 * Comprehensive unit and route integration tests for Admin Dashboard endpoints:
 * - GET /api/admin/identifiers
 * - GET /api/admin/clusters
 * - GET /api/admin/audit-logs
 * - GET /api/admin/reports?status=all
 *
 * SAFETY INVARIANTS:
 * - ZERO database connections: mock dispatch via invokeApp & Prisma mocking.
 * - ZERO network/TCP sockets.
 * - ZERO .env modifications.
 */

process.env.DATABASE_URL = 'postgresql://mock:mock@localhost:5432/mock_test';
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'http_admin_dashboard_test_jwt_secret_01234567890123456789';

const http = require('http');
const { Readable } = require('stream');
const assert = require('assert');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const prisma = require('../src/utils/prisma');
const adminService = require('../src/services/admin.service');
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

function invokeApp({ method = 'GET', url = '/api/admin/identifiers', headers = {}, body = null }) {
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
          headers: res.getHeaders(),
          body: parsed,
        });
      };

      app(req, res);
    } catch (err) {
      reject(err);
    }
  });
}

function makeToken({ sub = 'adm-001', role = 'admin' } = {}) {
  return jwt.sign(
    { sub, role },
    process.env.JWT_SECRET,
    { expiresIn: '1h', algorithm: 'HS256' }
  );
}

// ─── Test Suite ─────────────────────────────────────────────────────────────

async function main() {
  console.log('\n--- Admin Dashboard Backend Service & HTTP Tests ---\n');

  // Save original prisma methods
  const originalUserFindUnique = prisma.user.findUnique;
  const originalIdentifierCount = prisma.identifier.count;
  const originalIdentifierFindMany = prisma.identifier.findMany;
  const originalClusterFindMany = prisma.cluster.findMany;
  const originalAuditLogCount = prisma.auditLog.count;
  const originalAuditLogFindMany = prisma.auditLog.findMany;
  const originalReportCount = prisma.report.count;
  const originalReportFindMany = prisma.report.findMany;

  function setupUserLookup() {
    prisma.user.findUnique = async ({ where }) => {
      if (where.id === 'adm-001') {
        return { id: 'adm-001', role: 'admin', isBanned: false };
      }
      if (where.id === 'stu-001') {
        return { id: 'stu-001', role: 'student', isBanned: false };
      }
      return null;
    };
  }

  function restorePrisma() {
    setupUserLookup();
    prisma.identifier.count = originalIdentifierCount;
    prisma.identifier.findMany = originalIdentifierFindMany;
    prisma.cluster.findMany = originalClusterFindMany;
    prisma.auditLog.count = originalAuditLogCount;
    prisma.auditLog.findMany = originalAuditLogFindMany;
    prisma.report.count = originalReportCount;
    prisma.report.findMany = originalReportFindMany;
  }

  setupUserLookup();

  const adminToken = makeToken({ sub: 'adm-001', role: 'admin' });
  const studentToken = makeToken({ sub: 'stu-001', role: 'student' });

  // =========================================================================
  // 1. Authentication & RBAC Route Protection
  // =========================================================================
  console.log('1. Authentication & RBAC Route Protection:');

  await runTest('GET /api/admin/identifiers without auth returns 401', async () => {
    const res = await invokeApp({ method: 'GET', url: '/api/admin/identifiers' });
    assert.strictEqual(res.status, 401);
  });

  await runTest('GET /api/admin/identifiers with student token returns 403', async () => {
    const res = await invokeApp({
      method: 'GET',
      url: '/api/admin/identifiers',
      headers: { authorization: `Bearer ${studentToken}` },
    });
    assert.strictEqual(res.status, 403);
  });

  await runTest('GET /api/admin/clusters without auth returns 401', async () => {
    const res = await invokeApp({ method: 'GET', url: '/api/admin/clusters' });
    assert.strictEqual(res.status, 401);
  });

  await runTest('GET /api/admin/clusters with student token returns 403', async () => {
    const res = await invokeApp({
      method: 'GET',
      url: '/api/admin/clusters',
      headers: { authorization: `Bearer ${studentToken}` },
    });
    assert.strictEqual(res.status, 403);
  });

  await runTest('GET /api/admin/audit-logs without auth returns 401', async () => {
    const res = await invokeApp({ method: 'GET', url: '/api/admin/audit-logs' });
    assert.strictEqual(res.status, 401);
  });

  await runTest('GET /api/admin/audit-logs with student token returns 403', async () => {
    const res = await invokeApp({
      method: 'GET',
      url: '/api/admin/audit-logs',
      headers: { authorization: `Bearer ${studentToken}` },
    });
    assert.strictEqual(res.status, 403);
  });

  // =========================================================================
  // 2. Identifiers Endpoint & Service Logic
  // =========================================================================
  console.log('\n2. Identifiers Endpoint & Service Logic:');

  await runTest('adminService.getIdentifiers rejects non-admin caller with 403', async () => {
    await assert.rejects(
      async () => adminService.getIdentifiers({}, 'student'),
      (err) => err instanceof AppError && err.statusCode === 403
    );
  });

  await runTest('GET /api/admin/identifiers returns unmasked identifiers and pagination', async () => {
    prisma.identifier.count = async () => 1;
    prisma.identifier.findMany = async () => [
      {
        id: 'id-001',
        type: 'phone',
        value: '+919876543210',
        normalizedValue: '+919876543210',
        riskScore: 85,
        flagged: true,
        confidence: 'high',
        notes: null,
        firstSeen: new Date('2026-11-01T00:00:00Z'),
        lastSeen: new Date('2026-11-14T00:00:00Z'),
        _count: { reports: 3 },
      },
    ];

    const res = await invokeApp({
      method: 'GET',
      url: '/api/admin/identifiers',
      headers: { authorization: `Bearer ${adminToken}` },
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.identifiers.length, 1);
    assert.strictEqual(res.body.identifiers[0].value, '+919876543210');
    assert.strictEqual(res.body.identifiers[0].reportCount, 3);
    assert.strictEqual(res.body.identifiers[0].flagged, true);
    assert.strictEqual(res.body.pagination.total, 1);
    restorePrisma();
  });

  await runTest('GET /api/admin/identifiers filters by type and flagged status correctly', async () => {
    let capturedWhere = null;
    prisma.identifier.count = async ({ where }) => {
      capturedWhere = where;
      return 1;
    };
    prisma.identifier.findMany = async () => [];

    const res = await invokeApp({
      method: 'GET',
      url: '/api/admin/identifiers?type=upi&flagged=true',
      headers: { authorization: `Bearer ${adminToken}` },
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(capturedWhere.type, 'upi');
    assert.strictEqual(capturedWhere.flagged, true);
    restorePrisma();
  });

  // =========================================================================
  // 3. Clusters Endpoint & Service Logic
  // =========================================================================
  console.log('\n3. Clusters Endpoint & Service Logic:');

  await runTest('adminService.getClusters rejects non-admin caller with 403', async () => {
    await assert.rejects(
      async () => adminService.getClusters('student'),
      (err) => err instanceof AppError && err.statusCode === 403
    );
  });

  await runTest('GET /api/admin/clusters aggregates linked reports and computes riskScore', async () => {
    prisma.cluster.findMany = async () => [
      {
        id: 'cl-001',
        name: 'Telegram Part-time Scam Ring',
        description: 'Network of fraudulent hiring managers',
        confidence: 'high',
        status: 'active',
        connectionBasis: 'Shared UPI ID and recruiter phone number',
        discoveredAt: new Date('2026-11-10T12:00:00Z'),
        updatedAt: new Date('2026-11-14T12:00:00Z'),
        reports: [
          {
            report: {
              id: 'rep-001',
              status: 'verified',
              companyNameRaw: 'Fake Corp',
              riskAssessments: [{ score: 80 }],
              identifiers: [{ identifierId: 'ident-01' }, { identifierId: 'ident-02' }],
            },
          },
          {
            report: {
              id: 'rep-002',
              status: 'verified',
              companyNameRaw: 'Fake Corp 2',
              riskAssessments: [{ score: 90 }],
              identifiers: [{ identifierId: 'ident-02' }, { identifierId: 'ident-03' }],
            },
          },
        ],
      },
    ];

    const res = await invokeApp({
      method: 'GET',
      url: '/api/admin/clusters',
      headers: { authorization: `Bearer ${adminToken}` },
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.clusters.length, 1);
    const cluster = res.body.clusters[0];
    assert.strictEqual(cluster.name, 'Telegram Part-time Scam Ring');
    assert.strictEqual(cluster.totalReports, 2);
    assert.strictEqual(cluster.riskScore, 85); // Math.round((80 + 90) / 2)
    assert.deepStrictEqual(cluster.reportIds, ['rep-001', 'rep-002']);
    assert.strictEqual(cluster.identifierIds.length, 3); // ident-01, ident-02, ident-03 deduplicated
    restorePrisma();
  });

  // =========================================================================
  // 4. Audit Logs Endpoint & Service Logic
  // =========================================================================
  console.log('\n4. Audit Logs Endpoint & Service Logic:');

  await runTest('adminService.getAuditLogs rejects non-admin caller with 403', async () => {
    await assert.rejects(
      async () => adminService.getAuditLogs({}, 'student'),
      (err) => err instanceof AppError && err.statusCode === 403
    );
  });

  await runTest('GET /api/admin/audit-logs returns formatted audit log entries', async () => {
    prisma.auditLog.count = async () => 1;
    prisma.auditLog.findMany = async () => [
      {
        id: 'al-001',
        action: 'STATUS_CHANGED',
        reportId: 'rep-001',
        identifierId: null,
        clusterId: null,
        targetUserId: null,
        actorId: 'adm-001',
        oldValue: 'pending',
        newValue: 'verified',
        notes: 'Verified against recruiter domain',
        createdAt: new Date('2026-11-14T15:00:00Z'),
        actor: {
          id: 'adm-001',
          name: 'Chief Moderator',
          role: 'admin',
        },
      },
    ];

    const res = await invokeApp({
      method: 'GET',
      url: '/api/admin/audit-logs',
      headers: { authorization: `Bearer ${adminToken}` },
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.logs.length, 1);
    const log = res.body.logs[0];
    assert.strictEqual(log.action, 'STATUS_CHANGED');
    assert.strictEqual(log.userName, 'Chief Moderator');
    assert.strictEqual(log.oldStatus, 'pending');
    assert.strictEqual(log.newStatus, 'verified');
    restorePrisma();
  });

  await runTest('GET /api/admin/audit-logs filters by action correctly', async () => {
    let capturedWhere = null;
    prisma.auditLog.count = async ({ where }) => {
      capturedWhere = where;
      return 1;
    };
    prisma.auditLog.findMany = async () => [];

    const res = await invokeApp({
      method: 'GET',
      url: '/api/admin/audit-logs?action=STATUS_CHANGED',
      headers: { authorization: `Bearer ${adminToken}` },
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(capturedWhere.action, 'STATUS_CHANGED');
    restorePrisma();
  });

  // =========================================================================
  // 5. Report Moderation Status 'all' Filtering
  // =========================================================================
  console.log('\n5. Report Moderation Status "all" Filtering:');

  await runTest('GET /api/admin/reports?status=all leaves where.status unrestricted', async () => {
    let capturedWhere = null;
    prisma.report.count = async ({ where }) => {
      capturedWhere = where;
      return 5;
    };
    prisma.report.findMany = async () => [];

    const res = await invokeApp({
      method: 'GET',
      url: '/api/admin/reports?status=all',
      headers: { authorization: `Bearer ${adminToken}` },
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(capturedWhere.status, undefined); // Unrestricted
    restorePrisma();
  });

  await runTest('GET /api/admin/reports without status still defaults to status = pending', async () => {
    let capturedWhere = null;
    prisma.report.count = async ({ where }) => {
      capturedWhere = where;
      return 2;
    };
    prisma.report.findMany = async () => [];

    const res = await invokeApp({
      method: 'GET',
      url: '/api/admin/reports',
      headers: { authorization: `Bearer ${adminToken}` },
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(capturedWhere.status, 'pending');
    restorePrisma();
  });

  console.log(`\nAll ${passedTests} / ${totalTests} Admin Dashboard tests passed successfully!\n`);
}

main().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
