'use strict';

const { verifyAccessToken, extractBearerToken } = require('../utils/jwt');
const { AuthenticationError, ForbiddenError } = require('../utils/AppError');
const logger = require('../../infrastructure/logger');

/**
 * Authentication Middleware
 *
 * authenticate    → Required auth. Blocks unauthenticated requests.
 * optionalAuth    → Attaches user if token present, proceeds regardless.
 * requireRole     → Gate by system-level user role ('admin', 'user').
 *
 * On success, attaches to req:
 *   req.user = { id: uuid, role: string }
 *
 * Full user data is NOT fetched here on purpose.
 * Services that need full user data call the DB themselves.
 * This keeps the middleware fast and prevents over-fetching.
 *
 * Pattern:
 *   router.get('/admin/...', authenticate, requireRole('admin'), controller.handler);
 */

/**
 * Require a valid access token. Blocks if missing or invalid.
 */
const authenticate = (req, res, next) => {
  try {
    const token = extractBearerToken(req.headers.authorization);

    if (!token) {
      throw new AuthenticationError('Authentication token is required');
    }

    const payload = verifyAccessToken(token);

    // Attach minimal identity to request — services fetch full data if needed
    req.user = {
      id: payload.sub,
      role: payload.role,
    };

    logger.debug('[Auth] Request authenticated', {
      userId: req.user.id,
      path: req.path,
      method: req.method,
    });

    next();
  } catch (err) {
    next(err);
  }
};

/**
 * Attach user if token is present, but don't block if missing.
 * Used for endpoints accessible to both guests and authenticated users.
 */
const optionalAuth = (req, res, next) => {
  try {
    const token = extractBearerToken(req.headers.authorization);

    if (token) {
      const payload = verifyAccessToken(token);
      req.user = {
        id: payload.sub,
        role: payload.role,
      };
    } else {
      req.user = null;
    }

    next();
  } catch (err) {
    // Invalid token on optional auth → proceed as unauthenticated
    req.user = null;
    next();
  }
};

/**
 * Require a specific system role. Must be used AFTER authenticate.
 * @param {...string} roles - Allowed roles (e.g. 'admin')
 */
const requireRole = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return next(new AuthenticationError('Authentication required'));
    }

    if (!roles.includes(req.user.role)) {
      logger.warn('[Auth] Role access denied', {
        userId: req.user.id,
        userRole: req.user.role,
        requiredRoles: roles,
        path: req.path,
      });
      return next(
        new ForbiddenError(
          `Access denied. Required role: ${roles.join(' or ')}`
        )
      );
    }

    next();
  };
};

module.exports = { authenticate, optionalAuth, requireRole };