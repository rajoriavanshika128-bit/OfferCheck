/**
 * test/dashboard_service.test.js
 * Unit tests for frontend checkService (src/services/checkService.js)
 * and dashboard metrics integration.
 */

import assert from 'assert';
import { api, ApiError, storage, TOKEN_KEY } from '../src/services/api.js';
import checkService from '../src/services/checkService.js';

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
  console.log('\n--- Frontend checkService & Dashboard Metrics Unit Tests ---\n');

  // =========================================================================
  // 1. Dashboard Metrics Retrieval
  // =========================================================================
  console.log('1. Dashboard Metrics Endpoint Integration:');

  await runTest('checkService.getDashboardMetrics calls GET /api/checks/dashboard and unwraps metrics', async () => {
    mockStorageMap.clear();
    storage.set(TOKEN_KEY, 'valid-student-jwt');

    const sampleMetrics = {
      totalChecks: 12,
      reportsSubmitted: 3,
      savedReports: 2,
      highRiskChecks: 4,
      avgRiskScore: 68,
      weeklyActivity: [
        { date: '2026-11-08', day: 'Sun', checks: 0 },
        { date: '2026-11-09', day: 'Mon', checks: 1 },
        { date: '2026-11-10', day: 'Tue', checks: 2 },
        { date: '2026-11-11', day: 'Wed', checks: 0 },
        { date: '2026-11-12', day: 'Thu', checks: 4 },
        { date: '2026-11-13', day: 'Fri', checks: 1 },
        { date: '2026-11-14', day: 'Sat', checks: 4 },
      ],
      recentChecks: [
        {
          id: 'c-001',
          companyName: 'Suspicious Tech Ltd',
          riskScore: 85,
          riskCategory: 'high',
          checkedAt: '2026-11-14T10:00:00.000Z',
        },
      ],
    };

    let requestedUrl = null;
    let authHeader = null;

    mockFetch(async (url, options) => {
      requestedUrl = url;
      authHeader = options.headers?.Authorization;
      return createJsonResponse({ success: true, metrics: sampleMetrics }, 200);
    });

    const metrics = await checkService.getDashboardMetrics();

    assert.ok(requestedUrl.includes('/api/checks/dashboard'));
    assert.strictEqual(authHeader, 'Bearer valid-student-jwt');
    assert.deepStrictEqual(metrics, sampleMetrics);
    assert.strictEqual(metrics.totalChecks, 12);
    assert.strictEqual(metrics.highRiskChecks, 4);
    assert.strictEqual(metrics.avgRiskScore, 68);
    assert.strictEqual(metrics.weeklyActivity.length, 7);
  });

  await runTest('checkService.getDashboardMetrics handles genuine zero-state for new students', async () => {
    mockStorageMap.clear();
    storage.set(TOKEN_KEY, 'new-student-jwt');

    const zeroStateMetrics = {
      totalChecks: 0,
      reportsSubmitted: 0,
      savedReports: 0,
      highRiskChecks: 0,
      avgRiskScore: null,
      weeklyActivity: [
        { date: '2026-11-08', day: 'Sun', checks: 0 },
        { date: '2026-11-09', day: 'Mon', checks: 0 },
        { date: '2026-11-10', day: 'Tue', checks: 0 },
        { date: '2026-11-11', day: 'Wed', checks: 0 },
        { date: '2026-11-12', day: 'Thu', checks: 0 },
        { date: '2026-11-13', day: 'Fri', checks: 0 },
        { date: '2026-11-14', day: 'Sat', checks: 0 },
      ],
      recentChecks: [],
    };

    mockFetch(async () => createJsonResponse({ success: true, metrics: zeroStateMetrics }, 200));

    const metrics = await checkService.getDashboardMetrics();

    assert.strictEqual(metrics.totalChecks, 0);
    assert.strictEqual(metrics.reportsSubmitted, 0);
    assert.strictEqual(metrics.savedReports, 0);
    assert.strictEqual(metrics.highRiskChecks, 0);
    assert.strictEqual(metrics.avgRiskScore, null);
    assert.strictEqual(metrics.recentChecks.length, 0);
    assert.strictEqual(metrics.weeklyActivity.reduce((sum, d) => sum + d.checks, 0), 0);
  });

  await runTest('checkService.getDashboardMetrics propagates ApiError on 401 unauthenticated', async () => {
    mockStorageMap.clear();

    mockFetch(async () => createJsonResponse({ success: false, error: 'Authentication required' }, 401));

    await assert.rejects(
      async () => checkService.getDashboardMetrics(),
      (err) => {
        assert.ok(err instanceof ApiError);
        assert.strictEqual(err.status, 401);
        assert.strictEqual(err.message, 'Authentication required');
        return true;
      }
    );
  });

  await runTest('checkService.getDashboardMetrics propagates ApiError on server error', async () => {
    mockStorageMap.clear();

    mockFetch(async () => createJsonResponse({ success: false, message: 'Internal server failure' }, 500));

    await assert.rejects(
      async () => checkService.getDashboardMetrics(),
      (err) => {
        assert.ok(err instanceof ApiError);
        assert.strictEqual(err.status, 500);
        assert.strictEqual(err.message, 'Internal server failure');
        return true;
      }
    );
  });

  // =========================================================================
  // 2. Offer Check Submission Integration
  // =========================================================================
  console.log('\n2. Offer Check Submission (checkOffer):');

  await runTest('checkService.checkOffer posts to /api/checks and returns sanitized check record', async () => {
    mockStorageMap.clear();
    storage.set(TOKEN_KEY, 'student-token');

    const fakeForm = {
      offerMessage: 'Congratulations! You have been selected for an internship.',
      recruiterName: 'John recruiter',
      companyName: 'Apex Infotech',
      domain: 'apex-hr.in',
      phone: '9876543210',
      email: 'hr@apex-hr.in',
      upiId: 'apex@okhdfc',
      paymentRequest: '₹1500 registration deposit',
      additionalNotes: 'Urgent response requested within 24 hours',
    };

    let requestedUrl = null;
    let requestMethod = null;
    let requestBody = null;

    mockFetch(async (url, options) => {
      requestedUrl = url;
      requestMethod = options.method;
      requestBody = JSON.parse(options.body);

      return createJsonResponse({
        success: true,
        check: {
          id: 'chk-abc-123',
          checkId: 'chk-abc-123',
          companyName: 'Apex Infotech',
          riskScore: 75,
          riskCategory: 'high',
          result: {
            score: 75,
            riskCategory: 'high',
            summary: 'High risk offer',
            factors: [{ description: 'Fee demand detected', weight: 20 }],
            matchedIdentifiers: [],
            connectedReports: [],
          },
        },
      }, 201);
    });

    const check = await checkService.checkOffer(fakeForm);

    assert.ok(requestedUrl.includes('/api/checks'));
    assert.strictEqual(requestMethod, 'POST');
    assert.strictEqual(requestBody.companyName, 'Apex Infotech');
    assert.strictEqual(requestBody.domain, 'apex-hr.in');
    assert.strictEqual(requestBody.phone, '9876543210');
    assert.strictEqual(requestBody.email, 'hr@apex-hr.in');
    assert.strictEqual(requestBody.upi, 'apex@okhdfc');
    assert.strictEqual(requestBody.paymentRequest, '₹1500 registration deposit');
    assert.ok(requestBody.offerMessage.includes('Congratulations!'));
    assert.ok(requestBody.offerMessage.includes('Recruiter: John recruiter'));
    assert.ok(requestBody.offerMessage.includes('Additional Notes: Urgent response requested within 24 hours'));
    // Strict schema compliance: forbidden keys must not be present
    assert.strictEqual(requestBody.recruiterName, undefined);
    assert.strictEqual(requestBody.additionalNotes, undefined);
    assert.strictEqual(check.id, 'chk-abc-123');
    assert.strictEqual(check.riskScore, 75);
  });

  await runTest('checkService.checkOffer propagates ApiError on 400 validation error', async () => {
    mockStorageMap.clear();

    mockFetch(async () => createJsonResponse({ success: false, error: 'Offer message cannot be empty' }, 400));

    await assert.rejects(
      async () => checkService.checkOffer({ offerMessage: '' }),
      (err) => {
        assert.ok(err instanceof ApiError);
        assert.strictEqual(err.status, 400);
        assert.strictEqual(err.message, 'Offer message cannot be empty');
        return true;
      }
    );
  });

  // =========================================================================
  // 3. Single Offer Check Retrieval Integration
  // =========================================================================
  console.log('\n3. Single Offer Check Retrieval (getCheckById):');

  await runTest('checkService.getCheckById fetches /api/checks/:id and returns check record', async () => {
    mockStorageMap.clear();
    storage.set(TOKEN_KEY, 'student-token');

    let requestedUrl = null;
    let authHeader = null;

    mockFetch(async (url, options) => {
      requestedUrl = url;
      authHeader = options.headers?.Authorization;

      return createJsonResponse({
        success: true,
        check: {
          id: 'chk-xyz-789',
          checkId: 'chk-xyz-789',
          companyName: 'Verified Corp',
          riskScore: 10,
          riskCategory: 'low',
          result: {
            score: 10,
            riskCategory: 'low',
            summary: 'Low risk detected',
            factors: [],
            matchedIdentifiers: [],
            connectedReports: [],
          },
        },
      }, 200);
    });

    const check = await checkService.getCheckById('chk-xyz-789');

    assert.ok(requestedUrl.includes('/api/checks/chk-xyz-789'));
    assert.strictEqual(authHeader, 'Bearer student-token');
    assert.strictEqual(check.id, 'chk-xyz-789');
    assert.strictEqual(check.riskScore, 10);
    assert.strictEqual(check.riskCategory, 'low');
  });

  await runTest('checkService.getCheckById propagates ApiError on 404 not found', async () => {
    mockStorageMap.clear();

    mockFetch(async () => createJsonResponse({ success: false, error: 'Offer check not found' }, 404));

    await assert.rejects(
      async () => checkService.getCheckById('non-existent-id'),
      (err) => {
        assert.ok(err instanceof ApiError);
        assert.strictEqual(err.status, 404);
        assert.strictEqual(err.message, 'Offer check not found');
        return true;
      }
    );
  });

  restoreFetch();
  console.log(`\nAll ${passedTests} / ${totalTests} checkService tests passed successfully!\n`);
}

main().catch((err) => {
  restoreFetch();
  console.error('\n[FATAL] Test failed:', err);
  process.exit(1);
});
