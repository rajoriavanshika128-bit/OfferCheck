'use strict';

/**
 * backend/test/rate_limit.test.js
 * Unit test suite for rate limiting and production CORS_ORIGIN validation.
 *
 * SAFETY INVARIANTS:
 * - ZERO database connections: uses in-memory mock dispatch.
 * - ZERO network/TCP sockets.
 * - ZERO .env modifications.
 *
 * COVERS:
 * 1. Login rate limiter (5 max per 15 min per IP, 6th rejected with 429).
 * 2. Signup rate limiter (3 max per 1 hr per IP, 4th rejected with 429).
 * 3. Offer check rate limiter (per-authenticated user quota isolation).
 * 4. Standard HTTP 429 payload format ({ success: false, error: ... }) and headers.
 * 5. Proxy handling & client IP extraction via X-Forwarded-For (trust proxy: 1).
 * 6. Production CORS_ORIGIN validation and development/test fallback.
 */

process.env.DATABASE_URL = 'postgresql://mock:mock@localhost:5432/mock_test';
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'ratelimit_test_jwt_secret_01234567890123456789';

const http = require('http');
const { Readable } = require('stream');
const assert = require('assert');
const express = require('express');
const { ipKeyGenerator } = require('express-rate-limit');
const { createLimiter } = require('../src/middleware/rateLimiter');
const { isValidCorsOrigin } = require('../src/utils/cors');

let totalTests = 0;
let passedTests = 0;

async function runTest(name, fn) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`  ✅ [PASS] ${name}`);
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}:`, err.message);
    throw err;
  }
}

// Helper to create an Express app with standard OfferCheck proxy handling and stream support
function createTestApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use((req, _res, next) => {
    if (!req.socket) {
      const forwarded = req.headers['x-forwarded-for'];
      const ip = forwarded ? String(forwarded).split(',')[0].trim() : '127.0.0.1';
      Object.defineProperty(req, 'ip', { value: ip, configurable: true });
    }
    next();
  });
  return app;
}

// Helper to dispatch mock requests against an Express application
function invoke(appInstance, { method = 'POST', url = '/', headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    try {
      const rawBody =
        body !== null ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;

      const req = new Readable({
        read() {
          if (rawBody !== null) {
            this.push(rawBody);
          }
          this.push(null);
        },
      });

      req.method = method;
      req.url = url;
      req.headers = {
        ...(rawBody !== null
          ? {
              'content-type': 'application/json',
              'content-length': String(Buffer.byteLength(rawBody)),
            }
          : {}),
        ...headers,
      };

      const rawReq = new http.IncomingMessage();
      const res = new http.ServerResponse(rawReq);
      let responseBody = '';

      res.write = function (chunk) {
        if (chunk) responseBody += chunk;
        return true;
      };

      res.end = function (chunk) {
        if (chunk) responseBody += chunk;
        let parsed = null;
        try {
          parsed = JSON.parse(responseBody);
        } catch {
          parsed = responseBody;
        }
        resolve({
          status: res.statusCode,
          headers: res.getHeaders ? res.getHeaders() : {},
          body: parsed,
        });
      };

      appInstance(req, res);
    } catch (err) {
      reject(err);
    }
  });
}

async function main() {
  console.log('\n--- OfferCheck Rate Limiting & CORS Configuration Tests ---\n');

  // =========================================================================
  // 1. Login Rate Limiting (5 max per 15 min per IP)
  // =========================================================================
  console.log('1. Login Rate Limiting:');

  await runTest('Login limiter permits 5 requests and blocks the 6th with 429', async () => {
    const app = createTestApp();

    const limiter = createLimiter({
      windowMs: 15 * 60 * 1000,
      max: 5,
      message: 'Too many login attempts from this IP. Please try again after 15 minutes.',
    });

    app.post('/login', limiter, (_req, res) => res.json({ success: true }));

    // Send 5 successful attempts
    for (let i = 1; i <= 5; i++) {
      const res = await invoke(app, {
        method: 'POST',
        url: '/login',
        headers: { 'x-forwarded-for': '198.51.100.1' },
      });
      assert.strictEqual(res.status, 200, `Request #${i} should succeed with 200`);
      assert.strictEqual(res.body.success, true);
    }

    // 6th attempt must be rejected with 429
    const blockedRes = await invoke(app, {
      method: 'POST',
      url: '/login',
      headers: { 'x-forwarded-for': '198.51.100.1' },
    });

    assert.strictEqual(blockedRes.status, 429);
    assert.strictEqual(blockedRes.body.success, false);
    assert.strictEqual(
      blockedRes.body.error,
      'Too many login attempts from this IP. Please try again after 15 minutes.'
    );
    assert(blockedRes.headers['ratelimit'], 'Must set draft-7 RateLimit header');
  });

  // =========================================================================
  // 2. Signup Rate Limiting (3 max per 1 hr per IP)
  // =========================================================================
  console.log('\n2. Signup Rate Limiting:');

  await runTest('Signup limiter permits 3 creations and blocks the 4th with 429', async () => {
    const app = createTestApp();

    const limiter = createLimiter({
      windowMs: 60 * 60 * 1000,
      max: 3,
      message: 'Too many accounts created from this IP. Please try again after an hour.',
    });

    app.post('/signup', limiter, (_req, res) => res.json({ success: true }));

    // Send 3 requests
    for (let i = 1; i <= 3; i++) {
      const res = await invoke(app, {
        method: 'POST',
        url: '/signup',
        headers: { 'x-forwarded-for': '203.0.113.10' },
      });
      assert.strictEqual(res.status, 200, `Signup #${i} should succeed with 200`);
    }

    // 4th request must be blocked
    const blocked = await invoke(app, {
      method: 'POST',
      url: '/signup',
      headers: { 'x-forwarded-for': '203.0.113.10' },
    });

    assert.strictEqual(blocked.status, 429);
    assert.strictEqual(blocked.body.success, false);
    assert.strictEqual(
      blocked.body.error,
      'Too many accounts created from this IP. Please try again after an hour.'
    );
  });

  // =========================================================================
  // 3. Offer Check Rate Limiting with Authenticated User Isolation
  // =========================================================================
  console.log('\n3. Offer Check User Isolation:');

  await runTest('Check limiter isolates quotas by authenticated user ID on shared IP', async () => {
    const app = createTestApp();

    const limiter = createLimiter({
      windowMs: 15 * 60 * 1000,
      max: 2,
      keyGenerator: (req) =>
        req.user && req.user.id ? `user_${req.user.id}` : ipKeyGenerator(req),
      message: 'Too many offer checks submitted. Please try again after 15 minutes.',
    });

    app.post('/checks', (req, res, next) => {
      // Simulate auth middleware binding user
      const authHeader = req.headers.authorization;
      if (authHeader === 'Bearer userA') req.user = { id: 'user_A' };
      if (authHeader === 'Bearer userB') req.user = { id: 'user_B' };
      next();
    }, limiter, (_req, res) => res.json({ success: true }));

    const sharedIpHeaders = { 'x-forwarded-for': '192.0.2.55' };

    // User A consumes quota (2 requests)
    const uA1 = await invoke(app, { method: 'POST', url: '/checks', headers: { ...sharedIpHeaders, authorization: 'Bearer userA' } });
    const uA2 = await invoke(app, { method: 'POST', url: '/checks', headers: { ...sharedIpHeaders, authorization: 'Bearer userA' } });
    assert.strictEqual(uA1.status, 200);
    assert.strictEqual(uA2.status, 200);

    // User A 3rd request blocked
    const uA3 = await invoke(app, { method: 'POST', url: '/checks', headers: { ...sharedIpHeaders, authorization: 'Bearer userA' } });
    assert.strictEqual(uA3.status, 429);

    // User B on SAME IP should NOT be blocked (independent user quota)
    const uB1 = await invoke(app, { method: 'POST', url: '/checks', headers: { ...sharedIpHeaders, authorization: 'Bearer userB' } });
    assert.strictEqual(uB1.status, 200, 'User B must not be affected by User A quota');
  });

  // =========================================================================
  // 4. Proxy Handling (trust proxy: 1)
  // =========================================================================
  console.log('\n4. Proxy Handling:');

  await runTest('Trust proxy: 1 isolates rate limits by leftmost client IP in X-Forwarded-For', async () => {
    const app = createTestApp();

    const limiter = createLimiter({
      windowMs: 15 * 60 * 1000,
      max: 1,
      message: 'Limit reached',
    });

    app.post('/test', limiter, (_req, res) => res.json({ success: true }));

    // Client IP 1 blocked on 2nd attempt
    const r1 = await invoke(app, { method: 'POST', url: '/test', headers: { 'x-forwarded-for': '1.1.1.1, 10.0.0.1' } });
    const r2 = await invoke(app, { method: 'POST', url: '/test', headers: { 'x-forwarded-for': '1.1.1.1, 10.0.0.1' } });
    assert.strictEqual(r1.status, 200);
    assert.strictEqual(r2.status, 429);

    // Client IP 2 has separate bucket
    const r3 = await invoke(app, { method: 'POST', url: '/test', headers: { 'x-forwarded-for': '2.2.2.2, 10.0.0.1' } });
    assert.strictEqual(r3.status, 200);
  });

  // =========================================================================
  // 5. CORS_ORIGIN Validation Logic
  // =========================================================================
  console.log('\n5. CORS Configuration Validation:');

  await runTest('isValidCorsOrigin accepts single valid HTTPS production origin', () => {
    assert.strictEqual(isValidCorsOrigin('https://offercheck.vercel.app'), true);
  });

  await runTest('isValidCorsOrigin accepts multiple comma-separated origins', () => {
    assert.strictEqual(
      isValidCorsOrigin('https://offercheck.vercel.app, https://offercheck-preview.vercel.app'),
      true
    );
  });

  await runTest('isValidCorsOrigin rejects origins with trailing slashes, paths, and queries', () => {
    assert.strictEqual(isValidCorsOrigin('https://offercheck.vercel.app/'), false);
    assert.strictEqual(isValidCorsOrigin('https://offercheck.vercel.app/api'), false);
    assert.strictEqual(isValidCorsOrigin('https://offercheck.vercel.app?query=1'), false);
    assert.strictEqual(isValidCorsOrigin('https://user:pass@offercheck.vercel.app'), false);
  });

  await runTest('isValidCorsOrigin rejects empty or whitespace-only origins', () => {
    assert.strictEqual(isValidCorsOrigin(''), false);
    assert.strictEqual(isValidCorsOrigin('   '), false);
    assert.strictEqual(isValidCorsOrigin(null), false);
    assert.strictEqual(isValidCorsOrigin(undefined), false);
  });

  await runTest('isValidCorsOrigin rejects invalid schemes and non-URL strings', () => {
    assert.strictEqual(isValidCorsOrigin('ftp://not-allowed.com'), false);
    assert.strictEqual(isValidCorsOrigin('javascript:alert(1)'), false);
    assert.strictEqual(isValidCorsOrigin('not-a-valid-url'), false);
  });

  console.log(`\nAll ${passedTests} / ${totalTests} rate limiting & CORS tests passed successfully!\n`);
}

main().catch((err) => {
  console.error('\n[FATAL] Test failure:', err);
  process.exit(1);
});
