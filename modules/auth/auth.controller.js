'use strict';

const authService = require('./service/auth.service');
const ResponseFormatter = require('../../shared/utils/ResponseFormatter');

/**
 * Auth Controller
 *
 * HTTP layer only — no business logic here.
 * Responsibilities:
 *  1. Extract data from req (body, headers, ip)
 *  2. Call service
 *  3. Format and return response via ResponseFormatter
 *  4. Pass errors to next() for global error handler
 *
 * All try/catch blocks follow the same pattern.
 * Async errors are caught by asyncWrapper (wired in routes).
 */

/**
 * POST /api/v1/auth/register
 */
const register = async (req, res, next) => {
  try {
    const result = await authService.register(req.body, req.ip);
    return ResponseFormatter.created(res, result, 'Account created successfully');
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/auth/login
 */
const login = async (req, res, next) => {
  try {
    const result = await authService.login(req.body, req.ip);
    return ResponseFormatter.success(res, result, 200, 'Login successful');
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/auth/refresh
 * Body: { refreshToken: string }
 */
const refresh = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    const tokens = await authService.refreshTokens(refreshToken);
    return ResponseFormatter.success(res, tokens, 200, 'Tokens refreshed');
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/auth/password-reset/request
 * Body: { email: string }
 *
 * Always returns 200 — never reveals whether email exists.
 */
const requestPasswordReset = async (req, res, next) => {
  try {
    await authService.requestPasswordReset(req.body, {
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });
    return ResponseFormatter.success(
      res,
      null,
      200,
      'If an account with that email exists, a reset link has been sent.'
    );
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/auth/password-reset/confirm
 * Body: { token: string, newPassword: string }
 */
const resetPassword = async (req, res, next) => {
  try {
    await authService.resetPassword(req.body);
    return ResponseFormatter.success(res, null, 200, 'Password has been reset successfully');
  } catch (err) {
    next(err);
  }
};

module.exports = {
  register,
  login,
  refresh,
  requestPasswordReset,
  resetPassword,
};