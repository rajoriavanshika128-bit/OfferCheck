'use strict';

/**
 * src/validations/auth.validation.js
 * Zod validation schemas for authentication endpoints.
 */

const { z } = require('zod');

const signupSchema = z.object({
  name: z
    .string({ required_error: 'Name is required' })
    .trim()
    .min(1, 'Name cannot be empty')
    .max(120, 'Name must be 120 characters or less'),
  email: z
    .string({ required_error: 'Email is required' })
    .trim()
    .toLowerCase()
    .email('Please provide a valid email address')
    .max(254, 'Email must be 254 characters or less'),
  password: z
    .string({ required_error: 'Password is required' })
    .min(8, 'Password must be at least 8 characters')
    .max(72, 'Password must be 72 characters or less')
    .refine(
      (val) => Buffer.byteLength(val, 'utf8') <= 72,
      'Password must be 72 bytes or less'
    ),
  college: z
    .string()
    .trim()
    .max(200, 'College must be 200 characters or less')
    .optional(),
});

const loginSchema = z.object({
  email: z
    .string({ required_error: 'Email is required' })
    .trim()
    .toLowerCase()
    .email('Please provide a valid email address')
    .max(254, 'Email must be 254 characters or less'),
  password: z
    .string({ required_error: 'Password is required' })
    .min(1, 'Password is required')
    .max(72, 'Password must be 72 characters or less')
    .refine(
      (val) => Buffer.byteLength(val, 'utf8') <= 72,
      'Password must be 72 bytes or less'
    ),
});

const refreshSchema = z.object({
  refreshToken: z
    .string({ required_error: 'Refresh token is required' })
    .trim()
    .min(1, 'Refresh token is required'),
});

const logoutSchema = z.object({
  refreshToken: z
    .string({ required_error: 'Refresh token is required' })
    .trim()
    .min(1, 'Refresh token is required'),
});

module.exports = {
  signupSchema,
  loginSchema,
  refreshSchema,
  logoutSchema,
};
