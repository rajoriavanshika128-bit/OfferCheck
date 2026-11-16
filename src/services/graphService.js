/**
 * src/services/graphService.js
 * Domain service for verified Trust Graph exploration and public platform metrics.
 * Connects to real backend endpoints:
 * - GET /api/graph       (Trust graph & subgraph BFS queries)
 * - GET /api/graph/stats (Public platform statistics)
 */

import api from './api.js';

export const NODE_TYPES = {
  REPORT: 'report',
  PHONE: 'phone',
  EMAIL: 'email',
  UPI: 'upi',
  DOMAIN: 'domain',
  BANK_ACCOUNT: 'bank_account',
};

export const NODE_COLORS = {
  report: '#f59e0b',
  phone: '#3b82f6',
  email: '#8b5cf6',
  upi: '#ef4444',
  domain: '#22c55e',
  bank_account: '#06b6d4',
};

export const EDGE_STYLES = {
  high: { strokeDasharray: 'none', label: 'High confidence' },
  medium: { strokeDasharray: '8 4', label: 'Medium confidence' },
  low: { strokeDasharray: '3 3', label: 'Low confidence' },
};

/**
 * Retrieve verified trust graph or connected subgraph from the backend.
 * Calls GET /api/graph.
 *
 * @param {object} [params={}] - Query parameters { start, depth, flaggedOnly, limit }
 * @returns {Promise<{ nodes: Array<object>, edges: Array<object>, truncated: boolean, startNodeId?: string }>}
 */
export async function getTrustGraph(params = {}) {
  const query = new URLSearchParams();

  if (params.start && typeof params.start === 'string' && params.start.trim()) {
    query.set('start', params.start.trim());
  }

  if (params.depth !== undefined && params.depth !== null && params.depth !== '') {
    query.set('depth', String(params.depth));
  }

  if (params.flaggedOnly) {
    query.set('flaggedOnly', 'true');
  }

  if (params.limit !== undefined && params.limit !== null && params.limit !== '') {
    query.set('limit', String(params.limit));
  }

  const queryString = query.toString();
  const endpoint = `/api/graph${queryString ? `?${queryString}` : ''}`;
  const res = await api.get(endpoint);

  return {
    nodes: Array.isArray(res.nodes) ? res.nodes : [],
    edges: Array.isArray(res.edges) ? res.edges : [],
    truncated: Boolean(res.truncated),
    ...(res.startNodeId ? { startNodeId: res.startNodeId } : {}),
  };
}

/**
 * Retrieve connected subgraph starting from a specific node ID up to N hops.
 * Calls GET /api/graph?start={nodeId}&depth={depth}.
 *
 * @param {string} nodeId - Report or identifier ID
 * @param {number} [depth=2] - Traversal depth (1..3)
 * @returns {Promise<{ nodes: Array<object>, edges: Array<object>, truncated: boolean, startNodeId: string }>}
 */
export async function getSubgraph(nodeId, depth = 2) {
  return getTrustGraph({ start: nodeId, depth });
}

/**
 * Retrieve genuine platform statistics based on verified reports.
 * Calls GET /api/graph/stats.
 *
 * @returns {Promise<{ verifiedReports: number, totalIdentifiers: number, activeClusters: number, sharedIdentifiers: number }>}
 */
export async function getPublicStats() {
  const res = await api.get('/api/graph/stats');
  return res.stats;
}

export const STAT_ITEMS = [
  { key: 'verifiedReports', label: 'Reports in database' },
  { key: 'totalIdentifiers', label: 'Identifiers tracked' },
  { key: 'activeClusters', label: 'Fraud clusters' },
  { key: 'sharedIdentifiers', label: 'Shared identifiers' },
];

/**
 * Format public statistics count for landing page presentation.
 * Returns exact database counts or clean placeholder '—' without layout shift.
 *
 * @param {object|null} stats
 * @param {string} key
 * @param {boolean} loading
 * @param {boolean} error
 * @returns {string}
 */
export function formatStatValue(stats, key, loading, error) {
  if (loading || error || !stats) return '—';
  const val = stats[key];
  if (typeof val !== 'number') return '—';
  return String(val);
}

/**
 * Client-side plain-language explanation of why two report nodes are connected
 * based on the genuinely loaded graph data (nodes & edges).
 *
 * @param {string} reportIdA
 * @param {string} reportIdB
 * @param {Array<object>} [nodes=[]]
 * @param {Array<object>} [edges=[]]
 * @returns {object} { type: 'direct'|'indirect'|'none', sharedIdentifiers: Array, confidence: string, explanation: string, hops: number|null }
 */
export function explainReportConnection(reportIdA, reportIdB, nodes = [], edges = []) {
  if (!reportIdA || !reportIdB) return null;

  const reportNodeA = nodes.find((n) => n.id === reportIdA);
  const reportNodeB = nodes.find((n) => n.id === reportIdB);

  const companyA = reportNodeA?.data?.companyName || reportNodeA?.label || reportIdA;
  const companyB = reportNodeB?.data?.companyName || reportNodeB?.label || reportIdB;

  // 1. Identify direct shared identifiers: identifiers connected to both reportIdA and reportIdB
  const edgesToA = edges.filter((e) => e.target === reportIdA || e.source === reportIdA);
  const identIdsA = new Set(edgesToA.map((e) => (e.target === reportIdA ? e.source : e.target)));

  const edgesToB = edges.filter((e) => e.target === reportIdB || e.source === reportIdB);
  const identIdsB = new Set(edgesToB.map((e) => (e.target === reportIdB ? e.source : e.target)));

  const sharedIdentIds = Array.from(identIdsA).filter((id) => identIdsB.has(id));

  if (sharedIdentIds.length > 0) {
    const sharedIdents = sharedIdentIds
      .map((id) => nodes.find((n) => n.id === id))
      .filter(Boolean);

    const relatedEdges = edges.filter(
      (e) =>
        (e.target === reportIdA || e.target === reportIdB) &&
        sharedIdentIds.includes(e.source)
    );
    const hasHighConfidence = relatedEdges.some((e) => e.confidence === 'high');
    const confidence = hasHighConfidence ? 'high' : 'medium';

    const descriptions = sharedIdents
      .map((id) => `${id.type.replace('_', ' ')} "${id.data?.value || id.label}"`)
      .join(', ');

    const primaryType = sharedIdents[0]?.type?.replace('_', ' ') || 'indicator';

    return {
      type: 'direct',
      sharedIdentifiers: sharedIdents,
      confidence,
      explanation: `Reports ${reportIdA} (${companyA}) and ${reportIdB} (${companyB}) are directly linked by shared ${descriptions}. This means the same ${primaryType} was used in both incidents, suggesting a common fraud actor or infrastructure.`,
      hops: 1,
    };
  }

  // 2. Check 2-hop indirect connection: reportA -> identA -> intermediateReport -> identB -> reportB
  const intermediateReportMap = new Map();

  for (const idA of identIdsA) {
    const otherEdges = edges.filter(
      (e) =>
        (e.source === idA || e.target === idA) &&
        e.target !== reportIdA &&
        e.source !== reportIdA
    );
    for (const oe of otherEdges) {
      const intermediateReportId = oe.target === idA ? e.source : oe.target;
      if (intermediateReportId && intermediateReportId !== reportIdA && intermediateReportId !== reportIdB) {
        if (!intermediateReportMap.has(intermediateReportId)) {
          intermediateReportMap.set(intermediateReportId, { idA, idB: null });
        }
      }
    }
  }

  for (const idB of identIdsB) {
    const otherEdges = edges.filter(
      (e) =>
        (e.source === idB || e.target === idB) &&
        e.target !== reportIdB &&
        e.source !== reportIdB
    );
    for (const oe of otherEdges) {
      const intermediateReportId = oe.target === idB ? e.source : oe.target;
      if (intermediateReportMap.has(intermediateReportId)) {
        intermediateReportMap.get(intermediateReportId).idB = idB;
      }
    }
  }

  const indirectMatches = Array.from(intermediateReportMap.entries()).filter(
    ([, match]) => match.idB !== null
  );

  if (indirectMatches.length > 0) {
    const intermediateNames = indirectMatches.map(([rId]) => {
      const rNode = nodes.find((n) => n.id === rId);
      return rNode?.data?.companyName || rNode?.label || rId;
    });

    return {
      type: 'indirect',
      sharedIdentifiers: [],
      confidence: 'low',
      explanation: `These two reports are not directly linked but share a 2-hop connection through intermediate report(s): ${intermediateNames.join(', ')}.`,
      hops: 2,
    };
  }

  return {
    type: 'none',
    sharedIdentifiers: [],
    confidence: 'none',
    explanation: 'No direct or indirect connection found between these two reports in the current graph.',
    hops: null,
  };
}

/**
 * Backward compatibility alias for explainConnection.
 */
export function explainConnection(reportIdA, reportIdB, reportsOrNodes, identifiersOrEdges) {
  if (Array.isArray(identifiersOrEdges) && identifiersOrEdges[0] && 'source' in identifiersOrEdges[0]) {
    return explainReportConnection(reportIdA, reportIdB, reportsOrNodes, identifiersOrEdges);
  }
  // Legacy fallback if called with raw mock arrays
  return explainReportConnection(reportIdA, reportIdB, [], []);
}

/**
 * Calculate positions for SVG graph layout.
 */
export const calculateNodePositions = (nodes = [], canvasWidth = 900, canvasHeight = 600) => {
  const positions = {};
  const typeGroups = { upi: [], phone: [], email: [], domain: [], bank_account: [], report: [] };

  nodes.forEach((node) => {
    const group = typeGroups[node.type] || typeGroups.report;
    group.push(node);
  });

  const typePositions = {
    upi:          { cx: canvasWidth * 0.25, cy: canvasHeight * 0.25 },
    phone:        { cx: canvasWidth * 0.75, cy: canvasHeight * 0.25 },
    email:        { cx: canvasWidth * 0.25, cy: canvasHeight * 0.75 },
    domain:       { cx: canvasWidth * 0.75, cy: canvasHeight * 0.75 },
    bank_account: { cx: canvasWidth * 0.5,  cy: canvasHeight * 0.15 },
  };

  Object.entries(typeGroups).forEach(([type, group]) => {
    if (type === 'report') return;
    const center = typePositions[type] || { cx: canvasWidth * 0.5, cy: canvasHeight * 0.5 };
    const minArcLength = 44;
    const radius =
      group.length > 1
        ? Math.max(60, (group.length * minArcLength) / (2 * Math.PI))
        : 0;
    group.forEach((node, i) => {
      const angle = (2 * Math.PI * i) / Math.max(group.length, 1);
      positions[node.id] = {
        x: center.cx + radius * Math.cos(angle),
        y: center.cy + radius * Math.sin(angle),
      };
    });
  });

  const reportNodes = typeGroups.report;
  const reportCx = canvasWidth * 0.5;
  const reportCy = canvasHeight * 0.5;
  const reportRadius = Math.min(canvasWidth, canvasHeight) * 0.35;

  reportNodes.forEach((node, i) => {
    const angle = (2 * Math.PI * i) / Math.max(reportNodes.length, 1) - Math.PI / 2;
    positions[node.id] = {
      x: reportCx + reportRadius * Math.cos(angle),
      y: reportCy + reportRadius * Math.sin(angle),
    };
  });

  return positions;
};

// Legacy mock builders kept for mockApi backward-compatibility
export const buildGraphData = () => ({ nodes: [], edges: [] });
export const getConnectedSubgraph = () => ({ nodes: [], edges: [], startNodeId: null });

export const graphService = {
  getTrustGraph,
  getSubgraph,
  getPublicStats,
  explainReportConnection,
  calculateNodePositions,
  formatStatValue,
  STAT_ITEMS,
  NODE_TYPES,
  NODE_COLORS,
  EDGE_STYLES,
};

export default graphService;
