'use strict';

/**
 * backend/test/phase4c_unit.test.js
 * Pure unit tests for Phase 4C components:
 * 1. RBAC middleware (requireRole, requireAdmin)
 * 2. Ownership & self-action assertion helpers (assertOwnership, assertNotSelf)
 * 3. Server-side PII masking engine (maskPhone, maskEmail, maskUpi, maskBankAccount, maskReportForRole, maskIdentifierForRole)
 *
 * Uses mocked req/res/next objects — ZERO database connection, ZERO network, ZERO .env access.
 */

const assert = require('assert');
const { requireRole, requireAdmin } = require('../src/middleware/authorize');
const requireAdminCompat = require('../src/middleware/requireAdmin');
const { assertOwnership, assertNotSelf } = require('../src/utils/rbac');
const {
  maskPhone,
  maskEmail,
  maskUpi,
  maskBankAccount,
  maskReportForRole,
  maskIdentifierForRole,
  deepClone,
} = require('../src/utils/privacy');
const { AppError } = require('../src/utils/errors');

let totalTests = 0;
let passedTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    fn();
    passedTests++;
    console.log(`  ✅ [PASS] ${name}`);
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}:`, err.message);
    throw err;
  }
}

console.log('\n--- Phase 4C: Pure Unit Tests (Database-Independent) ---\n');

// ─── 1. RBAC Middleware Tests ────────────────────────────────────────────────

console.log('1. RBAC Middleware (requireRole & requireAdmin):');

runTest('requireRole throws when called with no role arguments', () => {
  assert.throws(
    () => requireRole(),
    /requireRole requires at least one role argument/
  );
});

runTest('requireRole rejects unauthenticated request (req.user missing) with 401', () => {
  const middleware = requireRole('admin');
  const req = {};
  let nextCalledWith = null;
  middleware(req, {}, (err) => { nextCalledWith = err; });

  assert(nextCalledWith instanceof AppError);
  assert.strictEqual(nextCalledWith.statusCode, 401);
  assert.strictEqual(nextCalledWith.message, 'Authentication required');
});

runTest('requireAdmin rejects student role with 403 "Admin access required"', () => {
  const req = { user: { id: 'u1', role: 'student' } };
  let nextCalledWith = null;
  requireAdmin(req, {}, (err) => { nextCalledWith = err; });

  assert(nextCalledWith instanceof AppError);
  assert.strictEqual(nextCalledWith.statusCode, 403);
  assert.strictEqual(nextCalledWith.message, 'Admin access required');
});

runTest('requireAdmin allows admin role', () => {
  const req = { user: { id: 'u2', role: 'admin' } };
  let nextCalled = false;
  requireAdmin(req, {}, (err) => {
    assert.strictEqual(err, undefined);
    nextCalled = true;
  });
  assert.strictEqual(nextCalled, true);
});

runTest('backward compatibility: requireAdmin.js exports the exact same middleware', () => {
  assert.strictEqual(requireAdminCompat, requireAdmin);
});

runTest('requireRole allows student when student is in allowedRoles', () => {
  const middleware = requireRole('student', 'admin');
  const req = { user: { id: 'u1', role: 'student' } };
  let nextCalled = false;
  middleware(req, {}, (err) => {
    assert.strictEqual(err, undefined);
    nextCalled = true;
  });
  assert.strictEqual(nextCalled, true);
});

runTest('requireRole rejects disallowed role with 403 "Forbidden: insufficient permissions"', () => {
  const middleware = requireRole('auditor', 'admin');
  const req = { user: { id: 'u1', role: 'student' } };
  let nextCalledWith = null;
  middleware(req, {}, (err) => { nextCalledWith = err; });

  assert(nextCalledWith instanceof AppError);
  assert.strictEqual(nextCalledWith.statusCode, 403);
  assert.strictEqual(nextCalledWith.message, 'Forbidden: insufficient permissions');
});

// ─── 2. Ownership & Self-Action Assertion Tests ──────────────────────────────

console.log('\n2. Ownership & Self-Action Assertions (assertOwnership, assertNotSelf):');

runTest('assertOwnership allows owner accessing their own resource', () => {
  const currentUser = { id: 'user-123', role: 'student' };
  const result = assertOwnership('user-123', currentUser);
  assert.strictEqual(result, true);
});

runTest('assertOwnership rejects student accessing another user\'s resource with 403', () => {
  const currentUser = { id: 'user-123', role: 'student' };
  assert.throws(
    () => assertOwnership('user-999', currentUser),
    (err) => err instanceof AppError && err.statusCode === 403 && err.message.includes('you do not own this resource')
  );
});

runTest('assertOwnership allows admin accessing another user\'s resource (admin bypass)', () => {
  const adminUser = { id: 'admin-1', role: 'admin' };
  const result = assertOwnership('user-999', adminUser);
  assert.strictEqual(result, true);
});

runTest('assertOwnership rejects admin when allowAdmin option is explicitly false', () => {
  const adminUser = { id: 'admin-1', role: 'admin' };
  assert.throws(
    () => assertOwnership('user-999', adminUser, { allowAdmin: false }),
    (err) => err instanceof AppError && err.statusCode === 403
  );
});

runTest('assertOwnership throws 401 when currentUser is missing or has no id', () => {
  assert.throws(
    () => assertOwnership('user-123', null),
    (err) => err instanceof AppError && err.statusCode === 401
  );
  assert.throws(
    () => assertOwnership('user-123', {}),
    (err) => err instanceof AppError && err.statusCode === 401
  );
});

runTest('assertNotSelf allows admin performing action on a different user', () => {
  const result = assertNotSelf('admin-1', 'student-2', 'ban');
  assert.strictEqual(result, true);
});

runTest('assertNotSelf rejects self-action with 400 error containing action description', () => {
  assert.throws(
    () => assertNotSelf('admin-1', 'admin-1', 'user suspension'),
    (err) => err instanceof AppError && err.statusCode === 400 && err.message.includes('Cannot perform user suspension on your own account')
  );
});

runTest('assertNotSelf throws 401 when actorId is missing', () => {
  assert.throws(
    () => assertNotSelf(null, 'target-1'),
    (err) => err instanceof AppError && err.statusCode === 401
  );
});

// ─── 3. PII Masking Utilities Tests ──────────────────────────────────────────

console.log('\n3. PII Masking Utilities (maskPhone, maskEmail, maskUpi, maskBankAccount, maskReport, maskIdentifier):');

runTest('maskPhone masks correctly and handles null/empty/short inputs', () => {
  assert.strictEqual(maskPhone('+91 9876543210'), '+91 9XXXXX');
  assert.strictEqual(maskPhone('9876543210'), '98765XXXXX');
  assert.strictEqual(maskPhone('1234'), '*****');
  assert.strictEqual(maskPhone(null), null);
  assert.strictEqual(maskPhone(''), null);
});

runTest('maskEmail masks local part correctly and handles null/malformed inputs', () => {
  assert.strictEqual(maskEmail('student@example.com'), 's***@example.com');
  assert.strictEqual(maskEmail('a@b.com'), 'a***@b.com');
  assert.strictEqual(maskEmail(null), null);
  assert.strictEqual(maskEmail(''), null);
  assert.strictEqual(maskEmail('invalid-email'), 'invalid-email');
});

runTest('maskUpi masks identifier and preserves provider domain', () => {
  assert.strictEqual(maskUpi('fraudster@upi'), 'f******er@upi');
  assert.strictEqual(maskUpi('payhere@upi'), 'p****re@upi');
  assert.strictEqual(maskUpi('abcd@upi'), 'a*cd@upi');
  assert.strictEqual(maskUpi('ab@okaxis'), 'a*@okaxis');
  assert.strictEqual(maskUpi(null), null);
  assert.strictEqual(maskUpi(''), null);
});

runTest('maskUpi masks short valid UPI usernames (2- and 3-character)', () => {
  // 2-character usernames
  assert.strictEqual(maskUpi('ab@okaxis'), 'a*@okaxis');
  assert.strictEqual(maskUpi('xy@okhdfcbank'), 'x*@okhdfcbank');
  assert.strictEqual(maskUpi('99@upi'), '9*@upi');

  // 3-character usernames
  assert.strictEqual(maskUpi('abc@okaxis'), 'a*c@okaxis');
  assert.strictEqual(maskUpi('pay@upi'), 'p*y@upi');
  assert.strictEqual(maskUpi('hr1@icici'), 'h*1@icici');
});

runTest('maskUpi safely handles malformed and edge-case inputs without exposing sensitive values', () => {
  // Null, undefined, empty, non-string
  assert.strictEqual(maskUpi(null), null);
  assert.strictEqual(maskUpi(undefined), null);
  assert.strictEqual(maskUpi(''), null);
  assert.strictEqual(maskUpi('   '), null);
  assert.strictEqual(maskUpi(12345), null);
  assert.strictEqual(maskUpi({}), null);

  // Missing @ symbol (must never leak raw string)
  assert.strictEqual(maskUpi('invalid-upi'), '*****');
  assert.strictEqual(maskUpi('9876543210'), '*****');
  assert.strictEqual(maskUpi('secretpassword'), '*****');

  // Multiple @ characters (must never leak raw string)
  assert.strictEqual(maskUpi('user@okaxis@extra'), '*****');
  assert.strictEqual(maskUpi('foo@bar@baz'), '*****');

  // Invalid username/handle formats (must never leak raw string)
  assert.strictEqual(maskUpi('@okaxis'), '*****');
  assert.strictEqual(maskUpi('user@'), '*****');
  assert.strictEqual(maskUpi('user @okaxis'), '*****');
  assert.strictEqual(maskUpi('@'), '*****');
});

runTest('maskBankAccount masks bank account and preserves last 4 digits', () => {
  assert.strictEqual(maskBankAccount('123456789012'), '********9012');
  assert.strictEqual(maskBankAccount('987654321'), '*****4321');
  assert.strictEqual(maskBankAccount('1234'), '****');
  assert.strictEqual(maskBankAccount(null), null);
});

runTest('deepClone correctly preserves Date objects and independence', () => {
  const origDate = new Date('2026-11-13T10:00:00.000Z');
  const clonedDate = deepClone(origDate);

  assert(clonedDate instanceof Date, 'Cloned value must be a Date instance');
  assert.strictEqual(clonedDate.getTime(), origDate.getTime());
  assert.notStrictEqual(clonedDate, origDate, 'Cloned Date must be a distinct instance');

  clonedDate.setFullYear(2099);
  assert.strictEqual(origDate.getFullYear(), 2026);
});

runTest('deepClone correctly preserves Prisma Decimal-like objects and Buffers', () => {
  // Mock Prisma.Decimal / decimal.js class
  class MockDecimal {
    constructor(val) {
      this.val = String(val);
      this.d = [parseInt(val, 10)];
    }
    isDecimal() { return true; }
    toString() { return this.val; }
    clone() { return new MockDecimal(this.val); }
  }

  const origDecimal = new MockDecimal('15000.50');
  const clonedDecimal = deepClone(origDecimal);

  assert(clonedDecimal instanceof MockDecimal, 'Cloned value must preserve Decimal class instance');
  assert.strictEqual(clonedDecimal.toString(), '15000.50');
  assert.notStrictEqual(clonedDecimal, origDecimal, 'Cloned Decimal must be an independent instance');

  const origBuffer = Buffer.from('binary-data');
  const clonedBuffer = deepClone(origBuffer);
  assert(Buffer.isBuffer(clonedBuffer), 'Cloned value must remain a Buffer');
  assert.strictEqual(clonedBuffer.toString(), 'binary-data');
  assert.notStrictEqual(clonedBuffer, origBuffer, 'Cloned Buffer must be independent');
});

runTest('maskReportForRole preserves Prisma DateTime fields as Date instances', () => {
  const reportWithDates = {
    id: 'rep-date-1',
    submittedAt: new Date('2026-11-12T08:30:00.000Z'),
    reviewedAt: new Date('2026-11-13T14:45:00.000Z'),
    phoneRaw: '+91 9876543210',
  };

  const masked = maskReportForRole(reportWithDates, 'student');
  assert(masked.submittedAt instanceof Date, 'submittedAt must remain a Date');
  assert(masked.reviewedAt instanceof Date, 'reviewedAt must remain a Date');
  assert.strictEqual(masked.submittedAt.toISOString(), '2026-11-12T08:30:00.000Z');
  assert.strictEqual(masked.phoneRaw, '+91 9XXXXX');
});

runTest('maskReportForRole masks all direct PII fields for student role', () => {
  const rawReport = {
    id: 'rep-1',
    companyNameRaw: 'Acme Corp',
    phoneRaw: '+91 9876543210',
    emailRaw: 'recruiter@fraud.com',
    upiRaw: 'payhere@upi',
    phone: '+91 9876543210',
    email: 'recruiter@fraud.com',
    upiId: 'payhere@upi',
    offerMessage: 'Deposit 5000 INR',
    identifiers: [
      { type: 'phone', value: '+91 9876543210', normalizedValue: '9876543210' },
      { type: 'email', value: 'recruiter@fraud.com', normalizedValue: 'recruiter@fraud.com' },
      { type: 'upi', value: 'payhere@upi', normalizedValue: 'payhere@upi' },
      { type: 'bank_account', value: '987654321098', normalizedValue: '987654321098' },
      { type: 'domain', value: 'fraud.com', normalizedValue: 'fraud.com' },
    ],
  };

  const masked = maskReportForRole(rawReport, 'student');

  assert.strictEqual(masked.phoneRaw, '+91 9XXXXX');
  assert.strictEqual(masked.phone, '+91 9XXXXX');
  assert.strictEqual(masked.emailRaw, 'r***@fraud.com');
  assert.strictEqual(masked.email, 'r***@fraud.com');
  assert.strictEqual(masked.upiRaw, 'p****re@upi');
  assert.strictEqual(masked.upiId, 'p****re@upi');

  assert.strictEqual(masked.id, 'rep-1');
  assert.strictEqual(masked.companyNameRaw, 'Acme Corp');
  assert.strictEqual(masked.offerMessage, 'Deposit 5000 INR');

  assert.strictEqual(masked.identifiers[0].value, '+91 9XXXXX');
  assert.strictEqual(masked.identifiers[0].normalizedValue, '98765XXXXX');
  assert.strictEqual(masked.identifiers[1].value, 'r***@fraud.com');
  assert.strictEqual(masked.identifiers[2].value, 'p****re@upi');
  assert.strictEqual(masked.identifiers[3].value, '********1098');
  assert.strictEqual(masked.identifiers[4].value, 'fraud.com');
});

runTest('maskReportForRole strictly allow-lists nested recruiter and blocks internal fields', () => {
  const reportWithRecruiter = {
    id: 'rep-2',
    recruiter: {
      id: 'rec-1',
      name: 'John Doe',
      phone: '+91 9123456789',
      email: 'johndoe@scam.org',
      flagged: true,
      createdAt: new Date('2026-10-01'),
      // Unexpected / internal / private fields
      passwordHash: '$2b$12$unexpectedHashShouldNeverLeak',
      tokens: ['token123'],
      internalSalaryNotes: 'confidential negotiation details',
      privateApiKey: 'secret_key_12345',
    },
  };

  const studentView = maskReportForRole(reportWithRecruiter, 'student');
  assert.strictEqual(studentView.recruiter.id, 'rec-1');
  assert.strictEqual(studentView.recruiter.name, 'John Doe');
  assert.strictEqual(studentView.recruiter.phone, '+91 9XXXXX');
  assert.strictEqual(studentView.recruiter.email, 'j***@scam.org');
  assert.strictEqual(studentView.recruiter.flagged, true);
  assert(studentView.recruiter.createdAt instanceof Date);

  // Assert non-allow-listed fields are absent by default
  assert.strictEqual(studentView.recruiter.passwordHash, undefined);
  assert.strictEqual(studentView.recruiter.tokens, undefined);
  assert.strictEqual(studentView.recruiter.internalSalaryNotes, undefined);
  assert.strictEqual(studentView.recruiter.privateApiKey, undefined);

  // Admin view preserves raw data
  const adminView = maskReportForRole(reportWithRecruiter, 'admin');
  assert.strictEqual(adminView.recruiter.phone, '+91 9123456789');
  assert.strictEqual(adminView.recruiter.email, 'johndoe@scam.org');
});

runTest('maskReportForRole strictly allow-lists nested submitter and eliminates credentials', () => {
  const reportWithSubmitter = {
    id: 'rep-3',
    submitter: {
      id: 'user-456',
      name: 'Vansh Sharma',
      email: 'vansh@university.edu',
      passwordHash: '$2b$12$secretHashValueMustNeverBeExposed',
      isBanned: false,
      college: 'NST College',
      role: 'student',
      refreshTokens: ['secret-token'],
      createdAt: new Date('2026-09-01'),
    },
  };

  const studentView = maskReportForRole(reportWithSubmitter, 'student');
  assert.strictEqual(studentView.submitter.id, 'user-456');
  assert.strictEqual(studentView.submitter.name, 'Vansh Sharma');
  assert.strictEqual(studentView.submitter.college, 'NST College');
  assert.strictEqual(studentView.submitter.role, 'student');
  assert(studentView.submitter.createdAt instanceof Date);

  // Private account credentials & moderation flags must be strictly absent
  assert.strictEqual(studentView.submitter.email, undefined);
  assert.strictEqual(studentView.submitter.passwordHash, undefined);
  assert.strictEqual(studentView.submitter.isBanned, undefined);
  assert.strictEqual(studentView.submitter.refreshTokens, undefined);

  const adminView = maskReportForRole(reportWithSubmitter, 'admin');
  assert.strictEqual(adminView.submitter.email, 'vansh@university.edu');
  assert.strictEqual(adminView.submitter.passwordHash, '$2b$12$secretHashValueMustNeverBeExposed');
});

runTest('maskReportForRole strictly allow-lists nested reviewer', () => {
  const reportWithReviewer = {
    id: 'rep-3b',
    reviewer: {
      id: 'admin-99',
      name: 'Chief Moderator',
      email: 'mod@offercheck.org',
      passwordHash: '$2b$12$adminHash',
      role: 'admin',
    },
  };

  const studentView = maskReportForRole(reportWithReviewer, 'student');
  assert.strictEqual(studentView.reviewer.id, 'admin-99');
  assert.strictEqual(studentView.reviewer.name, 'Chief Moderator');
  assert.strictEqual(studentView.reviewer.role, 'admin');
  assert.strictEqual(studentView.reviewer.email, undefined);
  assert.strictEqual(studentView.reviewer.passwordHash, undefined);
});

runTest('maskReportForRole sanitizes Prisma ReportIdentifier junction records with nested identifier', () => {
  const reportWithJunction = {
    id: 'rep-4',
    identifiers: [
      {
        reportId: 'rep-4',
        identifierId: 'ident-1',
        confidence: 'high',
        identifier: {
          id: 'ident-1',
          type: 'phone',
          value: '+91 9876500000',
          normalizedValue: '9876500000',
        },
      },
      {
        reportId: 'rep-4',
        identifierId: 'ident-2',
        confidence: 'high',
        identifier: {
          id: 'ident-2',
          type: 'domain',
          value: 'scamjobs.in',
          normalizedValue: 'scamjobs.in',
        },
      },
    ],
  };

  const studentView = maskReportForRole(reportWithJunction, 'student');
  assert.strictEqual(studentView.identifiers[0].identifier.value, '+91 9XXXXX');
  assert.strictEqual(studentView.identifiers[0].identifier.normalizedValue, '98765XXXXX');
  assert.strictEqual(studentView.identifiers[1].identifier.value, 'scamjobs.in');

  const adminView = maskReportForRole(reportWithJunction, 'admin');
  assert.strictEqual(adminView.identifiers[0].identifier.value, '+91 9876500000');
});

runTest('maskReportForRole preserves legitimate non-PII fraud intelligence fields', () => {
  const fullFraudReport = {
    id: 'rep-fraud-intel',
    companyId: 'comp-uuid-1',
    recruiterId: 'rec-uuid-1',
    companyNameRaw: 'Fake Tech Solutions',
    recruiterNameRaw: 'Alex Scammer',
    domainRaw: 'faketechsolutions.com',
    phoneRaw: '+91 9876512345',
    emailRaw: 'contact@faketechsolutions.com',
    upiRaw: 'payhere@fakebank',
    offerMessage: 'Congratulations! You are selected as a Junior Developer.',
    paymentRequest: 'Pay 3,500 INR for laptop security deposit',
    additionalNotes: 'Candidate noticed generic Gmail and unverified UPI',
    status: 'investigating',
    isVerified: false,
    isInferred: true,
    riskScore: 88,
    riskCategory: 'critical',
    riskAssessments: [
      {
        id: 'ra-1',
        score: 88,
        category: 'critical',
        summary: 'High probability fraudulent offer due to upfront deposit request and flagged UPI identifier',
        isCurrent: true,
        version: 1,
      },
    ],
  };

  const studentView = maskReportForRole(fullFraudReport, 'student');

  assert.strictEqual(studentView.phoneRaw, '+91 9XXXXX');
  assert.strictEqual(studentView.emailRaw, 'c***@faketechsolutions.com');
  assert.strictEqual(studentView.upiRaw, 'p****re@fakebank');

  assert.strictEqual(studentView.companyId, 'comp-uuid-1');
  assert.strictEqual(studentView.recruiterId, 'rec-uuid-1');
  assert.strictEqual(studentView.companyNameRaw, 'Fake Tech Solutions');
  assert.strictEqual(studentView.recruiterNameRaw, 'Alex Scammer');
  assert.strictEqual(studentView.domainRaw, 'faketechsolutions.com');
  assert.strictEqual(studentView.offerMessage, 'Congratulations! You are selected as a Junior Developer.');
  assert.strictEqual(studentView.paymentRequest, 'Pay 3,500 INR for laptop security deposit');
  assert.strictEqual(studentView.additionalNotes, 'Candidate noticed generic Gmail and unverified UPI');
  assert.strictEqual(studentView.status, 'investigating');
  assert.strictEqual(studentView.isVerified, false);
  assert.strictEqual(studentView.isInferred, true);
  assert.strictEqual(studentView.riskScore, 88);
  assert.strictEqual(studentView.riskCategory, 'critical');
  assert.strictEqual(studentView.riskAssessments[0].score, 88);
  assert.strictEqual(studentView.riskAssessments[0].category, 'critical');
  assert.strictEqual(studentView.riskAssessments[0].summary, 'High probability fraudulent offer due to upfront deposit request and flagged UPI identifier');
});

runTest('maskReportForRole safely preserves unknown and extra fields', () => {
  const reportWithExtras = {
    id: 'rep-5',
    phoneRaw: '+91 9876543210',
    customAuditNumber: 1042,
    arbitraryMetadata: { origin: 'api-v2', tags: ['phishing', 'urgent'] },
  };

  const sanitized = maskReportForRole(reportWithExtras, 'student');
  assert.strictEqual(sanitized.phoneRaw, '+91 9XXXXX');
  assert.strictEqual(sanitized.customAuditNumber, 1042);
  assert.deepStrictEqual(sanitized.arbitraryMetadata, { origin: 'api-v2', tags: ['phishing', 'urgent'] });
});

runTest('maskReportForRole strictly does not mutate original input objects', () => {
  const frozenReport = Object.freeze({
    id: 'rep-frozen',
    phoneRaw: '+91 9876543210',
    emailRaw: 'target@test.com',
    upiRaw: 'frozen@upi',
    recruiter: Object.freeze({
      name: 'Frozen Recruiter',
      phone: '+91 9999988888',
      email: 'rec@frozen.com',
    }),
    identifiers: Object.freeze([
      Object.freeze({
        type: 'phone',
        value: '+91 9999988888',
        normalizedValue: '9999988888',
      }),
    ]),
  });

  const result = maskReportForRole(frozenReport, 'student');

  assert.strictEqual(result.phoneRaw, '+91 9XXXXX');
  assert.strictEqual(result.recruiter.phone, '+91 9XXXXX');
  assert.strictEqual(result.identifiers[0].value, '+91 9XXXXX');

  assert.strictEqual(frozenReport.phoneRaw, '+91 9876543210');
  assert.strictEqual(frozenReport.recruiter.phone, '+91 9999988888');
  assert.strictEqual(frozenReport.identifiers[0].value, '+91 9999988888');
});

runTest('maskIdentifierForRole strictly does not mutate original frozen identifier', () => {
  const frozenIdentifier = Object.freeze({
    id: 'ident-frozen',
    type: 'email',
    value: 'secret@domain.com',
    normalizedValue: 'secret@domain.com',
  });

  const result = maskIdentifierForRole(frozenIdentifier, 'student');
  assert.strictEqual(result.value, 's***@domain.com');
  assert.strictEqual(frozenIdentifier.value, 'secret@domain.com');
});

runTest('maskIdentifierForRole handles UPI correctly for both student and admin roles', () => {
  const shortUpi = {
    type: 'upi',
    value: 'ab@okaxis',
    normalizedValue: 'ab@okaxis',
  };
  const threeCharUpi = {
    type: 'upi',
    value: 'pay@upi',
    normalizedValue: 'pay@upi',
  };
  const malformedUpi = {
    type: 'upi',
    value: 'malformedupi',
    normalizedValue: 'malformedupi',
  };
  const multiAtUpi = {
    type: 'upi',
    value: 'foo@bar@baz',
    normalizedValue: 'foo@bar@baz',
  };

  // Student role: must mask short UPIs and malformed inputs
  const studentShort = maskIdentifierForRole(shortUpi, 'student');
  assert.strictEqual(studentShort.value, 'a*@okaxis');
  assert.strictEqual(studentShort.normalizedValue, 'a*@okaxis');

  const studentThree = maskIdentifierForRole(threeCharUpi, 'student');
  assert.strictEqual(studentThree.value, 'p*y@upi');
  assert.strictEqual(studentThree.normalizedValue, 'p*y@upi');

  const studentMalformed = maskIdentifierForRole(malformedUpi, 'student');
  assert.strictEqual(studentMalformed.value, '*****');
  assert.strictEqual(studentMalformed.normalizedValue, '*****');

  const studentMultiAt = maskIdentifierForRole(multiAtUpi, 'student');
  assert.strictEqual(studentMultiAt.value, '*****');
  assert.strictEqual(studentMultiAt.normalizedValue, '*****');

  // Admin role: must receive raw unmasked values
  const adminShort = maskIdentifierForRole(shortUpi, 'admin');
  assert.strictEqual(adminShort.value, 'ab@okaxis');
  assert.strictEqual(adminShort.normalizedValue, 'ab@okaxis');

  const adminThree = maskIdentifierForRole(threeCharUpi, 'admin');
  assert.strictEqual(adminThree.value, 'pay@upi');
  assert.strictEqual(adminThree.normalizedValue, 'pay@upi');

  const adminMalformed = maskIdentifierForRole(malformedUpi, 'admin');
  assert.strictEqual(adminMalformed.value, 'malformedupi');
  assert.strictEqual(adminMalformed.normalizedValue, 'malformedupi');

  const adminMultiAt = maskIdentifierForRole(multiAtUpi, 'admin');
  assert.strictEqual(adminMultiAt.value, 'foo@bar@baz');
  assert.strictEqual(adminMultiAt.normalizedValue, 'foo@bar@baz');

  // Original objects remain unmutated
  assert.strictEqual(shortUpi.value, 'ab@okaxis');
  assert.strictEqual(threeCharUpi.value, 'pay@upi');
  assert.strictEqual(malformedUpi.value, 'malformedupi');
  assert.strictEqual(multiAtUpi.value, 'foo@bar@baz');
});

console.log(`\nAll ${passedTests} / ${totalTests} Phase 4C pure unit tests passed successfully!\n`);
