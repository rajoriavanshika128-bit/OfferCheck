/**
 * src/services/checkService.js
 * Domain service for offer checks and student dashboard metrics.
 */

import api from './api.js';

export const checkService = {
  /**
   * Retrieve aggregated dashboard metrics for authenticated user.
   * Calls GET /api/checks/dashboard.
   *
   * @returns {Promise<object>} Dashboard metrics object
   */
  async getDashboardMetrics() {
    const res = await api.get('/api/checks/dashboard');
    return res.metrics;
  },

  /**
   * Submit an offer for risk analysis.
   * Calls POST /api/checks.
   *
   * @param {object} formData
   * @returns {Promise<object>} Sanitized OfferCheck record
   */
  async checkOffer(formData) {
    const messageParts = [
      formData.offerMessage?.trim() || '',
      formData.recruiterName?.trim() ? `Recruiter: ${formData.recruiterName.trim()}` : null,
      formData.additionalNotes?.trim() ? `Additional Notes: ${formData.additionalNotes.trim()}` : null,
    ].filter(Boolean);

    const payload = {
      offerMessage: messageParts.join('\n\n') || formData.offerMessage?.trim() || '',
    };

    if (formData.companyName?.trim()) payload.companyName = formData.companyName.trim();
    if (formData.domain?.trim()) payload.domain = formData.domain.trim();
    if (formData.phone?.trim()) payload.phone = formData.phone.trim();
    if (formData.email?.trim()) payload.email = formData.email.trim();
    if (formData.upiId?.trim()) payload.upi = formData.upiId.trim();
    if (formData.paymentRequest?.trim()) payload.paymentRequest = formData.paymentRequest.trim();

    const res = await api.post('/api/checks', payload);
    return res.check;
  },

  /**
   * Retrieve a specific offer check by ID.
   * Calls GET /api/checks/:id.
   *
   * @param {string} checkId
   * @returns {Promise<object>} Sanitized OfferCheck record
   */
  async getCheckById(checkId) {
    const res = await api.get(`/api/checks/${checkId}`);
    return res.check;
  },
};

export default checkService;
