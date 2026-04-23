'use strict';

/**
 * pipeline.js
 *
 * Orchestrates the full end-to-end pipeline for a single Instagram post:
 *
 *   1. Research Agent    — Trends + Reddit → Gemini brief
 *   2. Content Agent     — Brief → post plan (type, caption, image prompts)
 *   3. Image Agent       — Prompts → raw PNG buffers
 *   4. Image Processor   — PNG buffers → Instagram-ready JPEG buffers
 *   5. CDN Upload        — JPEG buffers → public MinIO URLs
 *   6. Instagram Publish — URLs → live Instagram post
 *   7. CDN Cleanup       — Delete temp images after successful post
 *
 * Run with --dry-run flag (or DRY_RUN=true in .env) to skip the publish step.
 *
 * Usage:
 *   node src/pipeline.js            # live run
 *   node src/pipeline.js --dry-run  # dry run (no posting)
 */

require('dotenv').config();
const crypto = require('crypto');
const logger = require('./utils/logger');
const { runResearchAgent } = require('./agents/researchAgent');
const { runContentAgent } = require('./agents/contentAgent');
const { generateImages } = require('./agents/imageAgent');
const { processImages } = require('./processing/imageProcessor');
const { uploadImage, uploadCarouselImages, deleteImage } = require('./services/cdnService');
const {
  publishImagePost,
  publishCarouselPost,
  getRemainingPublishQuota,
} = require('./services/instagramService');

const isDryRun =
  process.env.DRY_RUN === 'true' || process.argv.includes('--dry-run');

/**
 * Runs the complete pipeline.
 *
 * @param {Object} [jobData={}]  - BullMQ job data (currently unused, reserved for overrides)
 * @returns {Promise<Object>}    - Summary of what was posted
 */
async function runPipeline(jobData = {}) {
  const runId = crypto.randomBytes(4).toString('hex');
  logger.info(`[pipeline:${runId}] ─────── Pipeline start ───────`, { dryRun: isDryRun });

  // ── 0. Pre-flight: check Instagram rate limit ──────────────────────────────
  if (!isDryRun) {
    try {
      const remaining = await getRemainingPublishQuota();
      logger.info(`[pipeline:${runId}] Instagram quota remaining (24h)`, { remaining });
      if (remaining <= 0) {
        throw new Error('Instagram 24-hour publishing limit reached — aborting pipeline');
      }
    } catch (err) {
      // If quota check fails (credentials not yet set), warn but continue
      if (err.message.includes('credentials')) {
        logger.warn(`[pipeline:${runId}] Quota check skipped — credentials not set`);
      } else {
        throw err;
      }
    }
  }

  // ── 1. Research ────────────────────────────────────────────────────────────
  logger.info(`[pipeline:${runId}] Step 1/6 — Research`);
  const researchBrief = await runResearchAgent();

  // ── 2. Content Planning ────────────────────────────────────────────────────
  logger.info(`[pipeline:${runId}] Step 2/6 — Content planning`);
  const contentPlan = await runContentAgent(researchBrief);

  // ── 3. Image Generation ────────────────────────────────────────────────────
  logger.info(`[pipeline:${runId}] Step 3/6 — Image generation (${contentPlan.slideCount} image(s))`);
  const rawBuffers = await generateImages(contentPlan.imagePrompts);

  // ── 4. Image Processing ────────────────────────────────────────────────────
  logger.info(`[pipeline:${runId}] Step 4/6 — Image processing`);
  const jpegBuffers = await processImages(rawBuffers);

  // ── 5. CDN Upload ──────────────────────────────────────────────────────────
  logger.info(`[pipeline:${runId}] Step 5/6 — CDN upload`);
  let publicUrls;
  if (contentPlan.postType === 'carousel') {
    publicUrls = await uploadCarouselImages(jpegBuffers, runId);
  } else {
    const url = await uploadImage(jpegBuffers[0], 'posts');
    publicUrls = [url];
  }
  logger.info(`[pipeline:${runId}] Images uploaded`, { urls: publicUrls });

  // ── 6. Instagram Publish ───────────────────────────────────────────────────
  logger.info(`[pipeline:${runId}] Step 6/6 — Publishing to Instagram`);
  let mediaId;
  if (isDryRun) {
    logger.info(`[pipeline:${runId}] DRY RUN — not publishing. Post plan:`, {
      postType: contentPlan.postType,
      concept: contentPlan.concept,
      caption: contentPlan.caption.slice(0, 100) + '...',
      imageUrls: publicUrls,
    });
    mediaId = `dry-run-${runId}`;
  } else if (contentPlan.postType === 'carousel') {
    mediaId = await publishCarouselPost(publicUrls, contentPlan.caption);
  } else {
    mediaId = await publishImagePost(publicUrls[0], contentPlan.caption);
  }

  // ── 7. CDN Cleanup ─────────────────────────────────────────────────────────
  if (!isDryRun) {
    logger.info(`[pipeline:${runId}] Cleaning up CDN images...`);
    for (const url of publicUrls) {
      await deleteImage(url);
    }
  }

  const summary = {
    runId,
    postType: contentPlan.postType,
    concept: contentPlan.concept,
    mediaId,
    dryRun: isDryRun,
    publishedAt: new Date().toISOString(),
  };

  logger.info(`[pipeline:${runId}] ─────── Pipeline complete ───────`, summary);
  return summary;
}

module.exports = { runPipeline };

// ── Run directly ─────────────────────────────────────────────────────────────
if (require.main === module) {
  runPipeline()
    .then((summary) => {
      console.log('\nPipeline result:', JSON.stringify(summary, null, 2));
      process.exit(0);
    })
    .catch((err) => {
      console.error('\nPipeline error:', err.message);
      process.exit(1);
    });
}
