/**
 * src/services/authService.js
 * Domain authentication service interfacing with real backend endpoints:
 * - POST /api/auth/signup
 * - POST /api/auth/login
 * - POST /api/auth/logout
 * - GET  /api/auth/me
 */

import api, { storage, TOKEN_KEY, REFRESH_TOKEN_KEY, USER_KEY } from './api.js';

export const authService = {
  /**
   * Register a new student account.
   *
   * @param {string} name
   * @param {string} email
   * @param {string} password
   * @param {string} [college]
   * @returns {Promise<object>} Sanitized User profile
   */
  async signup(name, email, password, college) {
    const payload = {
      name: name?.trim() || '',
      email: email?.trim().toLowerCase() || '',
      password: password || '',
      ...(college ? { college: college.trim() } : {}),
    };

    const res = await api.post('/api/auth/signup', payload);

    if (res.accessToken) storage.set(TOKEN_KEY, res.accessToken);
    if (res.refreshToken) storage.set(REFRESH_TOKEN_KEY, res.refreshToken);
    if (res.user) storage.set(USER_KEY, JSON.stringify(res.user));

    return res.user;
  },

  /**
   * Authenticate an existing user account.
   *
   * @param {string} email
   * @param {string} password
   * @returns {Promise<object>} Sanitized User profile
   */
  async login(email, password) {
    const payload = {
      email: email?.trim().toLowerCase() || '',
      password: password || '',
    };

    const res = await api.post('/api/auth/login', payload);

    if (res.accessToken) storage.set(TOKEN_KEY, res.accessToken);
    if (res.refreshToken) storage.set(REFRESH_TOKEN_KEY, res.refreshToken);
    if (res.user) storage.set(USER_KEY, JSON.stringify(res.user));

    return res.user;
  },

  /**
   * Terminate active user session by revoking refresh token on server
   * and clearing client storage.
   */
  async logout() {
    const refreshToken = storage.get(REFRESH_TOKEN_KEY);
    try {
      if (refreshToken) {
        await api.post('/api/auth/logout', { refreshToken });
      }
    } catch {
      // Regardless of server errors or network disconnects, client storage is unconditionally cleared
    } finally {
      storage.clearAll();
    }
  },

  /**
   * Retrieve current authenticated user profile from backend (/api/auth/me).
   *
   * @returns {Promise<object|null>}
   */
  async getCurrentUser() {
    const res = await api.get('/api/auth/me');
    if (res?.user) {
      storage.set(USER_KEY, JSON.stringify(res.user));
      return res.user;
    }
    return null;
  },

  getStoredUser() {
    const raw = storage.get(USER_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      storage.remove(USER_KEY);
      return null;
    }
  },

  getAccessToken() {
    return storage.get(TOKEN_KEY);
  },

  getRefreshToken() {
    return storage.get(REFRESH_TOKEN_KEY);
  },

  isAuthenticated() {
    return Boolean(storage.get(TOKEN_KEY) || storage.get(REFRESH_TOKEN_KEY));
  },
};

export default authService;
