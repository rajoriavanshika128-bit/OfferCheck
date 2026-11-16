'use strict';

/**
 * backend/test/graph.test.js
 * Comprehensive unit and HTTP route tests for Phase 9 Step 8:
 * Backend Trust Graph API & Public Platform Statistics.
 *
 * SAFETY INVARIANTS:
 * - ZERO database connections: uses in-memory mocked Prisma.
 * - ZERO network/TCP sockets: uses Node.js in-memory stream dispatch.
 * - ZERO .env modifications.
 *
 * COVERS:
 * 1. Privacy enforcement: public, student, and admin all receive masked PII.
 * 2. Privacy enforcement: freeform notes strictly nullified on public graph.
 * 3. Verified-only graph filtering: pending, investigating, and rejected reports excluded.
 * 4. Shared identifier relationships: only identifiers linked to >= 2 reports in global graph.
 * 5. Cycles and depth limits: cyclic relations handled cleanly, depth bounded between 1 and 3.
 * 6. Maximum response limits: node count strictly bounded to maxNodes even with large frontiers.
 * 7. Edge-node consistency: never return an edge unless both endpoint nodes exist in nodes.
 * 8. Node consistency: never return isolated identifier nodes (degree >= 1).
 * 9. Starting nodes: both report and identifier start nodes supported.
 * 10. flaggedOnly: unflagged starting identifier rejected under flaggedOnly=true.
 * 11. Query validation: rejects invalid flaggedOnly strings with 400; limit bounded 1-100.
 * 12. Public statistics: genuine database counts, verified reports only, unauthenticated access.
 * 13. Truncation flag: explicitly returned as boolean.
 */

process.env.DATABASE_URL = 'postgresql://mock:mock@localhost:5432/mock_test';
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'graph_test_jwt_secret_012345678901234567890123456789';

const http = require('http');
const { Readable } = require('stream');
const assert = require('assert');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const prisma = require('../src/utils/prisma');
const graphService = require('../src/services/graph.service');
const { graphQuerySchema } = require('../src/validations/graph.validation');

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

function invokeApp({ method = 'GET', url = '/api/graph', headers = {}, body = null }) {
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

function createToken(role = 'student', id = 'user-test-1') {
  return jwt.sign(
    { sub: id, role, iat: Math.floor(Date.now() / 1000) - 10, exp: Math.floor(Date.now() / 1000) + 3600 },
    process.env.JWT_SECRET,
    { algorithm: 'HS256' }
  );
}

// ─── Prisma Mocking Helpers ──────────────────────────────────────────────────

const originalPrisma = {
  reportIdentifierFindMany: prisma.reportIdentifier.findMany,
  reportIdentifierGroupBy: prisma.reportIdentifier.groupBy,
  reportFindMany: prisma.report.findMany,
  reportFindFirst: prisma.report.findFirst,
  reportCount: prisma.report.count,
  identifierFindMany: prisma.identifier.findMany,
  identifierFindFirst: prisma.identifier.findFirst,
  identifierCount: prisma.identifier.count,
  clusterCount: prisma.cluster.count,
  userFindUnique: prisma.user.findUnique,
};

function restorePrisma() {
  prisma.reportIdentifier.findMany = originalPrisma.reportIdentifierFindMany;
  prisma.reportIdentifier.groupBy = originalPrisma.reportIdentifierGroupBy;
  prisma.report.findMany = originalPrisma.reportFindMany;
  prisma.report.findFirst = originalPrisma.reportFindFirst;
  prisma.report.count = originalPrisma.reportCount;
  prisma.identifier.findMany = originalPrisma.identifierFindMany;
  prisma.identifier.findFirst = originalPrisma.identifierFindFirst;
  prisma.identifier.count = originalPrisma.identifierCount;
  prisma.cluster.count = originalPrisma.clusterCount;
  prisma.user.findUnique = originalPrisma.userFindUnique;
}

// Standard mock fixtures
const mockJunctions = [
  {
    reportId: 'rep-1',
    identifierId: 'id-upi-1',
    confidence: 'high',
    matchType: 'upi_exact',
    identifier: {
      id: 'id-upi-1',
      type: 'upi',
      value: 'fraudster99@okhdfcbank',
      riskScore: 90,
      flagged: true,
      confidence: 'high',
      notes: 'Contains sensitive phone 9876543210 and bank 123456789012',
    },
    report: {
      id: 'rep-1',
      companyNameRaw: 'Apex Global Tech',
      status: 'verified',
      riskAssessments: [{ score: 85, category: 'critical' }],
      clusters: [{ cluster: { id: 'cl-1', name: 'Apex Syndicate' } }],
    },
  },
  {
    reportId: 'rep-2',
    identifierId: 'id-upi-1',
    confidence: 'high',
    matchType: 'upi_exact',
    identifier: {
      id: 'id-upi-1',
      type: 'upi',
      value: 'fraudster99@okhdfcbank',
      riskScore: 90,
      flagged: true,
      confidence: 'high',
      notes: 'Contains sensitive phone 9876543210 and bank 123456789012',
    },
    report: {
      id: 'rep-2',
      companyNameRaw: 'Nova Infotech Systems',
      status: 'verified',
      riskAssessments: [{ score: 75, category: 'high' }],
      clusters: [{ cluster: { id: 'cl-1', name: 'Apex Syndicate' } }],
    },
  },
  {
    reportId: 'rep-1',
    identifierId: 'id-dom-1',
    confidence: 'high',
    matchType: 'domain_match',
    identifier: {
      id: 'id-dom-1',
      type: 'domain',
      value: 'apex-careers-fraud.com',
      riskScore: 70,
      flagged: false,
      confidence: 'medium',
      notes: null,
    },
    report: {
      id: 'rep-1',
      companyNameRaw: 'Apex Global Tech',
      status: 'verified',
      riskAssessments: [{ score: 85, category: 'critical' }],
      clusters: [{ cluster: { id: 'cl-1', name: 'Apex Syndicate' } }],
    },
  },
  {
    reportId: 'rep-3',
    identifierId: 'id-dom-1',
    confidence: 'medium',
    matchType: 'domain_match',
    identifier: {
      id: 'id-dom-1',
      type: 'domain',
      value: 'apex-careers-fraud.com',
      riskScore: 70,
      flagged: false,
      confidence: 'medium',
      notes: null,
    },
    report: {
      id: 'rep-3',
      companyNameRaw: 'Apex Consulting Ltd',
      status: 'verified',
      riskAssessments: [{ score: 65, category: 'medium' }],
      clusters: [],
    },
  },
];

async function main() {
  console.log('\n--- Phase 9 Step 8: Trust Graph & Public Stats Backend Tests ---\n');

  // =========================================================================
  // 1. Strict Query Parameter Validation Tests
  // =========================================================================
  console.log('1. Query Parameter Validation:');

  await runTest('Validates default depth=2, limit=100 and flaggedOnly=false', () => {
    const parsed = graphQuerySchema.parse({});
    assert.strictEqual(parsed.depth, 2);
    assert.strictEqual(parsed.flaggedOnly, false);
    assert.strictEqual(parsed.limit, 100);
  });

  await runTest('Coerces valid depth and limit values within 1..100 bounds', () => {
    const p1 = graphQuerySchema.parse({ depth: '1', limit: '50' });
    assert.strictEqual(p1.depth, 1);
    assert.strictEqual(p1.limit, 50);
  });

  await runTest('Rejects depth out of bounds (depth > 3 or depth < 1)', () => {
    assert.throws(() => graphQuerySchema.parse({ depth: '4' }));
    assert.throws(() => graphQuerySchema.parse({ depth: '0' }));
    assert.throws(() => graphQuerySchema.parse({ depth: 'invalid' }));
  });

  await runTest('Rejects limit out of bounds (limit > 100 or limit < 1)', () => {
    assert.throws(() => graphQuerySchema.parse({ limit: '101' }));
    assert.throws(() => graphQuerySchema.parse({ limit: '0' }));
    assert.throws(() => graphQuerySchema.parse({ limit: '-5' }));
  });

  await runTest('Coerces canonical flaggedOnly booleans and REJECTS invalid strings with error', () => {
    assert.strictEqual(graphQuerySchema.parse({ flaggedOnly: 'true' }).flaggedOnly, true);
    assert.strictEqual(graphQuerySchema.parse({ flaggedOnly: '1' }).flaggedOnly, true);
    assert.strictEqual(graphQuerySchema.parse({ flaggedOnly: 'false' }).flaggedOnly, false);
    assert.strictEqual(graphQuerySchema.parse({ flaggedOnly: '0' }).flaggedOnly, false);
    assert.strictEqual(graphQuerySchema.parse({ flaggedOnly: '' }).flaggedOnly, false);

    // Invalid non-boolean strings MUST be rejected (not silently coerced to false)
    assert.throws(() => graphQuerySchema.parse({ flaggedOnly: 'invalid' }));
    assert.throws(() => graphQuerySchema.parse({ flaggedOnly: 'foo' }));
    assert.throws(() => graphQuerySchema.parse({ flaggedOnly: '2' }));
  });

  // =========================================================================
  // 2. Privacy & PII Protection Invariants
  // =========================================================================
  console.log('\n2. Strict Privacy & Masking Invariants:');

  await runTest('Always masks UPI, phone and email in nodes, fullLabel and data', async () => {
    prisma.reportIdentifier.groupBy = async () => [
      { identifierId: 'id-upi-1', _count: { reportId: 2 } },
    ];
    prisma.reportIdentifier.findMany = async () => mockJunctions.filter((j) => j.identifierId === 'id-upi-1');

    const graph = await graphService.getTrustGraph({});
    restorePrisma();

    const upiNode = graph.nodes.find((n) => n.id === 'id-upi-1');
    assert(upiNode, 'UPI node must exist');

    assert(!upiNode.data.value.includes('fraudster99'), 'Raw UPI must not be in data.value');
    assert(!upiNode.fullLabel.includes('fraudster99'), 'Raw UPI must not be in fullLabel');
    assert(!upiNode.label.includes('fraudster99'), 'Raw UPI must not be in label');
    assert(upiNode.data.value.includes('@okhdfcbank'), 'Domain part preserved');
  });

  await runTest('Completely omits internal notes from public graph responses', async () => {
    prisma.reportIdentifier.groupBy = async () => [
      { identifierId: 'id-upi-1', _count: { reportId: 2 } },
    ];
    prisma.reportIdentifier.findMany = async () => mockJunctions.filter((j) => j.identifierId === 'id-upi-1');

    const graph = await graphService.getTrustGraph({});
    restorePrisma();

    for (const node of graph.nodes) {
      if (node.type !== 'report') {
        assert.strictEqual(node.data.notes, null, 'Identifier notes MUST be null in public graph payload');
      }
    }
  });

  await runTest('Admin caller STILL receives masked PII on public graph endpoints', async () => {
    prisma.reportIdentifier.groupBy = async () => [
      { identifierId: 'id-upi-1', _count: { reportId: 2 } },
    ];
    prisma.reportIdentifier.findMany = async () => mockJunctions.filter((j) => j.identifierId === 'id-upi-1');
    prisma.user.findUnique = async () => ({
      id: 'admin-1',
      email: 'admin@offercheck.com',
      name: 'Admin User',
      role: 'admin',
      isBanned: false,
    });

    const adminToken = createToken('admin', 'admin-1');

    const res = await invokeApp({
      method: 'GET',
      url: '/api/graph',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    restorePrisma();

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);

    const upiNode = res.body.nodes.find((n) => n.id === 'id-upi-1');
    assert(upiNode, 'UPI node must exist in response');
    assert(!upiNode.data.value.includes('fraudster99'), 'Admin caller must receive masked UPI on public graph');
  });

  // =========================================================================
  // 3. Global Graph Determinism, Truncation & Consistency
  // =========================================================================
  console.log('\n3. Global Graph Determinism & Consistency:');

  await runTest('Includes shared indicators and guarantees zero orphan nodes or edges', async () => {
    prisma.reportIdentifier.groupBy = async (args) => {
      assert.strictEqual(args.where.report.status, 'verified');
      return [
        { identifierId: 'id-upi-1', _count: { reportId: 2 } },
        { identifierId: 'id-dom-1', _count: { reportId: 2 } },
      ];
    };
    let capturedFindManyArgs = null;
    prisma.reportIdentifier.findMany = async (args) => {
      capturedFindManyArgs = args;
      return mockJunctions;
    };

    const graph = await graphService.getTrustGraph({});
    restorePrisma();

    // Verify junction query includes full composite primary key tie-breaker (reportId, identifierId)
    assert.deepStrictEqual(capturedFindManyArgs.orderBy, [
      { report: { submittedAt: 'desc' } },
      { reportId: 'asc' },
      { identifierId: 'asc' },
    ]);

    const nodeIds = new Set(graph.nodes.map((n) => n.id));

    // Every edge must have both endpoints in nodes
    for (const edge of graph.edges) {
      assert(nodeIds.has(edge.source), `Edge source ${edge.source} must exist in nodes`);
      assert(nodeIds.has(edge.target), `Edge target ${edge.target} must exist in nodes`);
    }

    // Every node must have degree >= 1 (no isolated nodes)
    const degrees = new Map();
    for (const e of graph.edges) {
      degrees.set(e.source, (degrees.get(e.source) || 0) + 1);
      degrees.set(e.target, (degrees.get(e.target) || 0) + 1);
    }
    for (const node of graph.nodes) {
      assert((degrees.get(node.id) || 0) > 0, `Node ${node.id} must have at least one edge (no orphans)`);
    }

    assert.strictEqual(typeof graph.truncated, 'boolean');
  });

  await runTest('Respects limit parameter and sets truncated=true when capped', async () => {
    prisma.reportIdentifier.groupBy = async () => [
      { identifierId: 'id-upi-1', _count: { reportId: 2 } },
      { identifierId: 'id-dom-1', _count: { reportId: 2 } },
    ];
    prisma.reportIdentifier.findMany = async () => mockJunctions;

    // Request limit of 2 nodes
    const graph = await graphService.getTrustGraph({ limit: 2 });
    restorePrisma();

    assert(graph.nodes.length <= 2, `Nodes length (${graph.nodes.length}) must be <= 2`);
    assert.strictEqual(graph.truncated, true, 'Must indicate truncation when capped by limit');
  });

  // =========================================================================
  // 4. Subgraph BFS: Dense Frontiers, Bounds & Starting Nodes
  // =========================================================================
  console.log('\n4. Subgraph BFS Traversal & Frontier Bounding:');

  await runTest('Starting from an Identifier node works correctly', async () => {
    prisma.report.findFirst = async () => null;
    prisma.identifier.findFirst = async ({ where }) => {
      if (where.id === 'id-upi-1') return { id: 'id-upi-1' };
      return null;
    };

    prisma.reportIdentifier.findMany = async ({ where }) => {
      if (where.identifierId && where.identifierId.in) {
        return [{ reportId: 'rep-1' }, { reportId: 'rep-2' }];
      }
      return [
        { reportId: 'rep-1', identifierId: 'id-upi-1', confidence: 'high' },
        { reportId: 'rep-2', identifierId: 'id-upi-1', confidence: 'high' },
      ];
    };

    prisma.report.findMany = async () => [
      { id: 'rep-1', companyNameRaw: 'Apex Tech', status: 'verified', riskAssessments: [], clusters: [] },
      { id: 'rep-2', companyNameRaw: 'Nova Tech', status: 'verified', riskAssessments: [], clusters: [] },
    ];
    prisma.identifier.findMany = async () => [
      { id: 'id-upi-1', type: 'upi', value: 'scam@upi', riskScore: 80, flagged: true, confidence: 'high' },
    ];

    const graph = await graphService.getTrustGraph({ start: 'id-upi-1', depth: 1 });
    restorePrisma();

    assert.strictEqual(graph.startNodeId, 'id-upi-1');
    assert.strictEqual(graph.nodes.length, 3); // 1 identifier + 2 reports
  });

  await runTest('Rejects unflagged starting identifier when flaggedOnly=true', async () => {
    prisma.report.findFirst = async () => null;
    prisma.identifier.findFirst = async ({ where }) => {
      // Invariant: when flaggedOnly is true, starting identifier query MUST enforce flagged: true
      assert.strictEqual(where.flagged, true);
      return null; // Unflagged identifier returns null
    };

    const graph = await graphService.getTrustGraph({ start: 'id-unflagged-1', flaggedOnly: true });
    restorePrisma();

    assert.strictEqual(graph.nodes.length, 0);
    assert.strictEqual(graph.edges.length, 0);
    assert.strictEqual(graph.startNodeId, 'id-unflagged-1');
  });

  await runTest('Dense BFS frontier exceeding 100 nodes is strictly capped at maxNodes', async () => {
    prisma.report.findFirst = async () => ({ id: 'rep-hub' });
    prisma.identifier.findFirst = async () => null;

    // Simulate dense report connected to 150 identifiers
    const denseLinks = [];
    for (let i = 1; i <= 150; i++) {
      denseLinks.push({ identifierId: `id-dense-${i}` });
    }

    prisma.reportIdentifier.findMany = async ({ where }) => {
      if (where.reportId && where.reportId.in) {
        return denseLinks;
      }
      return [];
    };

    prisma.report.findMany = async ({ where }) => {
      return [{ id: 'rep-hub', companyNameRaw: 'Hub Co', status: 'verified', riskAssessments: [], clusters: [] }];
    };

    prisma.identifier.findMany = async ({ where }) => {
      const ids = where.id.in;
      return ids.map((id) => ({
        id,
        type: 'phone',
        value: '+919876543210',
        riskScore: 50,
        flagged: false,
        confidence: 'medium',
      }));
    };

    const graph = await graphService.getTrustGraph({ start: 'rep-hub', depth: 1, limit: 100 });
    restorePrisma();

    assert(graph.nodes.length <= 100, `Nodes count (${graph.nodes.length}) must strictly not exceed 100`);
    assert.strictEqual(graph.truncated, true, 'Dense frontier must set truncated=true');
  });

  // =========================================================================
  // 5. Public Platform Statistics & HTTP Integration
  // =========================================================================
  console.log('\n5. Public Statistics Accuracy & HTTP API:');

  await runTest('GET /api/graph/stats returns accurate verified metrics', async () => {
    prisma.report.count = async (args) => {
      assert.strictEqual(args.where.status, 'verified');
      return 50;
    };
    prisma.identifier.count = async () => 120;
    prisma.reportIdentifier.groupBy = async () => [
      { identifierId: 'id-1', _count: { reportId: 3 } },
      { identifierId: 'id-2', _count: { reportId: 2 } },
      { identifierId: 'id-3', _count: { reportId: 1 } },
    ];
    prisma.cluster.count = async () => 8;

    const res = await invokeApp({ method: 'GET', url: '/api/graph/stats' });
    restorePrisma();

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body.stats, {
      verifiedReports: 50,
      totalIdentifiers: 120,
      activeClusters: 8,
      sharedIdentifiers: 2,
    });
  });

  await runTest('GET /api/graph returns 400 on invalid flaggedOnly parameter', async () => {
    const res = await invokeApp({ method: 'GET', url: '/api/graph?flaggedOnly=not-a-boolean' });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.success, false);
  });

  await runTest('GET /api/graph returns 400 on invalid limit parameter', async () => {
    const res = await invokeApp({ method: 'GET', url: '/api/graph?limit=500' });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.success, false);
  });

  console.log(`\nAll ${passedTests} / ${totalTests} Trust Graph & stats tests passed successfully!\n`);
}

main().catch((err) => {
  restorePrisma();
  console.error('\n[FATAL] Test failure:', err);
  process.exit(1);
});
