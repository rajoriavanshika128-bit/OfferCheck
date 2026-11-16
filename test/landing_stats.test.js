/**
 * test/landing_stats.test.js
 * Unit tests for Landing Page statistics integration, data formatting,
 * and error/zero-state handling.
 * Exercises the actual production formatStatValue and STAT_ITEMS exports.
 */

import assert from 'assert';
import { getPublicStats, formatStatValue, STAT_ITEMS } from '../src/services/graphService.js';
import { ApiError } from '../src/services/api.js';

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
  console.log('\n--- Landing Page Statistics Integration Tests ---\n');

  // =========================================================================
  // 1. STAT_ITEMS Metric Key Definitions
  // =========================================================================
  console.log('1. Production Metric Key Mapping:');

  await runTest('STAT_ITEMS maps to the exact 4 expected backend metric fields', () => {
    assert(Array.isArray(STAT_ITEMS), 'STAT_ITEMS must be an array');
    assert.strictEqual(STAT_ITEMS.length, 4, 'Must have exactly 4 items');

    const keys = STAT_ITEMS.map((item) => item.key);
    assert.deepStrictEqual(keys, [
      'verifiedReports',
      'totalIdentifiers',
      'activeClusters',
      'sharedIdentifiers',
    ]);
  });

  // =========================================================================
  // 2. Successful Stats Retrieval & Exact Formatting
  // =========================================================================
  console.log('\n2. Successful Public Stats Retrieval & Exact Formatting:');

  await runTest('getPublicStats retrieves live database metrics from GET /api/graph/stats', async () => {
    mockFetch((url) => {
      assert(url.endsWith('/api/graph/stats'));
      return createJsonResponse({
        success: true,
        stats: {
          verifiedReports: 142,
          totalIdentifiers: 380,
          activeClusters: 12,
          sharedIdentifiers: 45,
        },
      });
    });

    const stats = await getPublicStats();
    restoreFetch();

    assert.strictEqual(stats.verifiedReports, 142);
    assert.strictEqual(stats.totalIdentifiers, 380);
    assert.strictEqual(stats.activeClusters, 12);
    assert.strictEqual(stats.sharedIdentifiers, 45);

    // Tests production formatStatValue: exact integer representation without '+'
    assert.strictEqual(formatStatValue(stats, 'verifiedReports', false, false), '142');
    assert.strictEqual(formatStatValue(stats, 'totalIdentifiers', false, false), '380');
    assert.strictEqual(formatStatValue(stats, 'activeClusters', false, false), '12');
    assert.strictEqual(formatStatValue(stats, 'sharedIdentifiers', false, false), '45');
  });

  // =========================================================================
  // 3. Loading and Error State Invariants (Zero Layout Shift)
  // =========================================================================
  console.log('\n3. Loading and Error State Invariants:');

  await runTest('formatStatValue returns clean placeholder "—" during loading without shifting layout', () => {
    assert.strictEqual(formatStatValue(null, 'verifiedReports', true, false), '—');
    assert.strictEqual(formatStatValue(null, 'totalIdentifiers', true, false), '—');
    assert.strictEqual(formatStatValue(null, 'activeClusters', true, false), '—');
    assert.strictEqual(formatStatValue(null, 'sharedIdentifiers', true, false), '—');
  });

  await runTest('formatStatValue returns clean placeholder "—" on API failure', () => {
    assert.strictEqual(formatStatValue(null, 'verifiedReports', false, true), '—');
    assert.strictEqual(formatStatValue(null, 'totalIdentifiers', false, true), '—');
    assert.strictEqual(formatStatValue(null, 'activeClusters', false, true), '—');
    assert.strictEqual(formatStatValue(null, 'sharedIdentifiers', false, true), '—');
  });

  await runTest('getPublicStats propagates ApiError on network or 500 failure without crash', async () => {
    mockFetch(() => {
      return createJsonResponse({ success: false, error: 'Internal server error' }, 500);
    });

    await assert.rejects(
      async () => getPublicStats(),
      (err) => err instanceof ApiError && err.status === 500
    );
    restoreFetch();
  });

  // =========================================================================
  // 4. Genuine Zero-Data States
  // =========================================================================
  console.log('\n4. Genuine Zero-Data States (Never fabricated):');

  await runTest('formatStatValue displays exact "0" when database metrics are zero', () => {
    const zeroStats = {
      verifiedReports: 0,
      totalIdentifiers: 0,
      activeClusters: 0,
      sharedIdentifiers: 0,
    };

    assert.strictEqual(formatStatValue(zeroStats, 'verifiedReports', false, false), '0');
    assert.strictEqual(formatStatValue(zeroStats, 'totalIdentifiers', false, false), '0');
    assert.strictEqual(formatStatValue(zeroStats, 'activeClusters', false, false), '0');
    assert.strictEqual(formatStatValue(zeroStats, 'sharedIdentifiers', false, false), '0');
  });

  console.log(`\nAll ${passedTests} / ${totalTests} landing stats tests passed successfully!\n`);
}

main().catch((err) => {
  restoreFetch();
  console.error('\n[FATAL] Test failure:', err);
  process.exit(1);
});
