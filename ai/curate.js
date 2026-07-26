import { callStructured } from "./call.js";
import { CurationSchema } from "./schema.js";

/**
 * PASS 1 — CURATION
 *
 * Handing 30 trend items to a writer model produces mush: it tries to
 * acknowledge everything and says nothing. This pass does one job — pick the
 * 1-2 items genuinely worth a post today, and say why.
 *
 * The "why" matters: it becomes the seed of the angle in pass 2.
 */

const SYSTEM = `You are a ruthless content curator for a Web3 gaming founder.
Your only job is selecting which of today's trending items deserve a post.

You reject far more than you accept. Most trending items are noise: price
movements with no thesis, funding announcements with no product implication,
generic "adoption is coming" takes. Reject them.

Accept an item only if the founder could say something about it that is
(a) specific, (b) not already the consensus take, and (c) connected to their
actual domain.

Respond ONLY with valid JSON. No markdown fences.`;

export async function curateTrends({ trends, pillar, focus, recentTopics = [] }) {
  const list = trends
    .map((t, i) => {
      const meta = [t.source, t.upvotes ? `${t.upvotes} upvotes` : null, t.publishedAt]
        .filter(Boolean)
        .join(" | ");
      return `[${i}] ${t.title}\n    (${meta})`;
    })
    .join("\n");

  const avoidBlock = recentTopics.length
    ? `\nTOPICS ALREADY COVERED IN THE LAST 14 DAYS — do not select anything substantially similar:\n${recentTopics.map((t) => `- ${t}`).join("\n")}\n`
    : "";

  const user = `Focus area: ${focus}

Today's content pillar: ${pillar.label}
Pillar angle: ${pillar.angle}
${avoidBlock}
TRENDING ITEMS:
${list}

Select the 1-3 items best suited to today's pillar. Score each 0-10 for
relevance and explain in one sentence what specific, non-obvious angle the
founder could take on it.

If nothing scores above 5, still return the single best option but note why
in discard_reason.

Return JSON:
{"selected": [{"index": 0, "relevance": 8.5, "reason": "..."}], "discard_reason": "..."}`;

  const { data, provider } = await callStructured({
    system: SYSTEM,
    user,
    schema: CurationSchema,
  });

  // Map indices back to actual items, guarding against out-of-range indices
  const selected = data.selected
    .filter((s) => trends[s.index])
    .map((s) => ({ ...trends[s.index], relevance: s.relevance, angle_seed: s.reason }));

  if (!selected.length) {
    throw new Error("Curator returned no valid item indices");
  }

  console.log(
    `[curate] ${provider} selected ${selected.length}/${trends.length}: ` +
      selected.map((s) => `"${s.title.slice(0, 50)}..." (${s.relevance})`).join(", ")
  );

  return selected;
}
