import { callStructured } from "./call.js";
import { ViralSchema } from "./schema.js";

/**
 * VIRALITY JUDGE
 *
 * The pre-filter (fetchers/index.js) ranks by relevance + momentum, but a high
 * momentum score doesn't mean a topic will spread from *this* account. This
 * pass reads the whole candidate pool and scores each item on what actually
 * drives shares, then hands back the single strongest pick with its reasoning.
 *
 * Honest limit: this raises the odds, it does not guarantee a hit. Virality
 * also depends on timing, the follower graph, and luck no model can see.
 */

const SYSTEM = `You are a viral content strategist for a Web3 gaming founder who
posts on X and LinkedIn. Your job: judge which of today's candidate topics has
the highest genuine potential to spread with THIS audience, and why.

Score viral potential 0-100 as a blend of:
- HOOK: can the first line stop a scroll?
- NOVELTY: is there a specific, non-consensus take available, or is it a tired story?
- EMOTION/STAKES: does it provoke a reaction — surprise, disagreement, aspiration?
- TIMELINESS: is it peaking right now (momentum in the stats matters)?
- SHAREABILITY: would a reader repost it to look smart or start an argument?
- FIT: does it connect to Web3 gaming, payments, esports, or the founder's lane?

Be ruthless and calibrated. Most items are NOT viral — score generic price moves,
routine funding, and "adoption is coming" takes below 40. Reserve 80+ for topics
with a real, sharp, timely hook. Do not inflate scores.

Respond ONLY with valid JSON. No markdown fences.`;

export async function judgeVirality({ trends, focus, pillar, recentTopics = [] }) {
  const list = trends
    .map((t, i) => {
      const meta = [
        t.source,
        t.upvotes ? `${t.upvotes} upvotes` : null,
        t.comments ? `${t.comments} comments` : null,
        t.publishedAt ? `posted ${t.publishedAt}` : null,
      ]
        .filter(Boolean)
        .join(" | ");
      return `[${i}] ${t.title}\n    (${meta || "no engagement stats"})`;
    })
    .join("\n");

  const avoidBlock = recentTopics.length
    ? `\nALREADY COVERED in the last 14 days — do NOT pick anything similar:\n${recentTopics
        .slice(0, 20)
        .map((t) => `- ${t}`)
        .join("\n")}\n`
    : "";

  const user = `Audience focus: ${focus}
Today's content pillar: ${pillar.label} — ${pillar.angle}
${avoidBlock}
CANDIDATE TOPICS (stats included where available — momentum = engagement over a short time = strong signal):
${list}

Rank the strongest candidates by viral potential for this audience. Return the
top 5 (or fewer if the pool is small). For each give:
- index (from the list above)
- viral_score (0-100, calibrated per the rules)
- why (1-2 sentences: what makes it spread, or its ceiling)
- angle (the single sharpest angle the founder should take)
- risk (optional: what could make it flop)

Return JSON:
{"ranked":[{"index":0,"viral_score":82,"why":"...","angle":"...","risk":"..."}]}`;

  const { data, provider } = await callStructured({
    system: SYSTEM,
    user,
    schema: ViralSchema,
  });

  const ranked = data.ranked
    .filter((r) => trends[r.index])
    .map((r) => ({
      ...trends[r.index],
      viral_score: r.viral_score,
      why: r.why,
      angle_seed: r.angle,
      risk: r.risk,
    }))
    .sort((a, b) => b.viral_score - a.viral_score);

  if (!ranked.length) {
    throw new Error("Virality judge returned no valid item indices");
  }

  console.log(
    `[viral] ${provider} judged ${trends.length} candidates → best "${ranked[0].title.slice(
      0,
      60
    )}" (${ranked[0].viral_score}/100)`
  );

  return ranked;
}
