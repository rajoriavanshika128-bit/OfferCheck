/**
 * test/report_service.test.js
 * Unit tests for frontend reportService (src/services/reportService.js)
 * and report discovery / submission / bookmarking integration.
 */

import assert from 'assert';
import { api, ApiError, storage, TOKEN_KEY } from '../src/services/api.js';
import reportService from '../src/services/reportService.js';

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

async function runAllTests() {
  console.log('\n--- Frontend reportService Unit Tests ---');

  // Test 1: getReports builds query string correctly and returns reports list
  await runTest('getReports constructs URLSearchParams and returns report list with pagination', async () => {
    let capturedUrl = null;
    let capturedHeaders = null;

    mockFetch(async (url, opts) => {
      capturedUrl = url;
      capturedHeaders = opts.headers || {};
      return createJsonResponse({
        success: true,
        reports: [
          {
            id: 'rep-001',
            companyNameRaw: 'FakeCorp',
            status: 'verified',
            riskAssessments: [{ score: 85, category: 'critical' }],
          },
        ],
        pagination: {
          page: 2,
          limit: 10,
          total: 25,
          totalPages: 3,
        },
      });
    });

    const result = await reportService.getReports({
      page: 2,
      limit: 10,
      search: 'FakeCorp',
      sortBy: 'submittedAt',
      sortOrder: 'desc',
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.reports.length, 1);
    assert.strictEqual(result.reports[0].id, 'rep-001');
    assert.strictEqual(result.pagination.total, 25);
    assert.ok(capturedUrl.includes('/api/reports?'));
    assert.ok(capturedUrl.includes('page=2'));
    assert.ok(capturedUrl.includes('limit=10'));
    assert.ok(capturedUrl.includes('search=FakeCorp'));
    assert.ok(capturedUrl.includes('sortBy=submittedAt'));
    assert.ok(capturedUrl.includes('sortOrder=desc'));
  });

  // Test 2: getReportById unwraps res.report
  await runTest('getReportById calls GET /api/reports/:id and unwraps report record', async () => {
    let capturedUrl = null;

    mockFetch(async (url) => {
      capturedUrl = url;
      return createJsonResponse({
        success: true,
        report: {
          id: 'rep-uuid-1234',
          companyNameRaw: 'Telegram Scammers LLC',
          offerMessage: 'Pay 500 for training material',
          status: 'verified',
          isSaved: true,
          riskAssessments: [
            {
              score: 90,
              category: 'critical',
              factors: [{ description: 'Payment request before hiring', weight: 35, confidence: 'high' }],
            },
          ],
        },
      });
    });

    const report = await reportService.getReportById('rep-uuid-1234');
    assert.strictEqual(report.id, 'rep-uuid-1234');
    assert.strictEqual(report.companyNameRaw, 'Telegram Scammers LLC');
    assert.strictEqual(report.isSaved, true);
    assert.strictEqual(report.riskAssessments[0].score, 90);
    assert.ok(capturedUrl.endsWith('/api/reports/rep-uuid-1234'));
  });

  // Test 3: getRelatedReports unwraps relatedReports array
  await runTest('getRelatedReports calls GET /api/reports/:id/related and returns array', async () => {
    let capturedUrl = null;

    mockFetch(async (url) => {
      capturedUrl = url;
      return createJsonResponse({
        success: true,
        sourceReportId: 'rep-uuid-1234',
        relatedReports: [
          {
            id: 'rep-uuid-5678',
            companyName: 'Suspicious Corp',
            currentRisk: { score: 75, category: 'high' },
          },
        ],
      });
    });

    const related = await reportService.getRelatedReports('rep-uuid-1234');
    assert.strictEqual(Array.isArray(related), true);
    assert.strictEqual(related.length, 1);
    assert.strictEqual(related[0].id, 'rep-uuid-5678');
    assert.ok(capturedUrl.endsWith('/api/reports/rep-uuid-1234/related'));
  });

  // Test 4: submitReport enforces schema by stripping client-fabricated fields and formatting UPI
  await runTest('submitReport constructs clean payload matching createReportSchema strict rules', async () => {
    let capturedBody = null;
    let capturedMethod = null;

    mockFetch(async (url, opts) => {
      capturedMethod = opts.method;
      capturedBody = JSON.parse(opts.body);
      return createJsonResponse(
        {
          success: true,
          report: {
            id: 'rep-new-777',
            companyNameRaw: capturedBody.companyName,
            status: 'pending',
          },
        },
        201
      );
    });

    const inputData = {
      companyName: '  Apex Tech Solutions  ',
      offerMessage: '  Deposit money into UPI for security pass  ',
      recruiterName: '  John Fraud  ',
      domain: 'apex-fake.com',
      phone: '+919876543210',
      email: 'recruiter@apex-fake.com',
      upiId: 'scammer@okaxis', // upiId in frontend form
      paymentRequest: 'INR 2,500 security deposit',
      additionalNotes: 'Contacted via WhatsApp first',
      // Client-fabricated fields that MUST be stripped:
      riskScore: 50,
      riskCategory: 'medium',
      title: 'Fake Title',
      status: 'verified',
    };

    const res = await reportService.submitReport(inputData);
    assert.strictEqual(capturedMethod, 'POST');
    assert.strictEqual(capturedBody.companyName, 'Apex Tech Solutions');
    assert.strictEqual(capturedBody.offerMessage, 'Deposit money into UPI for security pass');
    assert.strictEqual(capturedBody.recruiterName, 'John Fraud');
    assert.strictEqual(capturedBody.domain, 'apex-fake.com');
    assert.strictEqual(capturedBody.phone, '+919876543210');
    assert.strictEqual(capturedBody.email, 'recruiter@apex-fake.com');
    assert.strictEqual(capturedBody.upi, 'scammer@okaxis');
    assert.strictEqual(capturedBody.paymentRequest, 'INR 2,500 security deposit');
    assert.strictEqual(capturedBody.additionalNotes, 'Contacted via WhatsApp first');

    // Verify forbidden fields were NOT transmitted
    assert.strictEqual(capturedBody.riskScore, undefined);
    assert.strictEqual(capturedBody.riskCategory, undefined);
    assert.strictEqual(capturedBody.title, undefined);
    assert.strictEqual(capturedBody.status, undefined);
    assert.strictEqual(capturedBody.upiId, undefined);

    assert.strictEqual(res.id, 'rep-new-777');
  });

  // Test 5: saveReport calls POST /api/reports/:id/save
  await runTest('saveReport calls POST /api/reports/:id/save to bookmark a report', async () => {
    let capturedUrl = null;
    let capturedMethod = null;

    mockFetch(async (url, opts) => {
      capturedUrl = url;
      capturedMethod = opts.method;
      return createJsonResponse({
        success: true,
        saved: true,
        reportId: 'rep-uuid-999',
      });
    });

    const result = await reportService.saveReport('rep-uuid-999');
    assert.strictEqual(capturedMethod, 'POST');
    assert.ok(capturedUrl.endsWith('/api/reports/rep-uuid-999/save'));
    assert.strictEqual(result.saved, true);
  });

  // Test 6: removeSavedReport calls DELETE /api/reports/:id/save
  await runTest('removeSavedReport calls DELETE /api/reports/:id/save to unbookmark', async () => {
    let capturedUrl = null;
    let capturedMethod = null;

    mockFetch(async (url, opts) => {
      capturedUrl = url;
      capturedMethod = opts.method;
      return createJsonResponse({
        success: true,
        saved: false,
        reportId: 'rep-uuid-999',
      });
    });

    const result = await reportService.removeSavedReport('rep-uuid-999');
    assert.strictEqual(capturedMethod, 'DELETE');
    assert.ok(capturedUrl.endsWith('/api/reports/rep-uuid-999/save'));
    assert.strictEqual(result.saved, false);
  });

  // Test 7: getMyReports calls GET /api/reports/me with query options
  await runTest('getMyReports calls GET /api/reports/me with status filter and search', async () => {
    let capturedUrl = null;

    mockFetch(async (url) => {
      capturedUrl = url;
      return createJsonResponse({
        success: true,
        reports: [{ id: 'my-rep-1', status: 'pending' }],
        pagination: { page: 1, limit: 10, total: 1, totalPages: 1 },
      });
    });

    const result = await reportService.getMyReports({
      page: 1,
      limit: 10,
      status: 'pending',
      search: 'Apex',
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.reports[0].id, 'my-rep-1');
    assert.ok(capturedUrl.includes('/api/reports/me?'));
    assert.ok(capturedUrl.includes('status=pending'));
    assert.ok(capturedUrl.includes('search=Apex'));
  });

  // Test 8: getSavedReports calls GET /api/reports/saved
  await runTest('getSavedReports calls GET /api/reports/saved with pagination', async () => {
    let capturedUrl = null;

    mockFetch(async (url) => {
      capturedUrl = url;
      return createJsonResponse({
        success: true,
        reports: [{ id: 'saved-rep-1', isSaved: true }],
        pagination: { page: 1, limit: 10, total: 1, totalPages: 1 },
      });
    });

    const result = await reportService.getSavedReports({ page: 1, limit: 10 });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.reports[0].id, 'saved-rep-1');
    assert.ok(capturedUrl.includes('/api/reports/saved?'));
  });

  // Test 9: ApiError propagation on 404
  await runTest('getReportById propagates 404 ApiError properly', async () => {
    mockFetch(async () => {
      return createJsonResponse(
        {
          success: false,
          error: { message: 'Report not found' },
        },
        404
      );
    });

    await assert.rejects(
      async () => {
        await reportService.getReportById('non-existent-uuid');
      },
      (err) => {
        assert.ok(err instanceof ApiError);
        assert.strictEqual(err.status, 404);
        assert.strictEqual(err.message, 'Report not found');
        return true;
      }
    );
  });

  restoreFetch();

  console.log(`\nResults: ${passedTests}/${totalTests} tests passed.`);
  if (passedTests !== totalTests) {
    throw new Error('Some frontend report service tests failed');
  }
}

runAllTests().catch((err) => {
  console.error('\nFatal test execution error:', err);
  process.exit(1);
});
