'use strict';

const { AppError } = require('../utils/AppError');
const ResponseFormatter = require('../utils/ResponseFormatter');
const logger = require('../../infrastructure/logger');
const config = require('../../config');

/**
 * Global Error Handler Middleware
 *
 * This is the LAST middleware in the Express chain.
 * All errors bubble here via next(error) or uncaught async throws.
 *
 * Responsibilities:
 *  1. Translate framework/library errors (Sequelize, JWT, Multer) into AppError
 *  2. Log operational errors at warn level, programmer errors at error level
 *  3. Return consistent JSON error envelope
 *  4. Never expose stack traces or internal details in production
 */

// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, next) => {
  let error = err;

  // ── Translate known third-party errors ────────────────────────────────
  error = normalizeError(err);

  // ── Log ───────────────────────────────────────────────────────────────
  const logPayload = {
    statusCode: error.statusCode,
    code: error.code,
    method: req.method,
    url: req.originalUrl,
    userId: req.user?.id || null,
    ip: req.ip,
    requestId: req.id,
    ...(config.isDevelopment && { stack: error.stack }),
  };

  if (!error.isOperational) {
    // Programmer errors: bugs, unhandled cases — always error level
    logger.error(`[ErrorHandler] Programmer error: ${error.message}`, logPayload);
  } else if (error.statusCode >= 500) {
    logger.error(`[ErrorHandler] Server error: ${error.message}`, logPayload);
  } else if (error.statusCode >= 400) {
    logger.warn(`[ErrorHandler] Client error: ${error.message}`, logPayload);
  }

  // ── Build response ────────────────────────────────────────────────────
  const responseError = {
    statusCode: error.statusCode || 500,
    code: error.code || 'INTERNAL_ERROR',
    message: !error.isOperational && config.isProduction
      ? 'An unexpected error occurred. Please try again later.'
      : error.message,
    details: error.details || undefined,
    // Only expose stack in development, never in production
    ...(config.isDevelopment && !error.isOperational && { stack: error.stack }),
  };

  return ResponseFormatter.error(res, responseError);
};

/**
 * Translate library-specific errors into AppError instances.
 * Add new cases here as new libraries are introduced.
 */
const normalizeError = (err) => {
  // Already an AppError — pass through
  if (err instanceof AppError) return err;

  const { AppError: AE, ValidationError, InvalidTokenError, InternalError } = require('../utils/AppError');

  // ── Sequelize Errors ──────────────────────────────────────────────────
  if (err.name === 'SequelizeValidationError' || err.name === 'SequelizeUniqueConstraintError') {
    const details = (err.errors || []).map((e) => ({
      field: e.path,
      message: e.message,
      type: err.name === 'SequelizeUniqueConstraintError' ? 'unique' : 'validation',
    }));
    const { ValidationError: VE } = require('../utils/AppError');
    return new VE(
      err.name === 'SequelizeUniqueConstraintError'
        ? 'A record with this value already exists'
        : 'Database validation failed',
      details
    );
  }

  if (err.name === 'SequelizeForeignKeyConstraintError') {
    const { ValidationError: VE } = require('../utils/AppError');
    return new VE('Referenced record does not exist');
  }

  if (err.name === 'SequelizeConnectionError' || err.name === 'SequelizeConnectionRefusedError') {
    const { ServiceUnavailableError } = require('../utils/AppError');
    return new ServiceUnavailableError('Database');
  }

  if (err.name === 'SequelizeDatabaseError') {
    logger.error('[ErrorHandler] Raw database error', { message: err.message });
    return new InternalError('A database error occurred');
  }

  // ── JWT Errors ────────────────────────────────────────────────────────
  if (err.name === 'JsonWebTokenError') {
    return new InvalidTokenError('Invalid token');
  }

  if (err.name === 'TokenExpiredError') {
    const { TokenExpiredError: TEE } = require('../utils/AppError');
    return new TEE('Token has expired');
  }

  // ── Multer Errors ─────────────────────────────────────────────────────
  if (err.code === 'LIMIT_FILE_SIZE') {
    const { ValidationError: VE } = require('../utils/AppError');
    return new VE(`File size exceeds the allowed limit`);
  }

  if (err.code === 'INVALID_FILE_TYPE') {
    const { ValidationError: VE } = require('../utils/AppError');
    return new VE(err.message);
  }

  // ── Express body-parser Errors ────────────────────────────────────────
  if (err.type === 'entity.parse.failed') {
    const { ValidationError: VE } = require('../utils/AppError');
    return new VE('Invalid JSON in request body');
  }

  if (err.type === 'entity.too.large') {
    const { ValidationError: VE } = require('../utils/AppError');
    return new VE('Request body is too large');
  }

  // ── Unknown Error ─────────────────────────────────────────────────────
  return new InternalError(err.message || 'An unexpected error occurred');
};

module.exports = { errorHandler, normalizeError };