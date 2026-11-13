'use strict';

/**
 * src/utils/privacy.js
 * Server-side privacy-by-design PII masking engine.
 * Ensures non-admin roles (students, public, anonymous) never receive raw sensitive contact data.
 * Admin users receive unmasked data for investigative and moderation purposes.
 *
 * Implements explicit schema-based response sanitization:
 * - Direct contact fields (phoneRaw, emailRaw, upiRaw, phone, email, upiId, upi)
 * - Nested recruiter contact info (Prisma Recruiter: strict allow-list of id, name, flagged, masked phone/email, createdAt)
 * - Nested submitter privacy (Prisma User: strict allow-list of id, name, college, role, createdAt; excludes credentials/email)
 * - Nested reviewer privacy (Prisma User: strict allow-list of id, name, role)
 * - Nested identifiers (both direct Identifier arrays and Prisma ReportIdentifier junction objects)
 * - Bank account identifiers (IdentifierType.bank_account)
 * - Safe deep cloning: preserves Date instances, Buffer, and Prisma Decimal objects
 * - Guaranteed non-mutation of input objects
 */

/**
 * Mask a phone number (e.g. "+91 9876543210" -> "+91 9XXXXX" or "98765XXXXX").
 *
 * @param {string|null} phone
 * @returns {string|null}
 */
function maskPhone(phone) {
  if (!phone || typeof phone !== 'string') return null;
  const trimmed = phone.trim();
  if (trimmed.length <= 5) return '*****';
  return trimmed.slice(0, 5) + 'XXXXX';
}

/**
 * Mask an email address (e.g. "student@example.com" -> "s***@example.com").
 *
 * @param {string|null} email
 * @returns {string|null}
 */
function maskEmail(email) {
  if (!email || typeof email !== 'string') return null;
  const trimmed = email.trim();
  const atIdx = trimmed.indexOf('@');
  if (atIdx === -1) return trimmed;
  const local = trimmed.slice(0, atIdx);
  const domain = trimmed.slice(atIdx + 1);
  if (!local) return `***@${domain}`;
  return `${local[0]}***@${domain}`;
}

/**
 * Mask a UPI ID (e.g. "fraudster@upi" -> "f******er@upi").
 *
 * @param {string|null} upi
 * @returns {string|null}
 */
function maskUpi(upi) {
  if (!upi || typeof upi !== 'string') return null;
  const trimmed = upi.trim();
  const atIdx = trimmed.indexOf('@');
  if (atIdx === -1 || atIdx < 3) return trimmed;
  return trimmed[0] + '*'.repeat(atIdx - 3) + trimmed.slice(atIdx - 2);
}

/**
 * Mask a bank account number (e.g. "123456789012" -> "********9012").
 *
 * @param {string|null} account
 * @returns {string|null}
 */
function maskBankAccount(account) {
  if (!account || typeof account !== 'string') return null;
  const trimmed = account.trim();
  if (trimmed.length <= 4) return '****';
  return '*'.repeat(Math.max(trimmed.length - 4, 4)) + trimmed.slice(-4);
}

/**
 * Deep-clone an object safely without mutating caller references.
 * Preserves Date instances, Buffer, Prisma.Decimal-like structures, and standard JSON values.
 *
 * @param {any} val
 * @returns {any}
 */
function deepClone(val) {
  if (val === null || typeof val !== 'object') return val;

  // 1. Preserve Date instances
  if (val instanceof Date) return new Date(val.getTime());

  // 2. Preserve Buffer instances if present
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(val)) {
    return Buffer.from(val);
  }

  // 3. Preserve Prisma Decimal instances or decimal.js objects
  if (
    (typeof val.isDecimal === 'function' && val.isDecimal()) ||
    (val.constructor && val.constructor.name === 'Decimal' && typeof val.toString === 'function')
  ) {
    if (typeof val.clone === 'function') return val.clone();
    try {
      return new val.constructor(val.toString());
    } catch {
      // fallback to object copy if constructor call fails
    }
  }

  // 4. Handle Arrays
  if (Array.isArray(val)) return val.map(deepClone);

  // 5. Handle standard Object
  const copy = {};
  for (const key of Object.keys(val)) {
    copy[key] = deepClone(val[key]);
  }
  return copy;
}

/**
 * Sanitize a single Identifier record based on role.
 *
 * @param {object} identifier - Identifier object { type, value, normalizedValue, ... }
 * @param {string} [role='student'] - Role of requesting user
 * @returns {object} Sanitized identifier copy
 */
function maskIdentifierForRole(identifier, role = 'student') {
  if (!identifier || typeof identifier !== 'object') return identifier;
  const copy = deepClone(identifier);
  if (role === 'admin') return copy;

  if (copy.type === 'phone') {
    if ('value' in copy) copy.value = maskPhone(copy.value);
    if ('normalizedValue' in copy) copy.normalizedValue = maskPhone(copy.normalizedValue);
  } else if (copy.type === 'email') {
    if ('value' in copy) copy.value = maskEmail(copy.value);
    if ('normalizedValue' in copy) copy.normalizedValue = maskEmail(copy.normalizedValue);
  } else if (copy.type === 'upi') {
    if ('value' in copy) copy.value = maskUpi(copy.value);
    if ('normalizedValue' in copy) copy.normalizedValue = maskUpi(copy.normalizedValue);
  } else if (copy.type === 'bank_account') {
    if ('value' in copy) copy.value = maskBankAccount(copy.value);
    if ('normalizedValue' in copy) copy.normalizedValue = maskBankAccount(copy.normalizedValue);
  }

  return copy;
}

/**
 * Sanitize an item inside a report's identifiers list.
 * Handles both direct Identifier items and Prisma ReportIdentifier junction items.
 *
 * @param {object} item - ReportIdentifier or Identifier
 * @param {string} role - User role
 * @returns {object} Sanitized copy
 */
function sanitizeReportIdentifierItem(item, role) {
  if (!item || typeof item !== 'object') return item;
  const copy = deepClone(item);

  // Prisma junction record with nested identifier relation: { identifier: { type, value, ... } }
  if (copy.identifier && typeof copy.identifier === 'object') {
    copy.identifier = maskIdentifierForRole(copy.identifier, role);
    return copy;
  }

  // Direct Identifier record: { type, value, ... }
  if ('type' in copy) {
    return maskIdentifierForRole(copy, role);
  }

  return copy;
}

/**
 * Apply privacy masking to a report record based on the user's role.
 * Guarantees non-mutation of the original report object.
 *
 * @param {object} report - Report object (database or API representation)
 * @param {string} [role='student'] - Role of the requesting user ('student' | 'admin')
 * @returns {object} Sanitized copy of the report
 */
function maskReportForRole(report, role = 'student') {
  if (!report || typeof report !== 'object') return report;
  const copy = deepClone(report);
  if (role === 'admin') return copy;

  // 1. Direct and alternate report-level contact fields
  if ('phone' in copy) copy.phone = maskPhone(copy.phone);
  if ('phoneRaw' in copy) copy.phoneRaw = maskPhone(copy.phoneRaw);
  if ('email' in copy) copy.email = maskEmail(copy.email);
  if ('emailRaw' in copy) copy.emailRaw = maskEmail(copy.emailRaw);
  if ('upi' in copy) copy.upi = maskUpi(copy.upi);
  if ('upiId' in copy) copy.upiId = maskUpi(copy.upiId);
  if ('upiRaw' in copy) copy.upiRaw = maskUpi(copy.upiRaw);

  // 2. Nested recruiter contact information (Prisma Recruiter relation) — strict allow-list
  if (copy.recruiter && typeof copy.recruiter === 'object') {
    const safeRecruiter = {
      id: copy.recruiter.id,
      name: copy.recruiter.name,
      flagged: Boolean(copy.recruiter.flagged),
    };
    if (copy.recruiter.phone) {
      safeRecruiter.phone = maskPhone(copy.recruiter.phone);
    }
    if (copy.recruiter.email) {
      safeRecruiter.email = maskEmail(copy.recruiter.email);
    }
    if (copy.recruiter.createdAt) {
      safeRecruiter.createdAt = copy.recruiter.createdAt;
    }
    copy.recruiter = safeRecruiter;
  }

  // 3. Nested submitter information (Prisma User relation) — strict allow-list of public attributes
  if (copy.submitter && typeof copy.submitter === 'object') {
    const safeSubmitter = {
      id: copy.submitter.id,
      name: copy.submitter.name,
      college: copy.submitter.college || null,
      role: copy.submitter.role || 'student',
    };
    if (copy.submitter.createdAt) {
      safeSubmitter.createdAt = copy.submitter.createdAt;
    }
    copy.submitter = safeSubmitter;
  }

  // 4. Nested reviewer information (Prisma User relation) — strict allow-list of public attributes
  if (copy.reviewer && typeof copy.reviewer === 'object') {
    copy.reviewer = {
      id: copy.reviewer.id,
      name: copy.reviewer.name,
      role: copy.reviewer.role || 'admin',
    };
  }

  // 5. Nested identifiers collection (both direct and Prisma ReportIdentifier junction structures)
  if (Array.isArray(copy.identifiers)) {
    copy.identifiers = copy.identifiers.map((item) => sanitizeReportIdentifierItem(item, role));
  }

  return copy;
}

module.exports = {
  maskPhone,
  maskEmail,
  maskUpi,
  maskBankAccount,
  maskReportForRole,
  maskIdentifierForRole,
  sanitizeReportIdentifierItem,
  deepClone,
};
