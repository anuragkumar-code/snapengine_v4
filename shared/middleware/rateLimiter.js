'use strict';

const rateLimit = require('express-rate-limit');
const config = require('../../config');
const logger = require('../../infrastructure/logger');

/**
 * Rate Limiter Middleware Factory
 *
 * Provides configurable rate limiters for different endpoint categories.
 * All limits are driven by config — no hardcoded values here.
 *
 * Available limiters:
 *  - authRateLimiter      → Login/register endpoints (stricter)
 *  - passwordResetLimiter → Password reset (very strict — abuse vector)
 *  - uploadRateLimiter    → File uploads (balanced for UX)
 */

const _buildLimiter = ({ windowMs, max, keyPrefix, message }) =>
  rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `${keyPrefix}:${req.ip}`,
    message: {
      success: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: message || 'Too many requests. Please try again later.',
      },
    },
    handler: (req, res, next, options) => {
      logger.warn('[RateLimit] Limit exceeded', {
        prefix: keyPrefix,
        ip: req.ip,
        path: req.path,
        limit: options.max,
        windowMs: options.windowMs,
      });
      res.status(429).json(options.message);
    },
    skip: (req) => {
      // Skip rate limiting for health checks
      return req.path === '/health' || req.path === '/api/health';
    },
  });

// Strict limiter for login/register — brute force protection
const authRateLimiter = _buildLimiter({
  windowMs: config.rateLimit.auth.windowMs,
  max: config.rateLimit.auth.max,
  keyPrefix: 'auth',
  message: 'Too many authentication attempts. Please try again in 15 minutes.',
});

// Very strict limiter for password reset — high abuse risk
const passwordResetLimiter = _buildLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  keyPrefix: 'pwd-reset',
  message: 'Too many password reset attempts. Please wait 1 hour.',
});

// Upload limiter — prevent storage abuse
const uploadRateLimiter = _buildLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 50,
  keyPrefix: 'upload',
  message: 'Upload limit reached. Maximum 50 uploads per hour.',
});

module.exports = {
  authRateLimiter,
  passwordResetLimiter,
  uploadRateLimiter,
};