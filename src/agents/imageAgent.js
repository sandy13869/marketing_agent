'use strict';

/**
 * imageAgent.js
 *
 * Generates images for Instagram posts using Gemini 3.1 Flash Image Preview.
 * Accepts an array of text prompts and returns an array of raw PNG Buffers
 * (one per prompt).  The imageProcessor converts them to JPEG.
 *
 * For carousel posts, prompts are processed sequentially to avoid rate limits
 * and ensure consistent style across slides.
 */

require('dotenv').config();
const { GoogleGenAI } = require('@google/genai');
const logger = require('../utils/logger');

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Model to use — supports native image generation
const IMAGE_MODEL = 'gemini-2.0-flash-preview-image-generation';

/** Pause for `ms` milliseconds. */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Generates a single image from a text prompt.
 * @param {string} prompt
 * @param {number} [attempt=1]
 * @returns {Promise<Buffer>}  Raw PNG image buffer
 */
async function generateSingleImage(prompt, attempt = 1) {
  try {
    const response = await ai.models.generateContent({
      model: IMAGE_MODEL,
      contents: [{ parts: [{ text: prompt }] }],
      config: {
        responseModalities: ['TEXT', 'IMAGE'],
      },
    });

    const parts = response.candidates?.[0]?.content?.parts || [];
    const imagePart = parts.find((p) => p.inlineData?.mimeType?.startsWith('image/'));

    if (!imagePart?.inlineData?.data) {
      throw new Error('Gemini returned no image data');
    }

    const buffer = Buffer.from(imagePart.inlineData.data, 'base64');
    logger.debug('[imageAgent] Generated image', { bytes: buffer.length });
    return buffer;
  } catch (err) {
    if (attempt < 3) {
      logger.warn(`[imageAgent] Image generation attempt ${attempt} failed — retrying`, {
        err: err.message,
      });
      await sleep(2000 * attempt);
      return generateSingleImage(prompt, attempt + 1);
    }
    logger.error('[imageAgent] Image generation failed after 3 attempts', { err: err.message });
    throw err;
  }
}

/**
 * Generates images for all provided prompts.
 * For a single image post, pass an array of one prompt.
 * For a carousel, pass one prompt per slide.
 *
 * @param {string[]} prompts
 * @returns {Promise<Buffer[]>}  Array of PNG buffers (same order as prompts)
 */
async function generateImages(prompts) {
  logger.info('[imageAgent] Generating images', { count: prompts.length });
  const buffers = [];

  for (let i = 0; i < prompts.length; i++) {
    const buf = await generateSingleImage(prompts[i]);
    buffers.push(buf);
    if (i < prompts.length - 1) {
      await sleep(1500); // brief pause between generations
    }
  }

  logger.info('[imageAgent] All images generated', { count: buffers.length });
  return buffers;
}

module.exports = { generateImages, generateSingleImage };

// ── Quick smoke-test when run directly ──────────────────────────────────────
if (require.main === module) {
  const fs = require('fs');
  const path = require('path');
  (async () => {
    const tmpDir = path.join(process.cwd(), 'tmp');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

    const prompt =
      'A futuristic dark-themed tech workspace with glowing blue holographic screens showing AI code generation, photorealistic digital art, 4:5 portrait aspect ratio';

    const [buf] = await generateImages([prompt]);
    const outPath = path.join(tmpDir, 'test-image.png');
    fs.writeFileSync(outPath, buf);
    console.log('Saved test image to:', outPath, `(${buf.length} bytes)`);
  })();
}
