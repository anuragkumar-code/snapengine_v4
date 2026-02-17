'use strict';

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const config = require('../../config');
const logger = require('../logger');
const { errorHandler } = require('../../shared/middleware/errorHandler');
const { notFoundHandler } = require('../../shared/middleware/notFoundHandler');
const { requestLogger } = require('../../shared/middleware/requestLogger');

/**
 * HTTP Infrastructure — Express App Factory
 *
 * Returns a fully configured Express application.
 * Routes are mounted externally (in app.js) after this factory returns.
 *
 * Middleware stack order (matters):
 *  1. Security headers (helmet)
 *  2. CORS
 *  3. Global rate limiter
 *  4. Body parsers
 *  5. Request logger
 *  6. Routes (mounted in app.js)
 *  7. 404 handler
 *  8. Global error handler
 */

const createExpressApp = () => {
  const app = express();

  // ── Trust Proxy ──────────────────────────────────────────────────────────
  // Required when behind Nginx/load balancer to get correct req.ip
  app.set('trust proxy', config.isProduction ? 1 : false);

  // ── Security Headers (Helmet) ────────────────────────────────────────────
  app.use(
    helmet({
      contentSecurityPolicy: config.isProduction,
      crossOriginEmbedderPolicy: false, // Needed for some API consumers
      hsts: config.isProduction
        ? {
            maxAge: 31536000,         // 1 year
            includeSubDomains: true,
            preload: true,
          }
        : false,
    })
  );

  // ── CORS ─────────────────────────────────────────────────────────────────
  app.use(
    cors({
      origin: (origin, callback) => {
        // Allow requests with no origin (e.g. mobile apps, curl, Postman)
        if (!origin) return callback(null, true);
        if (config.cors.origin.includes(origin) || config.cors.origin.includes('*')) {
          return callback(null, true);
        }
        callback(new Error(`CORS: Origin "${origin}" not allowed`));
      },
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
      exposedHeaders: ['X-Request-ID', 'X-RateLimit-Remaining'],
      credentials: true,
      maxAge: 86400, // Pre-flight cache: 24h
    })
  );

  // ── Global Rate Limiter ──────────────────────────────────────────────────
  app.use(
    rateLimit({
      windowMs: config.rateLimit.global.windowMs,
      max: config.rateLimit.global.max,
      standardHeaders: true,   // Return RateLimit-* headers
      legacyHeaders: false,    // Disable X-RateLimit-* headers
      message: {
        success: false,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many requests. Please try again later.',
        },
      },
      handler: (req, res, next, options) => {
        logger.warn('[RateLimit] Global limit exceeded', {
          ip: req.ip,
          path: req.path,
          limit: options.max,
        });
        res.status(429).json(options.message);
      },
    })
  );

  // ── Body Parsers ─────────────────────────────────────────────────────────
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // ── Request Logger ───────────────────────────────────────────────────────
  app.use(requestLogger);

  // ── Static File Serving (local uploads) ──────────────────────────────────
  if (config.upload.provider === 'local') {
    const path = require('path');
    app.use(
      '/uploads',
      express.static(path.resolve(config.upload.local.basePath), {
        maxAge: '1d',
        etag: true,
        lastModified: true,
      })
    );
  }

  return app;
};

/**
 * Attach the terminal middleware (404 + error handler).
 * Called after all routes are mounted.
 */
const attachTerminalMiddleware = (app) => {
  app.use(notFoundHandler);
  app.use(errorHandler);
};

module.exports = { createExpressApp, attachTerminalMiddleware };