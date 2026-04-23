'use strict';

/**
 * scheduler.js
 *
 * Uses node-cron to enqueue an Instagram post job into BullMQ on a schedule.
 * Default: 9am and 6pm UTC daily (configurable via POST_CRON_SCHEDULE in .env).
 *
 * The scheduler only *enqueues* — BullMQ worker processes the job reliably
 * with retry support even if the process restarts mid-job.
 */

require('dotenv').config();
const cron = require('node-cron');
const { postQueue } = require('../queue/queue');
const logger = require('../utils/logger');

const SCHEDULE = process.env.POST_CRON_SCHEDULE || '0 9,18 * * *';
const TIMEZONE = process.env.POST_TIMEZONE || 'UTC';

function startScheduler() {
  if (!cron.validate(SCHEDULE)) {
    throw new Error(`Invalid cron schedule: "${SCHEDULE}"`);
  }

  logger.info(`[scheduler] Starting — schedule: "${SCHEDULE}" (${TIMEZONE})`);

  cron.schedule(
    SCHEDULE,
    async () => {
      logger.info('[scheduler] Cron fired — enqueueing post job...');
      try {
        const job = await postQueue.add(
          'post',
          { triggeredAt: new Date().toISOString() },
          {
            attempts: 3,
            backoff: { type: 'exponential', delay: 5000 },
            removeOnComplete: { count: 50 },
            removeOnFail: { count: 20 },
          }
        );
        logger.info('[scheduler] Job enqueued', { jobId: job.id });
      } catch (err) {
        logger.error('[scheduler] Failed to enqueue job', { err: err.message });
      }
    },
    { timezone: TIMEZONE }
  );
}

module.exports = { startScheduler };
