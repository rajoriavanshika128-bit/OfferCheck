'use strict';

/**
 * backend/src/utils/normalize.js
 * Identifier normalization engine for OfferCheck.
 *
 * Implements deterministic, fraud-intelligence normalization and validation for:
 * - phone (India-first domestic rules + E.164 international country code preservation)
 * - email (case-insensitive exact match policy + Zod email validation)
 * - upi (NPCI Virtual Payment Address specification + lowercase normalization)
 * - domain (registered hostname extraction via standard URL parser + punycode IDN support)
 * - bank_account (separator stripping + alphanumeric validation + strict non-logging)
 *
 * Guaranteed properties:
 * - Deterministic output.
 * - Input immutability.
 * - Safe rejection of malformed, ambiguous, or unsupported types.
 * - Separation of raw display values from normalized matching keys.
 */

const net = require('net');
const { z } = require('zod');
const { AppError } = require('./errors');

// Allowed Prisma IdentifierType enum values
const SUPPORTED_TYPES = Object.freeze([
  'phone',
  'email',
  'upi',
  'domain',
  'bank_account',
]);

const emailSchema = z.string().trim().email();

// UPI Virtual Payment Address (VPA) regex:
// Local: 2-100 characters, alphanumeric, dots, underscores, hyphens; cannot start/end with dot/hyphen/underscore.
// Handle: 2-64 characters, alphanumeric, dots, hyphens; cannot start/end with dot/hyphen.
const UPI_VPA_REGEX = /^[a-zA-Z0-9](?:[a-zA-Z0-9.\-_]{0,98}[a-zA-Z0-9])?@[a-zA-Z0-9](?:[a-zA-Z0-9.\-]{0,62}[a-zA-Z0-9])?$/;

// Bank account permitted characters: alphanumeric only, length 8 to 34
const BANK_ACCOUNT_CHARS_REGEX = /^[A-Z0-9]+$/;

/**
 * Normalize a phone number according to an India-first policy with international preservation.
 *
 * Rules:
 * 1. Trim whitespace.
 * 2. Reject letters and unsupported punctuation (allowed: digits, +, spaces, hyphens, dots, parentheses).
 * 3. If starts with "+" or "00", normalize to "+<digits>" and validate E.164 (7-15 digits).
 * 4. If no international prefix:
 *    - 10 digits: Indian domestic number -> prepend "+91".
 *    - 11 digits starting with 0: Indian trunk STD code -> replace 0 with "+91".
 *    - 12 digits starting with 91: Indian domestic with country code -> prepend "+".
 *    - Otherwise: Reject as ambiguous (international numbers must include explicit country prefix).
 *
 * @param {string|number} value
 * @returns {string} E.164 normalized phone number (e.g. "+919876543210")
 */
function normalizePhone(value) {
  const rawStr = String(value).trim();
  if (!rawStr) {
    throw new AppError('Phone number cannot be empty', 400);
  }

  // Reject unsupported characters (letters, symbols like @, #, $, etc.)
  if (/[^\d+\s\-().]/.test(rawStr)) {
    throw new AppError('Invalid phone number: contains unsupported characters or letters', 400);
  }

  // Check plus sign occurrences and positions
  const plusMatches = rawStr.match(/\+/g);
  if (plusMatches && plusMatches.length > 1) {
    throw new AppError('Invalid phone number: plus sign must only appear at the beginning', 400);
  }

  const hasPlus = plusMatches && plusMatches.length === 1;
  if (hasPlus) {
    const plusIdx = rawStr.indexOf('+');
    const beforePlus = rawStr.slice(0, plusIdx);
    // Any characters before '+' must only be leading parenthesis/whitespace, never digits
    if (/[\d]/.test(beforePlus)) {
      throw new AppError('Invalid phone number: plus sign must only appear at the beginning', 400);
    }
  }

  const isDoubleZeroPrefixed = rawStr.startsWith('00');

  // Strip all non-digit formatting characters
  const digitsOnly = rawStr.replace(/\D/g, '');
  const normalizedDigits = isDoubleZeroPrefixed ? digitsOnly.slice(2) : digitsOnly;

  if (hasPlus || isDoubleZeroPrefixed) {
    // Digits count must conform to ITU-T E.164 standard (min 7, max 15 digits)
    if (normalizedDigits.length < 7 || normalizedDigits.length > 15) {
      throw new AppError(
        `Invalid international phone number: length must be between 7 and 15 digits (got ${normalizedDigits.length})`,
        400
      );
    }
    return `+${normalizedDigits}`;
  }

  // Domestic input without international prefix — apply India-first policy
  if (digitsOnly.length === 10) {
    return `+91${digitsOnly}`;
  }

  if (digitsOnly.length === 11 && digitsOnly.startsWith('0')) {
    return `+91${digitsOnly.slice(1)}`;
  }

  if (digitsOnly.length === 12 && digitsOnly.startsWith('91')) {
    return `+${digitsOnly}`;
  }

  // Ambiguous input without explicit country prefix
  throw new AppError(
    `Ambiguous phone number: "${rawStr}" does not match 10-digit Indian format. International numbers must include country code starting with "+"`,
    400
  );
}

/**
 * Normalize an email address according to a case-insensitive matching policy.
 * Validates syntax using Zod email validator.
 *
 * @param {string} value
 * @returns {string} Lowercased, trimmed email
 */
function normalizeEmail(value) {
  const rawStr = String(value).trim();
  if (!rawStr) {
    throw new AppError('Email address cannot be empty', 400);
  }

  const result = emailSchema.safeParse(rawStr);
  if (!result.success) {
    throw new AppError('Invalid email address format', 400);
  }

  return rawStr.toLowerCase();
}

/**
 * Normalize a UPI Virtual Payment Address (VPA).
 * Validates format against NPCI VPA specifications.
 *
 * @param {string} value
 * @returns {string} Lowercased, trimmed UPI handle
 */
function normalizeUpi(value) {
  const rawStr = String(value).trim();
  if (!rawStr) {
    throw new AppError('UPI ID cannot be empty', 400);
  }

  // Reject spaces or carriage returns
  if (/\s/.test(rawStr)) {
    throw new AppError('Invalid UPI ID: cannot contain spaces', 400);
  }

  // Must contain exactly one "@"
  const atMatches = rawStr.match(/@/g);
  if (!atMatches || atMatches.length !== 1) {
    throw new AppError('Invalid UPI ID: must contain exactly one "@" separator', 400);
  }

  if (!UPI_VPA_REGEX.test(rawStr)) {
    throw new AppError('Invalid UPI ID format. Expected format: username@handle', 400);
  }

  return rawStr.toLowerCase();
}

/**
 * Normalize a domain or hostname.
 * Strips protocols (http/https), credentials, ports, paths, query strings, and leading "www.".
 * Normalizes internationalized domains (IDN) via standard WHATWG URL parser punycode.
 * Rejects IP addresses, localhost, and malformed hostnames.
 *
 * @param {string} value
 * @returns {string} Lowercased, registered hostname (e.g. "techbridge.in")
 */
function normalizeDomain(value) {
  let rawStr = String(value).trim();
  if (!rawStr) {
    throw new AppError('Domain cannot be empty', 400);
  }

  // Prepend protocol if missing so URL parser can parse host accurately
  if (rawStr.startsWith('//')) {
    rawStr = 'https:' + rawStr;
  } else if (!/^https?:\/\//i.test(rawStr)) {
    rawStr = 'https://' + rawStr;
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(rawStr);
  } catch {
    throw new AppError('Invalid domain format', 400);
  }

  // Reject credentials (e.g. http://user:pass@domain.com)
  if (parsedUrl.username || parsedUrl.password) {
    throw new AppError('Domain cannot contain credentials', 400);
  }

  const hostname = parsedUrl.hostname.toLowerCase();
  const unbracketedHost = hostname.replace(/^\[|\]$/g, '');

  // Reject IP addresses (IPv4 or IPv6) — domains must be registered hostnames
  if (net.isIP(unbracketedHost) !== 0) {
    throw new AppError('IP addresses are not permitted as domain identifiers', 400);
  }

  // Must contain at least one dot (to ensure domain + valid TLD)
  if (!hostname.includes('.')) {
    throw new AppError('Invalid domain: must include a valid top-level domain (TLD)', 400);
  }

  const parts = hostname.split('.');

  // Validate TLD: must be at least 2 characters and not all digits
  const tld = parts[parts.length - 1];
  if (tld.length < 2 || /^\d+$/.test(tld)) {
    throw new AppError('Invalid domain: top-level domain is invalid', 400);
  }

  // Strip leading "www." if there is a domain name underneath (at least 3 parts, e.g. www.example.com -> example.com)
  if (hostname.startsWith('www.') && parts.length >= 3) {
    return hostname.slice(4);
  }

  return hostname;
}

/**
 * Normalize a bank account number.
 * Strips harmless formatting separators (spaces, hyphens, slashes).
 * Validates alphanumeric character set and length (8 to 34 characters).
 * Note: Never logs or outputs the raw account number in errors for security.
 *
 * @param {string|number} value
 * @returns {string} Upper-cased alphanumeric normalized bank account string
 */
function normalizeBankAccount(value) {
  const rawStr = String(value).trim();
  if (!rawStr) {
    throw new AppError('Bank account cannot be empty', 400);
  }

  // Remove common separators (spaces, hyphens, slashes)
  const cleaned = rawStr.replace(/[\s\-_/]/g, '').toUpperCase();

  if (cleaned.length < 8 || cleaned.length > 34) {
    throw new AppError('Invalid bank account: length must be between 8 and 34 characters', 400);
  }

  if (!BANK_ACCOUNT_CHARS_REGEX.test(cleaned)) {
    throw new AppError('Invalid bank account: contains unsupported characters', 400);
  }

  return cleaned;
}

/**
 * Universal normalization entrypoint.
 *
 * @param {string} type - One of: 'phone', 'email', 'upi', 'domain', 'bank_account'
 * @param {string|number} value - Raw identifier value
 * @param {object} [options] - Reserved for future options
 * @returns {string} Normalized identifier value
 * @throws {AppError} If type is unsupported or value is malformed/empty
 */
function normalizeIdentifier(type, value, options = {}) {
  if (!type || typeof type !== 'string') {
    throw new AppError('Identifier type is required and must be a string', 400);
  }

  const normalizedType = type.trim().toLowerCase();
  if (!SUPPORTED_TYPES.includes(normalizedType)) {
    throw new AppError(
      `Unsupported identifier type: "${type}". Supported types are: ${SUPPORTED_TYPES.join(', ')}`,
      400
    );
  }

  if (value === null || value === undefined) {
    throw new AppError(`Identifier value for "${type}" cannot be null or undefined`, 400);
  }

  switch (normalizedType) {
    case 'phone':
      return normalizePhone(value);
    case 'email':
      return normalizeEmail(value);
    case 'upi':
      return normalizeUpi(value);
    case 'domain':
      return normalizeDomain(value);
    case 'bank_account':
      return normalizeBankAccount(value);
    default:
      throw new AppError(`Unsupported identifier type: "${type}"`, 400);
  }
}

/**
 * Helper to build a safe identifier object preserving original display value.
 *
 * @param {string} type
 * @param {string|number} rawValue
 * @returns {{ type: string, raw: string, normalized: string }}
 */
function createNormalizedIdentifier(type, rawValue) {
  const normalized = normalizeIdentifier(type, rawValue);
  return {
    type: type.trim().toLowerCase(),
    raw: String(rawValue).trim(),
    normalized,
  };
}

/**
 * Extract and normalize identifiers from report submission contact fields.
 * Deduplicates by composite key (type, normalized).
 *
 * @param {object} reportData - Object containing contact fields (phone/phoneRaw, email/emailRaw, etc.)
 * @returns {Array<{ type: string, raw: string, normalized: string }>}
 */
function extractIdentifiersFromReport(reportData = {}) {
  if (!reportData || typeof reportData !== 'object') {
    return [];
  }

  const extracted = [];
  const seen = new Set();

  function addIfPresent(type, val) {
    if (val === null || val === undefined) return;
    const str = String(val).trim();
    if (!str) return;

    const normalized = normalizeIdentifier(type, str);
    const key = `${type}:${normalized}`;
    if (!seen.has(key)) {
      seen.add(key);
      extracted.push({
        type,
        raw: str,
        normalized,
      });
    }
  }

  // 1. Direct contact fields
  const phone = reportData.phoneRaw || reportData.phone;
  if (phone) addIfPresent('phone', phone);

  const email = reportData.emailRaw || reportData.email;
  if (email) addIfPresent('email', email);

  const upi = reportData.upiRaw || reportData.upiId || reportData.upi;
  if (upi) addIfPresent('upi', upi);

  const domain = reportData.domainRaw || reportData.domain;
  if (domain) addIfPresent('domain', domain);

  const bank = reportData.bankAccountRaw || reportData.bankAccount;
  if (bank) addIfPresent('bank_account', bank);

  // 2. Explicit identifiers array if provided
  if (Array.isArray(reportData.identifiers)) {
    for (const item of reportData.identifiers) {
      if (item && typeof item === 'object' && item.type && item.value !== undefined) {
        addIfPresent(item.type, item.value);
      }
    }
  }

  return extracted;
}

module.exports = {
  SUPPORTED_TYPES,
  normalizePhone,
  normalizeEmail,
  normalizeUpi,
  normalizeDomain,
  normalizeBankAccount,
  normalizeIdentifier,
  createNormalizedIdentifier,
  extractIdentifiersFromReport,
};
