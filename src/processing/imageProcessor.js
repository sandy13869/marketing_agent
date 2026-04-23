'use strict';

/**
 * imageProcessor.js
 *
 * Converts raw image Buffers (PNG/JPEG/any format from Gemini) to
 * Instagram-ready JPEG Buffers using sharp.
 *
 * Instagram requirements:
 *   - Format: JPEG only
 *   - Dimensions: 1080×1350 px (4:5 portrait) — best for feed reach
 *   - All carousel slides must share the same aspect ratio
 *   - Max file size: 8 MB (our output is well under this at ~300–600 KB)
 */

const sharp = require('sharp');
const logger = require('../utils/logger');

// Target Instagram portrait dimensions (4:5)
const TARGET_WIDTH = 1080;
const TARGET_HEIGHT = 1350;
const JPEG_QUALITY = 88; // balance between quality and file size

/**
 * Converts a single image Buffer to an Instagram-ready JPEG Buffer.
 *
 * @param {Buffer} inputBuffer  - Raw image buffer (PNG, JPEG, WebP, etc.)
 * @returns {Promise<Buffer>}   - JPEG buffer at 1080×1350
 */
async function toInstagramJpeg(inputBuffer) {
  try {
    const output = await sharp(inputBuffer)
      .resize(TARGET_WIDTH, TARGET_HEIGHT, {
        fit: 'cover',     // crop to fill (no letterboxing)
        position: 'centre',
      })
      .jpeg({ quality: JPEG_QUALITY, chromaSubsampling: '4:4:4' })
      .toBuffer();

    logger.debug('[imageProcessor] Processed image', {
      inputBytes: inputBuffer.length,
      outputBytes: output.length,
      dimensions: `${TARGET_WIDTH}x${TARGET_HEIGHT}`,
    });
    return output;
  } catch (err) {
    logger.error('[imageProcessor] Failed to process image', { err: err.message });
    throw err;
  }
}

/**
 * Converts an array of image Buffers to Instagram-ready JPEG Buffers.
 * Used for carousel posts — all slides are normalised to the same dimensions.
 *
 * @param {Buffer[]} inputBuffers
 * @returns {Promise<Buffer[]>}
 */
async function processImages(inputBuffers) {
  logger.info('[imageProcessor] Processing images', { count: inputBuffers.length });
  const results = await Promise.all(inputBuffers.map((buf) => toInstagramJpeg(buf)));
  logger.info('[imageProcessor] All images processed');
  return results;
}

module.exports = { toInstagramJpeg, processImages };
