import { researchTopic } from "./research.js";
import { writePlatformContent } from "./write.js";

/**
 * X counts characters differently from JS: every URL is billed as 23 chars
 * regardless of real length, and emoji/CJK count as 2. This approximates
 * X's weighted counting closely enough to keep you under the limit.
 */
export function xLength(text) {
  const urlRegex = /https?:\/\/\S+/g;
  const urls = text.match(urlRegex) || [];
  const stripped = text.replace(urlRegex, "");

  let count = 0;
  for (const ch of stripped) {
    count += /[ᄀ-ᇿ⺀-꓏가-힣豈-﫿︰-﹏＀-｠\u{1F300}-\u{1FAFF}]/u.test(
      ch
    )
      ? 2
      : 1;
  }
  return count + urls.length * 23;
}

/**
 * Stages 4-5: research the already-chosen topic, then write one draft per
 * platform. Research is skipped for pillars that run on voice alone (no link,
 * no related items).
 */
export async function generateContent({ topic, pillar, focus, voiceExamples = [], related = [], dna = null }) {
  let research = null;
  if (topic.link || related.length) {
    try {
      research = await researchTopic({ topic, related, focus, pillar });
    } catch (err) {
      console.warn(`[research] skipped: ${err.message}`);
    }
  }

  const content = await writePlatformContent({
    topic,
    research,
    pillar,
    focus,
    voiceExamples,
    dna,
  });

  // Enforce X's limit rather than trusting the model's self-report.
  if (xLength(content.x_post) > 280) {
    content.x_post = content.x_post.slice(0, 275).replace(/\s+\S*$/, "") + "…";
    content.x_trimmed = true;
  }

  return { content, research };
}
