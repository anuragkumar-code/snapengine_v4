'use strict';

/**
 * Application Error Hierarchy
 *
 * All thrown errors in the service layer should use one of these classes.
 * The global error handler reads .statusCode and .code to build responses.
 *
 * Rules:
 *  - Never throw raw Error() from service layer.
 *  - Never throw AppError from controllers (controllers don't have business logic).
 *  - isOperational: true means "safe to expose to client" (not a programming bug).
 */

class AppError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR', isOperational = true) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = isOperational;
    Error.captureStackTrace(this, this.constructor);
  }
}

// ── 400 Bad Request ────────────────────────────────────────────────────────
class ValidationError extends AppError {
  constructor(message, details = null) {
    super(message, 400, 'VALIDATION_ERROR');
    this.details = details; // Joi validation details array
  }
}

// ── 401 Unauthorized ───────────────────────────────────────────────────────
class AuthenticationError extends AppError {
  constructor(message = 'Authentication required') {
    super(message, 401, 'AUTHENTICATION_REQUIRED');
  }
}

class InvalidCredentialsError extends AppError {
  constructor(message = 'Invalid credentials') {
    super(message, 401, 'INVALID_CREDENTIALS');
  }
}

class TokenExpiredError extends AppError {
  constructor(message = 'Token has expired') {
    super(message, 401, 'TOKEN_EXPIRED');
  }
}

class InvalidTokenError extends AppError {
  constructor(message = 'Invalid or malformed token') {
    super(message, 401, 'INVALID_TOKEN');
  }
}

// ── 403 Forbidden ─────────────────────────────────────────────────────────
class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to perform this action') {
    super(message, 403, 'FORBIDDEN');
  }
}

// ── 404 Not Found ─────────────────────────────────────────────────────────
class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(`${resource} not found`, 404, 'NOT_FOUND');
    this.resource = resource;
  }
}

// ── 409 Conflict ──────────────────────────────────────────────────────────
class ConflictError extends AppError {
  constructor(message) {
    super(message, 409, 'CONFLICT');
  }
}

// ── 410 Gone ──────────────────────────────────────────────────────────────
class GoneError extends AppError {
  constructor(message = 'This resource is no longer available') {
    super(message, 410, 'GONE');
  }
}

// ── 422 Unprocessable Entity ──────────────────────────────────────────────
class UnprocessableError extends AppError {
  constructor(message) {
    super(message, 422, 'UNPROCESSABLE');
  }
}

// ── 429 Too Many Requests ─────────────────────────────────────────────────
class RateLimitError extends AppError {
  constructor(message = 'Too many requests') {
    super(message, 429, 'RATE_LIMIT_EXCEEDED');
  }
}

// ── 500 Internal Server Error ─────────────────────────────────────────────
class InternalError extends AppError {
  constructor(message = 'An unexpected error occurred') {
    super(message, 500, 'INTERNAL_ERROR', false);
  }
}

// ── 503 Service Unavailable ───────────────────────────────────────────────
class ServiceUnavailableError extends AppError {
  constructor(service = 'Service') {
    super(`${service} is currently unavailable`, 503, 'SERVICE_UNAVAILABLE');
  }
}

module.exports = {
  AppError,
  ValidationError,
  AuthenticationError,
  InvalidCredentialsError,
  TokenExpiredError,
  InvalidTokenError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  GoneError,
  UnprocessableError,
  RateLimitError,
  InternalError,
  ServiceUnavailableError,
};