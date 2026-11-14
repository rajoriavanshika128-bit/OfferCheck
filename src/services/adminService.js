/**
 * src/services/adminService.js
 * Domain service for administrative operations:
 * - Platform analytics & KPIs (GET /api/admin/stats)
 * - Report moderation listing & filtering (GET /api/admin/reports)
 * - Atomic status transitions (PATCH /api/admin/reports/:id)
 * - Identifier intelligence (GET /api/admin/identifiers)
 * - Fraud actor clusters (GET /api/admin/clusters)
 * - Audit trail (GET /api/admin/audit-logs)
 *
 * Interfaces with real backend endpoints only. Zero mock or static business data.
 */

import api from './api.js';

export const adminService = {
  /**
   * Retrieve aggregated platform analytics for admin dashboard overview.
   * Calls GET /api/admin/stats.
   *
   * @returns {Promise<object>} Normalized KPI stats and distributions
   */
  async getAdminStats() {
    const res = await api.get('/api/admin/stats');
    const stats = res.stats || {};

    return {
      totalReports: stats.totalReports ?? 0,
      pendingReports: stats.reportsByStatus?.pending ?? 0,
      verifiedReports: stats.reportsByStatus?.verified ?? 0,
      rejectedReports: stats.reportsByStatus?.rejected ?? 0,
      investigatingReports: stats.reportsByStatus?.investigating ?? 0,
      criticalReports: stats.riskDistribution?.critical ?? 0,
      highReports: stats.riskDistribution?.high ?? 0,
      mediumReports: stats.riskDistribution?.medium ?? 0,
      lowReports: stats.riskDistribution?.low ?? 0,
      totalIdentifiers: stats.totalIdentifiers ?? 0,
      flaggedIdentifiers: stats.flaggedIdentifiers ?? 0,
      activeClusters: stats.activeClusters ?? 0,
      totalUsers: stats.totalUsers ?? 0,
      totalChecks: stats.totalChecks ?? 0,
      raw: stats,
    };
  },

  /**
   * Retrieve paginated reports for moderation across statuses.
   * Calls GET /api/admin/reports.
   *
   * @param {object} [params={}] - { page, limit, status, search, sortBy, sortOrder }
   * @returns {Promise<{ reports: Array<object>, pagination: object }>}
   */
  async getAdminReports(params = {}) {
    const query = new URLSearchParams();
    if (params.page) query.set('page', String(params.page));
    if (params.limit) query.set('limit', String(params.limit));
    if (params.status) query.set('status', params.status);
    if (params.search?.trim()) query.set('search', params.search.trim());
    if (params.sortBy) query.set('sortBy', params.sortBy);
    if (params.sortOrder) query.set('sortOrder', params.sortOrder);

    const queryString = query.toString();
    const endpoint = `/api/admin/reports${queryString ? `?${queryString}` : ''}`;
    const res = await api.get(endpoint);

    const rawReports = res.reports || [];
    const normalizedReports = rawReports.map((r) => {
      const currentRisk = r.riskAssessments?.[0] || {};
      return {
        ...r,
        companyName: r.companyName || r.companyNameRaw || r.company?.name || 'Unknown Company',
        riskScore: r.riskScore !== undefined ? r.riskScore : (currentRisk.score ?? 0),
        riskCategory: r.riskCategory || currentRisk.category || 'low',
      };
    });

    return {
      reports: normalizedReports,
      pagination: res.pagination || {
        page: 1,
        limit: 20,
        total: normalizedReports.length,
        totalPages: 1,
      },
    };
  },

  /**
   * Retrieve single report details for admin inspection.
   * Calls GET /api/admin/reports/:id.
   *
   * @param {string} reportId - UUID
   * @returns {Promise<object>} Report object
   */
  async getAdminReportById(reportId) {
    const res = await api.get(`/api/admin/reports/${reportId}`);
    return res.report;
  },

  /**
   * Execute an atomic status transition on a report.
   * Calls PATCH /api/admin/reports/:id.
   *
   * @param {string} reportId - UUID
   * @param {string} status - 'verified' | 'rejected' | 'investigating'
   * @param {string} [notes] - Review notes
   * @returns {Promise<object>}
   */
  async updateReportStatus(reportId, status, notes = '') {
    const payload = { status };
    if (notes && typeof notes === 'string' && notes.trim()) {
      payload.notes = notes.trim();
    }
    return api.patch(`/api/admin/reports/${reportId}`, payload);
  },

  /**
   * Retrieve paginated identifiers with type, flagged, and search filters.
   * Calls GET /api/admin/identifiers.
   *
   * @param {object} [params={}] - { page, limit, type, flagged, search, sortBy, sortOrder }
   * @returns {Promise<{ identifiers: Array<object>, pagination: object }>}
   */
  async getAdminIdentifiers(params = {}) {
    const query = new URLSearchParams();
    if (params.page) query.set('page', String(params.page));
    if (params.limit) query.set('limit', String(params.limit));
    if (params.type && params.type !== 'all') query.set('type', params.type);
    if (params.flagged !== undefined && params.flagged !== 'all' && params.flagged !== '') {
      query.set('flagged', String(params.flagged));
    }
    if (params.search?.trim()) query.set('search', params.search.trim());
    if (params.sortBy) query.set('sortBy', params.sortBy);
    if (params.sortOrder) query.set('sortOrder', params.sortOrder);

    const queryString = query.toString();
    const endpoint = `/api/admin/identifiers${queryString ? `?${queryString}` : ''}`;
    const res = await api.get(endpoint);

    return {
      identifiers: res.identifiers || [],
      pagination: res.pagination || {
        page: 1,
        limit: 20,
        total: 0,
        totalPages: 1,
      },
    };
  },

  /**
   * Retrieve fraud actor clusters with member report IDs and shared identifiers.
   * Calls GET /api/admin/clusters.
   *
   * @returns {Promise<Array<object>>}
   */
  async getAdminClusters() {
    const res = await api.get('/api/admin/clusters');
    return res.clusters || [];
  },

  /**
   * Retrieve immutable audit trail with action filtering and pagination.
   * Calls GET /api/admin/audit-logs.
   *
   * @param {object} [params={}] - { page, limit, action, reportId }
   * @returns {Promise<{ logs: Array<object>, pagination: object }>}
   */
  async getAdminAuditLogs(params = {}) {
    const query = new URLSearchParams();
    if (params.page) query.set('page', String(params.page));
    if (params.limit) query.set('limit', String(params.limit));
    if (params.action && params.action !== 'all') query.set('action', params.action);
    if (params.reportId) query.set('reportId', params.reportId);

    const queryString = query.toString();
    const endpoint = `/api/admin/audit-logs${queryString ? `?${queryString}` : ''}`;
    const res = await api.get(endpoint);

    return {
      logs: res.logs || [],
      pagination: res.pagination || {
        page: 1,
        limit: 50,
        total: 0,
        totalPages: 1,
      },
    };
  },
};

export default adminService;
