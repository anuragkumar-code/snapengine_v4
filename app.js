'use strict';

const { createExpressApp, attachTerminalMiddleware } = require('./infrastructure/http');
const config = require('./config');
const logger = require('./infrastructure/logger');
const db = require('./infrastructure/database');
const queue = require('./infrastructure/queue');
const ResponseFormatter = require('./shared/utils/ResponseFormatter');

/**
 * Application Assembly
 *
 * This module:
 *  1. Creates the Express app with base middleware
 *  2. Mounts the health check endpoint
 *  3. Mounts all versioned module routes
 *  4. Attaches terminal middleware (404 + error handler)
 *
 * server.js handles infrastructure bootstrapping (DB, Redis, Queue).
 * app.js is kept pure Express — no async startup logic here.
 */

const app = createExpressApp();

// ── API Prefix ────────────────────────────────────────────────────────────
const API_PREFIX = `/api/${config.server.apiVersion}`;

// ── Health Check ───────────────────────────────────────────────────────────
/**
 * @route   GET /health
 * @desc    System health check — used by load balancers and monitoring
 * @access  Public
 */
app.get('/health', async (req, res) => {
  try {
    const { getHealthStatus } = require('./infrastructure/queue');
    const { ping } = require('./infrastructure/redis');

    const [redisOk, queueStatus] = await Promise.allSettled([
      ping(),
      getHealthStatus(),
    ]);

    // DB check: if models loaded, the connection was tested at startup
    const dbOk = !!db.sequelize;

    const health = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      environment: config.env,
      version: process.env.npm_package_version || '1.0.0',
      services: {
        database: {
          status: dbOk ? 'ok' : 'error',
        },
        redis: {
          status: redisOk.status === 'fulfilled' && redisOk.value ? 'ok' : 'error',
        },
        queues: {
          status: queueStatus.status === 'fulfilled' ? 'ok' : 'error',
          detail: queueStatus.status === 'fulfilled' ? queueStatus.value : null,
        },
      },
    };

    const allHealthy = dbOk &&
      health.services.redis.status === 'ok';

    return res.status(allHealthy ? 200 : 503).json(health);
  } catch (err) {
    logger.error('[Health] Health check error', { error: err.message });
    return res.status(503).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      message: 'Health check failed',
    });
  }
});

// ── Module Routes ──────────────────────────────────────────────────────────

// Auth Module
const authRoutes = require('./modules/auth/auth.routes');
app.use(`${API_PREFIX}/auth`, authRoutes);

// User Module
const userRoutes = require('./modules/user/user.routes');
app.use(`${API_PREFIX}/users`, userRoutes);

// Album Module (Phase 2)
const albumRoutes = require('./modules/album/album.routes');
app.use(`${API_PREFIX}/albums`, albumRoutes);

// Invitation token actions (standalone — not nested under /albums)
app.use(`${API_PREFIX}/invitations`, albumRoutes);

// Media Module (Phase 3)
// Photos are scoped under albums; standalone photo/tag/comment routes also available
const mediaRoutes = require('./modules/media/media.routes');
app.use(`${API_PREFIX}/albums`, mediaRoutes); // Scoped: /albums/:albumId/photos
app.use(`${API_PREFIX}`, mediaRoutes);          // Standalone: /photos/:photoId, /tags, /comments

// Phase 3: Media module routes will be added here
// const photoRoutes = require('./modules/media/photo.routes');
// app.use(`${API_PREFIX}/photos`, photoRoutes);

// ── Terminal Middleware ────────────────────────────────────────────────────
// Must be attached AFTER all routes
attachTerminalMiddleware(app);

module.exports = app;