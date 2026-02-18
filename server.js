'use strict';

/**
 * Server Entry Point
 *
 * Startup sequence (ORDER MATTERS):
 *  1. Initialize logger (no async — must work immediately)
 *  2. Connect to PostgreSQL (fail fast if unavailable)
 *  3. Sync models in development (migrations in production)
 *  4. Connect to Redis
 *  5. Initialize queues
 *  6. Register queue workers
 *  7. Start HTTP server
 *
 * Shutdown sequence (SIGTERM / SIGINT):
 *  1. Stop accepting new HTTP connections
 *  2. Drain in-flight requests (30s grace period)
 *  3. Shut down queue workers (finish current jobs)
 *  4. Disconnect Redis
 *  5. Close DB connection pool
 *  6. Exit cleanly
 */

const config = require('./config');
const logger = require('./infrastructure/logger');

// ── Unhandled Exception Safety Net ───────────────────────────────────────
// These fire for PROGRAMMER errors (bugs). Always log + exit.
process.on('uncaughtException', (err) => {
  logger.error('[Server] UNCAUGHT EXCEPTION — shutting down', {
    error: err.message,
    stack: err.stack,
  });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error('[Server] UNHANDLED REJECTION — shutting down', {
    reason: reason instanceof Error ? reason.message : reason,
    stack: reason instanceof Error ? reason.stack : undefined,
  });
  process.exit(1);
});

// ── Bootstrap ─────────────────────────────────────────────────────────────
const bootstrap = async () => {
  logger.info('[Server] Starting Album Platform', {
    env: config.env,
    port: config.server.port,
    nodeVersion: process.version,
  });

  // ── 1. Database ──────────────────────────────────────────────────────
  const db = require('./infrastructure/database');
  await db.testConnection();

  // Development: sync models (create tables if missing)
  // Production: always use migrations — never sync
  if (config.isDevelopment) {
    await db.sequelize.sync({ alter: false });
    logger.info('[Server] Database models synchronized (development mode)');
  }

  // ── 2. Redis ─────────────────────────────────────────────────────────
  const redis = require('./infrastructure/redis');
  await redis.connect();

  // ── 3. Queues ─────────────────────────────────────────────────────────
  const queueSystem = require('./infrastructure/queue');
  queueSystem.initQueues();

  // ── 4. Register Workers ───────────────────────────────────────────────
  // Workers are registered here so they start consuming immediately.
  // Each processor is a thin wrapper calling the appropriate service.
  const { QUEUE_NAMES } = queueSystem;

  queueSystem.registerWorker(
    QUEUE_NAMES.ACTIVITY_LOG,
    async (job) => {
      const { processActivityLog } = require('./modules/album/workers/activityLogWorker');
      return processActivityLog(job);
    },
    { concurrency: 10 }
  );

  queueSystem.registerWorker(
    QUEUE_NAMES.NOTIFICATION_EMAIL,
    async (job) => {
      logger.debug('[Worker:Email] Processing job', { jobName: job.name });
      // Full email implementation added in Phase 2
      // Placeholder: job.data contains { userId, email, firstName, rawToken }
    },
    { concurrency: 3 }
  );

  queueSystem.registerWorker(
    QUEUE_NAMES.PHOTO_PROCESSING,
    async (job) => {
      const { processPhoto } = require('./modules/media/workers/photoProcessor');
      return processPhoto(job);
    },
    { concurrency: 2 } // Lower concurrency — CPU-intensive image ops
  );

  // ── 5. HTTP Server ────────────────────────────────────────────────────
  const app = require('./app');
  const http = require('http');
  const server = http.createServer(app);

  await new Promise((resolve, reject) => {
    server.listen(config.server.port, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });

  logger.info('[Server] HTTP server listening', {
    port: config.server.port,
    apiBase: `/api/${config.server.apiVersion}`,
    environment: config.env,
  });

  // ── Graceful Shutdown ─────────────────────────────────────────────────
  const shutdown = async (signal) => {
    logger.info(`[Server] ${signal} received — starting graceful shutdown`);

    // Phase 1: Stop accepting new connections
    server.close(async () => {
      logger.info('[Server] HTTP server closed. Draining remaining operations...');

      try {
        await queueSystem.shutdown();
        await redis.disconnect();
        await db.close();
        logger.info('[Server] Graceful shutdown complete');
        process.exit(0);
      } catch (err) {
        logger.error('[Server] Error during shutdown', { error: err.message });
        process.exit(1);
      }
    });

    // Force exit if graceful shutdown takes too long
    setTimeout(() => {
      logger.error('[Server] Forced shutdown after 30s grace period');
      process.exit(1);
    }, 30_000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  return server;
};

// ── Run ───────────────────────────────────────────────────────────────────
bootstrap().catch((err) => {
  logger.error('[Server] Bootstrap failed', {
    error: err.message,
    stack: err.stack,
  });
  process.exit(1);
});