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

// Builds graph from REAL identifier/report relationships only
// Only includes identifiers that appear in 2+ reports (meaningful connections)
export const buildGraphData = (reports, identifiers, filters = {}) => {
  const nodes = [];
  const edges = [];
  const nodeSet = new Set();

  let sharedIdentifiers = identifiers.filter(id => id.reportIds.length >= 2);
  if (filters.flaggedOnly) {
    sharedIdentifiers = sharedIdentifiers.filter(id => id.flagged);
  }

  sharedIdentifiers.forEach(identifier => {
    if (!nodeSet.has(identifier.id)) {
      nodes.push({
        id: identifier.id,
        type: identifier.type,
        label: identifier.value.length > 25 ? identifier.value.substring(0, 22) + '...' : identifier.value,
        fullLabel: identifier.value,
        riskScore: identifier.riskScore,
        flagged: identifier.flagged,
        reportCount: identifier.reportIds.length,
        confidence: identifier.confidence || 'medium',
        data: identifier,
      });
      nodeSet.add(identifier.id);
    }

    identifier.reportIds.forEach(reportId => {
      const report = reports.find(r => r.id === reportId);
      if (!report) return;

      if (!nodeSet.has(reportId)) {
        nodes.push({
          id: reportId,
          type: 'report',
          label: report.companyName.length > 20
            ? report.companyName.substring(0, 17) + '...'
            : report.companyName,
          fullLabel: report.title,
          riskScore: report.riskScore,
          riskCategory: report.riskCategory,
          status: report.status,
          data: report,
        });
        nodeSet.add(reportId);
      }

      const edgeId = `${identifier.id}-${reportId}`;
      if (!edges.find(e => e.id === edgeId)) {
        edges.push({
          id: edgeId,
          source: identifier.id,
          target: reportId,
          type: identifier.type,
          label: `shares ${identifier.type}`,
          confidence: identifier.confidence || 'medium',
          connectionBasis: `Report ${reportId} shares ${identifier.type} "${identifier.value}" with ${identifier.reportIds.filter(r => r !== reportId).join(', ')}`,
        });
      }
    });
  });

  return { nodes, edges };
};

// BFS traversal up to `depth` hops from a starting node
export const getConnectedSubgraph = (nodeId, reports, identifiers, depth = 2) => {
  const visitedNodes = new Set();
  const visitedEdges = new Set();
  const resultNodes = [];
  const resultEdges = [];

  const traverse = (currentId, currentDepth) => {
    if (currentDepth > depth || visitedNodes.has(currentId)) return;
    visitedNodes.add(currentId);

    const report = reports.find(r => r.id === currentId);
    const identifier = identifiers.find(id => id.id === currentId);

    if (report) {
      resultNodes.push({
        id: currentId, type: 'report',
        label: report.companyName, fullLabel: report.title,
        riskScore: report.riskScore, riskCategory: report.riskCategory,
        status: report.status, data: report,
      });
      report.identifierIds.forEach(idId => {
        const edgeId = `${idId}-${currentId}`;
        if (!visitedEdges.has(edgeId)) {
          visitedEdges.add(edgeId);
          const ident = identifiers.find(i => i.id === idId);
          if (ident) {
            resultEdges.push({
              id: edgeId, source: idId, target: currentId,
              type: ident.type, confidence: ident.confidence || 'medium',
              label: `shares ${ident.type}`,
            });
            traverse(idId, currentDepth + 1);
          }
        }
      });
    } else if (identifier) {
      resultNodes.push({
        id: currentId, type: identifier.type,
        label: identifier.value.length > 25 ? identifier.value.substring(0, 22) + '...' : identifier.value,
        fullLabel: identifier.value,
        riskScore: identifier.riskScore, flagged: identifier.flagged,
        reportCount: identifier.reportIds.length, confidence: identifier.confidence || 'medium',
        data: identifier,
      });
      identifier.reportIds.forEach(rId => {
        const edgeId = `${currentId}-${rId}`;
        if (!visitedEdges.has(edgeId)) {
          visitedEdges.add(edgeId);
          resultEdges.push({
            id: edgeId, source: currentId, target: rId,
            type: identifier.type, confidence: identifier.confidence || 'medium',
            label: `shares ${identifier.type}`,
          });
          traverse(rId, currentDepth + 1);
        }
      });
    }
  };

  traverse(nodeId, 0);
  return { nodes: resultNodes, edges: resultEdges, startNodeId: nodeId };
};

// Plain-language explanation of why two reports are connected
export const explainConnection = (reportIdA, reportIdB, reports, identifiers) => {
  const reportA = reports.find(r => r.id === reportIdA);
  const reportB = reports.find(r => r.id === reportIdB);
  if (!reportA || !reportB) return null;

  const idsA = new Set(reportA.identifierIds);
  const sharedIdentifiers = identifiers.filter(id => idsA.has(id.id) && id.reportIds.includes(reportIdB));

  if (sharedIdentifiers.length === 0) {
    // Check 2-hop: identifiers of A that share any report with any identifier of B
    const idsB = new Set(reportB.identifierIds);
    const indirectLinks = [];
    identifiers.filter(id => idsA.has(id.id)).forEach(idA => {
      identifiers.filter(id => idsB.has(id.id)).forEach(idB => {
        const sharedReports = idA.reportIds.filter(r => idB.reportIds.includes(r) && r !== reportIdA && r !== reportIdB);
        if (sharedReports.length > 0) {
          indirectLinks.push({ identifierA: idA, identifierB: idB, throughReports: sharedReports });
        }
      });
    });
    if (indirectLinks.length > 0) {
      return {
        type: 'indirect',
        sharedIdentifiers: [],
        indirectLinks,
        confidence: 'low',
        explanation: `These two reports are not directly linked but share a 2-hop connection: ${indirectLinks.map(l => `${reportIdA}'s ${l.identifierA.type} and ${reportIdB}'s ${l.identifierB.type} both appear in report(s) ${l.throughReports.join(', ')}`).join('; ')}.`,
        hops: 2,
      };
    }
    return { type: 'none', sharedIdentifiers: [], confidence: 'none', explanation: 'No direct or indirect connection found between these two reports in the current dataset.', hops: null };
  }

  const highestConfidence = sharedIdentifiers.some(id => id.confidence === 'high') ? 'high' : sharedIdentifiers.some(id => id.confidence === 'medium') ? 'medium' : 'low';
  const descriptions = sharedIdentifiers.map(id => `${id.type} "${id.value}"`).join(', ');

  return {
    type: 'direct',
    sharedIdentifiers,
    confidence: highestConfidence,
    explanation: `Reports ${reportIdA} (${reportA.companyName}) and ${reportIdB} (${reportB.companyName}) are directly linked by shared ${descriptions}. This means the same ${sharedIdentifiers[0].type} was used in both cases, suggesting a common fraud actor or infrastructure.`,
    hops: 1,
  };
};

// Calculate positions for SVG graph layout
export const calculateNodePositions = (nodes, canvasWidth = 900, canvasHeight = 600) => {
  const positions = {};
  const typeGroups = { upi: [], phone: [], email: [], domain: [], bank_account: [], report: [] };

  nodes.forEach(node => {
    const group = typeGroups[node.type] || typeGroups.report;
    group.push(node);
  });

  // Identifier types placed in a band; reports around them
  const typePositions = {
    upi:          { cx: canvasWidth * 0.25, cy: canvasHeight * 0.25 },
    phone:        { cx: canvasWidth * 0.75, cy: canvasHeight * 0.25 },
    email:        { cx: canvasWidth * 0.25, cy: canvasHeight * 0.75 },
    domain:       { cx: canvasWidth * 0.75, cy: canvasHeight * 0.75 },
    bank_account: { cx: canvasWidth * 0.5,  cy: canvasHeight * 0.15 },
  };

  // Place identifier nodes — radius scales with group size to prevent overlap
  Object.entries(typeGroups).forEach(([type, group]) => {
    if (type === 'report') return;
    const center = typePositions[type] || { cx: canvasWidth * 0.5, cy: canvasHeight * 0.5 };
    // Minimum 44px arc-length per node at the chosen radius avoids label collisions.
    // For 1 node: radius 0 (placed at center). For 2+: at least 44px per node around circumference.
    const minArcLength = 44;
    const radius = group.length > 1
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

  // Place report nodes around the center
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

