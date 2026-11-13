'use strict';

/**
 * src/utils/rbac.js
 * Authorization and ownership validation helpers.
 */

const { AppError } = require('./errors');

/**
 * Assert that the current user owns a resource, or has administrative bypass.
 *
 * @param {string} resourceOwnerId - ID of the user who owns the resource (e.g. report.submittedBy, savedReport.userId)
 * @param {object} currentUser - The authenticated user (req.user: { id, role })
 * @param {object} [options] - Configuration options
 * @param {boolean} [options.allowAdmin=true] - Whether admin role can bypass ownership check
 * @returns {boolean} Returns true if authorized; throws AppError otherwise
 */
function assertOwnership(resourceOwnerId, currentUser, options = { allowAdmin: true }) {
  if (!currentUser || !currentUser.id) {
    throw new AppError('Authentication required', 401);
  }

  if (options.allowAdmin && currentUser.role === 'admin') {
    return true;
  }

  if (resourceOwnerId !== currentUser.id) {
    throw new AppError('Access denied: you do not own this resource', 403);
  }

  return true;
}

/**
 * Assert that an action is not being performed on the actor's own account.
 * Protects against accidental admin self-demotion, self-banning, or self-lockout.
 *
 * @param {string} actorId - ID of the acting administrator (req.user.id)
 * @param {string} targetUserId - ID of the target user being operated on
 * @param {string} [actionDescription='action'] - Description of the action for error messaging
 * @returns {boolean} Returns true if valid; throws AppError(400) if actor is target
 */
function assertNotSelf(actorId, targetUserId, actionDescription = 'action') {
  if (!actorId) {
    throw new AppError('Authentication required', 401);
  }

  if (actorId === targetUserId) {
    throw new AppError(`Cannot perform ${actionDescription} on your own account`, 400);
  }

  return true;
}

module.exports = {
  assertOwnership,
  assertNotSelf,
};
