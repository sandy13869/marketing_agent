'use strict';

/**
 * queue.js
 *
 * Defines the BullMQ Queue used by the scheduler (to enqueue jobs) and
 * the worker (to process them).
 *
 * Exporting the Queue from here ensures both sides share the same
 * queue name and Redis connection settings.
 */

require('dotenv').config();
const { Queue } = require('bullmq');
const IORedis = require('ioredis');

const connection = new IORedis({
  host: process.env.REDIS_HOST || 'redis',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  maxRetriesPerRequest: null, // required by BullMQ
});

const QUEUE_NAME = 'instagram-posts';

const postQueue = new Queue(QUEUE_NAME, { connection });

module.exports = { postQueue, connection, QUEUE_NAME };
