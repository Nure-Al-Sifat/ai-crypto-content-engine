import { fetchRssTrends } from "./rss.js";
import { fetchRedditTrends } from "./reddit.js";
import { fetchCoinGeckoTrends } from "./coingecko.js";
import { fetchFarcasterTrends } from "./farcaster.js";
import { fetchYouTubeTrends, fetchHackerNewsTrends } from "./misc.js";
import { fetchRecentCommits } from "./github.js";

/**
 * PRE-FILTER SCORING
 *
 * Running this before the AI does two things: the curator gets better raw
 * material, and you spend fewer tokens on items that were never candidates.
 *
 * Weights are deliberately domain-specific. Tune them — this is the knob that
 * decides whether your engine talks about Web3 gaming or about Bitcoin price.
 */
// CORE Web3-gaming terms. A topic MUST hit at least one of these to qualify —
// this is what stops general crypto news (Lido, POSCO, ETF flows) from getting
// a fabricated "for gamers" angle. If nothing here matches, the item is dropped.
const CORE_GAMING = {
  "web3 gaming": 6, "web3 game": 6, gamefi: 6, "game-fi": 6,
  "play to earn": 6, "play-to-earn": 6, p2e: 6,
  "blockchain gaming": 6, "blockchain game": 6, "onchain game": 5, "on-chain game": 5,
  "nft game": 5, "nft gaming": 5, "gaming nft": 5, "in-game nft": 5,
  esports: 5, "gaming guild": 5, "yield guild": 5,
  "gaming token": 5, "in-game economy": 5, "in-game asset": 4, "in-game": 4,
  "game studio": 4, "gaming studio": 4, "game developer": 4,
  streamer: 5, "creator monetization": 5, micropayment: 5, "state channel": 5,
  "erc-7824": 6, tipping: 4, tournament: 4,
  // specific Web3 games / gaming chains (phrases, to avoid false positives)
  "axie infinity": 6, illuvium: 6, "gods unchained": 6, "gala games": 5,
  "immutable x": 6, "ronin network": 6, "star atlas": 6, "yellow network": 5,
  "pixels game": 5, gamereq: 6,
};

// CONTEXT — adjusts the score but is NOT enough on its own to qualify.
const CONTEXT = {
  gaming: 2, game: 1, nft: 1, metaverse: 2, twitch: 3, "creator economy": 3,
  web3: 1, crypto: 1, blockchain: 1, base: 1, polygon: 1, ronin: 2, wallet: 1,
  onboarding: 2, "gas fee": 2, stablecoin: 1, payout: 2,
  bitcoin: -1, etf: -2, "price prediction": -3, presale: -4, "to the moon": -5,
  "100x": -5, memecoin: -2,
};

const matchScore = (text, map) => {
  let s = 0;
  for (const [kw, w] of Object.entries(map)) {
    const esc = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(?:^|[^a-z0-9])${esc}(?:[^a-z0-9]|$)`).test(text)) s += w;
  }
  return s;
};

function scoreItem(item) {
  const text = `${item.title || ""}`.toLowerCase();
  let score = 0;

  // `_core` = genuine Web3-gaming relevance; items with none are dropped later,
  // so the engine never fakes a gaming angle on unrelated crypto news.
  const core = matchScore(text, CORE_GAMING);
  const ctx = matchScore(text, CONTEXT);
  item._core = core;
  item._niche = core + ctx;
  score += core + ctx;

  const ageHours = item.publishedAt
    ? (Date.now() - new Date(item.publishedAt).getTime()) / 3600_000
    : null;
  const validAge = ageHours != null && !Number.isNaN(ageHours);

  // Comments weigh double — a debate spreads harder than a quiet upvote.
  const engagement =
    (item.upvotes || 0) + (item.comments || 0) * 2 + (item.engagement || 0);

  // VELOCITY is the core "trending right now" signal: engagement per hour, not
  // raw totals. A post gaining 500 upvotes in 3h beats one that took 3 days.
  if (engagement > 0 && validAge) {
    const perHour = engagement / Math.max(ageHours, 2); // floor age so brand-new posts don't divide by ~0
    score += Math.min(Math.log10(perHour + 1) * 3, 6);
  } else if (engagement > 0) {
    // No timestamp available: fall back to dampened raw engagement.
    score += Math.min(Math.log10(engagement + 1) * 2, 4);
  }

  // Recency decay — a 3-day-old story is rarely worth a post.
  if (validAge) {
    if (ageHours < 12) score += 3;
    else if (ageHours < 24) score += 2;
    else if (ageHours < 48) score += 0.5;
    else score -= 2;
  }

  return score;
}

/**
 * Removes near-duplicate headlines across sources (the same story reported by
 * CoinDesk, Decrypt and The Block should occupy one slot, not three).
 */
function dedupeByTitle(items) {
  const seen = new Map();

  for (const item of items) {
    const normalized = (item.title || "")
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, "")
      .split(/\s+/)
      .filter((w) => w.length > 3)
      .slice(0, 8)
      .sort()
      .join(" ");

    if (!normalized) continue;
    const existing = seen.get(normalized);
    if (!existing) {
      // _sourceCount / _sources power the "multi-platform confirmation" signal:
      // a story several outlets report at once is a stronger bet than one blog.
      item._sourceCount = 1;
      item._sources = [item.source];
      seen.set(normalized, item);
    } else {
      existing._sourceCount += 1;
      if (!existing._sources.includes(item.source)) existing._sources.push(item.source);
      // Keep the highest-scoring representative, but carry the merged count.
      if ((item._score || 0) > (existing._score || 0)) {
        item._sourceCount = existing._sourceCount;
        item._sources = existing._sources;
        seen.set(normalized, item);
      }
    }
  }

  return [...seen.values()];
}

/**
 * Fetches only the sources the day's pillar actually needs, scores, dedupes,
 * and returns the top N.
 */
export async function collectTrends({ needs = ["news", "market", "social"], limit = 25 } = {}) {
  const soft = (p, label) =>
    p.catch((e) => {
      console.warn(`[fetch] ${label} failed: ${e.message}`);
      return [];
    });

  // Build labelled jobs so we can log exactly how many items each source gave.
  const jobs = [];
  const add = (cond, fn, label) => {
    if (cond) jobs.push({ label, p: soft(fn(), label) });
  };
  add(needs.includes("news"), fetchRssTrends, "rss");
  add(needs.includes("news"), fetchHackerNewsTrends, "hackernews");
  add(needs.includes("news"), fetchYouTubeTrends, "youtube");
  add(needs.includes("market"), fetchCoinGeckoTrends, "coingecko");
  add(needs.includes("social"), fetchRedditTrends, "reddit");
  add(needs.includes("social"), fetchFarcasterTrends, "farcaster");
  add(needs.includes("commits"), fetchRecentCommits, "github");

  const results = await Promise.all(jobs.map((j) => j.p));
  console.log(
    `[fetch] sources → ${jobs.map((j, i) => `${j.label}:${results[i].length}`).join("  ")}`
  );

  const all = results.flat();
  const commits = all.filter((i) => i.type === "commit"); // bypass scoring — on-topic by definition
  const rest = all.filter((i) => i.type !== "commit");
  for (const item of rest) item._score = scoreItem(item);

  const ranked = dedupeByTitle(rest)
    // Must hit a CORE Web3-gaming keyword — no genuine gaming angle, no post.
    .filter((i) => i._core > 0 && i._score > 0)
    .sort((a, b) => b._score - a._score)
    .slice(0, limit);

  const dropped = rest.filter((i) => (i._core || 0) <= 0).length;
  console.log(
    `[fetch] ${all.length} raw → ${ranked.length} genuine Web3-gaming topics ` +
      `(${dropped} dropped as not gaming-relevant, +${commits.length} commits)`
  );

  return [...commits, ...ranked];
}

/** A readable table of ranked topics with their engagement — "what's trending & how much". */
export function formatTrendTable(items, n = 25) {
  const head =
    "   #  score  source        engagement        age   title";
  const rows = items.slice(0, n).map((t, i) => {
    const age = t.publishedAt
      ? Math.round((Date.now() - new Date(t.publishedAt).getTime()) / 3600_000) + "h"
      : "—";
    const eng =
      [t.upvotes ? `↑${t.upvotes}` : null, t.comments ? `💬${t.comments}` : null]
        .filter(Boolean)
        .join(" ") || "—";
    const score = (t._score ?? 0).toFixed(1);
    return (
      `  ${String(i + 1).padStart(2)}  ${score.padStart(5)}  ` +
      `${String(t.source || "").padEnd(12).slice(0, 12)}  ${eng.padEnd(16).slice(0, 16)}  ` +
      `${age.padStart(4)}  ${String(t.title || "").slice(0, 58)}`
    );
  });
  return [head, ...rows].join("\n");
}

export { scoreItem, dedupeByTitle };
