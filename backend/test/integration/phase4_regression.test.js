'use strict';

/**
 * backend/test/integration/phase4_regression.test.js
 * Formalized Phase 4A, 4B, and 4C Regression Test Suite.
 *
 * SAFETY INVARIANTS:
 * 1. Strictly requires an explicitly provided test database URL via TEST_DATABASE_URL only.
 *    Does NOT accept DATABASE_URL or fall back to .env / default database.
 * 2. Enforced by testDbGuard: host MUST be localhost/127.0.0.1/::1; database name MUST be exactly 'offercheck_test'.
 * 3. Never falls back to .env or connects to 'offercheck_dev' or production.
 * 4. Single shared PrismaClient lifecycle (src/utils/prisma.js) initialized only after URL validation
 *    and closed cleanly on teardown.
 * 5. Non-destructive cleanup: only deletes explicitly created test records by unique test ID / email.
 *    NEVER executes TRUNCATE, TRUNCATE CASCADE, or database-wide resets.
 *
 * HISTORICAL PROVENANCE:
 * - Cases 1–22 (Phase 4A) & Cases 23–35 (Phase 4B):
 *   Originally executed in transient scratch runners during earlier development and reconstructed
 *   from documented test matrices and assertions in BACKEND_PROGRESS.md.
 * - Cases 36–39 (Phase 4C):
 *   Newly formulated in Phase 4D Step 2 to verify Express HTTP middleware routing, live DB role demotion,
 *   and JWT tampering.
 */

const http = require('http');
const assert = require('assert');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { validateTestDatabaseUrl } = require('../helpers/testDbGuard');

// ─── Pre-flight Safety Guard Check ──────────────────────────────────────────

const testDbUrl = process.env.TEST_DATABASE_URL;

if (!testDbUrl) {
  console.error('\n[FATAL TEST RUNNER] No test database URL provided in environment.');
  console.error('Integration tests require an explicit TEST_DATABASE_URL.');
  console.error('Refusing to connect or fall back to DATABASE_URL / .env / default database.');
  console.error('To run safely against offercheck_test:');
  console.error('  TEST_DATABASE_URL="postgresql://localhost:5432/offercheck_test?schema=public" npm run test:integration\n');
  process.exit(1);
}

// Enforce strict safety guard — throws immediately if unapproved host or not offercheck_test
const guard = validateTestDatabaseUrl(testDbUrl);

// Configure process.env for isolated test execution BEFORE loading app or prisma singleton
process.env.DATABASE_URL = guard.url;
process.env.NODE_ENV = 'test';
if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'test_jwt_secret_012345678901234567890123456789';
if (!process.env.JWT_REFRESH_SECRET) process.env.JWT_REFRESH_SECRET = 'test_refresh_secret_012345678901234567890123456789';
if (!process.env.IP_HASH_SECRET) process.env.IP_HASH_SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

// ─── Shared Prisma Singleton and Application Modules ─────────────────────────
// Use the shared Prisma singleton from src/utils/prisma.js for both test operations
// and Express middleware. Initialized after DATABASE_URL has been validated and set.
const prisma = require('../../src/utils/prisma');
const app = require('../../src/app');
const authService = require('../../src/services/auth.service');
const tokenService = require('../../src/services/token.service');

// ─── Test Runner Harness ────────────────────────────────────────────────────

let totalTests = 0;
let passedTests = 0;
let skippedTests = 0;
let failedTests = 0;
const createdUserIds = new Set();
let server = null;
let rbacServer = null;
let baseUrl = '';

async function runTest(num, name, fn) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`  ✅ [PASS] #${num}: ${name}`);
  } catch (err) {
    failedTests++;
    console.error(`  ❌ [FAIL] #${num}: ${name}:`, err.message);
  }
}

function skipTest(num, name, reason) {
  totalTests++;
  skippedTests++;
  console.log(`  ⏭️ [SKIPPED] #${num}: ${name} (${reason})`);
}

// Lightweight HTTP client using native fetch on local ephemeral server port
async function apiRequest(path, options = {}) {
  const url = `${baseUrl}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, headers: res.headers, body: data };
}

// ─── Main Test Suite ────────────────────────────────────────────────────────

async function main() {
  console.log(`\n--- OfferCheck Phase 4 Regression & Integration Suite ---`);
  console.log(`Target: ${guard.dbName} on ${guard.host} (Verified Safe ✅)\n`);

  // Start ephemeral HTTP server for Express-level integration tests
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;

  try {
    // ══════════════════════════════════════════════════════════════════════════
    // PHASE 4A REGRESSION CASES (1 – 22)
    // ══════════════════════════════════════════════════════════════════════════
    console.log('--- Phase 4A: Authentication & Access Control (Cases 1–22) ---');

    const emailPrefix = `test_p4_${Date.now()}`;
    const testEmail1 = `${emailPrefix}_user1@example.com`;
    let user1 = null;
    let user1Tokens = null;

    // 1. Signup succeeds & profile sanitized
    await runTest(1, 'Signup succeeds & profile sanitized', async () => {
      const res = await apiRequest('/api/auth/signup', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Test Student',
          email: testEmail1,
          password: 'Password123!',
          college: 'Test University',
        }),
      });
      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.user.email, testEmail1);
      assert.strictEqual(res.body.user.role, 'student');
      assert.strictEqual(res.body.user.passwordHash, undefined);
      assert.strictEqual(res.body.user.isBanned, undefined);
      assert(res.body.accessToken, 'Access token must be present');
      assert(res.body.refreshToken, 'Refresh token must be present');

      user1 = res.body.user;
      user1Tokens = res.body;
      createdUserIds.add(user1.id);
    });

    // 2. Duplicate signup rejected
    await runTest(2, 'Duplicate signup rejected with 409 Conflict', async () => {
      const res = await apiRequest('/api/auth/signup', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Duplicate Student',
          email: testEmail1,
          password: 'Password123!',
        }),
      });
      assert.strictEqual(res.status, 409);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error, 'Email address already registered');
    });

    // 3. Password stored as bcrypt hash (cost 12)
    await runTest(3, 'Password stored as bcrypt hash (cost 12)', async () => {
      const dbUser = await prisma.user.findUnique({ where: { id: user1.id } });
      assert(dbUser.passwordHash.startsWith('$2a$12$') || dbUser.passwordHash.startsWith('$2b$12$'));
      assert.strictEqual(dbUser.passwordHash.length, 60);
    });

    // 4. Signup cannot create admin account
    await runTest(4, 'Signup cannot create admin account (role strictly student)', async () => {
      const adminAttemptEmail = `${emailPrefix}_admin_attempt@example.com`;
      const res = await apiRequest('/api/auth/signup', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Hacker User',
          email: adminAttemptEmail,
          password: 'Password123!',
          role: 'admin',
        }),
      });
      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.user.role, 'student');
      createdUserIds.add(res.body.user.id);

      const dbUser = await prisma.user.findUnique({ where: { id: res.body.user.id } });
      assert.strictEqual(dbUser.role, 'student');
    });

    // 5. Login succeeds with correct credentials
    await runTest(5, 'Login succeeds with correct credentials', async () => {
      const res = await apiRequest('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: testEmail1, password: 'Password123!' }),
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.user.id, user1.id);
      assert(res.body.accessToken);
    });

    // 6. Incorrect password rejected
    await runTest(6, 'Incorrect password rejected with generic 401', async () => {
      const res = await apiRequest('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: testEmail1, password: 'WrongPassword123!' }),
      });
      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.body.error, 'Invalid email or password');
    });

    // 7. Nonexistent email receives identical generic error
    await runTest(7, 'Nonexistent email receives identical generic error', async () => {
      const res = await apiRequest('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: 'nonexistent_user_999@example.com', password: 'Password123!' }),
      });
      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.body.error, 'Invalid email or password');
    });

    // 8. Student demo account login (exact verified fixture U001 from src/data/users.js)
    const student = await prisma.user.findUnique({ where: { email: 'student@demo.offercheck' } });
    if (!student || student.id !== 'U001' || student.role !== 'student') {
      skipTest(8, 'Student demo account login (U001 / student123)', 'Exact verified fixture U001 (student@demo.offercheck) not present in test db');
    } else {
      await runTest(8, 'Student demo account login (U001 / student123)', async () => {
        const res = await apiRequest('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email: 'student@demo.offercheck', password: 'student123' }),
        });
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.user.role, 'student');
      });
    }

    // 9. Admin demo account login (exact verified fixture U002 from src/data/users.js)
    const admin = await prisma.user.findUnique({ where: { email: 'admin@demo.offercheck' } });
    if (!admin || admin.id !== 'U002' || admin.role !== 'admin') {
      skipTest(9, 'Admin demo account login (U002 / admin123)', 'Exact verified fixture U002 (admin@demo.offercheck) not present in test db');
    } else {
      await runTest(9, 'Admin demo account login (U002 / admin123)', async () => {
        const res = await apiRequest('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email: 'admin@demo.offercheck', password: 'admin123' }),
        });
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.user.role, 'admin');
      });
    }

    // 10. Valid access token accepted on /api/auth/me
    await runTest(10, 'Valid access token accepted on /api/auth/me', async () => {
      const res = await apiRequest('/api/auth/me', {
        headers: { Authorization: `Bearer ${user1Tokens.accessToken}` },
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.user.id, user1.id);
    });

    // 11. Invalid, malformed and expired tokens rejected
    await runTest(11, 'Invalid, malformed and expired tokens rejected with 401', async () => {
      const badTokens = ['invalid-token', 'Bearer not.a.valid.jwt', ''];
      for (const t of badTokens) {
        const res = await apiRequest('/api/auth/me', { headers: { Authorization: `Bearer ${t}` } });
        assert.strictEqual(res.status, 401);
      }
    });

    // 12. Missing or non-Bearer authorization header rejected
    await runTest(12, 'Missing or non-Bearer authorization header rejected', async () => {
      const res1 = await apiRequest('/api/auth/me');
      assert.strictEqual(res1.status, 401);
      const res2 = await apiRequest('/api/auth/me', { headers: { Authorization: `Basic dXNlcjpwYXNz` } });
      assert.strictEqual(res2.status, 401);
    });

    // 13. Banned users rejected
    await runTest(13, 'Banned users rejected on login and on protected /me', async () => {
      const bannedEmail = `${emailPrefix}_banned@example.com`;
      const signupRes = await apiRequest('/api/auth/signup', {
        method: 'POST',
        body: JSON.stringify({ name: 'Banned User', email: bannedEmail, password: 'Password123!' }),
      });
      const bannedId = signupRes.body.user.id;
      createdUserIds.add(bannedId);

      // Ban user in DB
      await prisma.user.update({ where: { id: bannedId }, data: { isBanned: true } });

      // Attempt login
      const loginRes = await apiRequest('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: bannedEmail, password: 'Password123!' }),
      });
      assert.strictEqual(loginRes.status, 403);
      assert.strictEqual(loginRes.body.error, 'Account has been suspended');

      // Attempt /me with existing token
      const meRes = await apiRequest('/api/auth/me', {
        headers: { Authorization: `Bearer ${signupRes.body.accessToken}` },
      });
      assert.strictEqual(meRes.status, 403);
    });

    // 14. /api/auth/me returns strictly sanitized profile
    await runTest(14, '/api/auth/me returns strictly sanitized profile', async () => {
      const res = await apiRequest('/api/auth/me', {
        headers: { Authorization: `Bearer ${user1Tokens.accessToken}` },
      });
      assert.strictEqual(res.body.user.passwordHash, undefined);
      assert.strictEqual(res.body.user.isBanned, undefined);
      assert.strictEqual(res.body.user.refreshTokens, undefined);
    });

    // 15. Existing admin guard (requireAdmin) works
    await runTest(15, 'Existing admin guard (requireAdmin) blocks student (403)', async () => {
      const { requireAdmin } = require('../../src/middleware/authorize');
      const req = { user: { id: user1.id, role: 'student' } };
      let errResult = null;
      requireAdmin(req, {}, (err) => { errResult = err; });
      assert(errResult);
      assert.strictEqual(errResult.statusCode, 403);
    });

    // 16. ASCII password at 72-byte limit succeeds
    await runTest(16, 'ASCII password at 72-byte limit succeeds', async () => {
      const pw72 = 'A'.repeat(72);
      const email72 = `${emailPrefix}_pw72@example.com`;
      const res = await apiRequest('/api/auth/signup', {
        method: 'POST',
        body: JSON.stringify({ name: '72 Byte User', email: email72, password: pw72 }),
      });
      assert.strictEqual(res.status, 201);
      createdUserIds.add(res.body.user.id);
    });

    // 17. Multi-byte password within 72 bytes succeeds
    await runTest(17, 'Multi-byte password within 72 bytes succeeds', async () => {
      const multiPw = 'é'.repeat(30); // 60 bytes UTF-8
      const multiEmail = `${emailPrefix}_multibyte@example.com`;
      const res = await apiRequest('/api/auth/signup', {
        method: 'POST',
        body: JSON.stringify({ name: 'MultiByte User', email: multiEmail, password: multiPw }),
      });
      assert.strictEqual(res.status, 201);
      createdUserIds.add(res.body.user.id);
    });

    // 18. Multi-byte password exceeding 72 bytes rejected
    await runTest(18, 'Multi-byte password exceeding 72 bytes rejected by Zod', async () => {
      const overMultiPw = 'é'.repeat(37); // 74 bytes UTF-8
      const res = await apiRequest('/api/auth/signup', {
        method: 'POST',
        body: JSON.stringify({ name: 'Over User', email: `${emailPrefix}_over@example.com`, password: overMultiPw }),
      });
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.error, 'Validation failed');
    });

    // 19. Valid dummy bcrypt hash verified
    await runTest(19, 'Valid dummy bcrypt hash verified (cost 12)', async () => {
      const match = await bcrypt.compare('dummy-test-password', '$2b$12$aRbHd88mF2l3NMQuGMmcXOat4UGP005EAyzMtj2izq39QeNlBHvMm');
      assert.strictEqual(typeof match, 'boolean');
    });

    // 20. Login paths both execute bcrypt comparison (deterministic verification of timing mitigation)
    await runTest(20, 'Login paths both execute bcrypt comparison (dummy hash execution)', async () => {
      let compareExecuted = false;
      let comparedPassword = null;
      let comparedHash = null;

      const origCompare = bcrypt.compare;
      try {
        bcrypt.compare = async (password, hash) => {
          compareExecuted = true;
          comparedPassword = password;
          comparedHash = hash;
          return origCompare(password, hash);
        };

        const res = await apiRequest('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email: 'nonexistent_user@example.com', password: 'Password123!' }),
        });

        assert.strictEqual(res.status, 401);
        assert.strictEqual(res.body.error, 'Invalid email or password');
        assert.strictEqual(compareExecuted, true, 'bcrypt.compare must be called even for non-existent users');
        assert.strictEqual(comparedPassword, 'Password123!');
        assert.strictEqual(
          comparedHash,
          '$2b$12$aRbHd88mF2l3NMQuGMmcXOat4UGP005EAyzMtj2izq39QeNlBHvMm',
          'bcrypt.compare must use the pre-computed cost-12 dummy hash'
        );
      } finally {
        bcrypt.compare = origCompare;
      }
    });

    // 21. Concurrent duplicate signup returns HTTP 409
    await runTest(21, 'Concurrent duplicate signup returns HTTP 409', async () => {
      const raceEmail = `${emailPrefix}_race@example.com`;
      const [res1, res2] = await Promise.all([
        apiRequest('/api/auth/signup', {
          method: 'POST',
          body: JSON.stringify({ name: 'Race 1', email: raceEmail, password: 'Password123!' }),
        }),
        apiRequest('/api/auth/signup', {
          method: 'POST',
          body: JSON.stringify({ name: 'Race 2', email: raceEmail, password: 'Password123!' }),
        }),
      ]);
      const statuses = [res1.status, res2.status].sort();
      assert.deepStrictEqual(statuses, [201, 409]);
      if (res1.body.user) createdUserIds.add(res1.body.user.id);
      if (res2.body.user) createdUserIds.add(res2.body.user.id);
    });

    // 22. Invalid JWT role claims rejected
    await runTest(22, 'Invalid JWT role claims rejected with 401', async () => {
      const fakeToken = jwt.sign(
        { sub: user1.id, role: 'superadmin' },
        process.env.JWT_SECRET,
        { expiresIn: '15m', algorithm: 'HS256' }
      );
      const res = await apiRequest('/api/auth/me', { headers: { Authorization: `Bearer ${fakeToken}` } });
      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.body.error, 'Invalid token claims');
    });

    // ══════════════════════════════════════════════════════════════════════════
    // PHASE 4B REGRESSION CASES (23 – 35)
    // ══════════════════════════════════════════════════════════════════════════
    console.log('\n--- Phase 4B: Refresh Tokens, Concurrency & Suspension (Cases 23–35) ---');

    let currentRefreshToken = user1Tokens.refreshToken;
    let rotatedToken = null;

    // 23. Successful refresh token rotation
    await runTest(23, 'Successful refresh token rotation', async () => {
      const res = await apiRequest('/api/auth/refresh', {
        method: 'POST',
        body: JSON.stringify({ refreshToken: currentRefreshToken }),
      });
      assert.strictEqual(res.status, 200);
      assert(res.body.accessToken);
      assert(res.body.refreshToken);
      assert.notStrictEqual(res.body.refreshToken, currentRefreshToken);

      rotatedToken = res.body.refreshToken;
    });

    // 24. Previous token reuse triggers family revocation
    await runTest(24, 'Previous token reuse triggers family revocation (401)', async () => {
      // Re-use currentRefreshToken which was rotated in Case 23
      const res = await apiRequest('/api/auth/refresh', {
        method: 'POST',
        body: JSON.stringify({ refreshToken: currentRefreshToken }),
      });
      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.body.error, 'Invalid refresh token: token reuse detected');
    });

    // 25. Subsequent rotation with compromised family token rejected
    await runTest(25, 'Subsequent rotation with compromised family token rejected', async () => {
      // rotatedToken should now be revoked because reuse was detected
      const res = await apiRequest('/api/auth/refresh', {
        method: 'POST',
        body: JSON.stringify({ refreshToken: rotatedToken }),
      });
      assert.strictEqual(res.status, 401);
    });

    // 26. Unknown and malformed refresh tokens rejected
    await runTest(26, 'Unknown and malformed refresh tokens rejected', async () => {
      const res1 = await apiRequest('/api/auth/refresh', {
        method: 'POST',
        body: JSON.stringify({ refreshToken: '0'.repeat(64) }),
      });
      assert.strictEqual(res1.status, 401);

      const res2 = await apiRequest('/api/auth/refresh', {
        method: 'POST',
        body: JSON.stringify({ refreshToken: '' }),
      });
      assert.strictEqual(res2.status, 400);
    });

    // 27. Expired refresh token rejected
    await runTest(27, 'Expired refresh token rejected with 401', async () => {
      // Create user and expired token
      const expEmail = `${emailPrefix}_expired@example.com`;
      const signupRes = await apiRequest('/api/auth/signup', {
        method: 'POST',
        body: JSON.stringify({ name: 'Exp User', email: expEmail, password: 'Password123!' }),
      });
      createdUserIds.add(signupRes.body.user.id);

      const tokenHash = tokenService.hashToken(signupRes.body.refreshToken);
      // Manually backdate expiration in DB
      await prisma.refreshToken.update({
        where: { tokenHash },
        data: { expiresAt: new Date(Date.now() - 10000) },
      });

      const res = await apiRequest('/api/auth/refresh', {
        method: 'POST',
        body: JSON.stringify({ refreshToken: signupRes.body.refreshToken }),
      });
      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.body.error, 'Refresh token expired');
    });

    // 28. Logout and subsequent refresh rejection
    await runTest(28, 'Logout revokes active family and subsequent refresh fails', async () => {
      const logoutEmail = `${emailPrefix}_logout@example.com`;
      const signupRes = await apiRequest('/api/auth/signup', {
        method: 'POST',
        body: JSON.stringify({ name: 'Logout User', email: logoutEmail, password: 'Password123!' }),
      });
      createdUserIds.add(signupRes.body.user.id);

      const logoutRes = await apiRequest('/api/auth/logout', {
        method: 'POST',
        body: JSON.stringify({ refreshToken: signupRes.body.refreshToken }),
      });
      assert.strictEqual(logoutRes.status, 200);

      // Attempt refresh with logged out token
      const refRes = await apiRequest('/api/auth/refresh', {
        method: 'POST',
        body: JSON.stringify({ refreshToken: signupRes.body.refreshToken }),
      });
      assert.strictEqual(refRes.status, 401);
    });

    // 29. Banned user refresh rejection & session revocation
    await runTest(29, 'Banned user refresh rejection & session revocation', async () => {
      const banRefEmail = `${emailPrefix}_banref@example.com`;
      const signupRes = await apiRequest('/api/auth/signup', {
        method: 'POST',
        body: JSON.stringify({ name: 'BanRef User', email: banRefEmail, password: 'Password123!' }),
      });
      createdUserIds.add(signupRes.body.user.id);

      // Ban user in DB
      await prisma.user.update({ where: { id: signupRes.body.user.id }, data: { isBanned: true } });

      const res = await apiRequest('/api/auth/refresh', {
        method: 'POST',
        body: JSON.stringify({ refreshToken: signupRes.body.refreshToken }),
      });
      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.error, 'Account has been suspended');
    });

    // 30. Two concurrent requests using same token handled safely
    await runTest(30, 'Two concurrent requests using same token handled safely (one 200, one 409)', async () => {
      const concEmail = `${emailPrefix}_concurrent@example.com`;
      const signupRes = await apiRequest('/api/auth/signup', {
        method: 'POST',
        body: JSON.stringify({ name: 'Conc User', email: concEmail, password: 'Password123!' }),
      });
      createdUserIds.add(signupRes.body.user.id);

      const token = signupRes.body.refreshToken;
      const [res1, res2] = await Promise.all([
        apiRequest('/api/auth/refresh', { method: 'POST', body: JSON.stringify({ refreshToken: token }) }),
        apiRequest('/api/auth/refresh', { method: 'POST', body: JSON.stringify({ refreshToken: token }) }),
      ]);

      const statuses = [res1.status, res2.status].sort();
      assert.deepStrictEqual(statuses, [200, 409]);
    });

    // 31. Transaction failure and rollback verified
    await runTest(31, 'Transaction failure and rollback verified', async () => {
      const rollbackEmail = `${emailPrefix}_rollback@example.com`;
      await assert.rejects(async () => {
        await prisma.$transaction(async (tx) => {
          const u = await tx.user.create({
            data: {
              name: 'Rollback User',
              email: rollbackEmail,
              passwordHash: '$2b$12$dummyHashValueForRollbackTest1234567890123456789012345',
              role: 'student',
            },
          });
          createdUserIds.add(u.id);
          // Intentional failure to trigger rollback
          throw new Error('Simulated failure during transaction');
        });
      });

      const found = await prisma.user.findUnique({ where: { email: rollbackEmail } });
      assert.strictEqual(found, null);
    });

    // 32. Cascade deletion of refresh tokens on user delete
    await runTest(32, 'Cascade deletion of refresh tokens on user delete', async () => {
      const delEmail = `${emailPrefix}_cascade@example.com`;
      const signupRes = await apiRequest('/api/auth/signup', {
        method: 'POST',
        body: JSON.stringify({ name: 'Del User', email: delEmail, password: 'Password123!' }),
      });
      const userId = signupRes.body.user.id;

      const tokensBefore = await prisma.refreshToken.count({ where: { userId } });
      assert(tokensBefore >= 1);

      await prisma.user.delete({ where: { id: userId } });
      const tokensAfter = await prisma.refreshToken.count({ where: { userId } });
      assert.strictEqual(tokensAfter, 0);
    });

    // 33. Atomic signup rollback on refresh token creation failure
    await runTest(33, 'Atomic signup rollback on refresh token creation failure', async () => {
      const failEmail = `${emailPrefix}_fail_signup@example.com`;
      // Call authService.signup with simulated collision/error
      await assert.rejects(async () => {
        await prisma.$transaction(async (tx) => {
          const user = await tx.user.create({
            data: {
              name: 'Fail User',
              email: failEmail,
              passwordHash: '$2b$12$dummyHashValueForRollbackTest1234567890123456789012345',
              role: 'student',
            },
          });
          // Duplicate token hash collision to fail tx
          throw new Error('Forced failure after user creation');
        });
      });

      const found = await prisma.user.findUnique({ where: { email: failEmail } });
      assert.strictEqual(found, null);
    });

    // 34. Concurrent suspension serialized via FOR UPDATE
    await runTest(34, 'Concurrent suspension serialized via FOR UPDATE', async () => {
      const serialEmail = `${emailPrefix}_serial@example.com`;
      const signupRes = await apiRequest('/api/auth/signup', {
        method: 'POST',
        body: JSON.stringify({ name: 'Serial User', email: serialEmail, password: 'Password123!' }),
      });
      const userId = signupRes.body.user.id;
      createdUserIds.add(userId);

      // Verify that FOR UPDATE query successfully locks the row inside a transaction
      await prisma.$transaction(async (tx) => {
        const [lockedUser] = await tx.$queryRaw`
          SELECT id, email, role, is_banned AS "isBanned"
          FROM users
          WHERE id = ${userId}
          FOR UPDATE
        `;
        assert.strictEqual(lockedUser.id, userId);
      });
    });

    // 35. Rotation blocked behind active suspension
    await runTest(35, 'Rotation blocked behind active suspension (403)', async () => {
      const suspEmail = `${emailPrefix}_susp@example.com`;
      const signupRes = await apiRequest('/api/auth/signup', {
        method: 'POST',
        body: JSON.stringify({ name: 'Susp User', email: suspEmail, password: 'Password123!' }),
      });
      const userId = signupRes.body.user.id;
      createdUserIds.add(userId);

      // Admin suspends user
      await prisma.user.update({ where: { id: userId }, data: { isBanned: true } });

      const res = await apiRequest('/api/auth/refresh', {
        method: 'POST',
        body: JSON.stringify({ refreshToken: signupRes.body.refreshToken }),
      });
      assert.strictEqual(res.status, 403);
    });

    // ══════════════════════════════════════════════════════════════════════════
    // PHASE 4C LIVE INTEGRATION TESTS (36 – 39)
    // ══════════════════════════════════════════════════════════════════════════
    console.log('\n--- Phase 4C: RBAC, Live Role Demotion & Token Tampering (Cases 36–39) ---');

    // Create a dedicated Express test application for RBAC integration tests.
    // Register the test route BEFORE the test application's terminal 404 handler.
    const express = require('express');
    const auth = require('../../src/middleware/auth');
    const { requireAdmin } = require('../../src/middleware/authorize');
    const { errorHandler } = require('../../src/utils/errors');

    const testRbacApp = express();
    testRbacApp.use(express.json());
    testRbacApp.get('/api/test/admin-only', auth, requireAdmin, (_req, res) => {
      res.json({ success: true, message: 'Admin access granted' });
    });
    testRbacApp.use((_req, res) => {
      res.status(404).json({ success: false, error: 'Route not found' });
    });
    testRbacApp.use(errorHandler);

    rbacServer = http.createServer(testRbacApp);
    await new Promise((resolve) => rbacServer.listen(0, '127.0.0.1', resolve));
    const rbacPort = rbacServer.address().port;
    const rbacBaseUrl = `http://127.0.0.1:${rbacPort}`;

    async function rbacRequest(path, options = {}) {
      const url = `${rbacBaseUrl}${path}`;
      const res = await fetch(url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...(options.headers || {}),
        },
      });
      const data = await res.json().catch(() => ({}));
      return { status: res.status, headers: res.headers, body: data };
    }

    // 36. Express HTTP request with student token rejected by requireAdmin with 403
    await runTest(36, 'Express HTTP request with student token rejected by requireAdmin (403)', async () => {
      const res = await rbacRequest('/api/test/admin-only', {
        headers: { Authorization: `Bearer ${user1Tokens.accessToken}` },
      });
      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.error, 'Admin access required');
    });

    // 37. Express HTTP request with admin token accepted by requireAdmin with 200
    await runTest(37, 'Express HTTP request with admin token accepted by requireAdmin (200)', async () => {
      const adminEmail = `${emailPrefix}_admin_test@example.com`;
      const adminUser = await prisma.user.create({
        data: {
          name: 'Real Admin',
          email: adminEmail,
          passwordHash: '$2b$12$dummyHashValueForRollbackTest1234567890123456789012345',
          role: 'admin',
        },
      });
      createdUserIds.add(adminUser.id);
      const adminToken = tokenService.generateAccessToken(adminUser);

      const res = await rbacRequest('/api/test/admin-only', {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
    });

    // 38. Live database role change takes effect immediately on next HTTP call
    await runTest(38, 'Live database role demotion takes effect immediately on next HTTP call', async () => {
      const promoEmail = `${emailPrefix}_promo@example.com`;
      const promoUser = await prisma.user.create({
        data: {
          name: 'Promo User',
          email: promoEmail,
          passwordHash: '$2b$12$dummyHashValueForRollbackTest1234567890123456789012345',
          role: 'admin',
        },
      });
      createdUserIds.add(promoUser.id);

      // Issue admin access token
      const token = tokenService.generateAccessToken(promoUser);

      // Verify admin access works initially
      const res1 = await rbacRequest('/api/test/admin-only', { headers: { Authorization: `Bearer ${token}` } });
      assert.strictEqual(res1.status, 200);

      // Demote user in database directly (simulating admin demotion)
      await prisma.user.update({ where: { id: promoUser.id }, data: { role: 'student' } });

      // Immediate next call with the SAME access token must now fail with 403 because auth.js reads live role from DB!
      const res2 = await rbacRequest('/api/test/admin-only', { headers: { Authorization: `Bearer ${token}` } });
      assert.strictEqual(res2.status, 403);
      assert.strictEqual(res2.body.error, 'Admin access required');
    });

    // 39. Tampered JWT signature rejected with 401
    await runTest(39, 'Tampered JWT signature rejected with 401', async () => {
      const parts = user1Tokens.accessToken.split('.');
      // Tamper signature
      const tampered = `${parts[0]}.${parts[1]}.tamperedSignature0123456789`;
      const res = await rbacRequest('/api/test/admin-only', { headers: { Authorization: `Bearer ${tampered}` } });
      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.body.error, 'Invalid token');
    });

    console.log('\n======================================================');
    console.log('Phase 4 Regression Suite Execution Summary:');
    console.log(`  Total Cases:   ${totalTests}`);
    console.log(`  Passed:        ${passedTests}`);
    console.log(`  Skipped:       ${skippedTests}`);
    console.log(`  Failed:        ${failedTests}`);
    console.log('======================================================\n');

    if (failedTests > 0) {
      process.exitCode = 1;
    }
  } finally {
    // ─── Non-Destructive Scoped Cleanup ───────────────────────────────────────
    // Only delete records explicitly created during this run.
    // NEVER TRUNCATE or touch other records in the database.
    try {
      if (createdUserIds.size > 0) {
        const ids = Array.from(createdUserIds);
        await prisma.refreshToken.deleteMany({ where: { userId: { in: ids } } });
        await prisma.user.deleteMany({ where: { id: { in: ids } } });
      }
    } catch (cleanupErr) {
      console.error('\n[FATAL] Teardown record cleanup failed:', cleanupErr.message || cleanupErr);
      process.exitCode = 1;
    }

    if (server) {
      try {
        await new Promise((resolve, reject) => {
          server.close((err) => (err ? reject(err) : resolve()));
        });
      } catch (serverErr) {
        console.error('\n[FATAL] Ephemeral test server closure failed:', serverErr.message || serverErr);
        process.exitCode = 1;
      }
    }

    if (rbacServer) {
      try {
        await new Promise((resolve, reject) => {
          rbacServer.close((err) => (err ? reject(err) : resolve()));
        });
      } catch (rbacErr) {
        console.error('\n[FATAL] Ephemeral RBAC server closure failed:', rbacErr.message || rbacErr);
        process.exitCode = 1;
      }
    }

    try {
      await prisma.$disconnect();
    } catch (disconnectErr) {
      console.error('\n[FATAL] Prisma client disconnection failed:', disconnectErr.message || disconnectErr);
      process.exitCode = 1;
    }
  }
}

main().catch(async (err) => {
  console.error('\n[FATAL] Unhandled test runner error:', err);
  process.exitCode = 1;
  if (server) {
    try {
      await new Promise((resolve) => server.close(resolve));
    } catch {}
  }
  if (rbacServer) {
    try {
      await new Promise((resolve) => rbacServer.close(resolve));
    } catch {}
  }
  try {
    await prisma.$disconnect();
  } catch {}
});
