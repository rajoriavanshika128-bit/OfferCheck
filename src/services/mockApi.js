import { reports as initialReports } from '../data/reports';
import { companies } from '../data/companies';
import { identifiers } from '../data/identifiers';
import { recruiters } from '../data/recruiters';
import { clusters } from '../data/clusters';
import { auditLogs as initialAuditLogs } from '../data/auditLogs';
import { calculateRiskScore } from './riskEngine';
import { buildGraphData, getConnectedSubgraph, explainConnection } from './graphService';

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// In-memory mutable state for the demo session
let reportState = [...initialReports];
let auditState = [...initialAuditLogs];

// Mask sensitive values for non-admin users
const maskPhone = (phone) => phone ? phone.slice(0, 5) + 'XXXXX' : null;
const maskEmail = (email) => {
  if (!email) return null;
  const [local, domain] = email.split('@');
  if (!domain) return email;
  return local[0] + '***@' + domain;
};
const maskUpi = (upi) => {
  if (!upi) return null;
  const atIdx = upi.indexOf('@');
  if (atIdx < 3) return upi;
  return upi[0] + '*'.repeat(atIdx - 3) + upi.slice(atIdx - 2);
};

const applyPrivacy = (report, role) => {
  if (role === 'admin') return report;
  return {
    ...report,
    phone: maskPhone(report.phone),
    email: maskEmail(report.email),
    upiId: maskUpi(report.upiId),
  };
};

const applyIdentifierPrivacy = (identifier, role) => {
  if (role === 'admin') return identifier;
  let maskedValue = identifier.value;
  if (identifier.type === 'phone') maskedValue = maskPhone(identifier.value);
  else if (identifier.type === 'email') maskedValue = maskEmail(identifier.value);
  else if (identifier.type === 'upi') maskedValue = maskUpi(identifier.value);
  return { ...identifier, value: maskedValue };
};

export const checkOffer = async (formData) => {
  await delay(1200);

  const matchedIdentifiers = [];

  if (formData.upiId) {
    const match = identifiers.find(id =>
      id.type === 'upi' && id.value.toLowerCase() === formData.upiId.toLowerCase()
    );
    if (match) matchedIdentifiers.push(match);
  }
  if (formData.phone) {
    const normalized = formData.phone.replace(/\D/g, '');
    const match = identifiers.find(id =>
      id.type === 'phone' && id.normalizedValue.includes(normalized)
    );
    if (match) matchedIdentifiers.push(match);
  }
  if (formData.email) {
    const match = identifiers.find(id =>
      id.type === 'email' && id.value.toLowerCase() === formData.email.toLowerCase()
    );
    if (match) matchedIdentifiers.push(match);
  }
  if (formData.domain) {
    const domainClean = formData.domain
      .replace(/^https?:\/\//, '').replace(/\/$/, '').toLowerCase();
    const match = identifiers.find(id =>
      id.type === 'domain' && id.value.toLowerCase() === domainClean
    );
    if (match) matchedIdentifiers.push(match);
  }

  const connectedReportIds = new Set();
  matchedIdentifiers.forEach(id => id.reportIds.forEach(rId => connectedReportIds.add(rId)));
  const connectedReports = reportState.filter(r => connectedReportIds.has(r.id));

  const { score, factors, category, summary, disclaimer } = calculateRiskScore(formData, matchedIdentifiers, connectedReports);

  const checkId = `CHECK_${Date.now()}`;
  const result = {
    checkId,
    timestamp: new Date().toISOString(),
    formData,
    riskScore: score,
    riskCategory: category,
    riskFactors: factors,
    summary,
    disclaimer,
    matchedIdentifiers: matchedIdentifiers.map(id => applyIdentifierPrivacy(id, formData._role || 'student')),
    connectedReports: connectedReports.map(r => ({
      id: r.id, title: r.title, riskScore: r.riskScore,
      riskCategory: r.riskCategory, status: r.status,
      companyName: r.companyName, informationStatus: r.informationStatus,
    })),
    sharedIdentifiers: matchedIdentifiers.map(id => ({ ...applyIdentifierPrivacy(id, formData._role || 'student'), sharedCount: id.reportIds.length })),
  };

  const existing = JSON.parse(sessionStorage.getItem('offercheck_results') || '{}');
  existing[checkId] = result;
  sessionStorage.setItem('offercheck_results', JSON.stringify(existing));

  return result;
};

export const getReports = async (filters = {}, role = 'student') => {
  await delay(500);
  let filtered = [...reportState];

  if (filters.search) {
    const q = filters.search.toLowerCase();
    filtered = filtered.filter(r =>
      r.title.toLowerCase().includes(q) ||
      r.companyName.toLowerCase().includes(q) ||
      r.recruiterName.toLowerCase().includes(q) ||
      (r.phone && r.phone.includes(q)) ||
      (r.email && r.email.toLowerCase().includes(q)) ||
      (r.upiId && r.upiId.toLowerCase().includes(q))
    );
  }
  if (filters.riskCategory) filtered = filtered.filter(r => r.riskCategory === filters.riskCategory);
  if (filters.status) filtered = filtered.filter(r => r.status === filters.status);

  if (filters.sortBy === 'riskScore') filtered.sort((a, b) => b.riskScore - a.riskScore);
  else if (filters.sortBy === 'date') filtered.sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
  else filtered.sort((a, b) => b.riskScore - a.riskScore);

  const page = filters.page || 1;
  const limit = filters.limit || 10;
  const start = (page - 1) * limit;
  const paginated = filtered.slice(start, start + limit).map(r => applyPrivacy(r, role));

  return { reports: paginated, total: filtered.length, page, totalPages: Math.ceil(filtered.length / limit) };
};

export const getReportById = async (id, role = 'student') => {
  await delay(400);
  const report = reportState.find(r => r.id === id);
  if (!report) throw new Error('Report not found');

  const reportIdentifiers = identifiers
    .filter(ident => report.identifierIds.includes(ident.id))
    .map(ident => applyIdentifierPrivacy(ident, role));

  const connectedReportIds = new Set();
  identifiers
    .filter(ident => report.identifierIds.includes(ident.id))
    .forEach(ident => ident.reportIds.forEach(rId => { if (rId !== id) connectedReportIds.add(rId); }));
  const connectedReports = reportState
    .filter(r => connectedReportIds.has(r.id))
    .map(r => applyPrivacy(r, role));

  return { ...applyPrivacy(report, role), identifiers: reportIdentifiers, connectedReports };
};

export const searchIdentifiers = async (query, type, role = 'student') => {
  await delay(400);
  let results = [...identifiers];
  if (query) {
    const q = query.toLowerCase();
    results = results.filter(id =>
      id.value.toLowerCase().includes(q) || id.normalizedValue.toLowerCase().includes(q)
    );
  }
  if (type) results = results.filter(id => id.type === type);
  return results.slice(0, 20).map(id => applyIdentifierPrivacy(id, role));
};

export const getConnectedReports = async (reportId, role = 'student') => {
  await delay(500);
  const report = reportState.find(r => r.id === reportId);
  if (!report) return [];
  const reportIdentifiers = identifiers.filter(id => report.identifierIds.includes(id.id));
  const connectedIds = new Set();
  reportIdentifiers.forEach(ident => ident.reportIds.forEach(rId => { if (rId !== reportId) connectedIds.add(rId); }));
  return reportState.filter(r => connectedIds.has(r.id)).map(r => applyPrivacy(r, role));
};

export const getTrustGraph = async (filters = {}) => {
  await delay(600);
  return buildGraphData(reportState, identifiers, filters);
};

export const getSubgraph = async (nodeId, depth = 2) => {
  await delay(400);
  return getConnectedSubgraph(nodeId, reportState, identifiers, depth);
};

export const explainReportConnection = async (reportIdA, reportIdB) => {
  await delay(300);
  return explainConnection(reportIdA, reportIdB, reportState, identifiers);
};

export const getDashboardStats = async (userId) => {
  await delay(400);
  const userReports = userId ? reportState.filter(r => r.submittedBy === userId) : [];
  const stored = JSON.parse(sessionStorage.getItem('offercheck_results') || '{}');
  const checksCount = Object.keys(stored).length;
  const recentChecks = Object.values(stored).slice(-5).reverse();

  return {
    totalChecks: checksCount + 12,
    reportsSubmitted: userReports.length,
    activeAlerts: reportState.filter(r => r.riskCategory === 'critical' || r.riskCategory === 'high').length,
    avgRiskScore: Math.round(reportState.reduce((sum, r) => sum + r.riskScore, 0) / reportState.length),
    recentChecks,
    riskAlerts: reportState.filter(r => r.riskCategory === 'critical').slice(0, 5),
    weeklyActivity: [
      { day: 'Mon', checks: 3 }, { day: 'Tue', checks: 5 }, { day: 'Wed', checks: 2 },
      { day: 'Thu', checks: 7 }, { day: 'Fri', checks: 4 }, { day: 'Sat', checks: 1 }, { day: 'Sun', checks: 6 },
    ],
  };
};

export const updateReportStatus = async (reportId, status, notes) => {
  await delay(600);
  const idx = reportState.findIndex(r => r.id === reportId);
  if (idx === -1) throw new Error('Report not found');

  const oldStatus = reportState[idx].status;
  reportState[idx] = { ...reportState[idx], status, reviewedAt: new Date().toISOString().split('T')[0] };

  const newLog = {
    id: `AL${Date.now()}`,
    action: 'STATUS_CHANGED',
    reportId,
    userId: 'U002',
    userName: 'Demo Administrator',
    oldStatus,
    newStatus: status,
    notes: notes || '',
    timestamp: new Date().toISOString(),
  };
  auditState.unshift(newLog);

  return { success: true, report: reportState[idx], auditEntry: newLog };
};

export const getAuditLogs = async (filters = {}) => {
  await delay(400);
  let logs = [...auditState];
  if (filters.reportId) logs = logs.filter(l => l.reportId === filters.reportId);
  if (filters.userId) logs = logs.filter(l => l.userId === filters.userId);
  if (filters.action) logs = logs.filter(l => l.action === filters.action);
  return logs.slice(0, filters.limit || 50);
};

export const submitReport = async (reportData) => {
  await delay(1000);
  const newReport = {
    id: `R${String(reportState.length + 1).padStart(3, '0')}`,
    ...reportData,
    status: 'pending',
    informationStatus: { isVerified: false, isInferred: false, isReported: true },
    submittedAt: new Date().toISOString().split('T')[0],
    reviewedBy: null, reviewedAt: null,
    identifierIds: [], clusterIds: [], riskFactors: [],
  };
  reportState.push(newReport);
  return newReport;
};

export const getIdentifierById = async (identifierId, role = 'student') => {
  await delay(300);
  const identifier = identifiers.find(ident => ident.id === identifierId);
  if (!identifier) throw new Error('Identifier not found');
  const relatedReports = reportState.filter(r => r.identifierIds.includes(identifier.id));
  return { ...applyIdentifierPrivacy(identifier, role), reports: relatedReports };
};

export const getClusters = async () => {
  await delay(400);
  return clusters;
};

export const getAdminStats = async () => {
  await delay(500);
  return {
    totalReports: reportState.length,
    pendingReports: reportState.filter(r => r.status === 'pending').length,
    verifiedReports: reportState.filter(r => r.status === 'verified').length,
    rejectedReports: reportState.filter(r => r.status === 'rejected').length,
    investigatingReports: reportState.filter(r => r.status === 'investigating').length,
    totalIdentifiers: identifiers.length,
    flaggedIdentifiers: identifiers.filter(id => id.flagged).length,
    activeClusters: clusters.length,
    criticalReports: reportState.filter(r => r.riskCategory === 'critical').length,
    highReports: reportState.filter(r => r.riskCategory === 'high').length,
    mediumReports: reportState.filter(r => r.riskCategory === 'medium').length,
    lowReports: reportState.filter(r => r.riskCategory === 'low').length,
  };
};

export { companies, recruiters };

