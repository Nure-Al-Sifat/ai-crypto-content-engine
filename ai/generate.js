import { curateTrends } from "./curate.js";
import { writePosts } from "./write.js";
import { critiqueAndRevise } from "./critique.js";

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
    count += /[\u1100-\u11FF\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\u{1F300}-\u{1FAFF}]/u.test(
      ch
    )
      ? 2
      : 1;
  }
  return count + urls.length * 23;
}

/**
 * Full pipeline: curate -> write -> critique.
 */
export async function generateContent({
  trends,
  pillar,
  focus,
  voiceExamples = [],
  recentTopics = [],
  variantCount = 3,
}) {
  // Pillars like founder_story and build_log can run with no trend items
  let selected = [];
  if (trends.length) {
    selected = await curateTrends({ trends, pillar, focus, recentTopics });
  } else {
    console.log("[generate] No trend items — pillar runs on context alone");
    selected = [
      {
        source: "internal",
        title: `${pillar.label} post with no external trend input`,
        angle_seed: pillar.angle,
      },
    ];
  }

  const written = await writePosts({
    items: selected,
    pillar,
    focus,
    voiceExamples,
    variantCount,
  });

  const sourceMaterial = selected
    .map((s) => `- [${s.source}] ${s.title}${s.link ? ` (${s.link})` : ""}`)
    .join("\n");

  // Critique only variant 1 — it's the default shown. Critiquing all three
  // triples the cost for marginal benefit.
  const { variant: refined, critique } = await critiqueAndRevise({
    variant: written.variants[0],
    pillar,
    sourceMaterial,
  });

  const variants = [refined, ...written.variants.slice(1)];

  // Enforce X's limit rather than trusting the model's self-report
  for (const v of variants) {
    const len = xLength(v.x_post);
    if (len > 280) {
      console.warn(`[generate] Variant "${v.angle}" is ${len} chars — trimming`);
      v.x_post = v.x_post.slice(0, 275).replace(/\s+\S*$/, "") + "…";
      v.length_warning = true;
    }
  }

  return {
    variants,
    source_used: written.source_used,
    sources: selected.map((s) => ({ source: s.source, title: s.title, link: s.link })),
    pillar: pillar.key,
    critique_problems: critique?.problems || [],
  };
}
