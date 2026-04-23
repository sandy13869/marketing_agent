'use strict';

/**
 * researchAgent.js
 *
 * Aggregates trending tech topics from Google Trends and Reddit, then
 * uses Gemini 2.5 Flash (with Google Search grounding) to produce a
 * structured research brief for the content agent.
 *
 * Output shape:
 * {
 *   trendSummary: string,          // 2-3 sentence summary of today's tech trends
 *   topTopics: string[],           // 3-5 specific topics ranked by relevance
 *   keyInsights: string[],         // bullet-point insights to weave into post content
 *   redditHighlights: RedditPost[] // top 5 Reddit posts for context
 * }
 */

require('dotenv').config();
const { GoogleGenAI } = require('@google/genai');
const { getTechTrends } = require('../services/googleTrendsService');
const { getTechPosts } = require('../services/redditService');
const logger = require('../utils/logger');

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

/**
 * Runs the full research pipeline and returns a structured research brief.
 * @returns {Promise<Object>}
 */
async function runResearchAgent() {
  logger.info('[researchAgent] Starting research...');

  // Gather raw data in parallel
  const [trends, redditPosts] = await Promise.all([getTechTrends(), getTechPosts()]);

  const topReddit = redditPosts.slice(0, 10);

  // Build context for Gemini
  const trendsText = trends.length
    ? trends.join('\n- ')
    : 'No Google Trends data available today.';

  const redditText = topReddit.length
    ? topReddit
        .map(
          (p, i) =>
            `${i + 1}. [r/${p.subreddit}] "${p.title}" — score: ${p.score}, comments: ${p.numComments}`
        )
        .join('\n')
    : 'No Reddit data available.';

  const prompt = `You are a tech content strategist for an Instagram page focused on technology trends.

Today's trending Google searches (tech category):
- ${trendsText}

Today's top Reddit posts from r/technology, r/gadgets, r/MachineLearning, r/programming, r/artificial:
${redditText}

Based on all of the above data, produce a structured research brief in valid JSON format:
{
  "trendSummary": "<2-3 sentence high-level summary of today's dominant tech trends>",
  "topTopics": ["<topic 1>", "<topic 2>", "<topic 3>", "<topic 4>", "<topic 5>"],
  "keyInsights": [
    "<insight 1 — something interesting, surprising or useful to share>",
    "<insight 2>",
    "<insight 3>",
    "<insight 4>"
  ]
}

Rules:
- Focus on topics that will resonate with a tech-savvy Instagram audience (developers, tech enthusiasts, AI fans).
- Prefer specific and concrete topics over vague ones (e.g. "Apple Vision Pro spatial computing" > "new Apple product").
- Insights should be tweet-length facts or observations, not just topic names.
- Return only the JSON object, no markdown fences, no extra text.`;

  logger.debug('[researchAgent] Sending prompt to Gemini...');

  let responseText;
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{ parts: [{ text: prompt }] }],
      config: {
        tools: [{ googleSearch: {} }],
      },
    });
    responseText = response.candidates?.[0]?.content?.parts?.[0]?.text || '';
  } catch (err) {
    logger.error('[researchAgent] Gemini call failed', { err: err.message });
    throw err;
  }

  // Parse JSON response (strip any accidental markdown fences)
  const cleaned = responseText.replace(/```json|```/g, '').trim();
  let brief;
  try {
    brief = JSON.parse(cleaned);
  } catch (parseErr) {
    logger.error('[researchAgent] Failed to parse Gemini JSON response', {
      responseText,
      parseErr: parseErr.message,
    });
    throw new Error('researchAgent: invalid JSON from Gemini');
  }

  brief.redditHighlights = topReddit.slice(0, 5);
  logger.info('[researchAgent] Research complete', { topTopics: brief.topTopics });
  return brief;
}

module.exports = { runResearchAgent };

// ── Quick smoke-test when run directly ──────────────────────────────────────
if (require.main === module) {
  (async () => {
    const brief = await runResearchAgent();
    console.log('Research brief:', JSON.stringify(brief, null, 2));
  })();
}
