'use strict';

const db = require('../../../infrastructure/database');
const { validateOrThrow, Joi } = require('../../../shared/utils/validation');
const { NotFoundError, ForbiddenError } = require('../../../shared/utils/AppError');
const { USER_STATUS } = require('../../../shared/constants');
const logger = require('../../../infrastructure/logger');

/**
 * User Service
 *
 * Manages user profile operations.
 * Auth operations (login, register, reset) live in AuthService — not here.
 *
 * Permission rule:
 *  - Users can only update their own profile
 *  - System admins can view/manage any profile
 */

// ── Validation ─────────────────────────────────────────────────────────────
const updateProfileSchema = Joi.object({
  firstName: Joi.string().trim().min(1).max(100),
  lastName: Joi.string().trim().min(1).max(100),
  bio: Joi.string().trim().max(1000).allow('', null),
  preferences: Joi.object().max(50),
}).min(1); // At least one field required

const changePasswordSchema = Joi.object({
  currentPassword: Joi.string().required(),

  newPassword: Joi.string()
    .min(8)
    .max(128)
    .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .required()
    .messages({
      'string.pattern.base':
        'New password must include uppercase, lowercase, and a number',
      'string.min': 'Password must be at least 8 characters long',
      'string.max': 'Password must be at most 128 characters long',
      'any.required': 'New password is required',
    }),
});


// ── Service Methods ────────────────────────────────────────────────────────

/**
 * Get user profile by ID.
 * @param {string} requestedId - The profile being requested
 * @param {object} requester - { id, role } from req.user
 */
const getProfile = async (requestedId, requester) => {
  const { User } = db;
  
  console.log(requestedId);

  const user = await User.findByPk(requestedId);
  if (!user) throw new NotFoundError('User');

  // Non-admins can only view active users
  if (requester.role !== 'admin' && user.status !== USER_STATUS.ACTIVE) {
    throw new NotFoundError('User');
  }

  return user.toSafeJSON();
};

/**
 * Update own profile fields.
 * @param {string} userId - User being updated (must match requester.id or be admin)
 * @param {object} input - Fields to update
 * @param {object} requester - { id, role }
 */
const updateProfile = async (userId, input, requester) => {
  if (userId !== requester.id && requester.role !== 'admin') {
    throw new ForbiddenError('You can only update your own profile');
  }

  const data = validateOrThrow(updateProfileSchema, input);

  const { User } = db;
  const user = await User.findByPk(userId);
  if (!user) throw new NotFoundError('User');

  await user.update(data);

  logger.info('[UserService] Profile updated', { userId, updatedBy: requester.id });

  return user.toSafeJSON();
};

/**
 * Change own password.
 * Verifies current password before allowing change.
 */
const changePassword = async (userId, input) => {
  const data = validateOrThrow(changePasswordSchema, input);

  const { User } = db;
  const user = await User.scope('withPassword').findByPk(userId);
  if (!user) throw new NotFoundError('User');

  const currentPasswordValid = await user.comparePassword(data.currentPassword);
  if (!currentPasswordValid) {
    throw new ForbiddenError('Current password is incorrect');
  }

  // The beforeUpdate hook handles bcrypt hashing
  await user.update({ passwordHash: data.newPassword });

  logger.info('[UserService] Password changed', { userId });
};

/**
 * Update user avatar after upload.
 * Called from the upload controller after storage provider confirms write.
 */
const updateAvatar = async (userId, { url, key }) => {
  const { User } = db;
  const user = await User.findByPk(userId);
  if (!user) throw new NotFoundError('User');

  // If user had a previous avatar stored locally, old key is preserved for cleanup
  const previousKey = user.avatarKey;

  await user.update({ avatarUrl: url, avatarKey: key });

  logger.info('[UserService] Avatar updated', { userId, key });

  return { avatarUrl: url, previousKey };
};

/**
 * Admin: list all users (paginated).
 */
const listUsers = async ({ page = 1, limit = 20, status, role } = {}) => {
  const { User } = db;
  const { Op } = require('sequelize');

  const where = {};
  if (status) where.status = status;
  if (role) where.role = role;

  const offset = (page - 1) * limit;

  const { rows, count } = await User.findAndCountAll({
    where,
    limit,
    offset,
    order: [['createdAt', 'DESC']],
  });

  return {
    users: rows.map((u) => u.toSafeJSON()),
    total: count,
    page,
    limit,
  };
};

module.exports = {
  getProfile,
  updateProfile,
  changePassword,
  updateAvatar,
  listUsers,
};