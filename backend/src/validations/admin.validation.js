'use strict';

/**
 * backend/src/validations/admin.validation.js
 * Zod validation schemas for administrative endpoints:
 * - GET /api/admin/identifiers
 * - GET /api/admin/audit-logs
 */

const { z } = require('zod');

const IDENTIFIER_TYPES = Object.freeze([
  'phone',
  'email',
  'upi',
  'domain',
  'bank_account',
]);

const AUDIT_ACTIONS = Object.freeze([
  'STATUS_CHANGED',
  'IDENTIFIER_FLAGGED',
  'IDENTIFIER_REVEALED',
  'CLUSTER_CREATED',
  'CLUSTER_UPDATED',
  'REPORT_FLAGGED',
  'REPORT_SUBMITTED',
  'REPORT_DELETED',
  'USER_BANNED',
]);

const pageQuerySchema = z.preprocess((val) => {
  if (val === undefined || val === null) return 1;
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (trimmed === '') return NaN;
    return Number(trimmed);
  }
  return val;
}, z.number({ message: 'Page must be a valid number' })
    .int('Page must be an integer')
    .min(1, 'Page must be at least 1')
    .default(1));

const limitQuerySchema = z.preprocess((val) => {
  if (val === undefined || val === null) return 20;
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (trimmed === '') return NaN;
    return Number(trimmed);
  }
  return val;
}, z.number({ message: 'Limit must be a valid number' })
    .int('Limit must be an integer')
    .min(1, 'Limit must be at least 1')
    .max(100, 'Limit cannot exceed 100')
    .default(20));

const optionalSearchString = (maxLen, fieldName) =>
  z.preprocess((val) => {
    if (val === undefined || val === null) return undefined;
    if (typeof val === 'string') {
      const trimmed = val.trim();
      return trimmed === '' ? undefined : trimmed;
    }
    return val;
  }, z.string({ invalid_type_error: `${fieldName} must be a string` })
      .max(maxLen, `${fieldName} must be ${maxLen} characters or less`)
      .optional());

/**
 * Query schema for GET /api/admin/identifiers
 */
const adminIdentifierQuerySchema = z
  .object({
    page: pageQuerySchema,
    limit: limitQuerySchema,
    type: z
      .enum([...IDENTIFIER_TYPES, 'all'], {
        message: 'Invalid identifier type filter',
      })
      .optional(),
    flagged: z
      .preprocess((val) => {
        if (val === undefined || val === null || val === '' || val === 'all') return undefined;
        if (val === 'true' || val === true) return true;
        if (val === 'false' || val === false) return false;
        return val;
      }, z.boolean({ message: 'Flagged filter must be a boolean' }).optional()),
    search: optionalSearchString(100, 'Search term'),
    sortBy: z
      .enum(['firstSeen', 'lastSeen', 'riskScore', 'type', 'value'], {
        message: 'Invalid sort field for identifiers',
      })
      .default('lastSeen'),
    sortOrder: z
      .enum(['asc', 'desc', 'ASC', 'DESC'], {
        message: 'Sort order must be asc or desc',
      })
      .transform((val) => val.toLowerCase())
      .default('desc'),
  })
  .strict();

/**
 * Query schema for GET /api/admin/audit-logs
 */
const adminAuditQuerySchema = z
  .object({
    page: pageQuerySchema,
    limit: limitQuerySchema,
    action: z
      .enum([...AUDIT_ACTIONS, 'all'], {
        message: 'Invalid audit action filter',
      })
      .optional(),
    reportId: z
      .string({ invalid_type_error: 'Report ID must be a string' })
      .uuid('Report ID must be a valid UUID')
      .optional(),
    sortBy: z
      .enum(['createdAt'], {
        message: 'Invalid sort field for audit logs',
      })
      .default('createdAt'),
    sortOrder: z
      .enum(['asc', 'desc', 'ASC', 'DESC'], {
        message: 'Sort order must be asc or desc',
      })
      .transform((val) => val.toLowerCase())
      .default('desc'),
  })
  .strict();

module.exports = {
  IDENTIFIER_TYPES,
  AUDIT_ACTIONS,
  adminIdentifierQuerySchema,
  adminAuditQuerySchema,
};
