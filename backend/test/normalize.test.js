'use strict';

/**
 * backend/test/normalize.test.js
 * Pure unit tests for the Identifier Normalization Engine (Phase 5A.1).
 *
 * Covers:
 * 1. Phone normalization (India-first policy, leading zeroes, international codes, length limits, ambiguous inputs)
 * 2. Email normalization (whitespace trimming, case normalization, malformed rejection)
 * 3. UPI normalization (VPA specifications, arbitrary handles, invalid format rejection)
 * 4. Domain normalization (protocol stripping, paths/queries, punycode IDN, IP rejection, credentials rejection)
 * 5. Bank account normalization (separators, alphanumeric support, length limits, non-exposure of values)
 * 6. Universal normalizeIdentifier entrypoint & type validation
 * 7. createNormalizedIdentifier display value preservation
 * 8. extractIdentifiersFromReport extraction & deduplication
 * 9. Idempotency verification across all types
 */

const assert = require('assert');
const {
  SUPPORTED_TYPES,
  normalizePhone,
  normalizeEmail,
  normalizeUpi,
  normalizeDomain,
  normalizeBankAccount,
  normalizeIdentifier,
  createNormalizedIdentifier,
  extractIdentifiersFromReport,
} = require('../src/utils/normalize');
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

console.log('\n--- Phase 5A.1: Identifier Normalization Unit Tests ---\n');

// ─── 1. Phone Normalization ──────────────────────────────────────────────────

console.log('1. Phone Normalization (India-first & International E.164):');

runTest('10-digit Indian domestic number normalizes with +91 prepended', () => {
  assert.strictEqual(normalizePhone('9876543210'), '+919876543210');
  assert.strictEqual(normalizePhone(' 9876543210 '), '+919876543210');
  assert.strictEqual(normalizePhone('98765-43210'), '+919876543210');
  assert.strictEqual(normalizePhone('(987) 654-3210'), '+919876543210');
  assert.strictEqual(normalizePhone('987.654.3210'), '+919876543210');
});

runTest('11-digit Indian number with leading zero (STD code) normalizes to +91', () => {
  assert.strictEqual(normalizePhone('09876543210'), '+919876543210');
  assert.strictEqual(normalizePhone('0-98765-43210'), '+919876543210');
  assert.strictEqual(normalizePhone('(0) 98765 43210'), '+919876543210');
});

runTest('12-digit Indian number with leading 91 without plus normalizes to +91', () => {
  assert.strictEqual(normalizePhone('919876543210'), '+919876543210');
  assert.strictEqual(normalizePhone('91-9876543210'), '+919876543210');
});

runTest('Explicit Indian number with +91 is preserved and formatting stripped', () => {
  assert.strictEqual(normalizePhone('+91 98765 43210'), '+919876543210');
  assert.strictEqual(normalizePhone('+91-98765-43210'), '+919876543210');
  assert.strictEqual(normalizePhone('(+91) 9876543210'), '+919876543210');
});

runTest('Explicit international phone numbers with + are preserved', () => {
  // US (+1)
  assert.strictEqual(normalizePhone('+1 (415) 555-2671'), '+14155552671');
  // UK (+44)
  assert.strictEqual(normalizePhone('+44 20 7183 8750'), '+442071838750');
  // Singapore (+65)
  assert.strictEqual(normalizePhone('+65 6789 0123'), '+6567890123');
  // Australia (+61)
  assert.strictEqual(normalizePhone('+61 2 9876 5432'), '+61298765432');
});

runTest('International phone numbers with 00 prefix normalize to +', () => {
  assert.strictEqual(normalizePhone('0014155552671'), '+14155552671');
  assert.strictEqual(normalizePhone('00919876543210'), '+919876543210');
});

runTest('Numeric input types are accepted and normalized', () => {
  assert.strictEqual(normalizePhone(9876543210), '+919876543210');
});

runTest('Rejects ambiguous numbers (non-10 digits without international prefix)', () => {
  // 5 digits
  assert.throws(() => normalizePhone('12345'), (err) => {
    return err instanceof AppError && err.statusCode === 400 && err.message.includes('Ambiguous phone number');
  });
  // 9 digits
  assert.throws(() => normalizePhone('987654321'), (err) => {
    return err instanceof AppError && err.statusCode === 400 && err.message.includes('Ambiguous phone number');
  });
  // 11 digits not starting with 0
  assert.throws(() => normalizePhone('12345678901'), (err) => {
    return err instanceof AppError && err.statusCode === 400 && err.message.includes('Ambiguous phone number');
  });
});

runTest('Rejects phone numbers violating E.164 length (< 7 or > 15 digits)', () => {
  // +12345 (5 digits -> too short)
  assert.throws(() => normalizePhone('+12345'), (err) => {
    return err instanceof AppError && err.statusCode === 400 && err.message.includes('length must be between 7 and 15');
  });
  // 16 digits (+1234567890123456 -> too long)
  assert.throws(() => normalizePhone('+1234567890123456'), (err) => {
    return err instanceof AppError && err.statusCode === 400 && err.message.includes('length must be between 7 and 15');
  });
});

runTest('Rejects phone numbers containing unsupported characters or letters', () => {
  assert.throws(() => normalizePhone('98765CALLME'), /contains unsupported characters or letters/);
  assert.throws(() => normalizePhone('+91 98765-43210 ext 123'), /contains unsupported characters or letters/);
  assert.throws(() => normalizePhone('+91@9876543210'), /contains unsupported characters or letters/);
});

runTest('Rejects phone numbers with misplaced or multiple plus signs', () => {
  assert.throws(() => normalizePhone('91+9876543210'), /plus sign must only appear at the beginning/);
  assert.throws(() => normalizePhone('++919876543210'), /plus sign must only appear at the beginning/);
});

runTest('Rejects empty or blank phone inputs', () => {
  assert.throws(() => normalizePhone(''), /Phone number cannot be empty/);
  assert.throws(() => normalizePhone('   '), /Phone number cannot be empty/);
});

// ─── 2. Email Normalization ──────────────────────────────────────────────────

console.log('\n2. Email Normalization:');

runTest('Trims and lowercases standard emails', () => {
  assert.strictEqual(normalizeEmail('Student@Demo.OfferCheck.in'), 'student@demo.offercheck.in');
  assert.strictEqual(normalizeEmail('  HR.Recruiter@AcmeCorp.COM  '), 'hr.recruiter@acmecorp.com');
  assert.strictEqual(normalizeEmail('John.Doe+JobAlerts@Example.org'), 'john.doe+jobalerts@example.org');
});

runTest('Rejects malformed emails missing @ or domain', () => {
  assert.throws(() => normalizeEmail('invalid-email'), /Invalid email address format/);
  assert.throws(() => normalizeEmail('student@'), /Invalid email address format/);
  assert.throws(() => normalizeEmail('@domain.com'), /Invalid email address format/);
  assert.throws(() => normalizeEmail('student@domain'), /Invalid email address format/);
  assert.throws(() => normalizeEmail('student@.com'), /Invalid email address format/);
});

runTest('Rejects emails containing spaces or multiple @ signs', () => {
  assert.throws(() => normalizeEmail('student name@domain.com'), /Invalid email address format/);
  assert.throws(() => normalizeEmail('student@@domain.com'), /Invalid email address format/);
});

runTest('Rejects empty or blank email inputs', () => {
  assert.throws(() => normalizeEmail(''), /Email address cannot be empty/);
  assert.throws(() => normalizeEmail('   '), /Email address cannot be empty/);
});

// ─── 3. UPI Normalization ────────────────────────────────────────────────────

console.log('\n3. UPI (Virtual Payment Address) Normalization:');

runTest('Trims and lowercases valid UPI handles across various providers', () => {
  assert.strictEqual(normalizeUpi('Rahul.Sharma@OKAXIS'), 'rahul.sharma@okaxis');
  assert.strictEqual(normalizeUpi('paytm-hr@paytm'), 'paytm-hr@paytm');
  assert.strictEqual(normalizeUpi('company_recruiter@ibl'), 'company_recruiter@ibl');
  assert.strictEqual(normalizeUpi('  9876543210@ybl  '), '9876543210@ybl');
  assert.strictEqual(normalizeUpi('hr.jobs-2026@okhdfcbank'), 'hr.jobs-2026@okhdfcbank');
});

runTest('Rejects UPI handles missing @ or having multiple @', () => {
  assert.throws(() => normalizeUpi('invalidhandle'), /must contain exactly one "@" separator/);
  assert.throws(() => normalizeUpi('user@bank@extra'), /must contain exactly one "@" separator/);
});

runTest('Rejects UPI handles with spaces or invalid symbols', () => {
  assert.throws(() => normalizeUpi('user name@paytm'), /cannot contain spaces/);
  assert.throws(() => normalizeUpi('user#recruiter@ybl'), /Invalid UPI ID format/);
  assert.throws(() => normalizeUpi('user$pay@apl'), /Invalid UPI ID format/);
});

runTest('Rejects UPI handles starting or ending with dots/hyphens', () => {
  assert.throws(() => normalizeUpi('.username@bank'), /Invalid UPI ID format/);
  assert.throws(() => normalizeUpi('username.@bank'), /Invalid UPI ID format/);
  assert.throws(() => normalizeUpi('username@-bank'), /Invalid UPI ID format/);
});

runTest('Rejects empty or blank UPI inputs', () => {
  assert.throws(() => normalizeUpi(''), /UPI ID cannot be empty/);
  assert.throws(() => normalizeUpi('   '), /UPI ID cannot be empty/);
});

// ─── 4. Domain Normalization ─────────────────────────────────────────────────

console.log('\n4. Domain Normalization:');

runTest('Normalizes bare domains, lowercases and trims', () => {
  assert.strictEqual(normalizeDomain('techbridge.in'), 'techbridge.in');
  assert.strictEqual(normalizeDomain('  Acme-Careers.COM  '), 'acme-careers.com');
  assert.strictEqual(normalizeDomain('jobs.portal.co.uk'), 'jobs.portal.co.uk');
});

runTest('Strips http:// and https:// protocols', () => {
  assert.strictEqual(normalizeDomain('http://techbridge.in'), 'techbridge.in');
  assert.strictEqual(normalizeDomain('https://TechBridge.IN'), 'techbridge.in');
  assert.strictEqual(normalizeDomain('//techbridge.in'), 'techbridge.in');
});

runTest('Strips URL paths, query parameters and fragments', () => {
  assert.strictEqual(normalizeDomain('https://techbridge.in/careers/apply?ref=whatsapp#form'), 'techbridge.in');
  assert.strictEqual(normalizeDomain('http://example.com:8080/path'), 'example.com');
});

runTest('Strips leading www. when there is an underlying domain name', () => {
  assert.strictEqual(normalizeDomain('www.techbridge.in'), 'techbridge.in');
  assert.strictEqual(normalizeDomain('https://www.AcmeCorp.com/apply'), 'acmecorp.com');
  assert.strictEqual(normalizeDomain('www.sub.example.co.in'), 'sub.example.co.in');
});

runTest('Preserves valid subdomains', () => {
  assert.strictEqual(normalizeDomain('careers.techbridge.in'), 'careers.techbridge.in');
  assert.strictEqual(normalizeDomain('https://portal.jobs.acme.co.in/login'), 'portal.jobs.acme.co.in');
});

runTest('Normalizes internationalized domain names (IDN) via punycode', () => {
  assert.strictEqual(normalizeDomain('münchen.de'), 'xn--mnchen-3ya.de');
  assert.strictEqual(normalizeDomain('https://bücher.example/shop'), 'xn--bcher-kva.example');
});

runTest('Rejects domains containing credentials', () => {
  assert.throws(() => normalizeDomain('https://admin:secret@malicious.com'), /cannot contain credentials/);
});

runTest('Rejects IP addresses as domains', () => {
  assert.throws(() => normalizeDomain('192.168.1.1'), /IP addresses are not permitted as domain identifiers/);
  assert.throws(() => normalizeDomain('http://127.0.0.1:3000'), /IP addresses are not permitted as domain identifiers/);
  assert.throws(() => normalizeDomain('http://[::1]/careers'), /IP addresses are not permitted as domain identifiers/);
});

runTest('Rejects domains without valid TLD or without dot', () => {
  assert.throws(() => normalizeDomain('localhost'), /must include a valid top-level domain/);
  assert.throws(() => normalizeDomain('internal-host'), /must include a valid top-level domain/);
  assert.throws(() => normalizeDomain('example.123'), /Invalid domain/);
});

runTest('Rejects empty or blank domain inputs', () => {
  assert.throws(() => normalizeDomain(''), /Domain cannot be empty/);
  assert.throws(() => normalizeDomain('   '), /Domain cannot be empty/);
});

// ─── 5. Bank Account Normalization ───────────────────────────────────────────

console.log('\n5. Bank Account Normalization:');

runTest('Strips formatting separators (spaces, hyphens, slashes) and normalizes', () => {
  assert.strictEqual(normalizeBankAccount(' 1234 - 5678 - 9012 '), '123456789012');
  assert.strictEqual(normalizeBankAccount('1234/5678/9012'), '123456789012');
  assert.strictEqual(normalizeBankAccount('12345678901234'), '12345678901234');
  assert.strictEqual(normalizeBankAccount(123456789012), '123456789012');
});

runTest('Supports alphanumeric IBAN / international format in uppercase', () => {
  assert.strictEqual(normalizeBankAccount('in01 2345 6789 0123 45'), 'IN0123456789012345');
  assert.strictEqual(normalizeBankAccount('gb29xibm40051512345678'), 'GB29XIBM40051512345678');
});

runTest('Rejects bank accounts violating length boundaries (< 8 or > 34)', () => {
  // 7 chars -> too short
  assert.throws(() => normalizeBankAccount('1234567'), /length must be between 8 and 34 characters/);
  // 35 chars -> too long
  assert.throws(() => normalizeBankAccount('12345678901234567890123456789012345'), /length must be between 8 and 34 characters/);
});

runTest('Rejects bank accounts containing special characters', () => {
  assert.throws(() => normalizeBankAccount('1234@5678#9012'), /contains unsupported characters/);
  assert.throws(() => normalizeBankAccount('1234$5678'), /contains unsupported characters/);
});

runTest('Bank account error messages never leak the raw account value', () => {
  const secretAccount = '987654321#INVALID';
  try {
    normalizeBankAccount(secretAccount);
    assert.fail('Should have thrown');
  } catch (err) {
    assert.strictEqual(err.message.includes(secretAccount), false);
    assert.strictEqual(err.message, 'Invalid bank account: contains unsupported characters');
  }
});

runTest('Rejects empty or blank bank account inputs', () => {
  assert.throws(() => normalizeBankAccount(''), /Bank account cannot be empty/);
  assert.throws(() => normalizeBankAccount('   '), /Bank account cannot be empty/);
});

// ─── 6. Universal normalizeIdentifier Entrypoint ─────────────────────────────

console.log('\n6. Universal normalizeIdentifier Entrypoint:');

runTest('Dispatches correctly to type normalizers', () => {
  assert.strictEqual(normalizeIdentifier('phone', '9876543210'), '+919876543210');
  assert.strictEqual(normalizeIdentifier('PHONE', '9876543210'), '+919876543210');
  assert.strictEqual(normalizeIdentifier('email', 'Admin@Demo.in'), 'admin@demo.in');
  assert.strictEqual(normalizeIdentifier('upi', 'Paytm@Okaxis'), 'paytm@okaxis');
  assert.strictEqual(normalizeIdentifier('domain', 'https://Acme.In/'), 'acme.in');
  assert.strictEqual(normalizeIdentifier('bank_account', '1234 - 5678 - 9012'), '123456789012');
});

runTest('Rejects unsupported Prisma identifier types', () => {
  assert.throws(() => normalizeIdentifier('ssn', '123-45-6789'), /Unsupported identifier type: "ssn"/);
  assert.throws(() => normalizeIdentifier('crypto_wallet', '0x123...'), /Unsupported identifier type: "crypto_wallet"/);
});

runTest('Rejects missing, null or undefined types and values', () => {
  assert.throws(() => normalizeIdentifier('', 'val'), /Identifier type is required/);
  assert.throws(() => normalizeIdentifier(null, 'val'), /Identifier type is required/);
  assert.throws(() => normalizeIdentifier('phone', null), /cannot be null or undefined/);
  assert.throws(() => normalizeIdentifier('phone', undefined), /cannot be null or undefined/);
});

// ─── 7. createNormalizedIdentifier Display Preservation ──────────────────────

console.log('\n7. createNormalizedIdentifier Display Preservation:');

runTest('Creates an identifier object keeping raw separate from normalized', () => {
  const result = createNormalizedIdentifier('phone', ' (09876) 543-210 ');
  assert.deepStrictEqual(result, {
    type: 'phone',
    raw: '(09876) 543-210',
    normalized: '+919876543210',
  });
});

// ─── 8. extractIdentifiersFromReport Extraction & Deduplication ──────────────

console.log('\n8. extractIdentifiersFromReport Helper:');

runTest('Extracts and deduplicates identifiers from contact fields and array', () => {
  const reportData = {
    phoneRaw: '9876543210',
    emailRaw: 'HR@TechBridge.in',
    upiRaw: 'TechBridge@OKAXIS',
    domainRaw: 'https://TechBridge.in/careers',
    bankAccountRaw: '1234 5678 9012',
    // Duplicate phone with different formatting in array
    identifiers: [
      { type: 'phone', value: '+91 98765 43210' }, // duplicate of phoneRaw!
      { type: 'email', value: 'hr@techbridge.in' }, // duplicate of emailRaw!
      { type: 'upi', value: 'alternate@paytm' },     // new!
    ],
  };

  const extracted = extractIdentifiersFromReport(reportData);

  // Exactly 6 unique identifiers: phone, email, upi (techbridge), domain, bank_account, upi (alternate)
  assert.strictEqual(extracted.length, 6);

  assert.deepStrictEqual(extracted[0], { type: 'phone', raw: '9876543210', normalized: '+919876543210' });
  assert.deepStrictEqual(extracted[1], { type: 'email', raw: 'HR@TechBridge.in', normalized: 'hr@techbridge.in' });
  assert.deepStrictEqual(extracted[2], { type: 'upi', raw: 'TechBridge@OKAXIS', normalized: 'techbridge@okaxis' });
  assert.deepStrictEqual(extracted[3], { type: 'domain', raw: 'https://TechBridge.in/careers', normalized: 'techbridge.in' });
  assert.deepStrictEqual(extracted[4], { type: 'bank_account', raw: '1234 5678 9012', normalized: '123456789012' });
  assert.deepStrictEqual(extracted[5], { type: 'upi', raw: 'alternate@paytm', normalized: 'alternate@paytm' });
});

runTest('Gracefully returns empty array for reports with zero identifiers', () => {
  assert.deepStrictEqual(extractIdentifiersFromReport({}), []);
  assert.deepStrictEqual(extractIdentifiersFromReport(null), []);
  assert.deepStrictEqual(extractIdentifiersFromReport({ companyNameRaw: 'Only Company' }), []);
});

// ─── 9. Idempotency Verification ─────────────────────────────────────────────

console.log('\n9. Idempotency Across All Types:');

runTest('normalizeIdentifier is idempotent: normalize(normalize(x)) === normalize(x)', () => {
  const testCases = [
    ['phone', '  09876 543 210  '],
    ['phone', '+1 (415) 555-2671'],
    ['email', '  Student.Name@Demo.OfferCheck.In  '],
    ['upi', '  MyPayment@OKAXIS  '],
    ['domain', 'https://www.TechBridge.in/careers?ref=123'],
    ['bank_account', '  1234 - 5678 - 9012 / 34  '],
  ];

  for (const [type, raw] of testCases) {
    const once = normalizeIdentifier(type, raw);
    const twice = normalizeIdentifier(type, once);
    assert.strictEqual(twice, once, `Idempotency failed for ${type}: "${once}" vs "${twice}"`);
  }
});

console.log(`\nAll ${passedTests} / ${totalTests} Phase 5A.1 normalization tests passed successfully!\n`);
