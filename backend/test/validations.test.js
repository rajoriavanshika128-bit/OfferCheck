'use strict';

/**
 * backend/test/validations.test.js
 * Comprehensive unit tests for centralized Zod validation schemas (Phase 5A.3).
 *
 * Test Matrix:
 * 1. Single Identifier Schemas & Exact Boundaries (Phone 20, Bank Account 8-34)
 * 2. Report Submission Schema (createReportSchema) & Alias Conflict Rejection
 * 3. Canonical Parsed Output Shapes
 * 4. Protected Properties & Mass Assignment Rejection
 * 5. Public vs Admin Report Discovery Schemas (publicReportQuerySchema vs adminReportQuerySchema)
 * 6. Report Sorting Mapping to Prisma Scalar Fields
 * 7. Query Parameter Empty String Coercion & Pagination Validation
 * 8. Route Parameter Schemas (reportIdParamSchema, checkIdParamSchema)
 * 9. Offer Check Submission Schema (offerCheckSchema) & Query Aliases
 * 10. Offer Check History Query Schema (offerCheckQuerySchema)
 * 11. Strict No-Raw-PII in Error Messages
 * 12. Express validate() and validateQuery() Middleware Compatibility
 */

const assert = require('assert');
const {
  createReportSchema,
  publicReportQuerySchema,
  adminReportQuerySchema,
  reportQuerySchema,
  reportIdParamSchema,
  offerCheckSchema,
  offerCheckQuerySchema,
  checkIdParamSchema,
  singleIdentifierSchema,
  phoneSchema,
  emailSchema,
  upiSchema,
  domainSchema,
  bankAccountSchema,
  ERROR_MESSAGES,
  PRISMA_REPORT_SORT_FIELDS,
} = require('../src/validations');
const validate = require('../src/middleware/validate');
const { validateQuery } = require('../src/middleware/validate');

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

console.log('\n--- Phase 5A.3: Centralized Zod Validation Unit Tests ---\n');

// ─── 1. Single Identifier Schemas & Exact Boundaries ─────────────────────────

console.log('1. Single Identifier Schemas & Exact Boundaries:');

runTest('phoneSchema accepts valid Indian 10-digit and international E.164 phones', () => {
  assert.strictEqual(phoneSchema.parse('9876543210'), '9876543210');
  assert.strictEqual(phoneSchema.parse('+919876543210'), '+919876543210');
  assert.strictEqual(phoneSchema.parse('+14155552671'), '+14155552671');
});

runTest('phoneSchema enforces exact Prisma VARCHAR(20) length boundary: 20 valid, 21 rejected', () => {
  const phone20 = '+91 (9876) 543-21012'; // exactly 20 characters
  assert.strictEqual(phone20.length, 20);
  assert.strictEqual(phoneSchema.parse(phone20), phone20);

  const phone21 = '+91 (9876) 543-210123'; // 21 characters
  assert.strictEqual(phone21.length, 21);
  assert.throws(() => phoneSchema.parse(phone21), /Phone number must be 20 characters or less/);
});

runTest('phoneSchema rejects invalid, ambiguous, or letters in phone numbers', () => {
  assert.throws(() => phoneSchema.parse('invalid-phone'), /Invalid phone number format/);
  assert.throws(() => phoneSchema.parse('12345'), /Invalid phone number format/);
  assert.throws(() => phoneSchema.parse(''), /Phone number cannot be empty/);
  assert.throws(() => phoneSchema.parse('   '), /Phone number cannot be empty/);
  assert.throws(() => phoneSchema.parse(1234567890), /expected string/);
});

runTest('emailSchema accepts valid email and rejects malformed email', () => {
  assert.strictEqual(emailSchema.parse('recruiter@acme.com'), 'recruiter@acme.com');
  assert.throws(() => emailSchema.parse('not-an-email'), /Invalid email address format/);
  assert.throws(() => emailSchema.parse('@bad.com'), /Invalid email address format/);
  assert.throws(() => emailSchema.parse(''), /Email address cannot be empty/);
});

runTest('upiSchema accepts valid VPA and rejects invalid handle', () => {
  assert.strictEqual(upiSchema.parse('hr-payment@okaxis'), 'hr-payment@okaxis');
  assert.throws(() => upiSchema.parse('invalid-handle-no-at'), /Invalid UPI ID format/);
  assert.throws(() => upiSchema.parse('@okaxis'), /Invalid UPI ID format/);
  assert.throws(() => upiSchema.parse(''), /UPI ID cannot be empty/);
});

runTest('domainSchema accepts valid domain and rejects invalid or credential-bearing domains', () => {
  assert.strictEqual(domainSchema.parse('careers-google.com'), 'careers-google.com');
  assert.strictEqual(domainSchema.parse('https://acme-jobs.in/careers'), 'https://acme-jobs.in/careers');
  assert.throws(() => domainSchema.parse('nodotdomain'), /Invalid domain format/);
  assert.throws(() => domainSchema.parse('user:pass@evil.com'), /Invalid domain format/);
  assert.throws(() => domainSchema.parse(''), /Domain cannot be empty/);
});

runTest('bankAccountSchema enforces 8-34 length boundaries: 8 and 34 valid, 7 and 35 rejected', () => {
  const bank8 = '12345678';
  assert.strictEqual(bankAccountSchema.parse(bank8), bank8);

  const bank34 = 'A'.repeat(34);
  assert.strictEqual(bankAccountSchema.parse(bank34), bank34);

  assert.throws(() => bankAccountSchema.parse('1234567'), /Invalid bank account format/);
  assert.throws(() => bankAccountSchema.parse('A'.repeat(35)), /Bank account must be 34 characters or less/);
  assert.throws(() => bankAccountSchema.parse('INVALID_SPECIAL!'), /Invalid bank account format/);
  assert.throws(() => bankAccountSchema.parse(''), /Bank account cannot be empty/);
});

runTest('singleIdentifierSchema validates all 5 supported types and enforces type boundaries', () => {
  const validPhone = singleIdentifierSchema.parse({ type: 'phone', value: '+919876543210' });
  assert.strictEqual(validPhone.type, 'phone');
  assert.strictEqual(validPhone.value, '+919876543210');

  // Phone max 20 characters in singleIdentifierSchema
  assert.throws(
    () => singleIdentifierSchema.parse({ type: 'phone', value: '+91 (9876) 543-210123' }),
    /Phone number must be 20 characters or less/
  );

  // Bank account max 34 characters in singleIdentifierSchema
  const validBank = singleIdentifierSchema.parse({ type: 'bank_account', value: '123456789012' });
  assert.strictEqual(validBank.type, 'bank_account');

  assert.throws(
    () => singleIdentifierSchema.parse({ type: 'bank_account', value: 'A'.repeat(35) }),
    /Bank account must be 34 characters or less/
  );
  assert.throws(
    () => singleIdentifierSchema.parse({ type: 'bank_account', value: 'short' }),
    /Invalid bank account format/
  );
  assert.throws(
    () => singleIdentifierSchema.parse({ type: 'crypto_wallet', value: '0x123' }),
    /Invalid identifier type/
  );
});

runTest('singleIdentifierSchema rejects unexpected properties via .strict()', () => {
  assert.throws(
    () => singleIdentifierSchema.parse({ type: 'phone', value: '+919876543210', extra: 'injected' }),
    /Unrecognized key/
  );
});

// ─── 2. Report Submission Schema & Alias Handling ────────────────────────────

console.log('\n2. Report Submission Schema & Alias Handling:');

runTest('Valid minimal payload succeeds and canonicalizes companyName and companyNameRaw', () => {
  const input = {
    companyName: 'Acme Corporation',
    offerMessage: 'Congratulations! You have been selected for a software internship.',
  };
  const result = createReportSchema.parse(input);
  assert.strictEqual(result.companyName, 'Acme Corporation');
  assert.strictEqual(result.companyNameRaw, 'Acme Corporation');
  assert.strictEqual(result.offerMessage, input.offerMessage);
});

runTest('Valid payload accepts companyNameRaw as alias and canonicalizes both fields', () => {
  const input = {
    companyNameRaw: 'Acme Corporation',
    offerMessage: 'Congratulations! You have been selected for a software internship.',
  };
  const result = createReportSchema.parse(input);
  assert.strictEqual(result.companyName, 'Acme Corporation');
  assert.strictEqual(result.companyNameRaw, 'Acme Corporation');
});

runTest('Accepts identical values when both alias and canonical fields are supplied', () => {
  const input = {
    companyName: 'Acme Corp',
    companyNameRaw: 'Acme Corp',
    phone: '+919876543210',
    phoneRaw: '+919876543210',
    offerMessage: 'Valid offer message.',
  };
  const result = createReportSchema.parse(input);
  assert.strictEqual(result.companyName, 'Acme Corp');
  assert.strictEqual(result.companyNameRaw, 'Acme Corp');
  assert.strictEqual(result.phone, '+919876543210');
  assert.strictEqual(result.phoneRaw, '+919876543210');
});

runTest('Strictly rejects conflicting dual aliases for companyName and companyNameRaw', () => {
  const input = {
    companyName: 'Legitimate Acme Corp',
    companyNameRaw: 'Scam Phishers LLC',
    offerMessage: 'Valid offer message.',
  };
  assert.throws(() => createReportSchema.parse(input), /Conflicting companyName and companyNameRaw supplied/);
});

runTest('Strictly rejects conflicting dual aliases for recruiter, phone, email, upi, domain, notes', () => {
  const base = { companyName: 'Acme', offerMessage: 'Valid message' };

  assert.throws(
    () => createReportSchema.parse({ ...base, recruiterName: 'John Doe', recruiterNameRaw: 'Jane Smith' }),
    /Conflicting recruiterName and recruiterNameRaw supplied/
  );
  assert.throws(
    () => createReportSchema.parse({ ...base, phone: '+919876543210', phoneRaw: '+919876543211' }),
    /Conflicting phone and phoneRaw supplied/
  );
  assert.throws(
    () => createReportSchema.parse({ ...base, email: 'a@acme.com', emailRaw: 'b@acme.com' }),
    /Conflicting email and emailRaw supplied/
  );
  assert.throws(
    () => createReportSchema.parse({ ...base, upi: 'a@okaxis', upiRaw: 'b@okaxis' }),
    /Conflicting upi and upiRaw supplied/
  );
  assert.throws(
    () => createReportSchema.parse({ ...base, domain: 'acme.com', domainRaw: 'evil.com' }),
    /Conflicting domain and domainRaw supplied/
  );
  assert.throws(
    () => createReportSchema.parse({ ...base, additionalNotes: 'Note A', additionalInfo: 'Note B' }),
    /Conflicting additionalNotes and additionalInfo supplied/
  );
});

runTest('Valid complete payload with all optional fields succeeds and canonicalizes cleanly', () => {
  const completeInput = {
    companyName: 'Tech Innovations Ltd',
    recruiterName: 'John Doe',
    domain: 'tech-innovations.in',
    phone: '+919876543210',
    email: 'hr@tech-innovations.in',
    upi: 'pay-hr@okaxis',
    offerMessage: 'Immediate joining offer! Pay registration fee of Rs. 2000.',
    paymentRequest: 'Rs. 2000 mandatory training deposit',
    additionalNotes: 'Received via WhatsApp from unknown recruiter.',
    identifiers: [
      { type: 'phone', value: '+919876543210' },
      { type: 'upi', value: 'pay-hr@okaxis' },
      { type: 'bank_account', value: 'HDFC000123456789' },
    ],
  };
  const result = createReportSchema.parse(completeInput);
  assert.strictEqual(result.companyName, 'Tech Innovations Ltd');
  assert.strictEqual(result.companyNameRaw, 'Tech Innovations Ltd');
  assert.strictEqual(result.recruiterName, 'John Doe');
  assert.strictEqual(result.recruiterNameRaw, 'John Doe');
  assert.strictEqual(result.identifiers.length, 3);
});

runTest('Null versus omitted optional fields: accepts explicit null and omitted', () => {
  const nullInput = {
    companyName: 'Acme Corp',
    recruiterName: null,
    domain: null,
    phone: null,
    email: null,
    upi: null,
    paymentRequest: null,
    additionalNotes: null,
    identifiers: null,
    offerMessage: 'Valid offer message with null optionals.',
  };
  const result = createReportSchema.parse(nullInput);
  assert.strictEqual(result.companyName, 'Acme Corp');
  assert.strictEqual(result.recruiterName, null);
  assert.strictEqual(result.phone, null);
  assert.strictEqual(result.identifiers, null);
});

runTest('Missing required fields: rejects missing companyName or missing offerMessage', () => {
  assert.throws(
    () => createReportSchema.parse({ offerMessage: 'Offer without company name' }),
    /Company name is required/
  );
  assert.throws(
    () => createReportSchema.parse({ companyName: 'Acme Corp' }),
    /Offer message is required/
  );
  assert.throws(() => createReportSchema.parse({}), /Offer message is required/);
});

runTest('Empty and whitespace-only strings are rejected for required fields', () => {
  assert.throws(
    () => createReportSchema.parse({ companyName: '', offerMessage: 'Valid message' }),
    /Company name cannot be empty/
  );
  assert.throws(
    () => createReportSchema.parse({ companyName: '   ', offerMessage: 'Valid message' }),
    /Company name cannot be empty/
  );
  assert.throws(
    () => createReportSchema.parse({ companyName: 'Acme Corp', offerMessage: '' }),
    /Offer message cannot be empty/
  );
  assert.throws(
    () => createReportSchema.parse({ companyName: 'Acme Corp', offerMessage: '   ' }),
    /Offer message cannot be empty/
  );
});

runTest('Wrong data types are rejected with 400 validation errors', () => {
  assert.throws(
    () => createReportSchema.parse({ companyName: 12345, offerMessage: 'Valid' }),
    /expected string/
  );
  assert.throws(
    () => createReportSchema.parse({ companyName: 'Acme', offerMessage: 99999 }),
    /Offer message/
  );
  assert.throws(
    () => createReportSchema.parse({ companyName: 'Acme', offerMessage: 'Valid', identifiers: 'not-an-array' }),
    /expected array/
  );
});

runTest('Maximum length boundaries are strictly enforced', () => {
  const validCompany200 = 'A'.repeat(200);
  const oversizedCompany201 = 'A'.repeat(201);
  assert.strictEqual(
    createReportSchema.parse({ companyName: validCompany200, offerMessage: 'Valid' }).companyName.length,
    200
  );
  assert.throws(
    () => createReportSchema.parse({ companyName: oversizedCompany201, offerMessage: 'Valid' }),
    /Company name must be 200 characters or less/
  );

  const oversizedRecruiter121 = 'B'.repeat(121);
  assert.throws(
    () => createReportSchema.parse({ companyName: 'Acme', recruiterName: oversizedRecruiter121, offerMessage: 'Valid' }),
    /Recruiter name must be 120 characters or less/
  );

  const oversizedPayment301 = 'C'.repeat(301);
  assert.throws(
    () => createReportSchema.parse({ companyName: 'Acme', paymentRequest: oversizedPayment301, offerMessage: 'Valid' }),
    /Payment request must be 300 characters or less/
  );

  const oversizedMessage20001 = 'D'.repeat(20001);
  assert.throws(
    () => createReportSchema.parse({ companyName: 'Acme', offerMessage: oversizedMessage20001 }),
    /Offer message must be 20000 characters or less/
  );

  // Maximum 20 identifiers
  const max20Identifiers = Array.from({ length: 20 }, (_, i) => ({
    type: 'phone',
    value: `+91987654321${i % 10}`,
  }));
  assert.strictEqual(
    createReportSchema.parse({ companyName: 'Acme', offerMessage: 'Valid', identifiers: max20Identifiers }).identifiers.length,
    20
  );

  const oversized21Identifiers = Array.from({ length: 21 }, (_, i) => ({
    type: 'phone',
    value: `+91987654321${i % 10}`,
  }));
  assert.throws(
    () => createReportSchema.parse({ companyName: 'Acme', offerMessage: 'Valid', identifiers: oversized21Identifiers }),
    /Cannot submit more than 20 identifiers/
  );
});

// ─── 3. Protected Properties & Mass Assignment Rejection ─────────────────────

console.log('\n3. Protected Properties & Mass Assignment Rejection:');

runTest('Rejects client-supplied userId, submittedBy, and reviewedBy', () => {
  assert.throws(
    () => createReportSchema.parse({ companyName: 'Acme', offerMessage: 'Valid', userId: 'attacker-id' }),
    /Unrecognized key/
  );
  assert.throws(
    () => createReportSchema.parse({ companyName: 'Acme', offerMessage: 'Valid', submittedBy: 'attacker-id' }),
    /Unrecognized key/
  );
  assert.throws(
    () => createReportSchema.parse({ companyName: 'Acme', offerMessage: 'Valid', reviewedBy: 'admin-id' }),
    /Unrecognized key/
  );
});

runTest('Rejects client-supplied report status, role, isVerified, and isInferred', () => {
  assert.throws(
    () => createReportSchema.parse({ companyName: 'Acme', offerMessage: 'Valid', status: 'verified' }),
    /Unrecognized key/
  );
  assert.throws(
    () => createReportSchema.parse({ companyName: 'Acme', offerMessage: 'Valid', role: 'admin' }),
    /Unrecognized key/
  );
  assert.throws(
    () => createReportSchema.parse({ companyName: 'Acme', offerMessage: 'Valid', isVerified: true }),
    /Unrecognized key/
  );
  assert.throws(
    () => createReportSchema.parse({ companyName: 'Acme', offerMessage: 'Valid', isInferred: true }),
    /Unrecognized key/
  );
});

runTest('Rejects client-supplied risk scores, categories, and database audit columns', () => {
  assert.throws(
    () => createReportSchema.parse({ companyName: 'Acme', offerMessage: 'Valid', riskScore: 0 }),
    /Unrecognized key/
  );
  assert.throws(
    () => createReportSchema.parse({ companyName: 'Acme', offerMessage: 'Valid', riskCategory: 'low' }),
    /Unrecognized key/
  );
  assert.throws(
    () => createReportSchema.parse({ companyName: 'Acme', offerMessage: 'Valid', id: 'fake-uuid' }),
    /Unrecognized key/
  );
  assert.throws(
    () => createReportSchema.parse({ companyName: 'Acme', offerMessage: 'Valid', createdAt: new Date() }),
    /Unrecognized key/
  );
});

// ─── 4. Public vs Admin Report Discovery Schemas ─────────────────────────────

console.log('\n4. Public vs Admin Report Discovery Schemas:');

runTest('publicReportQuerySchema defaults to status "verified" and accepts status: "verified"', () => {
  const parsedDefault = publicReportQuerySchema.parse({});
  assert.strictEqual(parsedDefault.status, 'verified');

  const parsedExplicit = publicReportQuerySchema.parse({ status: 'verified' });
  assert.strictEqual(parsedExplicit.status, 'verified');
});

runTest('publicReportQuerySchema strictly blocks public discovery of pending, rejected, and investigating reports', () => {
  assert.throws(
    () => publicReportQuerySchema.parse({ status: 'pending' }),
    /Public report discovery only permits verified reports/
  );
  assert.throws(
    () => publicReportQuerySchema.parse({ status: 'rejected' }),
    /Public report discovery only permits verified reports/
  );
  assert.throws(
    () => publicReportQuerySchema.parse({ status: 'investigating' }),
    /Public report discovery only permits verified reports/
  );
});

runTest('adminReportQuerySchema allows querying across all 4 moderation statuses', () => {
  assert.strictEqual(adminReportQuerySchema.parse({ status: 'pending' }).status, 'pending');
  assert.strictEqual(adminReportQuerySchema.parse({ status: 'verified' }).status, 'verified');
  assert.strictEqual(adminReportQuerySchema.parse({ status: 'rejected' }).status, 'rejected');
  assert.strictEqual(adminReportQuerySchema.parse({ status: 'investigating' }).status, 'investigating');
  assert.strictEqual(adminReportQuerySchema.parse({}).status, undefined);
});

runTest('reportQuerySchema is safely aliased to publicReportQuerySchema for backward compatibility', () => {
  assert.strictEqual(reportQuerySchema, publicReportQuerySchema);
  assert.strictEqual(reportQuerySchema.parse({}).status, 'verified');
  assert.throws(() => reportQuerySchema.parse({ status: 'pending' }), /Public report discovery/);
});

// ─── 5. Report Sorting Mapping to Prisma Scalar Fields ────────────────────────

console.log('\n5. Report Sorting Mapping to Prisma Scalar Fields:');

runTest('sortBy: "companyName" is safely mapped to Prisma scalar "companyNameRaw"', () => {
  const parsed = publicReportQuerySchema.parse({ sortBy: 'companyName' });
  assert.strictEqual(parsed.sortBy, 'companyNameRaw');
});

runTest('sortBy: "companyNameRaw" preserves Prisma scalar "companyNameRaw"', () => {
  const parsed = publicReportQuerySchema.parse({ sortBy: 'companyNameRaw' });
  assert.strictEqual(parsed.sortBy, 'companyNameRaw');
});

runTest('All accepted sort fields map to actual Prisma Report model fields', () => {
  for (const field of PRISMA_REPORT_SORT_FIELDS) {
    const parsed = publicReportQuerySchema.parse({ sortBy: field });
    assert.strictEqual(parsed.sortBy, field);
  }
});

runTest('Rejects unindexed or unapproved sort fields', () => {
  assert.throws(() => publicReportQuerySchema.parse({ sortBy: 'passwordHash' }), /Invalid sort field/);
  assert.throws(() => publicReportQuerySchema.parse({ sortBy: 'unindexedField' }), /Invalid sort field/);
});

// ─── 6. Query Parameter Empty String Coercion & Pagination ───────────────────

console.log('\n6. Query Parameter Empty String Coercion & Pagination:');

runTest('Empty string and whitespace-only search parameters convert to undefined', () => {
  const emptySearch = publicReportQuerySchema.parse({ search: '' });
  assert.strictEqual(emptySearch.search, undefined);

  const whitespaceSearch = publicReportQuerySchema.parse({ search: '    ' });
  assert.strictEqual(whitespaceSearch.search, undefined);

  const emptyIdentifier = publicReportQuerySchema.parse({ identifierValue: '' });
  assert.strictEqual(emptyIdentifier.identifierValue, undefined);

  const validSearch = publicReportQuerySchema.parse({ search: '  Acme Corp  ' });
  assert.strictEqual(validSearch.search, 'Acme Corp');
});

runTest('Empty ?page= and ?limit= are rejected with validation errors (not silently coerced to 0)', () => {
  assert.throws(() => publicReportQuerySchema.parse({ page: '' }), /Page must be a valid number/);
  assert.throws(() => publicReportQuerySchema.parse({ page: '   ' }), /Page must be a valid number/);
  assert.throws(() => publicReportQuerySchema.parse({ limit: '' }), /Limit must be a valid number/);
  assert.throws(() => publicReportQuerySchema.parse({ limit: '   ' }), /Limit must be a valid number/);
});

runTest('Enforces pagination bounds: rejects page < 1, limit < 1, and limit > 100', () => {
  assert.throws(() => publicReportQuerySchema.parse({ page: '0' }), /Page must be at least 1/);
  assert.throws(() => publicReportQuerySchema.parse({ page: '-5' }), /Page must be at least 1/);
  assert.throws(() => publicReportQuerySchema.parse({ limit: '0' }), /Limit must be at least 1/);
  assert.throws(() => publicReportQuerySchema.parse({ limit: '101' }), /Limit cannot exceed 100/);
  assert.throws(() => publicReportQuerySchema.parse({ page: 'not-a-number' }), /Page must be a valid number/);
});

runTest('Validates UUID format for companyId and recruiterId filters', () => {
  const validUuid = '123e4567-e89b-12d3-a456-426614174000';
  const parsed = publicReportQuerySchema.parse({ companyId: validUuid, recruiterId: validUuid });
  assert.strictEqual(parsed.companyId, validUuid);
  assert.strictEqual(parsed.recruiterId, validUuid);

  assert.throws(() => publicReportQuerySchema.parse({ companyId: 'not-a-uuid' }), /Company ID must be a valid UUID/);
  assert.throws(() => publicReportQuerySchema.parse({ recruiterId: 'not-a-uuid' }), /Recruiter ID must be a valid UUID/);
});

runTest('Rejects unexpected or malicious query parameters via .strict()', () => {
  assert.throws(() => publicReportQuerySchema.parse({ maliciousParam: 'drop table' }), /Unrecognized key/);
});

// ─── 7. Route Parameter Schemas ──────────────────────────────────────────────

console.log('\n7. Route Parameter Schemas:');

runTest('reportIdParamSchema and checkIdParamSchema accept valid UUIDs and reject invalid', () => {
  const validUuid = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
  assert.strictEqual(reportIdParamSchema.parse({ id: validUuid }).id, validUuid);
  assert.strictEqual(checkIdParamSchema.parse({ id: validUuid }).id, validUuid);

  assert.throws(() => reportIdParamSchema.parse({ id: 'bad-id' }), /Invalid report ID format/);
  assert.throws(() => checkIdParamSchema.parse({ id: 'bad-id' }), /Invalid check ID format/);
  assert.throws(() => reportIdParamSchema.parse({}), /Report ID is required/);
});

// ─── 8. Offer Check Submission Schema & Query Aliases ────────────────────────

console.log('\n8. Offer Check Submission Schema & Query Aliases:');

runTest('Minimal offer check succeeds with offerMessage alone', () => {
  const parsed = offerCheckSchema.parse({
    offerMessage: 'You are selected! Send Rs. 1500 for training fees.',
  });
  assert.strictEqual(parsed.offerMessage, 'You are selected! Send Rs. 1500 for training fees.');
});

runTest('Complete offer check canonicalizes phone, email, upi, domain queries', () => {
  const completeInput = {
    offerMessage: 'You are selected! Send Rs. 1500 for training fees.',
    companyName: 'Acme Placement',
    paymentRequest: 'Rs. 1500 registration deposit',
    phone: '+919876543210',
    email: 'hr@acmeplacement.com',
    upi: 'acme@okaxis',
    domain: 'acmeplacement.com',
    bankAccount: '123456789012',
    identifiers: [
      { type: 'phone', value: '+919876543210' },
      { type: 'bank_account', value: '123456789012' },
    ],
  };
  const parsed = offerCheckSchema.parse(completeInput);
  assert.strictEqual(parsed.companyName, 'Acme Placement');
  assert.strictEqual(parsed.phone, '+919876543210');
  assert.strictEqual(parsed.phoneQuery, '+919876543210');
  assert.strictEqual(parsed.email, 'hr@acmeplacement.com');
  assert.strictEqual(parsed.emailQuery, 'hr@acmeplacement.com');
  assert.strictEqual(parsed.bankAccount, '123456789012');
  assert.strictEqual(parsed.identifiers.length, 2);
});

runTest('Offer check rejects conflicting query aliases', () => {
  const base = { offerMessage: 'Valid offer message' };
  assert.throws(
    () => offerCheckSchema.parse({ ...base, phone: '+919876543210', phoneQuery: '+919876543211' }),
    /Conflicting phone and phoneQuery supplied/
  );
  assert.throws(
    () => offerCheckSchema.parse({ ...base, email: 'a@acme.com', emailQuery: 'b@acme.com' }),
    /Conflicting email and emailQuery supplied/
  );
});

runTest('Offer check enforces phone VARCHAR(20) boundary: 20 valid, 21 rejected', () => {
  const base = { offerMessage: 'Valid message' };
  assert.strictEqual(offerCheckSchema.parse({ ...base, phone: '+91 (9876) 543-21012' }).phone, '+91 (9876) 543-21012');
  assert.throws(
    () => offerCheckSchema.parse({ ...base, phone: '+91 (9876) 543-210123' }),
    /Phone number must be 20 characters or less/
  );
});

runTest('Null versus omitted optional fields in offer check: accepts null and omitted', () => {
  const parsed = offerCheckSchema.parse({
    offerMessage: 'Offer text',
    companyName: null,
    phone: null,
    email: null,
    upi: null,
    domain: null,
    bankAccount: null,
    identifiers: null,
  });
  assert.strictEqual(parsed.companyName, null);
  assert.strictEqual(parsed.phone, null);
  assert.strictEqual(parsed.bankAccount, null);
});

runTest('Offer check rejects missing or empty offerMessage', () => {
  assert.throws(() => offerCheckSchema.parse({}), /Offer message is required/);
  assert.throws(() => offerCheckSchema.parse({ offerMessage: '' }), /Offer message cannot be empty/);
  assert.throws(() => offerCheckSchema.parse({ offerMessage: '   ' }), /Offer message cannot be empty/);
});

runTest('Offer check rejects client-supplied protected fields via .strict()', () => {
  assert.throws(
    () => offerCheckSchema.parse({ offerMessage: 'Valid', userId: 'attacker-id' }),
    /Unrecognized key/
  );
  assert.throws(
    () => offerCheckSchema.parse({ offerMessage: 'Valid', riskScore: 10 }),
    /Unrecognized key/
  );
  assert.throws(
    () => offerCheckSchema.parse({ offerMessage: 'Valid', riskCategory: 'low' }),
    /Unrecognized key/
  );
  assert.throws(
    () => offerCheckSchema.parse({ offerMessage: 'Valid', result: {} }),
    /Unrecognized key/
  );
  assert.throws(
    () => offerCheckSchema.parse({ offerMessage: 'Valid', ipHash: 'hash' }),
    /Unrecognized key/
  );
});

// ─── 9. Offer Check History Query Schema ─────────────────────────────────────

console.log('\n9. Offer Check History Query Schema:');

runTest('Empty query produces safe defaults for offer check history', () => {
  const parsed = offerCheckQuerySchema.parse({});
  assert.strictEqual(parsed.page, 1);
  assert.strictEqual(parsed.limit, 20);
  assert.strictEqual(parsed.sortBy, 'checkedAt');
  assert.strictEqual(parsed.sortOrder, 'desc');
});

runTest('Validates riskCategory filter and enforces pagination limits', () => {
  const parsed = offerCheckQuerySchema.parse({
    page: '2',
    limit: '25',
    riskCategory: 'critical',
    sortBy: 'riskScore',
    sortOrder: 'asc',
  });
  assert.strictEqual(parsed.page, 2);
  assert.strictEqual(parsed.limit, 25);
  assert.strictEqual(parsed.riskCategory, 'critical');
  assert.strictEqual(parsed.sortBy, 'riskScore');
  assert.strictEqual(parsed.sortOrder, 'asc');

  assert.throws(() => offerCheckQuerySchema.parse({ riskCategory: 'catastrophic' }), /Invalid risk category filter/);
  assert.throws(() => offerCheckQuerySchema.parse({ limit: '150' }), /Limit cannot exceed 100/);
  assert.throws(() => offerCheckQuerySchema.parse({ page: '-1' }), /Page must be at least 1/);
  assert.throws(() => offerCheckQuerySchema.parse({ page: '' }), /Page must be a valid number/);
});

// ─── 10. Strict No-Raw-PII in Error Messages ─────────────────────────────────

console.log('\n10. Strict No-Raw-PII in Error Messages:');

runTest('Validation errors NEVER leak raw sensitive phone number', () => {
  const rawSecretPhone = '+919999999999bad';
  let caughtError;
  try {
    createReportSchema.parse({
      companyName: 'Acme',
      offerMessage: 'Valid message',
      phone: rawSecretPhone,
    });
  } catch (err) {
    caughtError = err;
  }
  assert.ok(caughtError, 'Expected validation to throw');
  const serialized = JSON.stringify(caughtError);
  assert.strictEqual(
    serialized.includes(rawSecretPhone),
    false,
    `Error message leaked raw phone: ${serialized}`
  );
  assert.strictEqual((caughtError.issues || caughtError.errors)[0].message, ERROR_MESSAGES.phone);
});

runTest('Validation errors NEVER leak raw sensitive email address', () => {
  const rawSecretEmail = 'secret-student-target@not-a-valid-email';
  let caughtError;
  try {
    createReportSchema.parse({
      companyName: 'Acme',
      offerMessage: 'Valid message',
      email: rawSecretEmail,
    });
  } catch (err) {
    caughtError = err;
  }
  assert.ok(caughtError);
  const serialized = JSON.stringify(caughtError);
  assert.strictEqual(
    serialized.includes(rawSecretEmail),
    false,
    `Error message leaked raw email: ${serialized}`
  );
  assert.strictEqual((caughtError.issues || caughtError.errors)[0].message, ERROR_MESSAGES.email);
});

runTest('Validation errors NEVER leak raw sensitive bank account in identifiers', () => {
  const rawSecretBank = 'SBIN987654321098bad!';
  let caughtError;
  try {
    createReportSchema.parse({
      companyName: 'Acme',
      offerMessage: 'Valid message',
      identifiers: [{ type: 'bank_account', value: rawSecretBank }],
    });
  } catch (err) {
    caughtError = err;
  }
  assert.ok(caughtError);
  const serialized = JSON.stringify(caughtError);
  assert.strictEqual(
    serialized.includes(rawSecretBank),
    false,
    `Error message leaked raw bank account: ${serialized}`
  );
  assert.strictEqual((caughtError.issues || caughtError.errors)[0].message, ERROR_MESSAGES.bank_account);
});

// ─── 11. Express validate() and validateQuery() Middleware Compatibility ─────

console.log('\n11. Express validate() and validateQuery() Middleware Compatibility:');

runTest('validate(createReportSchema) middleware passes parsed body to next() on success', () => {
  const middleware = validate(createReportSchema);
  const req = {
    body: {
      companyName: ' Acme Corporation  ',
      offerMessage: '  Selected for internship  ',
    },
  };
  let nextCalled = false;
  let nextErr = null;

  middleware(req, {}, (err) => {
    nextCalled = true;
    nextErr = err;
  });

  assert.strictEqual(nextCalled, true);
  assert.strictEqual(nextErr, undefined);
  assert.strictEqual(req.body.companyName, 'Acme Corporation');
  assert.strictEqual(req.body.companyNameRaw, 'Acme Corporation');
  assert.strictEqual(req.body.offerMessage, 'Selected for internship');
});

runTest('validate(createReportSchema) middleware passes ZodError to next(err) on failure', () => {
  const middleware = validate(createReportSchema);
  const req = {
    body: {
      companyName: '',
      offerMessage: 'Valid offer message',
    },
  };
  let nextCalled = false;
  let passedErr = null;

  middleware(req, {}, (err) => {
    nextCalled = true;
    passedErr = err;
  });

  assert.strictEqual(nextCalled, true);
  assert.ok(passedErr, 'Expected next() to receive an error');
  assert.strictEqual(passedErr.name, 'ZodError');
  assert.ok(passedErr.issues.length >= 1);
});

runTest('validateQuery(publicReportQuerySchema) middleware parses req.query on success', () => {
  const middleware = validateQuery(publicReportQuerySchema);
  const req = {
    query: {
      page: '3',
      limit: '50',
      sortBy: 'companyName',
      search: '  Acme  ',
    },
  };
  let nextCalled = false;
  let nextErr = null;

  middleware(req, {}, (err) => {
    nextCalled = true;
    nextErr = err;
  });

  assert.strictEqual(nextCalled, true);
  assert.strictEqual(nextErr, undefined);
  assert.strictEqual(req.query.page, 3);
  assert.strictEqual(req.query.limit, 50);
  assert.strictEqual(req.query.sortBy, 'companyNameRaw'); // mapped to Prisma scalar field!
  assert.strictEqual(req.query.status, 'verified'); // public default!
  assert.strictEqual(req.query.search, 'Acme');
});

runTest('validateQuery(publicReportQuerySchema) middleware passes ZodError on unapproved status or invalid query', () => {
  const middleware = validateQuery(publicReportQuerySchema);
  const req = {
    query: {
      status: 'pending', // unapproved for public discovery!
    },
  };
  let nextCalled = false;
  let passedErr = null;

  middleware(req, {}, (err) => {
    nextCalled = true;
    passedErr = err;
  });

  assert.strictEqual(nextCalled, true);
  assert.ok(passedErr);
  assert.strictEqual(passedErr.name, 'ZodError');
});

runTest('validate.query is accessible as an alias on validate middleware function', () => {
  assert.strictEqual(typeof validate.query, 'function');
  assert.strictEqual(validate.query, validateQuery);
});

console.log(`\nAll ${passedTests} / ${totalTests} Phase 5A.3 validation tests passed successfully!\n`);
