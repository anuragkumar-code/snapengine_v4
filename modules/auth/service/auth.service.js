'use strict';

const db = require('../../../infrastructure/database');
const { issueTokenPair, verifyRefreshToken } = require('../../../shared/utils/jwt');
const { validateOrThrow, commonSchemas, Joi } = require('../../../shared/utils/validation');
const {
  ConflictError,
  InvalidCredentialsError,
  NotFoundError,
  InvalidTokenError,
  ValidationError,
} = require('../../../shared/utils/AppError');
const { USER_STATUS, ACTIVITY_TYPE } = require('../../../shared/constants');
const { dispatch, QUEUE_NAMES } = require('../../../infrastructure/queue');
const { JOB_NAMES } = require('../../../shared/constants');
const logger = require('../../../infrastructure/logger');
const config = require('../../../config');

/**
 * Auth Service
 *
 * Owns all authentication business logic:
 *  - User registration (email or mobile)
 *  - Login with credential verification
 *  - Access token refresh
 *  - Password reset (token issuance + consumption)
 *
 * Rules:
 *  - Never returns raw Sequelize model instances — always call .toSafeJSON()
 *  - Token operations never expose raw tokens to logs
 *  - Failed login attempts are logged for audit (future: implement lockout)
 *  - All input is validated via Joi before any DB operation
 */

// ── Validation Schemas ─────────────────────────────────────────────────────
const registerSchema = Joi.object({
  email: commonSchemas.email.optional(),
  mobile: commonSchemas.mobile.optional(),
  password: commonSchemas.password.required(),
  firstName: Joi.string().trim().min(1).max(100).required(),
  lastName: Joi.string().trim().min(1).max(100).required(),
}).or('email', 'mobile'); // At least one identifier required

const loginSchema = Joi.object({
  email: commonSchemas.email.optional(),
  mobile: commonSchemas.mobile.optional(),
  password: Joi.string().required(),
}).or('email', 'mobile');

const resetRequestSchema = Joi.object({
  email: commonSchemas.email.required(),
});

const resetPasswordSchema = Joi.object({
  token: Joi.string().length(64).hex().required(),
  newPassword: commonSchemas.password.required(),
});

// ── Service Methods ────────────────────────────────────────────────────────

/**
 * Register a new user.
 * Validates input, checks uniqueness, creates user, issues tokens.
 *
 * @param {object} input - { email?, mobile?, password, firstName, lastName }
 * @param {string} ipAddress - Caller's IP for audit
 * @returns {{ user: object, accessToken: string, refreshToken: string }}
 */
const register = async (input, ipAddress) => {
  const data = validateOrThrow(registerSchema, input);

  const { User } = db;

  // ── Uniqueness check ─────────────────────────────────────────────────
  if (data.email) {
    const existing = await User.unscoped().findOne({ where: { email: data.email } });
    if (existing) {
      throw new ConflictError('An account with this email address already exists');
    }
  }

  if (data.mobile) {
    const existing = await User.unscoped().findOne({ where: { mobile: data.mobile } });
    if (existing) {
      throw new ConflictError('An account with this mobile number already exists');
    }
  }

  // ── Create user ──────────────────────────────────────────────────────
  // passwordHash field triggers bcrypt hashing in the beforeCreate hook
  const user = await User.create({
    email: data.email || null,
    mobile: data.mobile || null,
    passwordHash: data.password,
    firstName: data.firstName,
    lastName: data.lastName,
    status: USER_STATUS.ACTIVE,
    lastLoginAt: new Date(),
    lastLoginIp: ipAddress,
  });

  const tokens = issueTokenPair(user.id, user.role);

  logger.info('[AuthService] User registered', {
    userId: user.id,
    email: data.email || null,
    ip: ipAddress,
  });

  // Fire-and-forget: log domain event
  await dispatch(QUEUE_NAMES.ACTIVITY_LOG, JOB_NAMES.LOG_ACTIVITY, {
    type: ACTIVITY_TYPE.USER_REGISTERED,
    actorId: user.id,
    metadata: { email: data.email, mobile: data.mobile },
  }).catch((err) => logger.error('[AuthService] Failed to dispatch activity log', { error: err.message }));

  return {
    user: user.toSafeJSON(),
    ...tokens,
  };
};

/**
 * Login with email or mobile + password.
 * Rate limiting is applied at the route level (authRateLimiter).
 *
 * @param {object} input - { email?, mobile?, password }
 * @param {string} ipAddress
 * @returns {{ user: object, accessToken: string, refreshToken: string }}
 */
const login = async (input, ipAddress) => {
  const data = validateOrThrow(loginSchema, input);

  const { User } = db;

  // Fetch user with password hash (special scope bypasses defaultScope exclusion)
  const whereClause = data.email ? { email: data.email } : { mobile: data.mobile };
  const user = await User.scope('withPassword').findOne({ where: whereClause });

  // Generic error — never reveal whether email/mobile exists
  const authError = new InvalidCredentialsError('Invalid credentials');

  if (!user) {
    logger.warn('[AuthService] Login failed: user not found', {
      identifier: data.email || data.mobile,
      ip: ipAddress,
    });
    throw authError;
  }

  if (!user.isActive()) {
    logger.warn('[AuthService] Login failed: account inactive', {
      userId: user.id,
      status: user.status,
      ip: ipAddress,
    });
    throw new InvalidCredentialsError(`Account is ${user.status}. Please contact support.`);
  }

  const passwordValid = await user.comparePassword(data.password);
  if (!passwordValid) {
    logger.warn('[AuthService] Login failed: wrong password', {
      userId: user.id,
      ip: ipAddress,
    });
    throw authError;
  }

  // Update last login metadata
  await user.update({ lastLoginAt: new Date(), lastLoginIp: ipAddress });

  const tokens = issueTokenPair(user.id, user.role);

  logger.info('[AuthService] User logged in', { userId: user.id, ip: ipAddress });

  await dispatch(QUEUE_NAMES.ACTIVITY_LOG, JOB_NAMES.LOG_ACTIVITY, {
    type: ACTIVITY_TYPE.USER_LOGIN,
    actorId: user.id,
    metadata: { ip: ipAddress },
  }).catch((err) => logger.error('[AuthService] Activity log dispatch failed', { error: err.message }));

  return {
    user: user.toSafeJSON(),
    ...tokens,
  };
};

/**
 * Issue new access token using a valid refresh token.
 *
 * @param {string} refreshToken - The refresh JWT
 * @returns {{ accessToken: string, refreshToken: string }}
 */
const refreshTokens = async (refreshToken) => {
  if (!refreshToken) {
    throw new InvalidTokenError('Refresh token is required');
  }

  const payload = verifyRefreshToken(refreshToken); // throws on invalid/expired
  const { User } = db;

  const user = await User.findOne({
    where: { id: payload.sub, status: USER_STATUS.ACTIVE },
  });

  if (!user) {
    throw new InvalidTokenError('User no longer exists or is inactive');
  }

  const tokens = issueTokenPair(user.id, user.role);

  logger.debug('[AuthService] Tokens refreshed', { userId: user.id });

  return tokens;
};

/**
 * Request a password reset token.
 * Always responds with the same message regardless of whether email exists
 * (prevents user enumeration).
 *
 * @param {object} input - { email }
 * @param {object} meta - { ip, userAgent }
 * @returns {void}
 */
const requestPasswordReset = async (input, meta = {}) => {
  const data = validateOrThrow(resetRequestSchema, input);

  const { User, PasswordResetToken } = db;

  const user = await User.findOne({ where: { email: data.email } });

  if (!user) {
    // Silently do nothing — don't reveal account existence
    logger.info('[AuthService] Password reset requested for unknown email', {
      email: data.email,
      ip: meta.ip,
    });
    return;
  }

  // Invalidate all existing unused tokens for this user
  await PasswordResetToken.update(
    { usedAt: new Date() },
    { where: { userId: user.id, usedAt: null } }
  );

  const { rawToken, hashedToken } = PasswordResetToken.generateToken();

  await PasswordResetToken.create({
    userId: user.id,
    tokenHash: hashedToken,
    expiresAt: new Date(Date.now() + config.passwordReset.tokenExpiresIn),
    requestedFromIp: meta.ip || null,
    requestedFromUserAgent: meta.userAgent || null,
  });

  logger.info('[AuthService] Password reset token created', { userId: user.id, ip: meta.ip });

  // Dispatch email job — token delivery is async
  await dispatch(QUEUE_NAMES.NOTIFICATION_EMAIL, JOB_NAMES.SEND_PASSWORD_RESET_EMAIL, {
    userId: user.id,
    email: user.email,
    firstName: user.firstName,
    rawToken, // Worker will construct the reset URL
    expiresAt: new Date(Date.now() + config.passwordReset.tokenExpiresIn),
  });

  await dispatch(QUEUE_NAMES.ACTIVITY_LOG, JOB_NAMES.LOG_ACTIVITY, {
    type: ACTIVITY_TYPE.PASSWORD_RESET_REQUESTED,
    actorId: user.id,
    metadata: { ip: meta.ip },
  }).catch(() => {});
};

/**
 * Consume a password reset token and set a new password.
 *
 * @param {object} input - { token: rawHexToken, newPassword }
 * @returns {void}
 */
const resetPassword = async (input) => {
  const data = validateOrThrow(resetPasswordSchema, input);

  const { User, PasswordResetToken } = db;

  const hashedToken = PasswordResetToken.hashToken(data.token);

  const tokenRecord = await PasswordResetToken.findOne({
    where: { tokenHash: hashedToken },
    include: [{ model: User, as: 'user', scope: 'withPassword' }],
  });

  if (!tokenRecord || !tokenRecord.isValid()) {
    throw new InvalidTokenError('Password reset token is invalid or has expired');
  }

  const user = tokenRecord.user;

  if (!user || !user.isActive()) {
    throw new InvalidTokenError('Associated account is not active');
  }

  // Update password (triggers beforeUpdate hook → bcrypt hash)
  await user.update({ passwordHash: data.newPassword });

  // Mark token as used (prevents replay)
  await tokenRecord.update({ usedAt: new Date() });

  logger.info('[AuthService] Password reset completed', { userId: user.id });

  await dispatch(QUEUE_NAMES.ACTIVITY_LOG, JOB_NAMES.LOG_ACTIVITY, {
    type: ACTIVITY_TYPE.PASSWORD_RESET_COMPLETED,
    actorId: user.id,
    metadata: {},
  }).catch(() => {});
};

module.exports = {
  register,
  login,
  refreshTokens,
  requestPasswordReset,
  resetPassword,
};