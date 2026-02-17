'use strict';

const { createLogger, format, transports } = require('winston');
require('winston-daily-rotate-file');
const path = require('path');
const config = require('../../config');

const { combine, timestamp, errors, json, colorize, printf, metadata } = format;

/**
 * Logger Infrastructure
 *
 * Outputs structured JSON in production (machine-readable for log aggregators).
 * Outputs colorized, human-readable lines in development.
 *
 * All log calls accept an optional metadata object as the second argument:
 *   logger.info('User registered', { userId, email });
 *   logger.error('DB connection failed', { error, retryCount });
 *
 * Domain events and activity logs are routed to the 'activity' child logger.
 */

// ── Format: Development (human-readable) ──────────────────────────────────
const devFormat = combine(
  colorize({ all: true }),
  timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  errors({ stack: true }),
  printf(({ timestamp, level, message, stack, ...meta }) => {
    const metaStr = Object.keys(meta).length ? `\n  ${JSON.stringify(meta, null, 2)}` : '';
    return `[${timestamp}] ${level}: ${message}${stack ? `\n${stack}` : ''}${metaStr}`;
  })
);

// ── Format: Production (structured JSON) ──────────────────────────────────
const prodFormat = combine(
  timestamp(),
  errors({ stack: true }),
  metadata({ fillExcept: ['message', 'level', 'timestamp', 'stack'] }),
  json()
);

// ── Transport: Console ─────────────────────────────────────────────────────
const consoleTransport = new transports.Console({
  format: config.isProduction ? prodFormat : devFormat,
  silent: config.env === 'test',
});

// ── Transport: Rotating file (all levels) ─────────────────────────────────
const combinedFileTransport = new transports.DailyRotateFile({
  dirname: config.logging.dir,
  filename: 'combined-%DATE%.log',
  datePattern: 'YYYY-MM-DD',
  maxSize: config.logging.maxSize,
  maxFiles: config.logging.maxFiles,
  format: prodFormat,
  auditFile: path.join(config.logging.dir, '.audit-combined.json'),
});

// ── Transport: Rotating file (errors only) ────────────────────────────────
const errorFileTransport = new transports.DailyRotateFile({
  dirname: config.logging.dir,
  filename: 'error-%DATE%.log',
  datePattern: 'YYYY-MM-DD',
  level: 'error',
  maxSize: config.logging.maxSize,
  maxFiles: config.logging.maxFiles,
  format: prodFormat,
  auditFile: path.join(config.logging.dir, '.audit-error.json'),
});

// ── Transport: Activity log (domain events only) ──────────────────────────
const activityFileTransport = new transports.DailyRotateFile({
  dirname: path.join(config.logging.dir, 'activity'),
  filename: 'activity-%DATE%.log',
  datePattern: 'YYYY-MM-DD',
  maxSize: config.logging.maxSize,
  maxFiles: config.logging.maxFiles,
  format: prodFormat,
  auditFile: path.join(config.logging.dir, '.audit-activity.json'),
});

// ── Root logger ───────────────────────────────────────────────────────────
const logger = createLogger({
  level: config.logging.level,
  defaultMeta: {
    service: 'album-platform',
    env: config.env,
  },
  transports: [
    consoleTransport,
    combinedFileTransport,
    errorFileTransport,
  ],
  // Do not crash process on uncaught exception in logger itself
  exitOnError: false,
});

// ── Activity child logger (for domain event audit trails) ─────────────────
logger.activity = logger.child({ context: 'activity' });
logger.activity.add(activityFileTransport);

// ── HTTP request logger helper ────────────────────────────────────────────
/**
 * Use in Morgan or custom request logging middleware.
 * Produces a single structured log line per request.
 */
logger.httpRequest = (req, res, responseTime) => {
  logger.info('HTTP Request', {
    method: req.method,
    url: req.originalUrl,
    statusCode: res.statusCode,
    responseTimeMs: responseTime,
    ip: req.ip,
    userAgent: req.get('user-agent'),
    userId: req.user?.id || null,
  });
};

module.exports = logger;