'use strict';

/**
 * redditService.js
 *
 * Fetches trending tech posts from Reddit using the official Reddit API
 * via the snoowrap library.
 *
 * Rate limit: 60 requests/minute for authenticated clients.
 * Subreddits are fetched sequentially (with a small delay) to stay well
 * within the limit.
 */

require('dotenv').config();
const Snoowrap = require('snoowrap');
const logger = require('../utils/logger');

const SUBREDDITS = (
  process.env.REDDIT_SUBREDDITS || 'technology,gadgets,MachineLearning,programming,artificial'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const POST_LIMIT = Math.min(
  parseInt(process.env.REDDIT_POST_LIMIT || '10', 10),
  25
);

/** Resolves once after `ms` milliseconds. */
const delay = (ms) => new Promise((res) => setTimeout(res, ms));

/**
 * Creates an authenticated Snoowrap client.
 * Throws if required env vars are missing.
 */
function createClient() {
  const { REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USERNAME, REDDIT_PASSWORD } =
    process.env;
  if (!REDDIT_CLIENT_ID || !REDDIT_CLIENT_SECRET || !REDDIT_USERNAME || !REDDIT_PASSWORD) {
    throw new Error(
      'Reddit credentials missing. Set REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, ' +
        'REDDIT_USERNAME, REDDIT_PASSWORD in .env'
    );
  }
  return new Snoowrap({
    userAgent: 'marketing_agent/1.0.0 (automated tech content research)',
    clientId: REDDIT_CLIENT_ID,
    clientSecret: REDDIT_CLIENT_SECRET,
    username: REDDIT_USERNAME,
    password: REDDIT_PASSWORD,
  });
}

/**
 * @typedef {Object} RedditPost
 * @property {string} title
 * @property {string} subreddit
 * @property {number} score
 * @property {number} numComments
 * @property {string} url
 * @property {string} selftext   - Post body (may be empty for link posts)
 */

/**
 * Fetches top posts from a single subreddit.
 * @param {Snoowrap} client
 * @param {string} subreddit
 * @returns {Promise<RedditPost[]>}
 */
async function fetchSubredditTop(client, subreddit) {
  try {
    const listing = await client
      .getSubreddit(subreddit)
      .getTop({ time: 'day', limit: POST_LIMIT });

    return listing.map((post) => ({
      title: post.title,
      subreddit,
      score: post.score,
      numComments: post.num_comments,
      url: `https://reddit.com${post.permalink}`,
      selftext: (post.selftext || '').slice(0, 500), // cap text to avoid oversized prompts
    }));
  } catch (err) {
    logger.warn(`[reddit] Failed to fetch r/${subreddit}`, { err: err.message });
    return [];
  }
}

/**
 * Fetches top posts from all configured subreddits (sequential with 500ms delay).
 * @returns {Promise<RedditPost[]>}
 */
async function getTechPosts() {
  let client;
  try {
    client = createClient();
  } catch (err) {
    logger.warn('[reddit] Client creation failed — returning empty', { err: err.message });
    return [];
  }

  const allPosts = [];
  for (const sub of SUBREDDITS) {
    const posts = await fetchSubredditTop(client, sub);
    allPosts.push(...posts);
    await delay(500); // polite pause to respect rate limits
  }

  // Sort by score descending and deduplicate by title
  const seen = new Set();
  const unique = allPosts
    .sort((a, b) => b.score - a.score)
    .filter((p) => {
      if (seen.has(p.title)) return false;
      seen.add(p.title);
      return true;
    });

  logger.info('[reddit] Fetched posts', {
    total: unique.length,
    subreddits: SUBREDDITS.join(', '),
  });
  return unique;
}

module.exports = { getTechPosts };

// ── Quick smoke-test when run directly ──────────────────────────────────────
if (require.main === module) {
  (async () => {
    const posts = await getTechPosts();
    console.log('Reddit posts:', JSON.stringify(posts.slice(0, 5), null, 2));
  })();
}
