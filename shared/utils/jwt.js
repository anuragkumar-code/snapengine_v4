'use strict';

const jwt = require('jsonwebtoken');
const config = require('../../config');
const {
  TokenExpiredError,
  InvalidTokenError,
} = require('./AppError');

/**
 * JWT Utility
 *
 * Two-token strategy:
 *  - Access Token  : Short-lived (15m), used for API authorization
 *  - Refresh Token : Long-lived (7d), used only on /auth/refresh endpoint
 *
 * Tokens embed minimal claims (sub + role only).
 * Full user data is fetched from DB on each request via the auth middleware.
 * This ensures revocation (e.g. password change) invalidates old tokens.
 *
 * Token payload shape:
 *   { sub: userId, role: 'user', type: 'access' | 'refresh' }
 */

const TokenType = Object.freeze({
  ACCESS: 'access',
  REFRESH: 'refresh',
});

/**
 * Sign an access token.
 * @param {string} userId - UUID
 * @param {string} role - User role (e.g. 'user', 'admin')
 * @returns {string} Signed JWT
 */
const signAccessToken = (userId, role = 'user') => {
  return jwt.sign(
    { sub: userId, role, type: TokenType.ACCESS },
    config.jwt.secret,
    {
      expiresIn: config.jwt.expiresIn,
      issuer: 'album-platform',
      audience: 'album-platform-client',
    }
  );
};

/**
 * Sign a refresh token.
 * @param {string} userId
 * @returns {string} Signed JWT
 */
const signRefreshToken = (userId) => {
  return jwt.sign(
    { sub: userId, type: TokenType.REFRESH },
    config.jwt.refreshSecret,
    {
      expiresIn: config.jwt.refreshExpiresIn,
      issuer: 'album-platform',
      audience: 'album-platform-client',
    }
  );
};

/**
 * Verify an access token.
 * Throws TokenExpiredError or InvalidTokenError (never raw jwt errors).
 * @param {string} token
 * @returns {{ sub: string, role: string, type: string, iat: number, exp: number }}
 */
const verifyAccessToken = (token) => {
  try {
    const payload = jwt.verify(token, config.jwt.secret, {
      issuer: 'album-platform',
      audience: 'album-platform-client',
    });

    if (payload.type !== TokenType.ACCESS) {
      throw new InvalidTokenError('Token type mismatch. Access token required.');
    }

    return payload;
  } catch (err) {
    if (err instanceof InvalidTokenError) throw err;
    if (err.name === 'TokenExpiredError') {
      throw new TokenExpiredError('Access token has expired. Please refresh.');
    }
    throw new InvalidTokenError(`Invalid access token: ${err.message}`);
  }
};

/**
 * Verify a refresh token.
 * @param {string} token
 * @returns {{ sub: string, type: string, iat: number, exp: number }}
 */
const verifyRefreshToken = (token) => {
  try {
    const payload = jwt.verify(token, config.jwt.refreshSecret, {
      issuer: 'album-platform',
      audience: 'album-platform-client',
    });

    if (payload.type !== TokenType.REFRESH) {
      throw new InvalidTokenError('Token type mismatch. Refresh token required.');
    }

    return payload;
  } catch (err) {
    if (err instanceof InvalidTokenError) throw err;
    if (err.name === 'TokenExpiredError') {
      throw new TokenExpiredError('Refresh token has expired. Please log in again.');
    }
    throw new InvalidTokenError(`Invalid refresh token: ${err.message}`);
  }
};

/**
 * Issue a fresh access + refresh token pair.
 * @param {string} userId
 * @param {string} role
 * @returns {{ accessToken: string, refreshToken: string }}
 */
const issueTokenPair = (userId, role = 'user') => {
  return {
    accessToken: signAccessToken(userId, role),
    refreshToken: signRefreshToken(userId),
  };
};

/**
 * Extract token from Authorization header.
 * Supports: "Bearer <token>"
 * @param {string} authHeader - req.headers.authorization
 * @returns {string|null}
 */
const extractBearerToken = (authHeader) => {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.split(' ')[1];
  return token && token.length > 0 ? token : null;
};

module.exports = {
  TokenType,
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  issueTokenPair,
  extractBearerToken,
};