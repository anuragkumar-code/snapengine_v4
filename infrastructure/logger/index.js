'use strict';

const { createLogger, format, transports } = require('winston');
require('winston-daily-rotate-file');
const path = require('path');
const util = require('util');
const config = require('../../config');

const {
  combine,
  timestamp,
  errors,
  json,
  colorize,
  printf,
  metadata,
} = format;

/**
 * Logger Infrastructure
 *
 * - Development: clean, colorized, human-readable
 * - Production: structured JSON
 *
 * Design goals:
 *  - Never crash on circular structures
 *  - Never leak internal Winston symbols
 *  - Keep metadata readable but controlled
 */

// ───────────────────────────────────────────────────────────────────────────
// Development Format (clean + circular-safe + no symbol leakage)
// ───────────────────────────────────────────────────────────────────────────
const devFormat = combine(
  colorize({ all: true }),
  timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  errors({ stack: true }),
  printf((info) => {
    const { timestamp, level, message, stack } = info;

    // Extract only enumerable string keys (ignore Symbols)
    const meta = {};
    for (const key of Object.keys(info)) {
      if (!['timestamp', 'level', 'message', 'stack'].includes(key)) {
        meta[key] = info[key];
      }
    }

    let metaStr = '';

    if (Object.keys(meta).length > 0) {
      metaStr =
        '\n  ' +
        util.inspect(meta, {
          depth: 3,          // prevent deep ORM explosions
          colors: true,
          compact: false,
          breakLength: 120,
        });
    }

    return `[${timestamp}] ${level}: ${message}${
      stack ? `\n${stack}` : ''
    }${metaStr}`;
  })
);

// ───────────────────────────────────────────────────────────────────────────
// Production Format (structured JSON, log-aggregator friendly)
// ───────────────────────────────────────────────────────────────────────────
const prodFormat = combine(
  timestamp(),
  errors({ stack: true }),
  metadata({ fillExcept: ['message', 'level', 'timestamp', 'stack'] }),
  json()
);

// ───────────────────────────────────────────────────────────────────────────
// Console Transport
// ───────────────────────────────────────────────────────────────────────────
const consoleTransport = new transports.Console({
  format: config.isProduction ? prodFormat : devFormat,
  silent: config.env === 'test',
});

// ───────────────────────────────────────────────────────────────────────────
// Rotating File Transports
// ───────────────────────────────────────────────────────────────────────────
const combinedFileTransport = new transports.DailyRotateFile({
  dirname: config.logging.dir,
  filename: 'combined-%DATE%.log',
  datePattern: 'YYYY-MM-DD',
  maxSize: config.logging.maxSize,
  maxFiles: config.logging.maxFiles,
  format: prodFormat,
  auditFile: path.join(config.logging.dir, '.audit-combined.json'),
});

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

const activityFileTransport = new transports.DailyRotateFile({
  dirname: path.join(config.logging.dir, 'activity'),
  filename: 'activity-%DATE%.log',
  datePattern: 'YYYY-MM-DD',
  maxSize: config.logging.maxSize,
  maxFiles: config.logging.maxFiles,
  format: prodFormat,
  auditFile: path.join(config.logging.dir, '.audit-activity.json'),
});

// ───────────────────────────────────────────────────────────────────────────
// Root Logger
// ───────────────────────────────────────────────────────────────────────────
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
  exitOnError: false,
});

// ───────────────────────────────────────────────────────────────────────────
// Activity Child Logger
// ───────────────────────────────────────────────────────────────────────────
logger.activity = logger.child({ context: 'activity' });
logger.activity.add(activityFileTransport);

// ───────────────────────────────────────────────────────────────────────────
// HTTP Request Helper
// ───────────────────────────────────────────────────────────────────────────
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
