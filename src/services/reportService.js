/**
 * src/services/reportService.js
 * Domain service for fraud incident reports, public discovery, and report bookmarking.
 * Interfaces with real backend endpoints:
 * - POST   /api/reports           (Report submission)
 * - GET    /api/reports           (Public verified report discovery)
 * - GET    /api/reports/me        (User submitted reports)
 * - GET    /api/reports/saved     (User saved reports)
 * - GET    /api/reports/:id       (Single report details)
 * - GET    /api/reports/:id/related (Related reports)
 * - POST   /api/reports/:id/save  (Save report bookmark)
 * - DELETE /api/reports/:id/save  (Remove saved bookmark)
 */

import api from './api.js';

export const reportService = {
  /**
   * Discover public verified reports with search, filtering, and pagination.
   * Calls GET /api/reports.
   *
   * @param {object} [params={}] - { page, limit, search, sortBy, sortOrder }
   * @returns {Promise<{ success: boolean, reports: Array<object>, pagination: object }>}
   */
  async getReports(params = {}) {
    const query = new URLSearchParams();
    if (params.page) query.set('page', String(params.page));
    if (params.limit) query.set('limit', String(params.limit));
    if (params.search?.trim()) query.set('search', params.search.trim());
    if (params.sortBy) query.set('sortBy', params.sortBy);
    if (params.sortOrder) query.set('sortOrder', params.sortOrder);

    const queryString = query.toString();
    const endpoint = `/api/reports${queryString ? `?${queryString}` : ''}`;
    return api.get(endpoint);
  },

  /**
   * Retrieve single report details by ID.
   * Calls GET /api/reports/:id.
   *
   * @param {string} reportId - UUID
   * @returns {Promise<object>} Report object
   */
  async getReportById(reportId) {
    const res = await api.get(`/api/reports/${reportId}`);
    return res.report;
  },

  /**
   * Retrieve related reports sharing contact identifiers with source report.
   * Calls GET /api/reports/:id/related.
   *
   * @param {string} reportId - UUID
   * @returns {Promise<Array<object>>} Array of related reports
   */
  async getRelatedReports(reportId) {
    const res = await api.get(`/api/reports/${reportId}/related`);
    return res.relatedReports || [];
  },

  /**
   * Submit a new fraud incident report.
   * Calls POST /api/reports.
   *
   * @param {object} formData
   * @returns {Promise<object>} Created Report object
   */
  async submitReport(formData) {
    const payload = {
      companyName: formData.companyName?.trim() || '',
      offerMessage: formData.offerMessage?.trim() || '',
    };

    if (formData.recruiterName?.trim()) payload.recruiterName = formData.recruiterName.trim();
    if (formData.domain?.trim()) payload.domain = formData.domain.trim();
    if (formData.phone?.trim()) payload.phone = formData.phone.trim();
    if (formData.email?.trim()) payload.email = formData.email.trim();
    if (formData.upiId?.trim()) payload.upi = formData.upiId.trim();
    else if (formData.upi?.trim()) payload.upi = formData.upi.trim();
    if (formData.paymentRequest?.trim()) payload.paymentRequest = formData.paymentRequest.trim();
    if (formData.additionalNotes?.trim()) payload.additionalNotes = formData.additionalNotes.trim();

    const res = await api.post('/api/reports', payload);
    return res.report;
  },

  /**
   * Bookmark / save a report for the authenticated user.
   * Calls POST /api/reports/:id/save.
   *
   * @param {string} reportId
   * @returns {Promise<object>}
   */
  async saveReport(reportId) {
    return api.post(`/api/reports/${reportId}/save`);
  },

  /**
   * Remove a saved report bookmark.
   * Calls DELETE /api/reports/:id/save.
   *
   * @param {string} reportId
   * @returns {Promise<object>}
   */
  async removeSavedReport(reportId) {
    return api.delete(`/api/reports/${reportId}/save`);
  },

  /**
   * Retrieve the authenticated user's submitted reports across all statuses.
   * Calls GET /api/reports/me.
   *
   * @param {object} [params={}]
   * @returns {Promise<{ success: boolean, reports: Array<object>, pagination: object }>}
   */
  async getMyReports(params = {}) {
    const query = new URLSearchParams();
    if (params.page) query.set('page', String(params.page));
    if (params.limit) query.set('limit', String(params.limit));
    if (params.status) query.set('status', params.status);
    if (params.search?.trim()) query.set('search', params.search.trim());

    const queryString = query.toString();
    const endpoint = `/api/reports/me${queryString ? `?${queryString}` : ''}`;
    return api.get(endpoint);
  },

  /**
   * Retrieve the authenticated user's saved report bookmarks.
   * Calls GET /api/reports/saved.
   *
   * @param {object} [params={}]
   * @returns {Promise<{ success: boolean, reports: Array<object>, pagination: object }>}
   */
  async getSavedReports(params = {}) {
    const query = new URLSearchParams();
    if (params.page) query.set('page', String(params.page));
    if (params.limit) query.set('limit', String(params.limit));

    const queryString = query.toString();
    const endpoint = `/api/reports/saved${queryString ? `?${queryString}` : ''}`;
    return api.get(endpoint);
  },
};

export default reportService;
