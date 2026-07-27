import { callStructured } from "./call.js";
import { ResearchSchema } from "./schema.js";
import { fetchArticleText } from "../fetchers/article.js";

/**
 * RESEARCH — grounds the chosen topic before writing.
 *
 * The virality judge picks the topic from a headline; a good post needs the
 * substance behind it. This agent step reads the full article (when reachable)
 * plus related headlines, and extracts the concrete facts, numbers, and angle
 * the writer should build on — so variants cite specifics instead of guessing.
 *
 * Honesty guardrail: if the article body can't be fetched (paywall / block),
 * it works from the headline + related items and is told NOT to invent facts.
 * The downstream critic also runs a fabrication check.
 */

const SYSTEM = `You are a research analyst for a Web3 gaming founder. Given a news
item — and the full article text when available — extract the substance a strong
post needs: what actually happened, the specific facts and numbers, any notable
quotes, why it matters for Web3 gaming / payments / esports, and the single
sharpest angle.

Rules:
- Prefer specifics (numbers, names, dates) over generalities.
- If the article text is missing, use the headline and related items, but DO NOT
  invent facts, figures, or quotes. Only state what is actually supported.
- key_facts and quotes must be things you can point to in the material, not guesses.

Respond ONLY with valid JSON. No markdown fences.`;

export async function researchTopic({ topic, related = [], focus, pillar }) {
  const articleText = await fetchArticleText(topic.link);

  const articleBlock = articleText
    ? `FULL ARTICLE TEXT (may be truncated):\n${articleText.slice(0, 4000)}`
    : `FULL ARTICLE TEXT: unavailable${
        topic.link ? " (fetch blocked or paywalled)" : " (no link)"
      }. Work from the headline and related items; do NOT fabricate specifics.`;

  const relatedBlock = related.length
    ? related.map((r) => `- [${r.source}] ${r.title}`).join("\n")
    : "(none)";

  const user = `Audience focus: ${focus}
Content pillar: ${pillar.label} — ${pillar.angle}

TOPIC
HEADLINE: ${topic.title}
SOURCE: ${topic.source}
LINK: ${topic.link || "n/a"}
JUDGE'S SUGGESTED ANGLE: ${topic.angle_seed || "(none)"}

${articleBlock}

RELATED HEADLINES (context):
${relatedBlock}

Extract grounding for a post. Return JSON:
{"summary":"...","key_facts":["..."],"quotes":["..."],"why_it_matters":"...","sharp_angle":"...","contrarian_take":"..."}`;

  const { data, provider } = await callStructured({
    system: SYSTEM,
    user,
    schema: ResearchSchema,
  });

  console.log(
    `[research] ${provider} grounded "${topic.title.slice(0, 50)}" — ` +
      `${data.key_facts.length} facts${articleText ? " (article read)" : " (headline only)"}`
  );

  return { ...data, articleFetched: !!articleText };
}
