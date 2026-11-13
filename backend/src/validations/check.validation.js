'use strict';

/**
 * backend/src/validations/check.validation.js
 * Zod validation schemas for Offer Check submission, history queries, and parameter handling.
 *
 * Requirements:
 * - Compatible with Express validate(schema) and validateQuery(schema) middleware.
 * - Enforces strict input types, bounds, and lengths (e.g. phoneQuery VARCHAR(20)).
 * - Resolves query aliases safely and checks for conflicting duplicate parameters.
 * - Protects against client-supplied fields: rejects userId, riskScore,
 *   riskCategory, result, ipHash, checkedAt, etc.
 * - Supports safe identifier validation with zero raw PII in error messages.
 */

const { z } = require('zod');
const {
  phoneSchema,
  emailSchema,
  upiSchema,
  domainSchema,
  bankAccountSchema,
  singleIdentifierSchema,
} = require('./identifier.validation');

// Supported Prisma RiskCategory enum values
const RISK_CATEGORIES = Object.freeze([
  'low',
  'medium',
  'high',
  'critical',
]);

// Allowed sorting fields supported by Prisma OfferCheck query index design
const CHECK_SORT_FIELDS = Object.freeze(['checkedAt', 'riskScore']);

const SORT_DIRECTIONS = Object.freeze(['asc', 'desc', 'ASC', 'DESC']);

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
 * Offer check submission schema (POST /api/checks).
 *
 * Mandatory fields:
 * - offerMessage: 1-20,000 characters (the text of the job or internship offer).
 *
 * Optional fields (genuinely optional, nullable):
 * - companyName: max 200 characters.
 * - paymentRequest: max 300 characters.
 * - phone (or phoneQuery): max 20 characters (format validated, matches Prisma VARCHAR(20)).
 * - email (or emailQuery): max 254 characters (format validated).
 * - upi (or upiQuery): max 80 characters (format validated).
 * - domain (or domainQuery): max 253 characters (format validated).
 * - bankAccount: max 34 characters (format validated).
 * - identifiers: array of up to 20 { type, value } objects.
 *
 * Strictly rejected:
 * - userId, riskScore, riskCategory, result, ipHash, checkedAt, id, audit metadata.
 */
const offerCheckSchema = z
  .object({
    offerMessage: z
      .string({
        message: 'Offer message is required',
      })
      .trim()
      .min(1, 'Offer message cannot be empty')
      .max(20000, 'Offer message must be 20000 characters or less'),
    companyName: z
      .string({ invalid_type_error: 'Company name must be a string' })
      .trim()
      .min(1, 'Company name cannot be empty')
      .max(200, 'Company name must be 200 characters or less')
      .nullable()
      .optional(),
    paymentRequest: z
      .string({ invalid_type_error: 'Payment request must be a string' })
      .trim()
      .min(1, 'Payment request cannot be empty')
      .max(300, 'Payment request must be 300 characters or less')
      .nullable()
      .optional(),
    phone: phoneSchema.nullable().optional(),
    phoneQuery: phoneSchema.nullable().optional(),
    email: emailSchema.nullable().optional(),
    emailQuery: emailSchema.nullable().optional(),
    upi: upiSchema.nullable().optional(),
    upiQuery: upiSchema.nullable().optional(),
    domain: domainSchema.nullable().optional(),
    domainQuery: domainSchema.nullable().optional(),
    bankAccount: bankAccountSchema.nullable().optional(),
    identifiers: z
      .array(singleIdentifierSchema, { invalid_type_error: 'Identifiers must be an array' })
      .max(20, 'Cannot submit more than 20 identifiers')
      .nullable()
      .optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.phone && data.phoneQuery && data.phone.trim() !== data.phoneQuery.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['phone'],
        message: 'Conflicting phone and phoneQuery supplied',
      });
    }

    if (data.email && data.emailQuery && data.email.trim().toLowerCase() !== data.emailQuery.trim().toLowerCase()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['email'],
        message: 'Conflicting email and emailQuery supplied',
      });
    }

    if (data.upi && data.upiQuery && data.upi.trim().toLowerCase() !== data.upiQuery.trim().toLowerCase()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['upi'],
        message: 'Conflicting upi and upiQuery supplied',
      });
    }

    if (data.domain && data.domainQuery && data.domain.trim() !== data.domainQuery.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['domain'],
        message: 'Conflicting domain and domainQuery supplied',
      });
    }
  })
  .transform((data) => {
    const phone = data.phone || data.phoneQuery || null;
    const email = data.email || data.emailQuery || null;
    const upi = data.upi || data.upiQuery || null;
    const domain = data.domain || data.domainQuery || null;

    return {
      offerMessage: data.offerMessage.trim(),
      companyName: data.companyName ? data.companyName.trim() : null,
      paymentRequest: data.paymentRequest ? data.paymentRequest.trim() : null,
      phone: phone ? phone.trim() : null,
      phoneQuery: phone ? phone.trim() : null,
      email: email ? email.trim() : null,
      emailQuery: email ? email.trim() : null,
      upi: upi ? upi.trim() : null,
      upiQuery: upi ? upi.trim() : null,
      domain: domain ? domain.trim() : null,
      domainQuery: domain ? domain.trim() : null,
      bankAccount: data.bankAccount ? data.bankAccount.trim() : null,
      identifiers: data.identifiers || null,
    };
  });

/**
 * Offer check history query schema (GET /api/checks).
 *
 * Supported query parameters:
 * - page: Integer >= 1 (default: 1).
 * - limit: Integer 1-100 (default: 20).
 * - riskCategory: Enum ('low', 'medium', 'high', 'critical').
 * - sortBy: 'checkedAt' | 'riskScore' (default: 'checkedAt').
 * - sortOrder: 'asc' | 'desc' (default: 'desc', case-insensitive).
 */
const offerCheckQuerySchema = z
  .object({
    page: pageQuerySchema,
    limit: limitQuerySchema,
    riskCategory: z
      .enum(RISK_CATEGORIES, {
        message: 'Invalid risk category filter',
      })
      .optional(),
    sortBy: z
      .enum(CHECK_SORT_FIELDS, {
        message: 'Invalid sort field',
      })
      .default('checkedAt'),
    sortOrder: z
      .enum(SORT_DIRECTIONS, {
        message: 'Sort order must be asc or desc',
      })
      .transform((val) => val.toLowerCase())
      .default('desc'),
  })
  .strict();

/**
 * Check route parameter schema (e.g. GET /api/checks/:id).
 */
const checkIdParamSchema = z
  .object({
    id: z
      .string({ message: 'Check ID is required' })
      .uuid('Invalid check ID format'),
  })
  .strict();

module.exports = {
  RISK_CATEGORIES,
  CHECK_SORT_FIELDS,
  offerCheckSchema,
  offerCheckQuerySchema,
  checkIdParamSchema,
};
