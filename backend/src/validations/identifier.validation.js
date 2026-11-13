'use strict';

/**
 * backend/src/validations/identifier.validation.js
 * Zod validation schemas for fraud identifiers (phone, email, upi, domain, bank_account).
 *
 * Guarantees:
 * - Uses Phase 5A.1 normalizer rules for format validation.
 * - Preserves raw user input for evidence storage.
 * - NEVER stores or exposes raw sensitive identifiers in validation error messages.
 * - Disallows client manipulation and invalid types.
 */

const { z } = require('zod');
const {
  SUPPORTED_TYPES,
  normalizePhone,
  normalizeEmail,
  normalizeUpi,
  normalizeDomain,
  normalizeBankAccount,
} = require('../utils/normalize');

// Safe, non-leaking static error messages — raw PII is NEVER interpolated
const ERROR_MESSAGES = Object.freeze({
  phone: 'Invalid phone number format',
  email: 'Invalid email address format',
  upi: 'Invalid UPI ID format',
  domain: 'Invalid domain format',
  bank_account: 'Invalid bank account format',
});

/**
 * Validates a single phone number using India-first + E.164 boundary rules.
 * Strictly capped at 20 characters to align with PostgreSQL VARCHAR(20) fields
 * (Report.phoneRaw and OfferCheck.phoneQuery).
 */
const phoneSchema = z
  .string({ invalid_type_error: 'Phone number must be a string' })
  .trim()
  .min(1, 'Phone number cannot be empty')
  .max(20, 'Phone number must be 20 characters or less')
  .refine(
    (val) => {
      try {
        normalizePhone(val);
        return true;
      } catch {
        return false;
      }
    },
    { message: ERROR_MESSAGES.phone }
  );

/**
 * Validates a single email address using standard email formatting.
 */
const emailSchema = z
  .string({ invalid_type_error: 'Email address must be a string' })
  .trim()
  .min(1, 'Email address cannot be empty')
  .max(254, 'Email address must be 254 characters or less')
  .refine(
    (val) => {
      try {
        normalizeEmail(val);
        return true;
      } catch {
        return false;
      }
    },
    { message: ERROR_MESSAGES.email }
  );

/**
 * Validates a single UPI handle using NPCI VPA format rules.
 */
const upiSchema = z
  .string({ invalid_type_error: 'UPI ID must be a string' })
  .trim()
  .min(1, 'UPI ID cannot be empty')
  .max(80, 'UPI ID must be 80 characters or less')
  .refine(
    (val) => {
      try {
        normalizeUpi(val);
        return true;
      } catch {
        return false;
      }
    },
    { message: ERROR_MESSAGES.upi }
  );

/**
 * Validates a domain name using URL parsing and TLD dot requirements.
 */
const domainSchema = z
  .string({ invalid_type_error: 'Domain must be a string' })
  .trim()
  .min(1, 'Domain cannot be empty')
  .max(253, 'Domain must be 253 characters or less')
  .refine(
    (val) => {
      try {
        normalizeDomain(val);
        return true;
      } catch {
        return false;
      }
    },
    { message: ERROR_MESSAGES.domain }
  );

/**
 * Validates a bank account number (8-34 alphanumeric characters).
 */
const bankAccountSchema = z
  .string({ invalid_type_error: 'Bank account must be a string' })
  .trim()
  .min(1, 'Bank account cannot be empty')
  .max(34, 'Bank account must be 34 characters or less')
  .refine(
    (val) => {
      try {
        normalizeBankAccount(val);
        return true;
      } catch {
        return false;
      }
    },
    { message: ERROR_MESSAGES.bank_account }
  );

/**
 * Validates an identifier entry inside an identifiers array:
 * { type: IdentifierType, value: string }
 */
const singleIdentifierSchema = z
  .object({
    type: z.enum(SUPPORTED_TYPES, {
      message: 'Invalid identifier type',
    }),
    value: z
      .string({
        message: 'Identifier value is required',
      })
      .trim()
      .min(1, 'Identifier value cannot be empty')
      .max(300, 'Identifier value must be 300 characters or less'),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.type === 'phone' && data.value.length > 20) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['value'],
        message: 'Phone number must be 20 characters or less',
      });
      return;
    }

    if (data.type === 'bank_account' && data.value.length > 34) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['value'],
        message: 'Bank account must be 34 characters or less',
      });
      return;
    }

    let isValid = false;
    try {
      if (data.type === 'phone') {
        normalizePhone(data.value);
        isValid = true;
      } else if (data.type === 'email') {
        normalizeEmail(data.value);
        isValid = true;
      } else if (data.type === 'upi') {
        normalizeUpi(data.value);
        isValid = true;
      } else if (data.type === 'domain') {
        normalizeDomain(data.value);
        isValid = true;
      } else if (data.type === 'bank_account') {
        normalizeBankAccount(data.value);
        isValid = true;
      }
    } catch {
      isValid = false;
    }

    if (!isValid) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['value'],
        message: ERROR_MESSAGES[data.type] || 'Invalid identifier format',
      });
    }
  });

module.exports = {
  ERROR_MESSAGES,
  phoneSchema,
  emailSchema,
  upiSchema,
  domainSchema,
  bankAccountSchema,
  singleIdentifierSchema,
};
