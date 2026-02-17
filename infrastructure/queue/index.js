'use strict';

const { Queue, Worker, QueueEvents } = require('bullmq');
const { bullMQConnection } = require('../redis');
const logger = require('../logger');

/**
 * Queue Infrastructure
 *
 * Architecture:
 *  - Queues are named, persistent, and defined here as constants.
 *  - Workers are registered per queue with a processor function.
 *  - All job events are logged via QueueEvents for observability.
 *  - No inline business logic — workers call service layer functions.
 *
 * Named Queues:
 *  - photo:processing   → Resize, compress, generate thumbnails
 *  - notification:email → Send transactional emails
 *  - activity:log       → Persist domain event activity records
 *  - zip:export         → Album ZIP download packaging (future)
 */

// ── Queue Name Constants ───────────────────────────────────────────────────
const QUEUE_NAMES = Object.freeze({
  PHOTO_PROCESSING: 'photo:processing',
  NOTIFICATION_EMAIL: 'notification:email',
  ACTIVITY_LOG: 'activity:log',
  ZIP_EXPORT: 'zip:export',
});

// ── Default Job Options ────────────────────────────────────────────────────
const defaultJobOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 1000, // 1s, 2s, 4s
  },
  removeOnComplete: {
    count: 100,       // Keep last 100 completed jobs
    age: 24 * 3600,   // Max 24 hours
  },
  removeOnFail: {
    count: 500,       // Keep failed jobs longer for debugging
    age: 7 * 24 * 3600,
  },
};

// ── Queue Registry ─────────────────────────────────────────────────────────
const _queues = new Map();
const _workers = new Map();
const _queueEvents = new Map();

/**
 * Get or create a named queue.
 * Queues are singletons — calling this twice for the same name returns the same instance.
 */
const getQueue = (name) => {
  if (_queues.has(name)) return _queues.get(name);

  const queue = new Queue(name, {
    connection: { ...bullMQConnection },
    defaultJobOptions,
    prefix: 'album-queue',
  });

  queue.on('error', (err) => {
    logger.error(`[Queue] Queue "${name}" error`, { queue: name, error: err.message });
  });

  _queues.set(name, queue);
  logger.info(`[Queue] Queue registered: "${name}"`);
  return queue;
};

/**
 * Register a worker for a named queue.
 * @param {string} name - Queue name (use QUEUE_NAMES constants)
 * @param {Function} processor - async (job) => result
 * @param {object} workerOptions - concurrency, limiter, etc.
 */
const registerWorker = (name, processor, workerOptions = {}) => {
  if (_workers.has(name)) {
    logger.warn(`[Queue] Worker already registered for queue "${name}". Skipping.`);
    return _workers.get(name);
  }

  const worker = new Worker(name, processor, {
    connection: { ...bullMQConnection },
    prefix: 'album-queue',
    concurrency: 5,
    ...workerOptions,
  });

  worker.on('completed', (job) => {
    logger.info(`[Queue] Job completed`, {
      queue: name,
      jobId: job.id,
      jobName: job.name,
      durationMs: job.processedOn - job.timestamp,
    });
  });

  worker.on('failed', (job, err) => {
    logger.error(`[Queue] Job failed`, {
      queue: name,
      jobId: job?.id,
      jobName: job?.name,
      attempt: job?.attemptsMade,
      error: err.message,
    });
  });

  worker.on('stalled', (jobId) => {
    logger.warn(`[Queue] Job stalled`, { queue: name, jobId });
  });

  worker.on('error', (err) => {
    logger.error(`[Queue] Worker error`, { queue: name, error: err.message });
  });

  _workers.set(name, worker);
  logger.info(`[Queue] Worker registered: "${name}"`, {
    concurrency: workerOptions.concurrency || 5,
  });
  return worker;
};

/**
 * Subscribe to queue-level events (for monitoring, metrics).
 * Does not process jobs — just observes.
 */
const observeQueue = (name) => {
  if (_queueEvents.has(name)) return _queueEvents.get(name);

  const qe = new QueueEvents(name, {
    connection: { ...bullMQConnection },
    prefix: 'album-queue',
  });

  qe.on('waiting', ({ jobId }) => logger.debug(`[Queue] Job waiting`, { queue: name, jobId }));
  qe.on('active', ({ jobId }) => logger.debug(`[Queue] Job active`, { queue: name, jobId }));
  qe.on('delayed', ({ jobId, delay }) =>
    logger.debug(`[Queue] Job delayed`, { queue: name, jobId, delayMs: delay })
  );

  _queueEvents.set(name, qe);
  return qe;
};

// ── Job Dispatch Helpers ───────────────────────────────────────────────────
/**
 * Add a job to a queue. Returns the job object.
 * Usage:
 *   await dispatch(QUEUE_NAMES.PHOTO_PROCESSING, 'resize', { photoId, filePath });
 */
const dispatch = async (queueName, jobName, data, options = {}) => {
  const queue = getQueue(queueName);
  const job = await queue.add(jobName, data, {
    ...defaultJobOptions,
    ...options,
  });
  logger.info(`[Queue] Job dispatched`, {
    queue: queueName,
    jobName,
    jobId: job.id,
    data: config?.isDevelopment ? data : '[redacted]',
  });
  return job;
};

// ── Graceful Shutdown ──────────────────────────────────────────────────────
const shutdown = async () => {
  logger.info('[Queue] Shutting down workers...');

  const workerShutdowns = [..._workers.values()].map((w) => w.close());
  const queueShutdowns = [..._queues.values()].map((q) => q.close());
  const eventsShutdowns = [..._queueEvents.values()].map((e) => e.close());

  await Promise.allSettled([...workerShutdowns, ...queueShutdowns, ...eventsShutdowns]);
  logger.info('[Queue] All queues and workers shut down');
};

// ── Health Check ───────────────────────────────────────────────────────────
const getHealthStatus = async () => {
  const status = {};
  for (const [name, queue] of _queues.entries()) {
    try {
      const counts = await queue.getJobCounts();
      status[name] = { healthy: true, counts };
    } catch (err) {
      status[name] = { healthy: false, error: err.message };
    }
  }
  return status;
};

// Pre-initialize the core queues so they exist on startup
const initQueues = () => {
  Object.values(QUEUE_NAMES).forEach((name) => getQueue(name));
  logger.info('[Queue] Core queues initialized', { queues: Object.values(QUEUE_NAMES) });
};

module.exports = {
  QUEUE_NAMES,
  getQueue,
  registerWorker,
  observeQueue,
  dispatch,
  shutdown,
  getHealthStatus,
  initQueues,
};