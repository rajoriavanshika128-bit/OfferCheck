'use strict';

/**
 * src/routes/auth.routes.js
 * Authentication route definitions.
 */

const { Router } = require('express');
const authController = require('../controllers/auth.controller');
const validate = require('../middleware/validate');
const auth = require('../middleware/auth');
const { loginLimiter, signupLimiter } = require('../middleware/rateLimiter');
const {
  signupSchema,
  loginSchema,
  refreshSchema,
  logoutSchema,
} = require('../validations/auth.validation');

const router = Router();

router.post('/signup', signupLimiter, validate(signupSchema), authController.signup);
router.post('/login', loginLimiter, validate(loginSchema), authController.login);
router.post('/refresh', validate(refreshSchema), authController.refresh);
router.post('/logout', validate(logoutSchema), authController.logout);
router.get('/me', auth, authController.getMe);

module.exports = router;
