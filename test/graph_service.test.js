/**
 * test/graph_service.test.js
 * Unit tests for frontend graphService (src/services/graphService.js)
 * and backend Trust Graph / public stats integration.
 */

import assert from 'assert';
import { ApiError } from '../src/services/api.js';
import {
  graphService,
  getTrustGraph,
  getSubgraph,
  getPublicStats,
  explainReportConnection,
  calculateNodePositions,
  NODE_COLORS,
  EDGE_STYLES,
} from '../src/services/graphService.js';

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
  console.log('\n--- Frontend graphService & Trust Graph Unit Tests ---\n');

  // =========================================================================
  // 1. Trust Graph API Queries & Parameter Serialization
  // =========================================================================
  console.log('1. Trust Graph Endpoint Queries:');

  await runTest('getTrustGraph calls GET /api/graph with default parameters', async () => {
    let capturedUrl = null;
    mockFetch((url) => {
      capturedUrl = url;
      return createJsonResponse({
        success: true,
        nodes: [{ id: 'rep-1', type: 'report', label: 'Apex' }],
        edges: [],
        truncated: false,
      });
    });

    const res = await getTrustGraph();
    restoreFetch();

    assert(capturedUrl.endsWith('/api/graph'), `Expected /api/graph, got ${capturedUrl}`);
    assert.strictEqual(res.nodes.length, 1);
    assert.strictEqual(res.truncated, false);
  });

  await runTest('getTrustGraph correctly serializes start, depth, flaggedOnly, and limit', async () => {
    let capturedUrl = null;
    mockFetch((url) => {
      capturedUrl = url;
      return createJsonResponse({
        success: true,
        nodes: [],
        edges: [],
        truncated: true,
        startNodeId: 'rep-hub',
      });
    });

    const res = await getTrustGraph({
      start: 'rep-hub',
      depth: 2,
      flaggedOnly: true,
      limit: 50,
    });
    restoreFetch();

    const parsed = new URL(capturedUrl);
    assert.strictEqual(parsed.pathname, '/api/graph');
    assert.strictEqual(parsed.searchParams.get('start'), 'rep-hub');
    assert.strictEqual(parsed.searchParams.get('depth'), '2');
    assert.strictEqual(parsed.searchParams.get('flaggedOnly'), 'true');
    assert.strictEqual(parsed.searchParams.get('limit'), '50');
    assert.strictEqual(res.truncated, true);
    assert.strictEqual(res.startNodeId, 'rep-hub');
  });

  await runTest('getTrustGraph propagates ApiError on 400 Bad Request', async () => {
    mockFetch(() => {
      return createJsonResponse({ success: false, error: 'depth cannot exceed 3' }, 400);
    });

    await assert.rejects(
      async () => getTrustGraph({ depth: 5 }),
      (err) => err instanceof ApiError && err.status === 400
    );
    restoreFetch();
  });

  // =========================================================================
  // 2. Subgraph Exploration
  // =========================================================================
  console.log('\n2. Subgraph Traversal Method:');

  await runTest('getSubgraph delegates to GET /api/graph?start={nodeId}&depth={depth}', async () => {
    let capturedUrl = null;
    mockFetch((url) => {
      capturedUrl = url;
      return createJsonResponse({
        success: true,
        nodes: [{ id: 'id-upi-1', type: 'upi' }],
        edges: [],
        truncated: false,
        startNodeId: 'id-upi-1',
      });
    });

    const res = await getSubgraph('id-upi-1', 2);
    restoreFetch();

    const parsed = new URL(capturedUrl);
    assert.strictEqual(parsed.searchParams.get('start'), 'id-upi-1');
    assert.strictEqual(parsed.searchParams.get('depth'), '2');
    assert.strictEqual(res.startNodeId, 'id-upi-1');
  });

  // =========================================================================
  // 3. Public Platform Statistics
  // =========================================================================
  console.log('\n3. Public Platform Statistics:');

  await runTest('getPublicStats calls GET /api/graph/stats and unwraps stats object', async () => {
    mockFetch((url) => {
      assert(url.endsWith('/api/graph/stats'));
      return createJsonResponse({
        success: true,
        stats: {
          verifiedReports: 42,
          totalIdentifiers: 88,
          activeClusters: 5,
          sharedIdentifiers: 12,
        },
      });
    });

    const stats = await getPublicStats();
    restoreFetch();

    assert.strictEqual(stats.verifiedReports, 42);
    assert.strictEqual(stats.totalIdentifiers, 88);
    assert.strictEqual(stats.activeClusters, 5);
    assert.strictEqual(stats.sharedIdentifiers, 12);
  });

  // =========================================================================
  // 4. Client-Side Connection Explanation Logic
  // =========================================================================
  console.log('\n4. Client-Side explainReportConnection:');

  const testNodes = [
    { id: 'rep-1', type: 'report', label: 'Apex Tech', data: { companyName: 'Apex Tech' } },
    { id: 'rep-2', type: 'report', label: 'Nova Tech', data: { companyName: 'Nova Tech' } },
    { id: 'rep-3', type: 'report', label: 'Zeta Corp', data: { companyName: 'Zeta Corp' } },
    { id: 'id-upi-1', type: 'upi', label: 'sc***@upi', data: { value: 'sc***@upi' } },
    { id: 'id-ph-1', type: 'phone', label: '+91 98765*****', data: { value: '+91 98765*****' } },
  ];

  const testEdges = [
    { id: 'e1', source: 'id-upi-1', target: 'rep-1', type: 'upi', confidence: 'high' },
    { id: 'e2', source: 'id-upi-1', target: 'rep-2', type: 'upi', confidence: 'high' },
    { id: 'e3', source: 'id-ph-1', target: 'rep-2', type: 'phone', confidence: 'medium' },
    { id: 'e4', source: 'id-ph-1', target: 'rep-3', type: 'phone', confidence: 'medium' },
  ];

  await runTest('explains direct 1-hop connection sharing an identifier', () => {
    const explanation = explainReportConnection('rep-1', 'rep-2', testNodes, testEdges);
    assert.strictEqual(explanation.type, 'direct');
    assert.strictEqual(explanation.hops, 1);
    assert.strictEqual(explanation.confidence, 'high');
    assert(explanation.explanation.includes('Apex Tech'));
    assert(explanation.explanation.includes('Nova Tech'));
    assert(explanation.explanation.includes('sc***@upi'));
  });

  await runTest('explains indirect 2-hop connection through intermediate report', () => {
    const explanation = explainReportConnection('rep-1', 'rep-3', testNodes, testEdges);
    assert.strictEqual(explanation.type, 'indirect');
    assert.strictEqual(explanation.hops, 2);
    assert.strictEqual(explanation.confidence, 'low');
    assert(explanation.explanation.includes('Nova Tech'));
  });

  await runTest('returns type "none" when two reports are completely unconnected', () => {
    const unconnectedNode = { id: 'rep-isolated', type: 'report', label: 'Isolated Inc' };
    const explanation = explainReportConnection('rep-1', 'rep-isolated', [...testNodes, unconnectedNode], testEdges);
    assert.strictEqual(explanation.type, 'none');
    assert.strictEqual(explanation.hops, null);
  });

  // =========================================================================
  // 5. Layout Calculation & Visual Invariants
  // =========================================================================
  console.log('\n5. Layout Calculation & Visual Invariants:');

  await runTest('calculateNodePositions assigns coordinates to all nodes', () => {
    const positions = calculateNodePositions(testNodes, 960, 620);
    for (const node of testNodes) {
      assert(positions[node.id], `Position for ${node.id} must exist`);
      assert(typeof positions[node.id].x === 'number');
      assert(typeof positions[node.id].y === 'number');
    }
  });

  await runTest('Preserves NODE_COLORS and EDGE_STYLES palettes', () => {
    assert.strictEqual(NODE_COLORS.report, '#f59e0b');
    assert.strictEqual(NODE_COLORS.upi, '#ef4444');
    assert.strictEqual(EDGE_STYLES.high.strokeDasharray, 'none');
    assert.strictEqual(EDGE_STYLES.medium.strokeDasharray, '8 4');
  });

  console.log(`\nAll ${passedTests} / ${totalTests} frontend graphService tests passed successfully!\n`);
}

main().catch((err) => {
  restoreFetch();
  console.error('\n[FATAL] Test failure:', err);
  process.exit(1);
});
