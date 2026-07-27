/**
 * CONTENT PILLARS
 *
 * Without rotation, a trend-driven engine produces the same "here's a hot take
 * on today's news" post every single day. Readers tune out fast.
 *
 * Each pillar declares what data it needs (`needs`), which changes what the
 * fetcher layer bothers collecting for that day.
 */

export const PILLARS = {
  founder_story: {
    label: "Founder Story",
    needs: [], // no external data — draws on context + voice examples
    angle: `A personal, specific moment from building GameReq. A decision you got
wrong, a constraint you underestimated, a conversation with a user that changed
your mind. It must be concrete and small — one scene, not a life lesson.
Do NOT invent events. Use only what's in the provided context; if the context is
thin, write about a general founder tension rather than fabricating specifics.`,
  },

  market_insight: {
    label: "Market Insight",
    needs: ["news", "market", "social"],
    angle: `A non-obvious read on what today's data actually means for Web3 gaming
and creator monetization. Take a position. Consensus restatement is worthless —
if the take could appear in a newsletter summary, discard it and find the second-
order implication instead.`,
  },

  technical_explainer: {
    label: "Technical Explainer",
    needs: ["news", "market", "social"],
    angle: `Explain one mechanism clearly — state channels, ERC-7824, settlement
latency, gas abstraction, micropayment economics. Audience is technical but not
expert in this specific area. Use a concrete example with real numbers. No
analogies to restaurants or highways.`,
    preferThread: true,
  },

  build_log: {
    label: "Build Log",
    needs: ["commits"],
    angle: `What actually got built this week, from the commit log. Ship notes with
personality. Mention what broke and what you learned, not just what shipped.
Ground every claim in the provided commit data — do not embellish.`,
  },

  ecosystem_commentary: {
    label: "Ecosystem Commentary",
    needs: ["news", "social", "market"],
    angle: `React to something happening in the Yellow Network / Base / Polygon /
BNB Chain / broader Web3 gaming ecosystem. Generous but not sycophantic. It is
fine to point out where you think an approach is wrong, as long as you say why.`,
  },
};

// Every day pulls trending topics (news/market/social) — only the *angle*
// rotates, so posts stay varied without ever being off-trend. build_log and
// founder_story stay defined for manual `--pillar=` runs, but are out of the
// daily rotation (they don't produce trending content).
const ROTATION = [
  "market_insight",       // Sunday
  "ecosystem_commentary", // Monday
  "technical_explainer",  // Tuesday
  "market_insight",       // Wednesday
  "ecosystem_commentary", // Thursday
  "technical_explainer",  // Friday
  "market_insight",       // Saturday
];

/**
 * Picks the pillar for a given date. Deterministic, so a re-run on the same
 * day produces the same pillar (important for idempotency).
 */
export function getPillarForDate(date = new Date()) {
  const key = ROTATION[date.getUTCDay()];
  return { key, ...PILLARS[key] };
}

export function getPillarByKey(key) {
  if (!PILLARS[key]) throw new Error(`Unknown pillar: ${key}`);
  return { key, ...PILLARS[key] };
}
