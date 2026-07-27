/**
 * VIRAL OPPORTUNITY SCORE
 *
 * A transparent, weighted 0-100 score (no AI call) that blends the quantitative
 * signals with the AI judge's qualitative read. This is what turns "trending"
 * into "worth posting for THIS account": it rewards momentum and low
 * competition, not just recency.
 *
 * Weights (free-data version; sums to 100):
 *   Momentum      25  — best of YouTube views/hr and our engagement/hr
 *   Competition   20  — inverse: fewer existing videos = more headroom
 *   Confirmation  15  — how many sources independently surfaced it
 *   AI quality    20  — the judge's hook/novelty/emotion/curiosity read
 *   Freshness     10  — how new the story is
 *   Niche fit     10  — keyword relevance to your lane
 */
const clamp = (n) => Math.max(0, Math.min(100, Math.round(n)));

export function opportunityScore(c, { batchMaxNiche = 1 } = {}) {
  const ageHours = c.publishedAt
    ? (Date.now() - new Date(c.publishedAt).getTime()) / 3600_000
    : null;

  // Momentum — best of YouTube views/hr and our own engagement/hr, log-scaled.
  const engPerHour =
    ageHours && (c.upvotes || c.comments)
      ? ((c.upvotes || 0) + (c.comments || 0) * 2) / Math.max(ageHours, 2)
      : 0;
  const vph = Math.max(c.youtube?.velocity || 0, engPerHour);
  const momentum = clamp(Math.log10(vph + 1) * 22); // ~1k/hr→66, ~10k/hr→88

  // Competition (inverse) — fewer videos on the topic = more room to stand out.
  const comp = c.youtube?.competition;
  const competition = comp != null ? clamp(100 - Math.log10(comp + 1) * 16.6) : 50;

  // Multi-platform confirmation.
  const src = c._sourceCount || 1;
  const confirmation = src >= 3 ? 100 : src === 2 ? 65 : 30;

  // AI qualitative (the judge's 0-100), freshness, niche relevance.
  const ai = clamp(c.viral_score ?? 50);
  const freshness =
    ageHours == null
      ? 50
      : ageHours < 6
      ? 100
      : ageHours < 12
      ? 85
      : ageHours < 24
      ? 70
      : ageHours < 48
      ? 40
      : 15;
  const niche = clamp(((c._score || 0) / (batchMaxNiche || 1)) * 100);

  const breakdown = { momentum, competition, confirmation, ai, freshness, niche };
  const score = clamp(
    momentum * 0.25 +
      competition * 0.2 +
      confirmation * 0.15 +
      ai * 0.2 +
      freshness * 0.1 +
      niche * 0.1
  );

  // A content gap = real interest but low competition (few videos to compete with).
  const gap = competition >= 60 && (momentum >= 40 || confirmation >= 65);

  return {
    score,
    breakdown,
    gap,
    competitionRaw: comp ?? null,
    ytVelocity: Math.round(c.youtube?.velocity || 0),
  };
}

/** Compact one-line breakdown for the Excel `signals` column and the terminal. */
export function signalsLine(o) {
  const b = o.breakdown;
  return (
    `momentum ${b.momentum} · competition ${b.competition}` +
    `${o.competitionRaw != null ? ` (~${o.competitionRaw} vids)` : ""}` +
    ` · confirm ${b.confirmation} · ai ${b.ai} · fresh ${b.freshness} · niche ${b.niche}` +
    `${o.gap ? " · GAP ✓" : ""}`
  );
}
