'use strict';

/**
 * instagramService.js
 *
 * Wraps the Instagram Graph API for:
 *   - Publishing single image posts
 *   - Publishing carousel posts (multi-image)
 *   - Polling container status
 *   - Checking the 24-hour publishing rate limit
 *
 * All API calls use axios with explicit error handling.
 * Set DRY_RUN=true in .env to skip the final publish step.
 *
 * Reference: https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/content-publishing
 */

require('dotenv').config();
const axios = require('axios');
const logger = require('../utils/logger');

const BASE_URL = 'https://graph.instagram.com/v25.0';
const MAX_POLL_ATTEMPTS = 10;
const POLL_INTERVAL_MS = 5000; // 5 seconds
const DRY_RUN = process.env.DRY_RUN === 'true';

// ── Helpers ──────────────────────────────────────────────────────────────────

function getCredentials() {
  const igUserId = process.env.IG_USER_ID;
  const accessToken = process.env.IG_ACCESS_TOKEN;
  if (!igUserId || !accessToken) {
    throw new Error('IG_USER_ID and IG_ACCESS_TOKEN must be set in .env');
  }
  return { igUserId, accessToken };
}

/** Pause for `ms` milliseconds. */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Polls the container status until FINISHED, ERROR, or max attempts reached.
 * @param {string} containerId
 * @param {string} accessToken
 * @returns {Promise<'FINISHED'|'ERROR'|'EXPIRED'>}
 */
async function pollContainerStatus(containerId, accessToken) {
  for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
    await sleep(POLL_INTERVAL_MS);
    const resp = await axios.get(`${BASE_URL}/${containerId}`, {
      params: { fields: 'status_code', access_token: accessToken },
    });
    const status = resp.data?.status_code;
    logger.debug('[instagram] Container status', { containerId, status, attempt: i + 1 });

    if (status === 'FINISHED') return 'FINISHED';
    if (status === 'ERROR' || status === 'EXPIRED') {
      logger.error('[instagram] Container failed', { containerId, status });
      return status;
    }
    // IN_PROGRESS — keep polling
  }
  return 'TIMEOUT';
}

// ── Rate-limit check ─────────────────────────────────────────────────────────

/**
 * Returns the number of posts remaining in the current 24-hour window.
 * Instagram allows 100 posts per 24h per account.
 * @returns {Promise<number>}
 */
async function getRemainingPublishQuota() {
  const { igUserId, accessToken } = getCredentials();
  const resp = await axios.get(`${BASE_URL}/${igUserId}/content_publishing_limit`, {
    params: {
      fields: 'config,quota_usage',
      access_token: accessToken,
    },
  });
  const data = resp.data?.data?.[0] || {};
  const quota = data.config?.quota_total ?? 100;
  const used = data.quota_usage ?? 0;
  return quota - used;
}

// ── Single image post ────────────────────────────────────────────────────────

/**
 * Creates an IG media container for a single image.
 * @param {string} imageUrl  - Publicly accessible JPEG URL
 * @param {string} caption
 * @returns {Promise<string>} containerId
 */
async function createImageContainer(imageUrl, caption) {
  const { igUserId, accessToken } = getCredentials();
  const resp = await axios.post(`${BASE_URL}/${igUserId}/media`, {
    image_url: imageUrl,
    caption,
    access_token: accessToken,
  });
  return resp.data.id;
}

/**
 * Publishes a prepared media container.
 * @param {string} containerId
 * @returns {Promise<string>} mediaId
 */
async function publishContainer(containerId) {
  if (DRY_RUN) {
    logger.info('[instagram] DRY_RUN — skipping publish', { containerId });
    return `dry-run-media-id-${Date.now()}`;
  }
  const { igUserId, accessToken } = getCredentials();
  const resp = await axios.post(`${BASE_URL}/${igUserId}/media_publish`, {
    creation_id: containerId,
    access_token: accessToken,
  });
  return resp.data.id;
}

/**
 * Full publish flow for a single image post.
 *
 * @param {string} imageUrl  - Public JPEG URL (MinIO)
 * @param {string} caption   - Full caption with hashtags
 * @returns {Promise<string>} Instagram media ID
 */
async function publishImagePost(imageUrl, caption) {
  logger.info('[instagram] Creating single-image container', { imageUrl });
  const containerId = await createImageContainer(imageUrl, caption);

  const status = await pollContainerStatus(containerId, process.env.IG_ACCESS_TOKEN);
  if (status !== 'FINISHED') {
    throw new Error(`Container ${containerId} ended with status: ${status}`);
  }

  const mediaId = await publishContainer(containerId);
  logger.info('[instagram] Published image post', { mediaId });
  return mediaId;
}

// ── Carousel post ────────────────────────────────────────────────────────────

/**
 * Creates a single carousel item container.
 * @param {string} imageUrl
 * @returns {Promise<string>} item containerId
 */
async function createCarouselItemContainer(imageUrl) {
  const { igUserId, accessToken } = getCredentials();
  const resp = await axios.post(`${BASE_URL}/${igUserId}/media`, {
    image_url: imageUrl,
    is_carousel_item: true,
    access_token: accessToken,
  });
  return resp.data.id;
}

/**
 * Creates the top-level carousel container.
 * @param {string[]} childIds  - Array of carousel item container IDs
 * @param {string} caption
 * @returns {Promise<string>} carousel containerId
 */
async function createCarouselContainer(childIds, caption) {
  const { igUserId, accessToken } = getCredentials();
  const resp = await axios.post(`${BASE_URL}/${igUserId}/media`, {
    media_type: 'CAROUSEL',
    children: childIds.join(','),
    caption,
    access_token: accessToken,
  });
  return resp.data.id;
}

/**
 * Full publish flow for a carousel post.
 *
 * @param {string[]} imageUrls  - Array of public JPEG URLs (all same aspect ratio)
 * @param {string} caption
 * @returns {Promise<string>} Instagram media ID
 */
async function publishCarouselPost(imageUrls, caption) {
  if (imageUrls.length < 2 || imageUrls.length > 10) {
    throw new Error(`Carousel requires 2–10 images, got ${imageUrls.length}`);
  }

  logger.info('[instagram] Creating carousel item containers', { count: imageUrls.length });
  const childIds = [];
  for (const url of imageUrls) {
    const childId = await createCarouselItemContainer(url);
    childIds.push(childId);
    await sleep(500); // brief pause between item creation calls
  }

  logger.info('[instagram] Creating carousel container');
  const carouselId = await createCarouselContainer(childIds, caption);

  const status = await pollContainerStatus(carouselId, process.env.IG_ACCESS_TOKEN);
  if (status !== 'FINISHED') {
    throw new Error(`Carousel container ${carouselId} ended with status: ${status}`);
  }

  const mediaId = await publishContainer(carouselId);
  logger.info('[instagram] Published carousel post', { mediaId, slides: imageUrls.length });
  return mediaId;
}

module.exports = {
  publishImagePost,
  publishCarouselPost,
  getRemainingPublishQuota,
  pollContainerStatus,
};

// ── Quick smoke-test when run directly ──────────────────────────────────────
if (require.main === module) {
  (async () => {
    try {
      const remaining = await getRemainingPublishQuota();
      console.log('Remaining publish quota (24h):', remaining);
    } catch (err) {
      console.error('Could not check quota (credentials not set?):', err.message);
    }
  })();
}
