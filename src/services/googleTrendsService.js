'use strict';

/**
 * googleTrendsService.js
 *
 * Fetches trending tech topics from Google Trends using the unofficial
 * google-trends-api package.  All calls are wrapped in try/catch so that
 * a Google throttle or API change causes a graceful fallback (empty array)
 * rather than crashing the pipeline.
 */

require('dotenv').config();
const googleTrends = require('google-trends-api');
const logger = require('../utils/logger');

const GEO = process.env.TRENDS_GEO || 'US';

/**
 * Returns up to 20 daily trending search topics for the given geo.
 * @returns {Promise<string[]>}
 */
async function getDailyTrends() {
  try {
    const raw = await googleTrends.dailyTrends({ geo: GEO });
    const parsed = JSON.parse(raw);
    const items =
      parsed?.default?.trendingSearchesDays?.[0]?.trendingSearches || [];
    return items.map((t) => t.title?.query).filter(Boolean).slice(0, 20);
  } catch (err) {
    logger.warn('[googleTrends] dailyTrends failed — returning empty', {
      err: err.message,
    });
    return [];
  }
}

/**
 * Returns real-time trending topics in the technology category.
 * @returns {Promise<string[]>}
 */
async function getRealTimeTrends() {
  try {
    const raw = await googleTrends.realTimeTrends({
      geo: GEO,
      category: 't', // 't' = Science/Technology
    });
    const parsed = JSON.parse(raw);
    const stories = parsed?.storySummaries?.trendingStories || [];
    return stories.map((s) => s.title).filter(Boolean).slice(0, 13);
  } catch (err) {
    logger.warn('[googleTrends] realTimeTrends failed — returning empty', {
      err: err.message,
    });
    return [];
  }
}

/**
 * Returns combined deduplicated trend list from daily + real-time sources.
 * @returns {Promise<string[]>}
 */
async function getTechTrends() {
  const [daily, realTime] = await Promise.all([
    getDailyTrends(),
    getRealTimeTrends(),
  ]);
  const combined = [...new Set([...daily, ...realTime])];
  logger.info('[googleTrends] Fetched trends', { count: combined.length, geo: GEO });
  return combined;
}

module.exports = { getTechTrends, getDailyTrends, getRealTimeTrends };

// ── Quick smoke-test when run directly ──────────────────────────────────────
if (require.main === module) {
  (async () => {
    const trends = await getTechTrends();
    console.log('Google Trends (tech):', JSON.stringify(trends, null, 2));
  })();
}
