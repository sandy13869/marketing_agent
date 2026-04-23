'use strict';

/**
 * contentAgent.js
 *
 * Takes the research brief from researchAgent and uses Gemini 2.5 Flash to
 * produce a fully formed Instagram post plan:
 *   - postType:      'image' | 'carousel'
 *   - concept:       one-sentence description of the post
 *   - caption:       full Instagram caption (hook + body + CTA + hashtags)
 *   - hashtags:      array of hashtags (already embedded in caption too)
 *   - imagePrompts:  array of image generation prompts
 *                    (1 prompt for image, N prompts for carousel slides)
 *   - slideCount:    number of images to generate
 */

require('dotenv').config();
const { GoogleGenAI } = require('@google/genai');
const logger = require('../utils/logger');

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const MAX_CAROUSEL_SLIDES = Math.min(
  parseInt(process.env.CAROUSEL_SLIDE_COUNT || '5', 10),
  10
);

/**
 * @typedef {Object} ContentPlan
 * @property {'image'|'carousel'} postType
 * @property {string} concept
 * @property {string} caption
 * @property {string[]} hashtags
 * @property {string[]} imagePrompts
 * @property {number} slideCount
 */

/**
 * Generates a full Instagram content plan from a research brief.
 * @param {Object} researchBrief  - output of researchAgent
 * @returns {Promise<ContentPlan>}
 */
async function runContentAgent(researchBrief) {
  logger.info('[contentAgent] Generating content plan...', {
    topTopics: researchBrief.topTopics,
  });

  const prompt = `You are a creative Instagram content strategist for a tech-focused page.

Research brief:
- Trend summary: ${researchBrief.trendSummary}
- Top topics: ${researchBrief.topTopics.join(', ')}
- Key insights:
  ${researchBrief.keyInsights.map((i, n) => `${n + 1}. ${i}`).join('\n  ')}

Create a single Instagram post plan. Choose the best format:
- "image": A single striking visual post. Best for one bold fact, announcement, or concept.
- "carousel": Multi-slide educational or listicle post (max ${MAX_CAROUSEL_SLIDES} slides). Best for "top N", how-to, or comparisons.

Return ONLY a valid JSON object with this exact shape:
{
  "postType": "image" | "carousel",
  "concept": "<one sentence describing the post idea>",
  "caption": "<full Instagram caption: attention-grabbing first line (no truncation), 2-3 sentences of insight, emoji usage, call to action, blank line, then 15-20 hashtags mixing popular and niche>",
  "hashtags": ["hashtag1", "hashtag2", ...],
  "imagePrompts": [
    "<detailed image generation prompt for slide 1 / the single image>",
    "<prompt for slide 2 if carousel>",
    ...
  ],
  "slideCount": <integer, 1 for image, 2-${MAX_CAROUSEL_SLIDES} for carousel>
}

Image prompt guidelines:
- Style: photorealistic digital art, vibrant tech aesthetic, dark background with neon/glowing UI elements
- Each prompt must describe a SELF-CONTAINED visual (no text overlays — Instagram crops those)
- Prompts should visually reinforce the caption topic
- For carousel: each slide should tell one part of the story (e.g., slide 1 = intro, slide 2-N = each point)
- Aspect ratio target: portrait 4:5 (1080×1350px)

Caption rules:
- First line must hook the reader within 125 chars (appears before "... more")
- Use 3-5 relevant emojis naturally in the body
- End with a question or CTA to drive comments
- Hashtags on a separate line after body
- Total caption under 2,200 chars

Return only the JSON object, no markdown fences, no extra text.`;

  let responseText;
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{ parts: [{ text: prompt }] }],
    });
    responseText = response.candidates?.[0]?.content?.parts?.[0]?.text || '';
  } catch (err) {
    logger.error('[contentAgent] Gemini call failed', { err: err.message });
    throw err;
  }

  const cleaned = responseText.replace(/```json|```/g, '').trim();
  let plan;
  try {
    plan = JSON.parse(cleaned);
  } catch (parseErr) {
    logger.error('[contentAgent] Failed to parse Gemini JSON response', {
      responseText,
      parseErr: parseErr.message,
    });
    throw new Error('contentAgent: invalid JSON from Gemini');
  }

  // Enforce slideCount consistency
  if (plan.postType === 'image') {
    plan.slideCount = 1;
    plan.imagePrompts = plan.imagePrompts.slice(0, 1);
  } else {
    plan.slideCount = Math.min(Math.max(plan.imagePrompts.length, 2), MAX_CAROUSEL_SLIDES);
    plan.imagePrompts = plan.imagePrompts.slice(0, plan.slideCount);
  }

  logger.info('[contentAgent] Content plan ready', {
    postType: plan.postType,
    slideCount: plan.slideCount,
    concept: plan.concept,
  });
  return plan;
}

module.exports = { runContentAgent };

// ── Quick smoke-test when run directly ──────────────────────────────────────
if (require.main === module) {
  (async () => {
    const mockBrief = {
      trendSummary: 'AI coding assistants are reshaping software development workflows.',
      topTopics: ['GitHub Copilot', 'LLMs in production', 'AI code review'],
      keyInsights: [
        'GitHub Copilot now writes ~46% of code for users who have it enabled.',
        'LLM hallucinations in code generation cost teams significant debugging time.',
        'AI code review tools reduce PR turnaround time by up to 40%.',
      ],
    };
    const plan = await runContentAgent(mockBrief);
    console.log('Content plan:', JSON.stringify(plan, null, 2));
  })();
}
