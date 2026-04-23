'use strict';

/**
 * worker.js
 *
 * BullMQ Worker that processes queued Instagram post jobs.
 * Each job runs the full pipeline: research → content → image → process → upload → post.
 *
 * Job retry strategy:
 *   - 3 attempts with exponential backoff (5s, 10s, 20s)
 *   - Failed jobs are kept in the "failed" set for inspection
 *
 * Start this process alongside the scheduler:
 *   node src/queue/worker.js
 */

require('dotenv').config();
const { Worker } = require('bullmq');
const { connection, QUEUE_NAME } = require('./queue');
const { runPipeline } = require('../pipeline');
const logger = require('../utils/logger');

const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    logger.info(`[worker] Starting job`, { jobId: job.id, data: job.data });
    const result = await runPipeline(job.data || {});
    logger.info(`[worker] Job complete`, { jobId: job.id, result });
    return result;
  },
  {
    connection,
    concurrency: 1,        // process one post at a time
    lockDuration: 300_000, // 5 min lock (image generation can be slow)
  }
);

worker.on('active', (job) => logger.info(`[worker] Job active`, { jobId: job.id }));
worker.on('completed', (job, result) =>
  logger.info(`[worker] Job completed`, { jobId: job.id, result })
);
worker.on('failed', (job, err) =>
  logger.error(`[worker] Job failed`, { jobId: job?.id, err: err.message })
);
worker.on('error', (err) =>
  logger.error(`[worker] Worker error`, { err: err.message })
);

logger.info(`[worker] Worker started — listening on queue "${QUEUE_NAME}"`);

// Graceful shutdown
process.on('SIGINT', async () => {
  logger.info('[worker] Shutting down...');
  await worker.close();
  process.exit(0);
});
process.on('SIGTERM', async () => {
  logger.info('[worker] Shutting down...');
  await worker.close();
  process.exit(0);
});
