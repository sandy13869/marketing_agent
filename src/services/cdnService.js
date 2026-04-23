'use strict';

/**
 * cdnService.js
 *
 * Manages image uploads to a self-hosted MinIO (S3-compatible) instance.
 * Each image is stored under a date-stamped key and returned as a
 * publicly accessible URL that Instagram's crawler can reach.
 *
 * IMPORTANT: MinIO must be reachable from the public internet (or Meta's
 * servers) at the URL returned here.  For local dev, use ngrok or port
 * forwarding to expose MINIO_PUBLIC_BASE_URL.
 */

require('dotenv').config();
const Minio = require('minio');
const crypto = require('crypto');
const logger = require('../utils/logger');

// Use Node's built-in crypto.randomUUID() (Node 14.17+)
const uuidv4 = () => crypto.randomUUID();

// ── MinIO client ─────────────────────────────────────────────────────────────
const minioClient = new Minio.Client({
  endPoint: process.env.MINIO_ENDPOINT || 'minio',
  port: parseInt(process.env.MINIO_PORT || '9000', 10),
  useSSL: process.env.MINIO_USE_SSL === 'true',
  accessKey: process.env.MINIO_ACCESS_KEY || 'minioadmin',
  secretKey: process.env.MINIO_SECRET_KEY || 'minioadmin',
});

const BUCKET = process.env.MINIO_BUCKET || 'instagram-agent';
const PUBLIC_BASE = (process.env.MINIO_PUBLIC_BASE_URL || 'http://localhost:9000').replace(
  /\/$/,
  ''
);

/**
 * Ensures the target bucket exists with a public read policy.
 * Safe to call multiple times (idempotent).
 */
async function ensureBucket() {
  const exists = await minioClient.bucketExists(BUCKET);
  if (!exists) {
    await minioClient.makeBucket(BUCKET, 'us-east-1');
    logger.info('[cdn] Created MinIO bucket', { bucket: BUCKET });
  }

  // Apply anonymous read policy so Instagram can fetch images without auth
  const policy = JSON.stringify({
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Principal: '*',
        Action: ['s3:GetObject'],
        Resource: [`arn:aws:s3:::${BUCKET}/*`],
      },
    ],
  });
  await minioClient.setBucketPolicy(BUCKET, policy);
}

/**
 * Uploads a JPEG Buffer to MinIO and returns a public URL.
 *
 * @param {Buffer} jpegBuffer  - JPEG image data
 * @param {string} [prefix]    - optional key prefix (e.g. 'carousel/post-id')
 * @returns {Promise<string>}  - publicly accessible image URL
 */
async function uploadImage(jpegBuffer, prefix = 'posts') {
  await ensureBucket();

  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const key = `${prefix}/${date}/${uuidv4()}.jpg`;

  await minioClient.putObject(BUCKET, key, jpegBuffer, jpegBuffer.length, {
    'Content-Type': 'image/jpeg',
  });

  const url = `${PUBLIC_BASE}/${BUCKET}/${key}`;
  logger.debug('[cdn] Uploaded image', { key, url });
  return url;
}

/**
 * Uploads multiple JPEG buffers (e.g. carousel slides) and returns their URLs.
 * @param {Buffer[]} jpegBuffers
 * @param {string} postId  - used as prefix to group slides together
 * @returns {Promise<string[]>}
 */
async function uploadCarouselImages(jpegBuffers, postId) {
  const prefix = `carousel/${postId}`;
  const urls = [];
  for (const buf of jpegBuffers) {
    const url = await uploadImage(buf, prefix);
    urls.push(url);
  }
  return urls;
}

/**
 * Deletes an object from MinIO (cleanup after successful Instagram publish).
 * Safe-fails on error.
 * @param {string} url - the URL returned by uploadImage
 */
async function deleteImage(url) {
  try {
    // Extract key from URL:  <base>/<bucket>/<key>
    const key = url.replace(`${PUBLIC_BASE}/${BUCKET}/`, '');
    await minioClient.removeObject(BUCKET, key);
    logger.debug('[cdn] Deleted image from CDN', { key });
  } catch (err) {
    logger.warn('[cdn] Failed to delete image from CDN', { url, err: err.message });
  }
}

module.exports = { uploadImage, uploadCarouselImages, deleteImage, ensureBucket };

// ── Quick smoke-test when run directly ──────────────────────────────────────
if (require.main === module) {
  (async () => {
    const sharp = require('sharp');
    // Create a tiny test JPEG
    const buf = await sharp({
      create: { width: 100, height: 100, channels: 3, background: { r: 0, g: 128, b: 255 } },
    })
      .jpeg()
      .toBuffer();
    const url = await uploadImage(buf, 'test');
    console.log('Uploaded test image:', url);
  })();
}
