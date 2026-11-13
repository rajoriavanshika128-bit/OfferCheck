'use strict';

/**
 * src/services/auth.service.js
 * Business logic for user signup, authentication, and profile retrieval.
 */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const prisma = require('../utils/prisma');
const { AppError } = require('../utils/errors');
const {
  generateAccessToken,
  generateRefreshToken,
  hashToken,
  calculateRefreshTokenExpiry,
} = require('./token.service');

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

  // 3. Issue opaque refresh token (Phase 4B)
  const rawRefreshToken = generateRefreshToken();
  const tokenHash = hashToken(rawRefreshToken);
  const family = crypto.randomUUID();
  const expiresAt = calculateRefreshTokenExpiry();

  // 4. Create user and initial refresh token atomically in a transaction
  let createdUser;
  try {
    createdUser = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          name: input.name.trim(),
          email: normalizedEmail,
          passwordHash,
          role: 'student', // Never trust client-supplied role
          college: input.college ? input.college.trim() : null,
          isBanned: false,
        },
      });

      await tx.refreshToken.create({
        data: {
          userId: user.id,
          tokenHash,
          family,
          expiresAt,
        },
      });

      return user;
    });
  } catch (err) {
    if (err && err.code === 'P2002') {
      throw new AppError('Email address already registered', 409);
    }
    throw err;
  }

  // 5. Issue access token
  const accessToken = generateAccessToken(createdUser);

  // 6. Return sanitized user profile + access token + refresh token
  return {
    user: sanitizeUser(createdUser),
    accessToken,
    refreshToken: rawRefreshToken,
  };
}

/**
 * Authenticate user credentials and return an access token and refresh token.
 *
 * @param {object} input - { email, password }
 * @returns {Promise<{ user: object, accessToken: string, refreshToken: string }>}
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

  // 6. Issue opaque refresh token (Phase 4B)
  const rawRefreshToken = generateRefreshToken();
  const tokenHash = hashToken(rawRefreshToken);
  const family = crypto.randomUUID();
  const expiresAt = calculateRefreshTokenExpiry();

  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash,
      family,
      expiresAt,
    },
  });

  // 7. Return sanitized user profile + access token + refresh token
  return {
    user: sanitizeUser(user),
    accessToken,
    refreshToken: rawRefreshToken,
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

/**
 * Rotate a refresh token atomically.
 * Enforces reuse detection, token family revocation, expiration, and user ban checks.
 *
 * @param {string} rawRefreshToken - Raw opaque refresh token from client
 * @returns {Promise<{ accessToken: string, refreshToken: string }>}
 */
async function rotateRefreshToken(rawRefreshToken) {
  if (!rawRefreshToken || typeof rawRefreshToken !== 'string') {
    throw new AppError('Refresh token is required', 400);
  }

  const tokenHash = hashToken(rawRefreshToken);

  // 1. Look up token by SHA-256 hash
  const token = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  // Ordinary invalid token: token does not exist in database
  if (!token) {
    throw new AppError('Invalid refresh token', 401);
  }

  // 2. Token reuse detection: if already revoked, a compromised/stolen token was reused!
  // Atomically revoke the entire family immediately to prevent further unauthorized access
  if (token.revokedAt !== null) {
    await prisma.refreshToken.updateMany({
      where: {
        family: token.family,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });
    throw new AppError('Invalid refresh token: token reuse detected', 401);
  }

  // 3. Expiration check
  if (new Date() > token.expiresAt) {
    await prisma.refreshToken.update({
      where: { id: token.id },
      data: { revokedAt: new Date() },
    });
    throw new AppError('Refresh token expired', 401);
  }

  // 4. Ban / account suspension check
  if (!token.user || token.user.isBanned) {
    await prisma.refreshToken.updateMany({
      where: {
        userId: token.userId,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });
    throw new AppError('Account has been suspended', 403);
  }

  // 5. Atomic conditional update & rotation in a transaction to prevent dual-rotation
  let rotationResult;
  try {
    rotationResult = await prisma.$transaction(async (tx) => {
      // 5a. Recheck and lock user row with FOR UPDATE to serialize concurrent suspension
      const [currentUser] = await tx.$queryRaw`
        SELECT id, email, role, is_banned AS "isBanned"
        FROM users
        WHERE id = ${token.userId}
        FOR UPDATE
      `;

      if (!currentUser || currentUser.isBanned) {
        throw new AppError('Account has been suspended', 403);
      }

      const updateResult = await tx.refreshToken.updateMany({
        where: {
          id: token.id,
          revokedAt: null,
        },
        data: {
          revokedAt: new Date(),
        },
      });

      if (updateResult.count === 0) {
        // Safe concurrency handling: the token was just rotated by a concurrent winner.
        // Reject with 409 Conflict without destroying the winner's new family session.
        throw new AppError('Concurrent refresh in progress; token already rotated', 409);
      }

      // 6. Issue new opaque refresh token in the same family
      const newRawRefreshToken = generateRefreshToken();
      const newTokenHash = hashToken(newRawRefreshToken);
      const newExpiresAt = calculateRefreshTokenExpiry();

      await tx.refreshToken.create({
        data: {
          userId: currentUser.id,
          tokenHash: newTokenHash,
          family: token.family, // Preserve rotation chain
          expiresAt: newExpiresAt,
        },
      });

      // 7. Issue new 15-minute access token using verified user profile
      const newAccessToken = generateAccessToken(currentUser);

      return {
        accessToken: newAccessToken,
        refreshToken: newRawRefreshToken,
      };
    });
  } catch (err) {
    if (err instanceof AppError && err.statusCode === 403) {
      // Ensure all active sessions for the suspended user are revoked in DB
      await prisma.refreshToken.updateMany({
        where: {
          userId: token.userId,
          revokedAt: null,
        },
        data: {
          revokedAt: new Date(),
        },
      });
    }
    throw err;
  }

  return rotationResult;
}

/**
 * Log out by revoking the refresh token and its active rotation family.
 *
 * @param {string} rawRefreshToken - Raw opaque refresh token
 * @returns {Promise<{ success: boolean, message: string }>}
 */
async function logout(rawRefreshToken) {
  if (!rawRefreshToken || typeof rawRefreshToken !== 'string') {
    throw new AppError('Refresh token is required', 400);
  }

  const tokenHash = hashToken(rawRefreshToken);

  const token = await prisma.refreshToken.findUnique({
    where: { tokenHash },
  });

  if (token) {
    // Revoke all active tokens in this family
    await prisma.refreshToken.updateMany({
      where: {
        family: token.family,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });
  }

  return {
    success: true,
    message: 'Logged out successfully',
  };
}

module.exports = {
  signup,
  login,
  rotateRefreshToken,
  logout,
  getCurrentUser,
  sanitizeUser,
  BCRYPT_ROUNDS,
};
