/**
 * test/admin_service.test.js
 * Unit tests for frontend adminService (src/services/adminService.js)
 * and Admin Dashboard integration.
 */

import assert from 'assert';
import { api, ApiError, storage, TOKEN_KEY } from '../src/services/api.js';
import adminService from '../src/services/adminService.js';

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

// In-memory localStorage mock for Node test environment
const mockStorageMap = new Map();
globalThis.localStorage = {
  getItem: (key) => mockStorageMap.get(key) || null,
  setItem: (key, val) => mockStorageMap.set(key, String(val)),
  removeItem: (key) => mockStorageMap.delete(key),
  clear: () => mockStorageMap.clear(),
};

// Global fetch mock helper
let originalFetch = globalThis.fetch;

function mockFetch(handler) {
  globalThis.fetch = async (url, options = {}) => {
    return handler(String(url), options);
  };
}

function restoreFetch() {
  globalThis.fetch = originalFetch;
}

function createJsonResponse(data, status = 200) {
  const bodyText = JSON.stringify(data);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (header) => (header.toLowerCase() === 'content-type' ? 'application/json' : null),
    },
    json: async () => data,
    text: async () => bodyText,
  };
}

async function main() {
  console.log('\n--- Frontend adminService Unit Tests ---\n');

  storage.set(TOKEN_KEY, 'valid-admin-jwt');

  // =========================================================================
  // 1. Admin Stats Retrieval & Normalization
  // =========================================================================
  console.log('1. Admin Stats:');

  await runTest('getAdminStats normalizes nested stats into flat UI properties', async () => {
    mockFetch((url) => {
      assert.ok(url.endsWith('/api/admin/stats'));
      return createJsonResponse({
        success: true,
        stats: {
          totalReports: 15,
          reportsByStatus: { pending: 6, verified: 5, rejected: 3, investigating: 1 },
          riskDistribution: { critical: 4, high: 5, medium: 4, low: 2 },
          totalIdentifiers: 30,
          flaggedIdentifiers: 8,
          activeClusters: 4,
          totalUsers: 25,
          totalChecks: 40,
        },
      });
    });

    const stats = await adminService.getAdminStats();
    assert.strictEqual(stats.totalReports, 15);
    assert.strictEqual(stats.pendingReports, 6);
    assert.strictEqual(stats.verifiedReports, 5);
    assert.strictEqual(stats.rejectedReports, 3);
    assert.strictEqual(stats.investigatingReports, 1);
    assert.strictEqual(stats.criticalReports, 4);
    assert.strictEqual(stats.highReports, 5);
    assert.strictEqual(stats.totalIdentifiers, 30);
    assert.strictEqual(stats.flaggedIdentifiers, 8);
    assert.strictEqual(stats.activeClusters, 4);
    restoreFetch();
  });

  await runTest('getAdminStats propagates ApiError on 403 Forbidden', async () => {
    mockFetch(() => createJsonResponse({ error: 'Admin access required' }, 403));

    await assert.rejects(
      async () => adminService.getAdminStats(),
      (err) => err instanceof ApiError && err.status === 403
    );
    restoreFetch();
  });

  // =========================================================================
  // 2. Report Moderation (getAdminReports & updateReportStatus)
  // =========================================================================
  console.log('\n2. Report Moderation:');

  await runTest('getAdminReports serializes query params and normalizes report fields', async () => {
    let capturedUrl = null;
    mockFetch((url) => {
      capturedUrl = url;
      return createJsonResponse({
        success: true,
        reports: [
          {
            id: 'rep-001',
            companyNameRaw: 'Acme Scam Corp',
            status: 'pending',
            riskAssessments: [{ score: 88, category: 'critical' }],
          },
        ],
        pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
      });
    });

    const res = await adminService.getAdminReports({ status: 'pending', search: 'Acme' });
    assert.ok(capturedUrl.includes('status=pending'));
    assert.ok(capturedUrl.includes('search=Acme'));
    assert.strictEqual(res.reports.length, 1);
    assert.strictEqual(res.reports[0].companyName, 'Acme Scam Corp');
    assert.strictEqual(res.reports[0].riskScore, 88);
    assert.strictEqual(res.reports[0].riskCategory, 'critical');
    restoreFetch();
  });

  await runTest('updateReportStatus sends PATCH with status and review notes', async () => {
    let capturedMethod = null;
    let capturedBody = null;
    let capturedUrl = null;

    mockFetch((url, opts) => {
      capturedUrl = url;
      capturedMethod = opts.method;
      capturedBody = JSON.parse(opts.body);
      return createJsonResponse({
        success: true,
        report: { id: 'rep-001', status: 'verified' },
      });
    });

    const res = await adminService.updateReportStatus('rep-001', 'verified', 'Confirmed fake UPI handle');
    assert.ok(capturedUrl.endsWith('/api/admin/reports/rep-001'));
    assert.strictEqual(capturedMethod, 'PATCH');
    assert.strictEqual(capturedBody.status, 'verified');
    assert.strictEqual(capturedBody.notes, 'Confirmed fake UPI handle');
    assert.strictEqual(res.success, true);
    restoreFetch();
  });

  await runTest('updateReportStatus propagates 409 Conflict when report is already modified', async () => {
    mockFetch(() =>
      createJsonResponse(
        { error: 'Report was modified by another administrator or is no longer in expected status' },
        409
      )
    );

    await assert.rejects(
      async () => adminService.updateReportStatus('rep-001', 'verified'),
      (err) => err instanceof ApiError && err.status === 409
    );
    restoreFetch();
  });

  // =========================================================================
  // 3. Identifier Intelligence (getAdminIdentifiers)
  // =========================================================================
  console.log('\n3. Identifiers:');

  await runTest('getAdminIdentifiers constructs query string and returns identifier list', async () => {
    let capturedUrl = null;
    mockFetch((url) => {
      capturedUrl = url;
      return createJsonResponse({
        success: true,
        identifiers: [
          {
            id: 'id-001',
            type: 'upi',
            value: 'fraud@upi',
            riskScore: 90,
            flagged: true,
            reportCount: 4,
          },
        ],
        pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
      });
    });

    const res = await adminService.getAdminIdentifiers({ type: 'upi', flagged: 'true', search: 'fraud' });
    assert.ok(capturedUrl.includes('type=upi'));
    assert.ok(capturedUrl.includes('flagged=true'));
    assert.ok(capturedUrl.includes('search=fraud'));
    assert.strictEqual(res.identifiers.length, 1);
    assert.strictEqual(res.identifiers[0].value, 'fraud@upi');
    assert.strictEqual(res.identifiers[0].reportCount, 4);
    restoreFetch();
  });

  // =========================================================================
  // 4. Fraud Clusters (getAdminClusters)
  // =========================================================================
  console.log('\n4. Clusters:');

  await runTest('getAdminClusters calls /api/admin/clusters and returns array', async () => {
    mockFetch((url) => {
      assert.ok(url.endsWith('/api/admin/clusters'));
      return createJsonResponse({
        success: true,
        clusters: [
          {
            id: 'cl-001',
            name: 'Campus Telegram Scam',
            totalReports: 3,
            riskScore: 82,
            reportIds: ['r1', 'r2', 'r3'],
          },
        ],
      });
    });

    const clusters = await adminService.getAdminClusters();
    assert.strictEqual(clusters.length, 1);
    assert.strictEqual(clusters[0].name, 'Campus Telegram Scam');
    assert.strictEqual(clusters[0].riskScore, 82);
    restoreFetch();
  });

  // =========================================================================
  // 5. Audit Trail (getAdminAuditLogs)
  // =========================================================================
  console.log('\n5. Audit Logs:');

  await runTest('getAdminAuditLogs filters by action and unwraps log entries', async () => {
    let capturedUrl = null;
    mockFetch((url) => {
      capturedUrl = url;
      return createJsonResponse({
        success: true,
        logs: [
          {
            id: 'al-001',
            action: 'STATUS_CHANGED',
            reportId: 'rep-001',
            userName: 'Admin User',
            oldStatus: 'pending',
            newStatus: 'verified',
            notes: 'Approved',
            timestamp: '2026-11-14T10:00:00Z',
          },
        ],
        pagination: { page: 1, limit: 50, total: 1, totalPages: 1 },
      });
    });

    const res = await adminService.getAdminAuditLogs({ action: 'STATUS_CHANGED' });
    assert.ok(capturedUrl.includes('action=STATUS_CHANGED'));
    assert.strictEqual(res.logs.length, 1);
    assert.strictEqual(res.logs[0].userName, 'Admin User');
    assert.strictEqual(res.logs[0].oldStatus, 'pending');
    assert.strictEqual(res.logs[0].newStatus, 'verified');
    restoreFetch();
  });

  console.log(`\nAll ${passedTests} / ${totalTests} adminService tests passed successfully!\n`);
}

main().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
