'use strict';

/**
 * backend/test/cors.test.js
 * Focused unit test suite for shared CORS origin validation and resolution.
 * Imports the actual shared helpers from backend/src/utils/cors.js.
 *
 * SAFETY INVARIANTS:
 * - ZERO database connections.
 * - ZERO network/TCP sockets.
 * - ZERO .env modifications.
 */

const assert = require('assert');
const {
  isSingleCanonicalOrigin,
  isValidCorsOrigin,
  resolveCorsOrigin,
} = require('../src/utils/cors');

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

console.log('\n--- Shared CORS Origin Validation & Resolution Tests ---\n');

// ─── 1. Canonical Origin Validation (isSingleCanonicalOrigin) ────────────────
console.log('1. Canonical Single Origin Validation:');

runTest('Accepts valid HTTPS production origin (no path, no trailing slash)', () => {
  assert.strictEqual(isSingleCanonicalOrigin('https://offercheck.vercel.app'), true);
});

runTest('Accepts valid HTTP localhost with port (development fallback)', () => {
  assert.strictEqual(isSingleCanonicalOrigin('http://localhost:5173'), true);
  assert.strictEqual(isSingleCanonicalOrigin('http://127.0.0.1:3000'), true);
});

runTest('Accepts valid HTTPS origin with custom port', () => {
  assert.strictEqual(isSingleCanonicalOrigin('https://preview.offercheck.dev:8443'), true);
});

runTest('Rejects origin with trailing slash', () => {
  assert.strictEqual(isSingleCanonicalOrigin('https://offercheck.vercel.app/'), false);
});

runTest('Rejects origin with path', () => {
  assert.strictEqual(isSingleCanonicalOrigin('https://offercheck.vercel.app/api'), false);
  assert.strictEqual(isSingleCanonicalOrigin('https://offercheck.vercel.app/dashboard'), false);
});

runTest('Rejects origin with query string', () => {
  assert.strictEqual(isSingleCanonicalOrigin('https://offercheck.vercel.app?redirect=true'), false);
});

runTest('Rejects origin with fragment / hash', () => {
  assert.strictEqual(isSingleCanonicalOrigin('https://offercheck.vercel.app#section'), false);
});

runTest('Rejects origin with embedded user credentials', () => {
  assert.strictEqual(isSingleCanonicalOrigin('https://user:pass@offercheck.vercel.app'), false);
});

runTest('Rejects disallowed schemes (ftp, ws, javascript, file)', () => {
  assert.strictEqual(isSingleCanonicalOrigin('ftp://offercheck.vercel.app'), false);
  assert.strictEqual(isSingleCanonicalOrigin('ws://offercheck.vercel.app'), false);
  assert.strictEqual(isSingleCanonicalOrigin('javascript:alert(1)'), false);
  assert.strictEqual(isSingleCanonicalOrigin('file:///path/to/file'), false);
});

runTest('Rejects malformed strings, empty strings, and non-strings', () => {
  assert.strictEqual(isSingleCanonicalOrigin(''), false);
  assert.strictEqual(isSingleCanonicalOrigin('   '), false);
  assert.strictEqual(isSingleCanonicalOrigin('not-a-valid-url'), false);
  assert.strictEqual(isSingleCanonicalOrigin(null), false);
  assert.strictEqual(isSingleCanonicalOrigin(undefined), false);
  assert.strictEqual(isSingleCanonicalOrigin(123), false);
});

// ─── 2. Multi-Origin Validation (isValidCorsOrigin) ──────────────────────────
console.log('\n2. Multi-Origin List Validation:');

runTest('Accepts single canonical origin in list format', () => {
  assert.strictEqual(isValidCorsOrigin('https://offercheck.vercel.app'), true);
});

runTest('Accepts multiple comma-separated canonical origins with varying whitespace', () => {
  assert.strictEqual(
    isValidCorsOrigin('https://offercheck.vercel.app, https://offercheck-preview.vercel.app'),
    true
  );
  assert.strictEqual(
    isValidCorsOrigin('https://offercheck.vercel.app,http://localhost:5173,https://staging.offercheck.com'),
    true
  );
});

runTest('Rejects multi-origin list if any single origin is invalid (e.g. trailing slash)', () => {
  assert.strictEqual(
    isValidCorsOrigin('https://offercheck.vercel.app, https://offercheck-preview.vercel.app/'),
    false
  );
});

runTest('Rejects multi-origin list if any single origin contains a path', () => {
  assert.strictEqual(
    isValidCorsOrigin('https://offercheck.vercel.app, https://offercheck-preview.vercel.app/sub'),
    false
  );
});

runTest('Rejects multi-origin list with trailing or leading empty commas', () => {
  assert.strictEqual(isValidCorsOrigin('https://offercheck.vercel.app,'), false);
  assert.strictEqual(isValidCorsOrigin(',https://offercheck.vercel.app'), false);
  assert.strictEqual(isValidCorsOrigin('https://offercheck.vercel.app,,https://b.com'), false);
});

runTest('Rejects empty or whitespace-only origin list', () => {
  assert.strictEqual(isValidCorsOrigin(''), false);
  assert.strictEqual(isValidCorsOrigin('   '), false);
  assert.strictEqual(isValidCorsOrigin(null), false);
  assert.strictEqual(isValidCorsOrigin(undefined), false);
});

// ─── 3. Runtime Origin Resolution (resolveCorsOrigin) ────────────────────────
console.log('\n3. Runtime Origin Resolution:');

runTest('In production: returns single string for single valid origin', () => {
  const result = resolveCorsOrigin('https://offercheck.vercel.app', 'production');
  assert.strictEqual(result, 'https://offercheck.vercel.app');
});

runTest('In production: returns array of strings for multiple comma-separated origins', () => {
  const result = resolveCorsOrigin(
    'https://offercheck.vercel.app, https://offercheck-preview.vercel.app',
    'production'
  );
  assert.deepStrictEqual(result, [
    'https://offercheck.vercel.app',
    'https://offercheck-preview.vercel.app',
  ]);
});

runTest('In production: throws if CORS_ORIGIN is missing or empty', () => {
  assert.throws(
    () => resolveCorsOrigin('', 'production'),
    /CORS_ORIGIN environment variable is required in production/
  );
  assert.throws(
    () => resolveCorsOrigin(null, 'production'),
    /CORS_ORIGIN environment variable is required in production/
  );
});

runTest('In production: throws if CORS_ORIGIN contains trailing slash or path', () => {
  assert.throws(
    () => resolveCorsOrigin('https://offercheck.vercel.app/', 'production'),
    /CORS_ORIGIN environment variable is invalid/
  );
  assert.throws(
    () => resolveCorsOrigin('https://offercheck.vercel.app/api', 'production'),
    /CORS_ORIGIN environment variable is invalid/
  );
});

runTest('In development / test: falls back to http://localhost:5173 when unset', () => {
  assert.strictEqual(resolveCorsOrigin('', 'development'), 'http://localhost:5173');
  assert.strictEqual(resolveCorsOrigin(null, 'development'), 'http://localhost:5173');
  assert.strictEqual(resolveCorsOrigin(undefined, 'test'), 'http://localhost:5173');
});

runTest('In development: respects valid custom CORS_ORIGIN if provided', () => {
  assert.strictEqual(
    resolveCorsOrigin('http://localhost:3000', 'development'),
    'http://localhost:3000'
  );
});

runTest('In development: throws if custom CORS_ORIGIN is provided but malformed', () => {
  assert.throws(
    () => resolveCorsOrigin('not-a-valid-origin', 'development'),
    /CORS_ORIGIN environment variable is invalid/
  );
});

console.log(`\nAll ${passedTests} / ${totalTests} CORS origin validation and resolution tests passed successfully!\n`);
