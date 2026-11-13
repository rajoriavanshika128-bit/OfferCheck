'use strict';

/**
 * src/routes/auth.routes.js
 * Authentication route definitions.
 */

const { Router } = require('express');
const authController = require('../controllers/auth.controller');
const validate = require('../middleware/validate');
const auth = require('../middleware/auth');
const {
  signupSchema,
  loginSchema,
  refreshSchema,
  logoutSchema,
} = require('../validations/auth.validation');

const router = Router();

router.post('/signup', validate(signupSchema), authController.signup);
router.post('/login', validate(loginSchema), authController.login);
router.post('/refresh', validate(refreshSchema), authController.refresh);
router.post('/logout', validate(logoutSchema), authController.logout);
router.get('/me', auth, authController.getMe);

module.exports = router;
