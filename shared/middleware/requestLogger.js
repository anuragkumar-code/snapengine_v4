'use strict';

const { v4: uuidv4 } = require('uuid');
const logger = require('../../infrastructure/logger');
const { NotFoundError } = require('../utils/AppError');

/**
 * Request Logger Middleware
 *
 * Attaches a unique X-Request-ID to every request.
 * Logs structured request/response pairs.
 * Excludes health check endpoint from logs to prevent noise.
 */
const requestLogger = (req, res, next) => {
  // Attach request ID (use client-provided one if present, else generate)
  const requestId = req.headers['x-request-id'] || uuidv4();
  req.id = requestId;
  res.setHeader('X-Request-ID', requestId);

  // Don't log health checks — would flood logs in production
  if (req.path === '/health' || req.path === '/api/health') {
    return next();
  }

  const startTime = Date.now();

  // Log when response finishes
  res.on('finish', () => {
    const responseTime = Date.now() - startTime;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';

    logger[level]('HTTP', {
      requestId,
      method: req.method,
      url: req.originalUrl,
      statusCode: res.statusCode,
      responseTimeMs: responseTime,
      ip: req.ip,
      userAgent: req.get('user-agent'),
      userId: req.user?.id || null,
      contentLength: res.get('content-length') || null,
    });
  });

  next();
};

/**
 * 404 Not Found handler.
 * Catches all unmatched routes and returns a consistent JSON error.
 */
const notFoundHandler = (req, res, next) => {
  next(new NotFoundError(`Route "${req.method} ${req.originalUrl}" not found`));
};

module.exports = { requestLogger, notFoundHandler };