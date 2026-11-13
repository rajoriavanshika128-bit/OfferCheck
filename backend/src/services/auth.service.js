'use strict';

/**
 * src/services/auth.service.js
 * Business logic for user signup, authentication, and profile retrieval.
 */

const bcrypt = require('bcryptjs');
const prisma = require('../utils/prisma');
const { AppError } = require('../utils/errors');
const { generateAccessToken } = require('./token.service');

const BCRYPT_ROUNDS = 12;

// Pre-computed verified bcrypt hash (cost 12) for non-existent account lookup mitigation
const DUMMY_HASH = '$2b$12$aRbHd88mF2l3NMQuGMmcXOat4UGP005EAyzMtj2izq39QeNlBHvMm';

/**
 * Explicitly construct a sanitized user profile.
 * Never returns Prisma database records directly.
 * Omits internal moderation flags like isBanned from public user profiles.
 */
function sanitizeUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    college: user.college || null,
    createdAt: user.createdAt,
  };
}

/**
 * Register a new student account.
 *
 * @param {object} input - { name, email, password, college }
 * @returns {Promise<{ user: object, accessToken: string }>}
 */
async function signup(input) {
  const normalizedEmail = input.email.trim().toLowerCase();

  // 1. Check for duplicate email
  const existing = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    select: { id: true },
  });

  if (existing) {
    throw new AppError('Email address already registered', 409);
  }

  // 2. Hash password with bcrypt cost factor 12
  const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);

  // 3. Create user — role is strictly server-assigned 'student'
  let createdUser;
  try {
    createdUser = await prisma.user.create({
      data: {
        name: input.name.trim(),
        email: normalizedEmail,
        passwordHash,
        role: 'student', // Never trust client-supplied role
        college: input.college ? input.college.trim() : null,
        isBanned: false,
      },
    });
  } catch (err) {
    if (err && err.code === 'P2002') {
      throw new AppError('Email address already registered', 409);
    }
    throw err;
  }

  // 4. Issue access token
  const accessToken = generateAccessToken(createdUser);

  // 5. Return sanitized user profile + access token
  return {
    user: sanitizeUser(createdUser),
    accessToken,
  };
}

/**
 * Authenticate user credentials and return an access token.
 *
 * @param {object} input - { email, password }
 * @returns {Promise<{ user: object, accessToken: string }>}
 */
async function login(input) {
  const normalizedEmail = input.email.trim().toLowerCase();

  // 1. Find user by normalized email
  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });

  // 2. Perform bcrypt comparison unconditionally to mitigate timing enumeration
  const targetHash = user ? user.passwordHash : DUMMY_HASH;
  const isValid = await bcrypt.compare(input.password, targetHash);

  // 3. Reject invalid credentials with identical generic error
  if (!user || !isValid) {
    throw new AppError('Invalid email or password', 401);
  }

  // 4. Reject banned users
  if (user.isBanned) {
    throw new AppError('Account has been suspended', 403);
  }

  // 5. Issue access token
  const accessToken = generateAccessToken(user);

  // 6. Return sanitized user profile + access token
  return {
    user: sanitizeUser(user),
    accessToken,
  };
}

/**
 * Retrieve current user profile by user ID.
 *
 * @param {string} userId - Authenticated user ID
 * @returns {Promise<object>} Sanitized user profile
 */
async function getCurrentUser(userId) {
  if (!userId) {
    throw new AppError('Authentication required', 401);
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!user) {
    throw new AppError('User not found', 404);
  }

  if (user.isBanned) {
    throw new AppError('Account has been suspended', 403);
  }

  return sanitizeUser(user);
}

module.exports = {
  signup,
  login,
  getCurrentUser,
  sanitizeUser,
  BCRYPT_ROUNDS,
};
