'use strict';

/**
 * tokenRefresh.js
 *
 * Checks whether the Instagram long-lived access token is within 7 days of
 * expiry and, if so, calls the Meta token-refresh endpoint and updates the
 * in-memory process.env values (and optionally a .env file in dev mode).
 *
 * NOTE: For production use, persist the new token + expiry to a secrets store
 * (e.g. Redis key, AWS Secrets Manager) rather than writing to .env at runtime.
 *
 * Called once on startup (from index.js) and then weekly via node-cron.
 */

require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const SEVEN_DAYS_S = 7 * 24 * 60 * 60;
const ENV_FILE = path.join(process.cwd(), '.env');

/**
 * Returns true if the stored token will expire within the next 7 days.
 */
function isTokenExpiringSoon() {
  const expiry = parseInt(process.env.IG_ACCESS_TOKEN_EXPIRY || '0', 10);
  if (!expiry) return false;
  const nowS = Math.floor(Date.now() / 1000);
  return expiry - nowS < SEVEN_DAYS_S;
}

/**
 * Calls Meta's token-refresh endpoint and returns the new token + expiry.
 * @returns {{ accessToken: string, expiresAt: number }}
 */
async function fetchRefreshedToken() {
  const url = 'https://graph.instagram.com/refresh_access_token';
  const response = await axios.get(url, {
    params: {
      grant_type: 'ig_refresh_token',
      access_token: process.env.IG_ACCESS_TOKEN,
    },
  });
  const { access_token, expires_in } = response.data;
  const expiresAt = Math.floor(Date.now() / 1000) + expires_in;
  return { accessToken: access_token, expiresAt };
}

/**
 * Updates .env file on disk (dev convenience only; safe-fails if file missing).
 */
function updateEnvFile(accessToken, expiresAt) {
  if (!fs.existsSync(ENV_FILE)) return;
  let content = fs.readFileSync(ENV_FILE, 'utf8');
  content = content
    .replace(/^IG_ACCESS_TOKEN=.*/m, `IG_ACCESS_TOKEN=${accessToken}`)
    .replace(/^IG_ACCESS_TOKEN_EXPIRY=.*/m, `IG_ACCESS_TOKEN_EXPIRY=${expiresAt}`);
  fs.writeFileSync(ENV_FILE, content, 'utf8');
}

/**
 * Main entry: check expiry and refresh if needed.
 * Safe to call repeatedly — no-ops if token is still valid.
 */
async function maybeRefreshToken() {
  if (!process.env.IG_ACCESS_TOKEN) {
    logger.warn('[tokenRefresh] IG_ACCESS_TOKEN not set — skipping refresh check');
    return;
  }

  if (!isTokenExpiringSoon()) {
    logger.debug('[tokenRefresh] Token is still valid — no refresh needed');
    return;
  }

  logger.info('[tokenRefresh] Token expiring soon — refreshing...');
  const { accessToken, expiresAt } = await fetchRefreshedToken();

  // Update in-process env
  process.env.IG_ACCESS_TOKEN = accessToken;
  process.env.IG_ACCESS_TOKEN_EXPIRY = String(expiresAt);

  // Best-effort update of .env file (dev only)
  try {
    updateEnvFile(accessToken, expiresAt);
  } catch (err) {
    logger.warn('[tokenRefresh] Could not update .env file on disk', { err: err.message });
  }

  logger.info('[tokenRefresh] Token refreshed successfully', {
    expiresAt: new Date(expiresAt * 1000).toISOString(),
  });
}

module.exports = { maybeRefreshToken, isTokenExpiringSoon };
