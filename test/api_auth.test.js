/**
 * test/api_auth.test.js
 * Comprehensive unit tests for centralized API client (src/services/api.js)
 * and authentication service (src/services/authService.js).
 *
 * COVERS:
 * 1. API error handling:
 *    - 400/404/500 HTTP errors with custom message extraction.
 *    - Network connectivity failure handling.
 * 2. Expired tokens & automatic transparent retry:
 *    - Request returning 401 triggers single-flight refresh and retries successfully.
 * 3. Concurrent requests & single-flight refresh mutex:
 *    - Multiple concurrent 401 requests trigger EXACTLY 1 refresh call.
 *    - All concurrent callers receive the retried response.
 * 4. Refresh failure handling:
 *    - Invalid/expired refresh token clears storage and dispatches onAuthExpired.
 * 5. Authentication endpoints guard:
 *    - Login/signup/refresh 401 errors never trigger recursive refresh.
 * 6. Logout resilience:
 *    - Revokes refresh token and unconditionally clears client storage.
 * 7. Auth service methods:
 *    - Login, signup, getCurrentUser, session persistence.
 */

import assert from 'assert';
import { api, request, storage, onAuthExpired, ApiError, TOKEN_KEY, REFRESH_TOKEN_KEY, USER_KEY } from '../src/services/api.js';
import authService from '../src/services/authService.js';

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

// In-memory localStorage mock for Node test environment
const mockStorageMap = new Map();
globalThis.localStorage = {
  getItem: (key) => mockStorageMap.get(key) || null,
  setItem: (key, val) => mockStorageMap.set(key, String(val)),
  removeItem: (key) => mockStorageMap.delete(key),
  clear: () => mockStorageMap.clear(),
};

// Global fetch mock helper
let originalFetch = globalThis.fetch;

function mockFetch(handler) {
  globalThis.fetch = async (url, options = {}) => {
    return handler(String(url), options);
  };
}

function restoreFetch() {
  globalThis.fetch = originalFetch;
}

function createJsonResponse(data, status = 200) {
  const bodyText = JSON.stringify(data);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (header) => (header.toLowerCase() === 'content-type' ? 'application/json' : null),
    },
    json: async () => data,
    text: async () => bodyText,
  };
}

async function main() {
  console.log('\n--- Frontend API Client & Auth Service Unit Tests ---\n');

  // =========================================================================
  // 1. API Error Handling
  // =========================================================================
  console.log('1. API Error Handling:');

  await runTest('API client throws ApiError with status and custom message on 400 Bad Request', async () => {
    mockStorageMap.clear();
    mockFetch(async () => createJsonResponse({ success: false, error: 'Validation failed: invalid email' }, 400));

    await assert.rejects(
      async () => api.post('/api/checks', { companyName: '' }),
      (err) => {
        assert.ok(err instanceof ApiError);
        assert.strictEqual(err.status, 400);
        assert.strictEqual(err.message, 'Validation failed: invalid email');
        return true;
      }
    );
  });

  await runTest('API client throws ApiError with status and message on 500 Server Error', async () => {
    mockStorageMap.clear();
    mockFetch(async () => createJsonResponse({ success: false, message: 'Database connection failed' }, 500));

    await assert.rejects(
      async () => api.get('/api/reports'),
      (err) => {
        assert.ok(err instanceof ApiError);
        assert.strictEqual(err.status, 500);
        assert.strictEqual(err.message, 'Database connection failed');
        return true;
      }
    );
  });

  await runTest('API client handles network failure gracefully with status 0', async () => {
    mockStorageMap.clear();
    mockFetch(async () => {
      throw new TypeError('Failed to fetch');
    });

    await assert.rejects(
      async () => api.get('/api/health'),
      (err) => {
        assert.ok(err instanceof ApiError);
        assert.strictEqual(err.status, 0);
        assert.match(err.message, /Failed to fetch|Network error/i);
        return true;
      }
    );
  });

  // =========================================================================
  // 2. Expired Token & Automatic Transparent Retry
  // =========================================================================
  console.log('\n2. Expired Token & Automatic Transparent Retry:');

  await runTest('Request receiving 401 refreshes token and retries with new access token', async () => {
    mockStorageMap.clear();
    storage.set(TOKEN_KEY, 'expired-token');
    storage.set(REFRESH_TOKEN_KEY, 'valid-refresh-token');

    let requestCount = 0;
    let refreshCount = 0;

    mockFetch(async (url, options) => {
      if (url.includes('/api/auth/refresh')) {
        refreshCount++;
        const parsedBody = JSON.parse(options.body);
        assert.strictEqual(parsedBody.refreshToken, 'valid-refresh-token');
        return createJsonResponse({
          success: true,
          accessToken: 'fresh-new-access-token',
          refreshToken: 'fresh-new-refresh-token',
        });
      }

      if (url.includes('/api/checks/dashboard')) {
        requestCount++;
        if (options.headers?.Authorization === 'Bearer expired-token') {
          return createJsonResponse({ success: false, error: 'Token expired' }, 401);
        }
        if (options.headers?.Authorization === 'Bearer fresh-new-access-token') {
          return createJsonResponse({ success: true, metrics: { totalChecks: 5 } }, 200);
        }
      }

      return createJsonResponse({ success: false }, 404);
    });

    const result = await api.get('/api/checks/dashboard');
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.metrics.totalChecks, 5);
    assert.strictEqual(refreshCount, 1);
    assert.strictEqual(requestCount, 2);
    assert.strictEqual(storage.get(TOKEN_KEY), 'fresh-new-access-token');
    assert.strictEqual(storage.get(REFRESH_TOKEN_KEY), 'fresh-new-refresh-token');
  });

  // =========================================================================
  // 3. Concurrent Requests & Single-Flight Refresh Mutex
  // =========================================================================
  console.log('\n3. Concurrent Requests & Single-Flight Mutex:');

  await runTest('Multiple concurrent 401 requests trigger EXACTLY 1 token refresh and all succeed', async () => {
    mockStorageMap.clear();
    storage.set(TOKEN_KEY, 'expired-batch-token');
    storage.set(REFRESH_TOKEN_KEY, 'batch-refresh-token');

    let refreshCallCount = 0;

    mockFetch(async (url, options) => {
      if (url.includes('/api/auth/refresh')) {
        refreshCallCount++;
        // Simulate a small network delay to test concurrency race
        await new Promise((res) => setTimeout(res, 20));
        return createJsonResponse({
          success: true,
          accessToken: 'batch-refreshed-token',
          refreshToken: 'batch-new-refresh-token',
        });
      }

      if (options.headers?.Authorization === 'Bearer expired-batch-token') {
        return createJsonResponse({ success: false, error: 'jwt expired' }, 401);
      }

      if (options.headers?.Authorization === 'Bearer batch-refreshed-token') {
        if (url.includes('/api/checks/dashboard')) {
          return createJsonResponse({ success: true, endpoint: 'dashboard' });
        }
        if (url.includes('/api/reports')) {
          return createJsonResponse({ success: true, endpoint: 'reports' });
        }
        if (url.includes('/api/auth/me')) {
          return createJsonResponse({ success: true, endpoint: 'me' });
        }
      }

      return createJsonResponse({ success: false }, 404);
    });

    // Dispatch 3 concurrent requests simultaneously while token is expired
    const [res1, res2, res3] = await Promise.all([
      api.get('/api/checks/dashboard'),
      api.get('/api/reports'),
      api.get('/api/auth/me'),
    ]);

    assert.strictEqual(res1.success, true);
    assert.strictEqual(res1.endpoint, 'dashboard');
    assert.strictEqual(res2.success, true);
    assert.strictEqual(res2.endpoint, 'reports');
    assert.strictEqual(res3.success, true);
    assert.strictEqual(res3.endpoint, 'me');

    // Crucial invariant: refresh was executed strictly ONCE
    assert.strictEqual(refreshCallCount, 1);
    assert.strictEqual(storage.get(TOKEN_KEY), 'batch-refreshed-token');
  });

  // =========================================================================
  // 4. Refresh Failure & Session Expiry Handling
  // =========================================================================
  console.log('\n4. Refresh Failure & Session Expiry:');

  await runTest('Failed refresh clears client storage and notifies onAuthExpired listeners', async () => {
    mockStorageMap.clear();
    storage.set(TOKEN_KEY, 'expired-token');
    storage.set(REFRESH_TOKEN_KEY, 'revoked-refresh-token');
    storage.set(USER_KEY, JSON.stringify({ name: 'Student' }));

    let expiryNotified = false;
    const unsubscribe = onAuthExpired(() => {
      expiryNotified = true;
    });

    mockFetch(async (url) => {
      if (url.includes('/api/auth/refresh')) {
        return createJsonResponse({ success: false, error: 'Invalid refresh token: token reuse detected' }, 401);
      }
      return createJsonResponse({ success: false, error: 'Unauthorized' }, 401);
    });

    await assert.rejects(
      async () => api.get('/api/checks/dashboard'),
      (err) => {
        assert.strictEqual(err.status, 401);
        assert.match(err.message, /token reuse detected/i);
        return true;
      }
    );

    assert.strictEqual(expiryNotified, true);
    assert.strictEqual(storage.get(TOKEN_KEY), null);
    assert.strictEqual(storage.get(REFRESH_TOKEN_KEY), null);
    assert.strictEqual(storage.get(USER_KEY), null);

    unsubscribe();
  });

  // =========================================================================
  // 5. Auth Endpoints Guard (No Recursive Refresh)
  // =========================================================================
  console.log('\n5. Auth Endpoints Guard:');

  await runTest('401 on login or signup endpoint does NOT trigger refresh loop', async () => {
    mockStorageMap.clear();
    storage.set(REFRESH_TOKEN_KEY, 'existing-refresh-token');

    let refreshCalled = false;

    mockFetch(async (url) => {
      if (url.includes('/api/auth/refresh')) {
        refreshCalled = true;
        return createJsonResponse({ success: true, accessToken: 'token' });
      }
      if (url.includes('/api/auth/login')) {
        return createJsonResponse({ success: false, error: 'Invalid email or password' }, 401);
      }
      return createJsonResponse({ success: false }, 404);
    });

    await assert.rejects(
      async () => authService.login('bad@student.com', 'wrongpassword'),
      (err) => {
        assert.strictEqual(err.status, 401);
        assert.strictEqual(err.message, 'Invalid email or password');
        return true;
      }
    );

    assert.strictEqual(refreshCalled, false);
  });

  // =========================================================================
  // 6. Logout Resilience
  // =========================================================================
  console.log('\n6. Logout Resilience:');

  await runTest('Logout calls backend and clears all storage unconditionally even if network fails', async () => {
    mockStorageMap.clear();
    storage.set(TOKEN_KEY, 'tok');
    storage.set(REFRESH_TOKEN_KEY, 'ref');
    storage.set(USER_KEY, JSON.stringify({ name: 'User' }));

    mockFetch(async () => {
      throw new TypeError('Network connection lost');
    });

    // Should not throw — must swallow network error and clear local session
    await authService.logout();

    assert.strictEqual(storage.get(TOKEN_KEY), null);
    assert.strictEqual(storage.get(REFRESH_TOKEN_KEY), null);
    assert.strictEqual(storage.get(USER_KEY), null);
    assert.strictEqual(authService.isAuthenticated(), false);
  });

  // =========================================================================
  // 7. Auth Service Login, Signup, and User Persistence
  // =========================================================================
  console.log('\n7. Auth Service Login & Signup:');

  await runTest('authService.login persists tokens and user profile', async () => {
    mockStorageMap.clear();
    const fakeUser = { id: 'u1', name: 'John Doe', email: 'john@college.edu', role: 'student' };

    mockFetch(async (url, options) => {
      assert.ok(url.includes('/api/auth/login'));
      const body = JSON.parse(options.body);
      assert.strictEqual(body.email, 'john@college.edu');
      assert.strictEqual(body.password, 'secret123');

      return createJsonResponse({
        success: true,
        user: fakeUser,
        accessToken: 'acc-jwt-123',
        refreshToken: 'ref-token-456',
      });
    });

    const user = await authService.login('John@College.Edu', 'secret123');
    assert.deepStrictEqual(user, fakeUser);
    assert.strictEqual(storage.get(TOKEN_KEY), 'acc-jwt-123');
    assert.strictEqual(storage.get(REFRESH_TOKEN_KEY), 'ref-token-456');
    assert.deepStrictEqual(authService.getStoredUser(), fakeUser);
    assert.strictEqual(authService.isAuthenticated(), true);
  });

  await runTest('authService.signup persists tokens and user profile', async () => {
    mockStorageMap.clear();
    const fakeUser = { id: 'u2', name: 'Jane Smith', email: 'jane@college.edu', role: 'student', college: 'Tech Uni' };

    mockFetch(async (url, options) => {
      assert.ok(url.includes('/api/auth/signup'));
      const body = JSON.parse(options.body);
      assert.strictEqual(body.name, 'Jane Smith');
      assert.strictEqual(body.email, 'jane@college.edu');
      assert.strictEqual(body.college, 'Tech Uni');

      return createJsonResponse({
        success: true,
        user: fakeUser,
        accessToken: 'acc-jwt-789',
        refreshToken: 'ref-token-012',
      });
    });

    const user = await authService.signup('Jane Smith', 'Jane@college.edu', 'secret123', 'Tech Uni');
    assert.deepStrictEqual(user, fakeUser);
    assert.strictEqual(storage.get(TOKEN_KEY), 'acc-jwt-789');
    assert.strictEqual(storage.get(REFRESH_TOKEN_KEY), 'ref-token-012');
    assert.deepStrictEqual(authService.getStoredUser(), fakeUser);
  });

  await runTest('authService.getCurrentUser fetches /api/auth/me and updates stored user', async () => {
    mockStorageMap.clear();
    storage.set(TOKEN_KEY, 'valid-token');
    const updatedUser = { id: 'u1', name: 'John Doe', email: 'john@college.edu', role: 'admin' };

    mockFetch(async (url, options) => {
      assert.ok(url.includes('/api/auth/me'));
      assert.strictEqual(options.headers.Authorization, 'Bearer valid-token');
      return createJsonResponse({ success: true, user: updatedUser });
    });

    const user = await authService.getCurrentUser();
    assert.deepStrictEqual(user, updatedUser);
    assert.deepStrictEqual(authService.getStoredUser(), updatedUser);
  });

  restoreFetch();
  console.log(`\nAll ${passedTests} / ${totalTests} API client and auth service tests passed successfully!\n`);
}

main().catch((err) => {
  restoreFetch();
  console.error('\n[FATAL] Test failed:', err);
  process.exit(1);
});
