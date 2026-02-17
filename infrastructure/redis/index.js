'use strict';

const { createClient } = require('redis');
const config = require('../../config');
const logger = require('../logger');

/**
 * Redis Infrastructure
 *
 * Provides two clients:
 *  - redisClient    → General purpose: caching, session data, rate limiting state
 *  - subscriberClient → Dedicated pub/sub subscriber (Redis requires separate connections)
 *
 * BullMQ creates its own Redis connections via the shared connectionOptions,
 * so queue workers do not consume slots from these clients.
 *
 * All Redis keys are automatically prefixed with config.redis.keyPrefix
 * to avoid collision between environments sharing a Redis instance.
 */

const connectionOptions = {
  socket: {
    host: config.redis.host,
    port: config.redis.port,
    // Reconnect with exponential backoff, max 30s
    reconnectStrategy: (retries) => {
      if (retries > 10) {
        logger.error('[Redis] Max reconnection attempts reached. Giving up.');
        return new Error('Redis max retries exceeded');
      }
      const delay = Math.min(retries * 500, 30000);
      logger.warn(`[Redis] Reconnecting in ${delay}ms (attempt ${retries})`);
      return delay;
    },
  },
  ...(config.redis.password && { password: config.redis.password }),
  database: config.redis.db,
};

// ── General Client ─────────────────────────────────────────────────────────
const redisClient = createClient({
  ...connectionOptions,
  name: 'album-platform-general',
});

redisClient.on('connect', () => logger.info('[Redis] Client connecting...'));
redisClient.on('ready', () => logger.info('[Redis] Client ready'));
redisClient.on('error', (err) => logger.error('[Redis] Client error', { error: err.message }));
redisClient.on('reconnecting', () => logger.warn('[Redis] Client reconnecting'));
redisClient.on('end', () => logger.info('[Redis] Client disconnected'));

// ── Subscriber Client (for pub/sub) ───────────────────────────────────────
const subscriberClient = createClient({
  ...connectionOptions,
  name: 'album-platform-subscriber',
});

subscriberClient.on('error', (err) =>
  logger.error('[Redis] Subscriber error', { error: err.message })
);

// ── BullMQ Connection Options (exported for queue setup) ──────────────────
/**
 * BullMQ manages its own pool of Redis connections internally.
 * We export raw connection params so each Queue/Worker creates its own.
 * Never pass an existing Redis client to BullMQ — it requires ioredis style.
 */
const bullMQConnection = {
  host: config.redis.host,
  port: config.redis.port,
  ...(config.redis.password && { password: config.redis.password }),
  db: config.redis.db,
};

// ── Key Helpers ────────────────────────────────────────────────────────────
/**
 * Namespace a key with the global prefix.
 * Usage: redisKey('user:session', userId) → 'album:user:session:uuid'
 */
const redisKey = (...parts) => `${config.redis.keyPrefix}${parts.join(':')}`;

// ── Connection Lifecycle ───────────────────────────────────────────────────
const connect = async () => {
  await redisClient.connect();
  logger.info('[Redis] General client connected', {
    host: config.redis.host,
    port: config.redis.port,
    db: config.redis.db,
  });
};

const connectSubscriber = async () => {
  await subscriberClient.connect();
  logger.info('[Redis] Subscriber client connected');
};

const disconnect = async () => {
  await redisClient.quit();
  await subscriberClient.quit();
  logger.info('[Redis] All clients disconnected');
};

// ── Health Check ───────────────────────────────────────────────────────────
const ping = async () => {
  const result = await redisClient.ping();
  return result === 'PONG';
};

// ── Cache Helpers ──────────────────────────────────────────────────────────
/**
 * get / set with automatic JSON serialization.
 * ttlSeconds defaults to 5 minutes.
 */
const cacheGet = async (key) => {
  const data = await redisClient.get(key);
  if (!data) return null;
  try {
    return JSON.parse(data);
  } catch {
    return data;
  }
};

const cacheSet = async (key, value, ttlSeconds = 300) => {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  await redisClient.set(key, serialized, { EX: ttlSeconds });
};

const cacheDel = async (key) => {
  await redisClient.del(key);
};

const cacheDelPattern = async (pattern) => {
  const keys = await redisClient.keys(pattern);
  if (keys.length > 0) {
    await redisClient.del(keys);
  }
};

module.exports = {
  redisClient,
  subscriberClient,
  bullMQConnection,
  redisKey,
  connect,
  connectSubscriber,
  disconnect,
  ping,
  cacheGet,
  cacheSet,
  cacheDel,
  cacheDelPattern,
};