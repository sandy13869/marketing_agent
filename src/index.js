'use strict';

/**
 * index.js
 *
 * Application entry point.
 *
 * Responsibilities:
 *   1. Load environment variables
 *   2. Check Instagram token expiry (and refresh if needed)
 *   3. Start the BullMQ worker (processes queued jobs)
 *   4. Start the node-cron scheduler (enqueues jobs on schedule)
 *   5. Schedule a weekly token refresh check
 *
 * Run:
 *   node src/index.js      (or `npm start`)
 */

require('dotenv').config();
const cron = require('node-cron');
const logger = require('./utils/logger');
const { maybeRefreshToken } = require('./utils/tokenRefresh');
const { startScheduler } = require('./scheduler/scheduler');

// Import worker inline — it self-registers on import
require('./queue/worker');

async function main() {
  logger.info('[app] ── Marketing Agent starting ──');
  logger.info('[app] Mode:', { dryRun: process.env.DRY_RUN === 'true' ? 'DRY RUN' : 'LIVE' });

  // ── Token health check on startup ──────────────────────────────────────────
  try {
    await maybeRefreshToken();
  } catch (err) {
    logger.warn('[app] Token refresh check failed on startup', { err: err.message });
  }

  // ── Weekly token refresh (every Sunday at 08:00 UTC) ──────────────────────
  cron.schedule(
    '0 8 * * 0',
    async () => {
      logger.info('[app] Running weekly token refresh check...');
      try {
        await maybeRefreshToken();
      } catch (err) {
        logger.error('[app] Weekly token refresh failed', { err: err.message });
      }
    },
    { timezone: process.env.POST_TIMEZONE || 'UTC' }
  );

  // ── Start posting scheduler ────────────────────────────────────────────────
  startScheduler();

  logger.info('[app] ── Agent is running ──');
}

main().catch((err) => {
  logger.error('[app] Fatal startup error', { err: err.message });
  process.exit(1);
});
