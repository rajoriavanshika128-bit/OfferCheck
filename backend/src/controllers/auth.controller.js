'use strict';

/**
 * src/controllers/auth.controller.js
 * HTTP route handlers for authentication endpoints.
 */

const authService = require('../services/auth.service');

/**
 * POST /api/auth/signup
 */
async function signup(req, res, next) {
  try {
    const result = await authService.signup(req.body);
    return res.status(201).json({
      success: true,
      user: result.user,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/auth/login
 */
async function login(req, res, next) {
  try {
    const result = await authService.login(req.body);
    return res.status(200).json({
      success: true,
      user: result.user,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/auth/refresh
 */
async function refresh(req, res, next) {
  try {
    const result = await authService.rotateRefreshToken(req.body.refreshToken);
    return res.status(200).json({
      success: true,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/auth/logout
 */
async function logout(req, res, next) {
  try {
    const result = await authService.logout(req.body.refreshToken);
    return res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/auth/me
 */
async function getMe(req, res, next) {
  try {
    const user = await authService.getCurrentUser(req.user.id);
    return res.status(200).json({
      success: true,
      user,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  signup,
  login,
  refresh,
  logout,
  getMe,
};
