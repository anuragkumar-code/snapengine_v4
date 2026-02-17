'use strict';

const { Router } = require('express');
const authController = require('./auth.controller');
const { authRateLimiter, passwordResetLimiter } = require('../../shared/middleware/rateLimiter');

/**
 * Auth Routes
 * Base path: /api/v1/auth
 *
 * All auth routes use the strict authRateLimiter.
 * Password reset routes use an even stricter passwordResetLimiter.
 *
 * No authenticate middleware here — these are public endpoints.
 */

const router = Router();

// Apply auth rate limiter to all routes in this router
router.use(authRateLimiter);

// ── Registration ───────────────────────────────────────────────────────────
/**
 * @route   POST /api/v1/auth/register
 * @desc    Register with email or mobile + password
 * @access  Public
 * @body    { email?, mobile?, password, firstName, lastName }
 */
router.post('/register', authController.register);

// ── Login ──────────────────────────────────────────────────────────────────
/**
 * @route   POST /api/v1/auth/login
 * @desc    Login and receive access + refresh tokens
 * @access  Public
 * @body    { email?, mobile?, password }
 */
router.post('/login', authController.login);

// ── Token Refresh ──────────────────────────────────────────────────────────
/**
 * @route   POST /api/v1/auth/refresh
 * @desc    Exchange refresh token for new access + refresh token pair
 * @access  Public (requires valid refresh token in body)
 * @body    { refreshToken }
 */
router.post('/refresh', authController.refresh);

// ── Password Reset ─────────────────────────────────────────────────────────
/**
 * @route   POST /api/v1/auth/password-reset/request
 * @desc    Request password reset email (always returns 200)
 * @access  Public
 * @body    { email }
 */
router.post(
  '/password-reset/request',
  passwordResetLimiter,
  authController.requestPasswordReset
);

/**
 * @route   POST /api/v1/auth/password-reset/confirm
 * @desc    Confirm reset with token and set new password
 * @access  Public
 * @body    { token, newPassword }
 */
router.post(
  '/password-reset/confirm',
  passwordResetLimiter,
  authController.resetPassword
);

module.exports = router;