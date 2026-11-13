'use strict';

/**
 * backend/test/helpers/testDbGuard.test.js
 * Isolated unit tests for the test database safety guard.
 * Zero database connection, zero network, zero .env access.
 */

const assert = require('assert');
const {
  validateTestDatabaseUrl,
  APPROVED_PROTOCOLS,
  APPROVED_HOSTS,
  REQUIRED_DB_NAME,
} = require('./testDbGuard');

let total = 0;
let passed = 0;

function runTest(name, fn) {
  total++;
  try {
    fn();
    passed++;
    console.log(`  ✅ [PASS] ${name}`);
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}:`, err.message);
    throw err;
  }
}

console.log('\n--- Test Database Guard Validation (Memory Only) ---\n');

runTest('Rejects missing or null database URL', () => {
  assert.throws(
    () => validateTestDatabaseUrl(null),
    /No test database URL supplied/
  );
  assert.throws(
    () => validateTestDatabaseUrl(''),
    /No test database URL supplied/
  );
  assert.throws(
    () => validateTestDatabaseUrl(undefined),
    /No test database URL supplied/
  );
});

runTest('Rejects malformed URL strings', () => {
  assert.throws(
    () => validateTestDatabaseUrl('not_a_valid_url'),
    /Malformed database URL provided/
  );
});

runTest('Rejects unapproved database protocols (non-PostgreSQL)', () => {
  assert.throws(
    () => validateTestDatabaseUrl('mysql://localhost:3306/offercheck_test'),
    /Unapproved database protocol: 'mysql:'/
  );
  assert.throws(
    () => validateTestDatabaseUrl('sqlite:///offercheck_test'),
    /Unapproved database protocol: 'sqlite:'/
  );
  assert.throws(
    () => validateTestDatabaseUrl('http://localhost:5432/offercheck_test'),
    /Unapproved database protocol: 'http:'/
  );
});

runTest('Rejects remote or unapproved database hosts', () => {
  assert.throws(
    () => validateTestDatabaseUrl('postgresql://user:pass@db.supabase.co:5432/offercheck_test'),
    /Unapproved host/
  );
  assert.throws(
    () => validateTestDatabaseUrl('postgresql://user:pass@192.168.1.50:5432/offercheck_test'),
    /Unapproved host/
  );
  assert.throws(
    () => validateTestDatabaseUrl('postgresql://user:pass@aws-rds.amazonaws.com:5432/offercheck_test'),
    /Unapproved host/
  );
  assert.throws(
    () => validateTestDatabaseUrl('postgresql://[2001:db8::1]:5432/offercheck_test'),
    /Unapproved host/
  );
});

runTest('CRITICAL: Strictly rejects development database (offercheck_dev)', () => {
  assert.throws(
    () => validateTestDatabaseUrl('postgresql://localhost:5432/offercheck_dev'),
    /Unsafe database target: 'offercheck_dev'/
  );
  assert.throws(
    () => validateTestDatabaseUrl('postgresql://127.0.0.1:5432/offercheck_dev?schema=public'),
    /Unsafe database target: 'offercheck_dev'/
  );
});

runTest('CRITICAL: Strictly rejects production or staging databases', () => {
  assert.throws(
    () => validateTestDatabaseUrl('postgresql://localhost:5432/production'),
    /Unsafe database target: 'production'/
  );
  assert.throws(
    () => validateTestDatabaseUrl('postgresql://localhost:5432/staging_db'),
    /Unsafe database target: 'staging_db'/
  );
});

runTest('Accepts valid local offercheck_test URL on localhost with postgresql: protocol', () => {
  const result = validateTestDatabaseUrl('postgresql://localhost:5432/offercheck_test');
  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.dbName, REQUIRED_DB_NAME);
  assert.strictEqual(result.host, 'localhost');
  assert.strictEqual(result.protocol, 'postgresql:');
});

runTest('Accepts valid local offercheck_test URL with postgres: alias protocol', () => {
  const result = validateTestDatabaseUrl('postgres://localhost:5432/offercheck_test');
  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.dbName, REQUIRED_DB_NAME);
  assert.strictEqual(result.host, 'localhost');
  assert.strictEqual(result.protocol, 'postgres:');
});

runTest('Accepts valid local offercheck_test URL on 127.0.0.1 with query parameters', () => {
  const result = validateTestDatabaseUrl('postgresql://127.0.0.1:5432/offercheck_test?schema=public&sslmode=disable');
  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.dbName, REQUIRED_DB_NAME);
  assert.strictEqual(result.host, '127.0.0.1');
});

runTest('Accepts valid local offercheck_test URL on IPv6 localhost ([::1])', () => {
  const result = validateTestDatabaseUrl('postgresql://[::1]:5432/offercheck_test');
  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.dbName, REQUIRED_DB_NAME);
  assert.strictEqual(result.host, '::1');
});

console.log(`\nAll ${passed} / ${total} Test Database Guard validation tests passed!\n`);
