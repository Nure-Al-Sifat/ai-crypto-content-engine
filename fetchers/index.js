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
const KEYWORD_WEIGHTS = {
  // Core domain — highest signal
  esports: 5, streamer: 5, "state channel": 5, micropayment: 5,
  "creator monetization": 5, "in-game": 4, tipping: 4, "erc-7824": 6,
  yellow: 4, "web3 gaming": 5, "game developer": 4, tournament: 4,

  // Adjacent — relevant with a good angle
  base: 2, polygon: 2, "bnb chain": 2, stablecoin: 3, "gas fee": 3,
  onboarding: 3, wallet: 2, "account abstraction": 3, l2: 2, rollup: 2,
  gaming: 3, twitch: 3, youtube: 2, payout: 3, "creator economy": 4,

  // General crypto / web3 — enough to count as on-niche (keeps real crypto
  // news in, keeps totally off-topic tech/health/etc. out).
  crypto: 2, blockchain: 2, web3: 3, ethereum: 2, ether: 1, defi: 2,
  token: 1, tokenized: 3, tokenization: 3, nft: 2, onchain: 2, "on-chain": 2,
  staking: 2, staked: 2, coinbase: 2, binance: 2, solana: 1, "smart contract": 2,
  exchange: 1, sec: 1, "real-world asset": 3, rwa: 3, "layer 2": 2, dao: 2,

  // Generic / low-signal — down-weighted so price spam can't win
  bitcoin: -1, etf: -1, "price prediction": -3, "to the moon": -5,
  airdrop: -2, presale: -4, "100x": -5, memecoin: -2,
};

function scoreItem(item) {
  const text = `${item.title || ""}`.toLowerCase();
  let score = 0;

  // Keyword relevance keeps the ranking on-brand. `_niche` is tracked
  // separately so we can DROP items with no niche match — otherwise a recent,
  // popular but totally off-topic post (weather, gas stoves) sneaks in.
  // Word-boundary match so "sec" doesn't hit "security", "base" not "based".
  let niche = 0;
  for (const [kw, weight] of Object.entries(KEYWORD_WEIGHTS)) {
    const esc = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(?:^|[^a-z0-9])${esc}(?:[^a-z0-9]|$)`).test(text)) niche += weight;
  }
  item._niche = niche;
  score += niche;

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
    // Must be on-niche (positive keyword match) AND net-positive overall.
    .filter((i) => i._niche > 0 && i._score > 0)
    .sort((a, b) => b._score - a._score)
    .slice(0, limit);

  console.log(
    `[fetch] ${all.length} raw → ${ranked.length} ranked by keyword+momentum (+${commits.length} commits)`
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
