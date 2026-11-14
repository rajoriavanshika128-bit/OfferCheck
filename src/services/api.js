/**
 * src/services/api.js
 * Centralized API client with resilient token management, single-flight refresh mutex,
 * and standard HTTP method dispatch.
 */

export const TOKEN_KEY = 'offercheck_access_token';
export const REFRESH_TOKEN_KEY = 'offercheck_refresh_token';
export const USER_KEY = 'offercheck_user';

export class ApiError extends Error {
  constructor(message, status = 500, data = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.statusCode = status;
    this.data = data;
  }
}

/**
 * Safe local storage wrapper handling SSR or environments where localStorage is unavailable.
 */
export const storage = {
  get: (key) => {
    try {
      return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
    } catch {
      return null;
    }
  },
  set: (key, val) => {
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(key, val);
    } catch {}
  },
  remove: (key) => {
    try {
      if (typeof localStorage !== 'undefined') localStorage.removeItem(key);
    } catch {}
  },
  clearAll: () => {
    storage.remove(TOKEN_KEY);
    storage.remove(REFRESH_TOKEN_KEY);
    storage.remove(USER_KEY);
  },
};

const getBaseUrl = () => {
  if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) {
    return import.meta.env.VITE_API_URL.replace(/\/+$/, '');
  }
  return 'http://localhost:3000';
};

// Single-flight refresh state and listeners
let isRefreshing = false;
let refreshPromise = null;
const authExpiredListeners = new Set();

export const onAuthExpired = (callback) => {
  if (typeof callback === 'function') {
    authExpiredListeners.add(callback);
    return () => authExpiredListeners.delete(callback);
  }
  return () => {};
};

const notifyAuthExpired = () => {
  authExpiredListeners.forEach((cb) => {
    try {
      cb();
    } catch {}
  });
};

/**
 * Execute single-flight refresh token rotation.
 * All concurrent 401 requests share a single in-flight promise to prevent 409 conflict
 * and duplicate token rotation.
 */
export async function refreshAccessToken() {
  if (isRefreshing && refreshPromise) {
    return refreshPromise;
  }

  const refreshToken = storage.get(REFRESH_TOKEN_KEY);
  if (!refreshToken) {
    storage.clearAll();
    notifyAuthExpired();
    throw new ApiError('No refresh token available', 401);
  }

  isRefreshing = true;
  refreshPromise = (async () => {
    try {
      const baseUrl = getBaseUrl();
      const res = await fetch(`${baseUrl}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });

      let data = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }

      if (!res.ok || !data?.success) {
        const errorMsg = data?.error || data?.message || 'Token refresh failed';
        storage.clearAll();
        notifyAuthExpired();
        throw new ApiError(errorMsg, res.status, data);
      }

      if (data.accessToken) {
        storage.set(TOKEN_KEY, data.accessToken);
      }
      if (data.refreshToken) {
        storage.set(REFRESH_TOKEN_KEY, data.refreshToken);
      }

      return data.accessToken;
    } catch (err) {
      storage.clearAll();
      notifyAuthExpired();
      throw err;
    } finally {
      isRefreshing = false;
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

/**
 * Centralized HTTP request dispatcher with automatic authorization, JSON serialization,
 * error handling, and 401 transparent token retry.
 */
export async function request(endpoint, options = {}) {
  const baseUrl = getBaseUrl();
  const url = endpoint.startsWith('http')
    ? endpoint
    : `${baseUrl}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;

  const token = storage.get(TOKEN_KEY);

  const headers = {
    ...(options.body && typeof options.body === 'object' && !(options.body instanceof FormData)
      ? { 'Content-Type': 'application/json' }
      : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  };

  let body = options.body;
  if (body && typeof body === 'object' && !(body instanceof FormData) && typeof body !== 'string') {
    body = JSON.stringify(body);
  }

  const config = {
    ...options,
    headers,
    body,
  };

  let response;
  try {
    response = await fetch(url, config);
  } catch (netErr) {
    throw new ApiError(netErr.message || 'Network error: unable to connect to server', 0);
  }

  let data = null;
  const contentType = response.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    try {
      data = await response.json();
    } catch {
      data = null;
    }
  } else {
    try {
      const text = await response.text();
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
  }

  const isAuthEndpoint =
    endpoint.includes('/api/auth/login') ||
    endpoint.includes('/api/auth/signup') ||
    endpoint.includes('/api/auth/refresh');

  // Handle 401 Unauthorized by attempting single-flight token refresh
  if (response.status === 401 && !options._isRetry && !isAuthEndpoint) {
    const refreshToken = storage.get(REFRESH_TOKEN_KEY);
    if (refreshToken) {
      try {
        const newAccessToken = await refreshAccessToken();
        return request(endpoint, {
          ...options,
          _isRetry: true,
          headers: {
            ...options.headers,
            Authorization: `Bearer ${newAccessToken}`,
          },
        });
      } catch (refreshErr) {
        throw refreshErr instanceof ApiError
          ? refreshErr
          : new ApiError(refreshErr.message || 'Session expired. Please log in again.', 401);
      }
    } else {
      storage.clearAll();
      notifyAuthExpired();
    }
  }

  if (!response.ok) {
    const errorMessage =
      (typeof data?.error === 'string' ? data.error : null) ||
      data?.error?.message ||
      data?.message ||
      `Request failed with status ${response.status}`;
    throw new ApiError(errorMessage, response.status, data);
  }

  return data;
}

export const api = {
  get: (endpoint, options) => request(endpoint, { ...options, method: 'GET' }),
  post: (endpoint, body, options) => request(endpoint, { ...options, method: 'POST', body }),
  put: (endpoint, body, options) => request(endpoint, { ...options, method: 'PUT', body }),
  patch: (endpoint, body, options) => request(endpoint, { ...options, method: 'PATCH', body }),
  delete: (endpoint, options) => request(endpoint, { ...options, method: 'DELETE' }),
};

export default api;
