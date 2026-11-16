'use strict';

/**
 * backend/src/services/graph.service.js
 * Domain service for Trust Graph intelligence and public platform statistics.
 *
 * INVARIANTS:
 * - Exclusively operates on VERIFIED reports (status === 'verified').
 * - Always masks contact identifiers (phone, email, UPI, bank_account) across all public graph outputs,
 *   even for administrators.
 * - Completely omits freeform identifier notes from public graph responses (internal investigation data).
 * - Enforces depth limits (1 <= depth <= 3) and visited sets to eliminate cycles.
 * - Strictly enforces 100-node and 250-edge caps during both frontier expansion and graph formatting.
 * - Guarantees edge-node consistency: an edge is NEVER returned unless both endpoint nodes exist in the graph.
 * - Guarantees node consistency: isolated identifier nodes with zero edges are never returned.
 * - Explicitly reports `truncated: true` whenever limits prune the response.
 */

const prisma = require('../utils/prisma');
const {
  maskPhone,
  maskEmail,
  maskUpi,
  maskBankAccount,
  deepClone,
} = require('../utils/privacy');

const MAX_GRAPH_NODES = 100;
const MAX_GRAPH_EDGES = 250;

/**
 * Public graph identifier masking helper.
 * Strictly guarantees that phone, email, upi, and bank_account are masked regardless of caller role.
 *
 * @param {object} identifier
 * @returns {object}
 */
function maskIdentifierForPublicGraph(identifier) {
  if (!identifier || typeof identifier !== 'object') return identifier;
  const copy = deepClone(identifier);

  if (copy.type === 'phone') {
    copy.value = maskPhone(copy.value);
    if ('normalizedValue' in copy) copy.normalizedValue = maskPhone(copy.normalizedValue);
  } else if (copy.type === 'email') {
    copy.value = maskEmail(copy.value);
    if ('normalizedValue' in copy) copy.normalizedValue = maskEmail(copy.normalizedValue);
  } else if (copy.type === 'upi') {
    copy.value = maskUpi(copy.value);
    if ('normalizedValue' in copy) copy.normalizedValue = maskUpi(copy.normalizedValue);
  } else if (copy.type === 'bank_account') {
    copy.value = maskBankAccount(copy.value);
    if ('normalizedValue' in copy) copy.normalizedValue = maskBankAccount(copy.normalizedValue);
  }

  return copy;
}

/**
 * Construct standard UI node object for a Report.
 */
function formatReportNode(report) {
  const companyName = report.companyNameRaw || report.company?.name || 'Unknown Company';
  const score = report.riskAssessments?.[0]?.score ?? 0;
  const category = report.riskAssessments?.[0]?.category ?? 'low';
  const clusterNames = (report.clusters || [])
    .map((cr) => cr.cluster?.name)
    .filter(Boolean);
  const identifierIds = (report.identifiers || []).map((ri) => ri.identifierId);

  return {
    id: report.id,
    type: 'report',
    label: companyName.length > 20 ? companyName.substring(0, 17) + '...' : companyName,
    fullLabel: companyName,
    riskScore: score,
    riskCategory: category,
    status: 'verified',
    data: {
      id: report.id,
      companyName,
      title: `${companyName} Fraud Incident Report`,
      riskScore: score,
      riskCategory: category,
      status: 'verified',
      identifierIds,
      clusterIds: clusterNames,
    },
  };
}

/**
 * Construct standard UI node object for an Identifier.
 * Freeform internal notes are strictly nullified for public graph privacy.
 */
function formatIdentifierNode(identifier, linkedReportIds) {
  const masked = maskIdentifierForPublicGraph(identifier);
  const rawVal = masked.value || '';
  const label = rawVal.length > 25 ? rawVal.substring(0, 22) + '...' : rawVal;

  return {
    id: identifier.id,
    type: identifier.type,
    label,
    fullLabel: rawVal,
    riskScore: identifier.riskScore ?? 0,
    flagged: Boolean(identifier.flagged),
    reportCount: linkedReportIds.length,
    confidence: identifier.confidence || 'medium',
    data: {
      id: identifier.id,
      type: identifier.type,
      value: rawVal,
      notes: null, // Omit internal notes completely from public graph payloads
      reportIds: linkedReportIds,
      flagged: Boolean(identifier.flagged),
      riskScore: identifier.riskScore ?? 0,
      confidence: identifier.confidence || 'medium',
    },
  };
}

/**
 * Construct standard UI edge object connecting an Identifier and a Report.
 */
function formatEdge(identifier, reportId, confidence = 'medium') {
  return {
    id: `${identifier.id}-${reportId}`,
    source: identifier.id,
    target: reportId,
    type: identifier.type,
    label: `shares ${identifier.type}`,
    confidence: confidence || identifier.confidence || 'medium',
    connectionBasis: `Report links to ${identifier.type} indicator`,
  };
}

/**
 * Retrieve Global Trust Graph of verified reports connected by shared identifiers.
 * Employs a deterministic, two-stage query strategy:
 * 1. Groups report_identifiers to find genuine shared indicators (linked to >= 2 verified reports).
 * 2. Fetches verified reports for those shared indicators.
 * Strictly guarantees no orphan edges or isolated nodes, and signals truncation if limits are reached.
 *
 * @param {object} options
 * @param {boolean} [options.flaggedOnly=false]
 * @param {number} [options.limit=100]
 * @returns {Promise<{ nodes: Array<object>, edges: Array<object>, truncated: boolean }>}
 */
async function getGlobalTrustGraph({ flaggedOnly = false, limit = MAX_GRAPH_NODES } = {}) {
  const maxNodes = Math.min(Math.max(limit, 1), MAX_GRAPH_NODES);
  let truncated = false;

  // 1. Find shared identifiers (having >= 2 verified reports) ordered deterministically
  const sharedIdentifierGroups = await prisma.reportIdentifier.groupBy({
    by: ['identifierId'],
    where: {
      report: { status: 'verified' },
      ...(flaggedOnly ? { identifier: { flagged: true } } : {}),
    },
    _count: {
      reportId: true,
    },
    orderBy: {
      _count: {
        reportId: 'desc',
      },
    },
  });

  const qualifiedGroups = sharedIdentifierGroups.filter(
    (g) => g._count && g._count.reportId >= 2
  );

  if (qualifiedGroups.length === 0) {
    return { nodes: [], edges: [], truncated: false };
  }

  const candidateSharedIds = qualifiedGroups.map((g) => g.identifierId);

  // 2. Fetch all verified junctions for these shared identifiers with deterministic ordering
  const junctions = await prisma.reportIdentifier.findMany({
    where: {
      identifierId: { in: candidateSharedIds },
      report: { status: 'verified' },
    },
    orderBy: [
      { report: { submittedAt: 'desc' } },
      { reportId: 'asc' },
      { identifierId: 'asc' },
    ],
    select: {
      reportId: true,
      identifierId: true,
      confidence: true,
      matchType: true,
      identifier: {
        select: {
          id: true,
          type: true,
          value: true,
          riskScore: true,
          flagged: true,
          confidence: true,
        },
      },
      report: {
        select: {
          id: true,
          companyNameRaw: true,
          status: true,
          riskAssessments: {
            where: { isCurrent: true },
            select: { score: true, category: true },
          },
          clusters: {
            select: {
              cluster: {
                select: { id: true, name: true },
              },
            },
          },
        },
      },
    },
  });

  // Index relations in memory
  const identifierDataMap = new Map();
  const reportDataMap = new Map();
  const edgesList = [];

  for (const j of junctions) {
    if (!identifierDataMap.has(j.identifierId)) {
      identifierDataMap.set(j.identifierId, {
        identifier: j.identifier,
        reportIds: new Set(),
        confidences: new Map(),
      });
    }
    const idEntry = identifierDataMap.get(j.identifierId);
    idEntry.reportIds.add(j.reportId);
    idEntry.confidences.set(j.reportId, j.confidence);

    if (!reportDataMap.has(j.reportId)) {
      reportDataMap.set(j.reportId, {
        report: j.report,
        identifierIds: new Set(),
      });
    }
    reportDataMap.get(j.reportId).identifierIds.add(j.identifierId);

    edgesList.push({
      identifier: j.identifier,
      reportId: j.reportId,
      confidence: j.confidence,
    });
  }

  // 3. Assemble graph ensuring strict node cap and zero orphan nodes/edges
  const nodes = [];
  const includedNodeIds = new Set();
  const nodeDegrees = new Map(); // track node degrees to prevent isolated nodes

  for (const [idId, idEntry] of identifierDataMap.entries()) {
    // If adding this identifier would exceed maxNodes, mark truncated and stop
    if (nodes.length + 1 > maxNodes) {
      truncated = true;
      break;
    }

    // Determine how many of this identifier's reports are already in nodes or can be added
    const candidateReportIds = Array.from(idEntry.reportIds);
    const newReportsToAdd = candidateReportIds.filter((rid) => !includedNodeIds.has(rid));

    // To prevent an orphan identifier (0 edges), at least 1 report must be present or addable
    const availableRoom = maxNodes - (nodes.length + 1); // room after identifier
    if (newReportsToAdd.length > 0 && availableRoom < 1) {
      // Cannot add any report for this identifier -> skip identifier to prevent orphan
      truncated = true;
      break;
    }

    // Add identifier node
    includedNodeIds.add(idId);
    nodes.push(formatIdentifierNode(idEntry.identifier, candidateReportIds));
    nodeDegrees.set(idId, 0);

    // Add candidate reports up to available room
    for (const repId of candidateReportIds) {
      if (!includedNodeIds.has(repId)) {
        if (nodes.length >= maxNodes) {
          truncated = true;
          break;
        }
        includedNodeIds.add(repId);
        const repEntry = reportDataMap.get(repId);
        const formattedReport = formatReportNode(repEntry.report);
        formattedReport.data.identifierIds = Array.from(repEntry.identifierIds);
        nodes.push(formattedReport);
        nodeDegrees.set(repId, 0);
      }
    }
  }

  // 4. Assemble edges ensuring both source and target exist in nodes
  const edges = [];
  for (const e of edgesList) {
    if (edges.length >= MAX_GRAPH_EDGES) {
      truncated = true;
      break;
    }
    if (includedNodeIds.has(e.identifier.id) && includedNodeIds.has(e.reportId)) {
      edges.push(formatEdge(e.identifier, e.reportId, e.confidence));
      nodeDegrees.set(e.identifier.id, (nodeDegrees.get(e.identifier.id) || 0) + 1);
      nodeDegrees.set(e.reportId, (nodeDegrees.get(e.reportId) || 0) + 1);
    }
  }

  // Final check: prune any node that ended up with degree 0 (orphan) due to truncation
  const filteredNodes = nodes.filter((n) => (nodeDegrees.get(n.id) || 0) > 0);
  if (filteredNodes.length < nodes.length) {
    truncated = true;
  }

  if (qualifiedGroups.length > identifierDataMap.size || junctions.length > edges.length) {
    truncated = true;
  }

  return {
    nodes: filteredNodes,
    edges,
    truncated,
  };
}

/**
 * Retrieve connected subgraph up to N hops starting from a report or identifier node.
 * Uses batched BFS with visited sets to guarantee cycle freedom and zero N+1 queries.
 * Strictly enforces 100-node and 250-edge caps during every expansion step.
 *
 * @param {object} options
 * @param {string} options.start - Starting report ID or identifier ID
 * @param {number} [options.depth=2] - Traversal depth (1 <= depth <= 3)
 * @param {boolean} [options.flaggedOnly=false]
 * @param {number} [options.limit=100]
 * @returns {Promise<{ nodes: Array<object>, edges: Array<object>, startNodeId: string, truncated: boolean }>}
 */
async function getConnectedSubgraph({
  start,
  depth = 2,
  flaggedOnly = false,
  limit = MAX_GRAPH_NODES,
}) {
  const boundedDepth = Math.min(Math.max(depth, 1), 3);
  const maxNodes = Math.min(Math.max(limit, 1), MAX_GRAPH_NODES);
  let truncated = false;

  // Determine starting entity type (report vs identifier)
  // If flaggedOnly is requested, starting identifier MUST be flagged
  const [startReport, startIdentifier] = await Promise.all([
    prisma.report.findFirst({
      where: { id: start, status: 'verified' },
      select: { id: true },
    }),
    prisma.identifier.findFirst({
      where: {
        id: start,
        ...(flaggedOnly ? { flagged: true } : {}),
        reports: { some: { report: { status: 'verified' } } },
      },
      select: { id: true },
    }),
  ]);

  if (!startReport && !startIdentifier) {
    return { nodes: [], edges: [], startNodeId: start, truncated: false };
  }

  const visitedReportIds = new Set();
  const visitedIdentifierIds = new Set();
  let frontierReportIds = new Set();
  let frontierIdentifierIds = new Set();

  if (startReport) {
    visitedReportIds.add(startReport.id);
    frontierReportIds.add(startReport.id);
  } else {
    visitedIdentifierIds.add(startIdentifier.id);
    frontierIdentifierIds.add(startIdentifier.id);
  }

  // Batched BFS traversal up to boundedDepth hops
  for (let step = 0; step < boundedDepth; step++) {
    if (visitedReportIds.size + visitedIdentifierIds.size >= maxNodes) {
      truncated = true;
      break;
    }

    const nextFrontierReportIds = new Set();
    const nextFrontierIdentifierIds = new Set();

    // 1. Expand from frontier reports to identifiers
    if (frontierReportIds.size > 0) {
      const links = await prisma.reportIdentifier.findMany({
        where: {
          reportId: { in: Array.from(frontierReportIds) },
          report: { status: 'verified' },
          ...(flaggedOnly ? { identifier: { flagged: true } } : {}),
        },
        select: { identifierId: true },
      });

      for (const l of links) {
        if (!visitedIdentifierIds.has(l.identifierId)) {
          if (visitedReportIds.size + visitedIdentifierIds.size >= maxNodes) {
            truncated = true;
            break;
          }
          visitedIdentifierIds.add(l.identifierId);
          nextFrontierIdentifierIds.add(l.identifierId);
        }
      }
    }

    // 2. Expand from frontier identifiers to reports
    if (frontierIdentifierIds.size > 0 && visitedReportIds.size + visitedIdentifierIds.size < maxNodes) {
      const links = await prisma.reportIdentifier.findMany({
        where: {
          identifierId: { in: Array.from(frontierIdentifierIds) },
          report: { status: 'verified' },
        },
        select: { reportId: true },
      });

      for (const l of links) {
        if (!visitedReportIds.has(l.reportId)) {
          if (visitedReportIds.size + visitedIdentifierIds.size >= maxNodes) {
            truncated = true;
            break;
          }
          visitedReportIds.add(l.reportId);
          nextFrontierReportIds.add(l.reportId);
        }
      }
    }

    frontierReportIds = nextFrontierReportIds;
    frontierIdentifierIds = nextFrontierIdentifierIds;

    if (frontierReportIds.size === 0 && frontierIdentifierIds.size === 0) break;
  }

  // Fetch full records for all visited entities in 2 parallel batch queries
  const [visitedReports, visitedIdentifiers, junctionEdges] = await Promise.all([
    prisma.report.findMany({
      where: {
        id: { in: Array.from(visitedReportIds) },
        status: 'verified',
      },
      select: {
        id: true,
        companyNameRaw: true,
        status: true,
        riskAssessments: {
          where: { isCurrent: true },
          select: { score: true, category: true },
        },
        clusters: {
          select: {
            cluster: { select: { id: true, name: true } },
          },
        },
      },
    }),
    prisma.identifier.findMany({
      where: {
        id: { in: Array.from(visitedIdentifierIds) },
        ...(flaggedOnly ? { flagged: true } : {}),
      },
      select: {
        id: true,
        type: true,
        value: true,
        riskScore: true,
        flagged: true,
        confidence: true,
      },
    }),
    prisma.reportIdentifier.findMany({
      where: {
        reportId: { in: Array.from(visitedReportIds) },
        identifierId: { in: Array.from(visitedIdentifierIds) },
        report: { status: 'verified' },
      },
      select: {
        reportId: true,
        identifierId: true,
        confidence: true,
      },
    }),
  ]);

  // Index relations for fast metadata attribution
  const reportIdentifierMap = new Map();
  const identifierReportMap = new Map();

  for (const je of junctionEdges) {
    if (!reportIdentifierMap.has(je.reportId)) reportIdentifierMap.set(je.reportId, []);
    reportIdentifierMap.get(je.reportId).push(je.identifierId);

    if (!identifierReportMap.has(je.identifierId)) identifierReportMap.set(je.identifierId, []);
    identifierReportMap.get(je.identifierId).push(je.reportId);
  }

  const nodes = [];
  const includedNodeIds = new Set();

  for (const r of visitedReports) {
    if (nodes.length >= maxNodes) {
      truncated = true;
      break;
    }
    const formatted = formatReportNode(r);
    formatted.data.identifierIds = reportIdentifierMap.get(r.id) || [];
    nodes.push(formatted);
    includedNodeIds.add(r.id);
  }

  const identifierLookup = new Map();
  for (const i of visitedIdentifiers) {
    if (nodes.length >= maxNodes) {
      truncated = true;
      break;
    }
    identifierLookup.set(i.id, i);
    const linkedReports = identifierReportMap.get(i.id) || [];
    nodes.push(formatIdentifierNode(i, linkedReports));
    includedNodeIds.add(i.id);
  }

  const edges = [];
  for (const je of junctionEdges) {
    if (edges.length >= MAX_GRAPH_EDGES) {
      truncated = true;
      break;
    }
    // Strict endpoint check: never return edges whose endpoint nodes are missing
    if (includedNodeIds.has(je.identifierId) && includedNodeIds.has(je.reportId)) {
      const ident = identifierLookup.get(je.identifierId);
      if (ident) {
        edges.push(formatEdge(ident, je.reportId, je.confidence));
      }
    }
  }

  return {
    nodes,
    edges,
    startNodeId: start,
    truncated,
  };
}

/**
 * Unified entry point for Trust Graph queries.
 *
 * @param {object} params - Validated query parameters
 * @returns {Promise<{ nodes: Array<object>, edges: Array<object>, truncated: boolean }>}
 */
async function getTrustGraph(params = {}) {
  const { start, depth = 2, flaggedOnly = false, limit = MAX_GRAPH_NODES } = params;

  if (start && typeof start === 'string' && start.trim()) {
    return getConnectedSubgraph({
      start: start.trim(),
      depth,
      flaggedOnly,
      limit,
    });
  }

  return getGlobalTrustGraph({ flaggedOnly, limit });
}

/**
 * Retrieve genuine, database-backed public statistics for the landing page.
 * Strictly calculates metrics based on VERIFIED reports.
 *
 * @returns {Promise<object>} Platform statistics summary
 */
async function getPublicStats() {
  const [verifiedReports, totalIdentifiers, sharedGroups, activeClusters] = await Promise.all([
    prisma.report.count({
      where: { status: 'verified' },
    }),
    prisma.identifier.count({
      where: {
        reports: {
          some: {
            report: { status: 'verified' },
          },
        },
      },
    }),
    prisma.reportIdentifier.groupBy({
      by: ['identifierId'],
      where: {
        report: { status: 'verified' },
      },
      _count: {
        reportId: true,
      },
    }),
    prisma.cluster.count({
      where: {
        status: 'active',
        reports: {
          some: {
            report: { status: 'verified' },
          },
        },
      },
    }),
  ]);

  const sharedIdentifiers = sharedGroups.filter((g) => g._count && g._count.reportId >= 2).length;

  return {
    verifiedReports,
    totalIdentifiers,
    activeClusters,
    sharedIdentifiers,
  };
}

module.exports = {
  getTrustGraph,
  getConnectedSubgraph,
  getGlobalTrustGraph,
  getPublicStats,
  maskIdentifierForPublicGraph,
};
