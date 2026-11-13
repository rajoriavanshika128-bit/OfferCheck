'use strict';

/**
 * backend/src/validations/report.validation.js
 * Zod validation schemas for Report submission, query, and parameter handling.
 *
 * Requirements:
 * - Compatible with Express validate(schema) and validateQuery(schema) middleware.
 * - Protects against mass assignment: rejects client-supplied userId, role,
 *   status, riskScore, riskCategory, reviewer information, or audit metadata.
 * - Reusable across student and admin endpoints with strict boundaries.
 * - Conforms strictly to PostgreSQL/Prisma field length constraints (e.g. phoneRaw VARCHAR(20)).
 * - Resolves conflicting aliases cleanly and outputs canonical shapes.
 * - Separates public report discovery (verified only) from admin moderation queries.
 *
 * NOTE FOR CONTROLLERS:
 * Schema validation provides input sanitization and defense-in-depth. Controllers MUST
 * still enforce database-level query isolation (e.g., where: { status: 'verified' })
 * and authorization (req.user role checks).
 */

const { z } = require('zod');
const { SUPPORTED_TYPES } = require('../utils/normalize');
const {
  phoneSchema,
  emailSchema,
  upiSchema,
  domainSchema,
  singleIdentifierSchema,
} = require('./identifier.validation');

// Supported Prisma ReportStatus enum values
const REPORT_STATUSES = Object.freeze([
  'pending',
  'verified',
  'rejected',
  'investigating',
]);

// Actual scalar sorting fields supported by Prisma Report model
const PRISMA_REPORT_SORT_FIELDS = Object.freeze([
  'submittedAt',
  'companyNameRaw',
  'reviewedAt',
  'status',
]);

// Allowed sorting input parameters (accepting both companyName and companyNameRaw)
const SORT_FIELD_INPUTS = Object.freeze([
  'submittedAt',
  'companyName',
  'companyNameRaw',
  'reviewedAt',
  'status',
]);

const SORT_DIRECTIONS = Object.freeze(['asc', 'desc', 'ASC', 'DESC']);

/**
 * Helper to validate integer pagination query parameters.
 * Rejects empty or whitespace-only inputs with clear validation errors.
 */
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

/**
 * Helper for optional query string filters: converts empty/whitespace-only strings to undefined.
 */
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
 * Shared sortBy schema mapping companyName -> companyNameRaw for Prisma compatibility.
 */
const reportSortBySchema = z
  .enum(SORT_FIELD_INPUTS, {
    message: 'Invalid sort field',
  })
  .transform((val) => (val === 'companyName' ? 'companyNameRaw' : val))
  .default('submittedAt');

/**
 * Report submission schema (POST /api/reports).
 *
 * Mandatory fields:
 * - companyName (or companyNameRaw): 1-200 characters.
 * - offerMessage: 1-20,000 characters.
 *
 * Optional fields (genuinely optional, nullable):
 * - recruiterName (or recruiterNameRaw): max 120 characters.
 * - domain (or domainRaw): max 253 characters (format validated).
 * - phone (or phoneRaw): max 20 characters (format validated, matches Prisma phoneRaw VARCHAR(20)).
 * - email (or emailRaw): max 254 characters (format validated).
 * - upi (or upiRaw): max 80 characters (format validated).
 * - paymentRequest: max 300 characters.
 * - additionalNotes (or additionalInfo): max 5,000 characters.
 * - identifiers: array of up to 20 { type, value } objects.
 *
 * Conflicting aliases:
 * - Rejects conflicting values when both canonical and alias fields are supplied.
 * - Transforms output to canonical shapes for consistent controller consumption.
 *
 * Strictly rejected:
 * - userId, submittedBy, reviewedBy, status, role, isVerified, isInferred,
 *   riskScore, riskCategory, id, createdAt, updatedAt, audit fields.
 */
const createReportSchema = z
  .object({
    companyName: z
      .string({ invalid_type_error: 'Company name must be a string' })
      .trim()
      .min(1, 'Company name cannot be empty')
      .max(200, 'Company name must be 200 characters or less')
      .optional(),
    companyNameRaw: z
      .string({ invalid_type_error: 'Company name must be a string' })
      .trim()
      .min(1, 'Company name cannot be empty')
      .max(200, 'Company name must be 200 characters or less')
      .optional(),
    recruiterName: z
      .string({ invalid_type_error: 'Recruiter name must be a string' })
      .trim()
      .min(1, 'Recruiter name cannot be empty')
      .max(120, 'Recruiter name must be 120 characters or less')
      .nullable()
      .optional(),
    recruiterNameRaw: z
      .string({ invalid_type_error: 'Recruiter name must be a string' })
      .trim()
      .min(1, 'Recruiter name cannot be empty')
      .max(120, 'Recruiter name must be 120 characters or less')
      .nullable()
      .optional(),
    domain: domainSchema.nullable().optional(),
    domainRaw: domainSchema.nullable().optional(),
    phone: phoneSchema.nullable().optional(),
    phoneRaw: phoneSchema.nullable().optional(),
    email: emailSchema.nullable().optional(),
    emailRaw: emailSchema.nullable().optional(),
    upi: upiSchema.nullable().optional(),
    upiRaw: upiSchema.nullable().optional(),
    offerMessage: z
      .string({
        message: 'Offer message is required',
      })
      .trim()
      .min(1, 'Offer message cannot be empty')
      .max(20000, 'Offer message must be 20000 characters or less'),
    paymentRequest: z
      .string({ invalid_type_error: 'Payment request must be a string' })
      .trim()
      .min(1, 'Payment request cannot be empty')
      .max(300, 'Payment request must be 300 characters or less')
      .nullable()
      .optional(),
    additionalNotes: z
      .string({ invalid_type_error: 'Additional notes must be a string' })
      .trim()
      .min(1, 'Additional notes cannot be empty')
      .max(5000, 'Additional notes must be 5000 characters or less')
      .nullable()
      .optional(),
    additionalInfo: z
      .string({ invalid_type_error: 'Additional notes must be a string' })
      .trim()
      .min(1, 'Additional notes cannot be empty')
      .max(5000, 'Additional notes must be 5000 characters or less')
      .nullable()
      .optional(),
    identifiers: z
      .array(singleIdentifierSchema, { invalid_type_error: 'Identifiers must be an array' })
      .max(20, 'Cannot submit more than 20 identifiers')
      .nullable()
      .optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    // 1. Check company name presence
    const companyVal = data.companyName ? data.companyName.trim() : '';
    const companyRawVal = data.companyNameRaw ? data.companyNameRaw.trim() : '';
    if (!companyVal && !companyRawVal) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['companyName'],
        message: 'Company name is required',
      });
    }

    // 2. Reject conflicting dual aliases
    if (companyVal && companyRawVal && companyVal !== companyRawVal) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['companyName'],
        message: 'Conflicting companyName and companyNameRaw supplied',
      });
    }

    if (data.recruiterName && data.recruiterNameRaw && data.recruiterName.trim() !== data.recruiterNameRaw.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['recruiterName'],
        message: 'Conflicting recruiterName and recruiterNameRaw supplied',
      });
    }

    if (data.domain && data.domainRaw && data.domain.trim() !== data.domainRaw.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['domain'],
        message: 'Conflicting domain and domainRaw supplied',
      });
    }

    if (data.phone && data.phoneRaw && data.phone.trim() !== data.phoneRaw.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['phone'],
        message: 'Conflicting phone and phoneRaw supplied',
      });
    }

    if (data.email && data.emailRaw && data.email.trim().toLowerCase() !== data.emailRaw.trim().toLowerCase()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['email'],
        message: 'Conflicting email and emailRaw supplied',
      });
    }

    if (data.upi && data.upiRaw && data.upi.trim().toLowerCase() !== data.upiRaw.trim().toLowerCase()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['upi'],
        message: 'Conflicting upi and upiRaw supplied',
      });
    }

    if (data.additionalNotes && data.additionalInfo && data.additionalNotes.trim() !== data.additionalInfo.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['additionalNotes'],
        message: 'Conflicting additionalNotes and additionalInfo supplied',
      });
    }
  })
  .transform((data) => {
    const company = (data.companyName || data.companyNameRaw || '').trim();
    const recruiter = (data.recruiterName || data.recruiterNameRaw || null);
    const domain = (data.domain || data.domainRaw || null);
    const phone = (data.phone || data.phoneRaw || null);
    const email = (data.email || data.emailRaw || null);
    const upi = (data.upi || data.upiRaw || null);
    const notes = (data.additionalNotes || data.additionalInfo || null);

    return {
      companyName: company,
      companyNameRaw: company,
      recruiterName: recruiter ? recruiter.trim() : null,
      recruiterNameRaw: recruiter ? recruiter.trim() : null,
      domain: domain ? domain.trim() : null,
      domainRaw: domain ? domain.trim() : null,
      phone: phone ? phone.trim() : null,
      phoneRaw: phone ? phone.trim() : null,
      email: email ? email.trim() : null,
      emailRaw: email ? email.trim() : null,
      upi: upi ? upi.trim() : null,
      upiRaw: upi ? upi.trim() : null,
      offerMessage: data.offerMessage.trim(),
      paymentRequest: data.paymentRequest ? data.paymentRequest.trim() : null,
      additionalNotes: notes ? notes.trim() : null,
      additionalInfo: notes ? notes.trim() : null,
      identifiers: data.identifiers || null,
    };
  });

/**
 * Public report discovery query schema (GET /api/reports).
 *
 * Security & Approved Product Decision:
 * - Public callers CANNOT discover pending, investigating, or rejected reports.
 * - status defaults to 'verified' and clients cannot override it.
 * - If status query param is supplied, it MUST be 'verified' (literal).
 */
const publicReportQuerySchema = z
  .object({
    page: pageQuerySchema,
    limit: limitQuerySchema,
    status: z
      .literal('verified', {
        message: 'Public report discovery only permits verified reports',
      })
      .default('verified'),
    search: optionalSearchString(100, 'Search term'),
    companyId: z
      .string({ invalid_type_error: 'Company ID must be a string' })
      .uuid('Company ID must be a valid UUID')
      .optional(),
    recruiterId: z
      .string({ invalid_type_error: 'Recruiter ID must be a string' })
      .uuid('Recruiter ID must be a valid UUID')
      .optional(),
    identifierType: z
      .enum(SUPPORTED_TYPES, {
        message: 'Invalid identifier type filter',
      })
      .optional(),
    identifierValue: optionalSearchString(300, 'Identifier value'),
    sortBy: reportSortBySchema,
    sortOrder: z
      .enum(SORT_DIRECTIONS, {
        message: 'Sort order must be asc or desc',
      })
      .transform((val) => val.toLowerCase())
      .default('desc'),
  })
  .strict();

/**
 * Administrative report moderation query schema (GET /api/admin/reports).
 *
 * Requirements:
 * - Allows searching across all report statuses ('pending', 'verified', 'rejected', 'investigating').
 * - Requires admin authentication and authorization in the route handler.
 */
const adminReportQuerySchema = z
  .object({
    page: pageQuerySchema,
    limit: limitQuerySchema,
    status: z
      .enum(REPORT_STATUSES, {
        message: 'Invalid report status filter',
      })
      .optional(),
    search: optionalSearchString(100, 'Search term'),
    companyId: z
      .string({ invalid_type_error: 'Company ID must be a string' })
      .uuid('Company ID must be a valid UUID')
      .optional(),
    recruiterId: z
      .string({ invalid_type_error: 'Recruiter ID must be a string' })
      .uuid('Recruiter ID must be a valid UUID')
      .optional(),
    identifierType: z
      .enum(SUPPORTED_TYPES, {
        message: 'Invalid identifier type filter',
      })
      .optional(),
    identifierValue: optionalSearchString(300, 'Identifier value'),
    sortBy: reportSortBySchema,
    sortOrder: z
      .enum(SORT_DIRECTIONS, {
        message: 'Sort order must be asc or desc',
      })
      .transform((val) => val.toLowerCase())
      .default('desc'),
  })
  .strict();

/**
 * @deprecated Use publicReportQuerySchema for public discovery or adminReportQuerySchema for admin moderation.
 * Aliased to publicReportQuerySchema to prevent accidental exposure of non-verified reports.
 */
const reportQuerySchema = publicReportQuerySchema;

/**
 * Report route parameter schema (e.g. GET /api/reports/:id).
 */
const reportIdParamSchema = z
  .object({
    id: z
      .string({ message: 'Report ID is required' })
      .uuid('Invalid report ID format'),
  })
  .strict();

module.exports = {
  REPORT_STATUSES,
  PRISMA_REPORT_SORT_FIELDS,
  SORT_FIELD_INPUTS,
  createReportSchema,
  publicReportQuerySchema,
  adminReportQuerySchema,
  reportQuerySchema,
  reportIdParamSchema,
};
