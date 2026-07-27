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

  // Generic crypto — low weight, needs everything else to carry it
  bitcoin: -1, etf: -1, "price prediction": -3, "to the moon": -5,
  airdrop: -2, presale: -4, "100x": -5, memecoin: -2,
};

function scoreItem(item) {
  const text = `${item.title || ""}`.toLowerCase();
  let score = 0;

  // Keyword relevance keeps the ranking on-brand (this is what stops a viral
  // but off-topic post from winning).
  for (const [kw, weight] of Object.entries(KEYWORD_WEIGHTS)) {
    if (text.includes(kw)) score += weight;
  }

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
    if (!existing || (item._score || 0) > (existing._score || 0)) {
      seen.set(normalized, item);
    }
  }

  return [...seen.values()];
}

/**
 * Fetches only the sources the day's pillar actually needs, scores, dedupes,
 * and returns the top N.
 */
export async function collectTrends({ needs = ["news", "market", "social"], limit = 25 } = {}) {
  const tasks = [];
  const soft = (p, label) =>
    p.catch((e) => {
      console.warn(`[fetch] ${label} failed: ${e.message}`);
      return [];
    });

  if (needs.includes("news")) {
    tasks.push(soft(fetchRssTrends(), "rss"));
    tasks.push(soft(fetchHackerNewsTrends(), "hackernews"));
    tasks.push(soft(fetchYouTubeTrends(), "youtube"));
  }
  if (needs.includes("market")) {
    tasks.push(soft(fetchCoinGeckoTrends(), "coingecko"));
  }
  if (needs.includes("social")) {
    tasks.push(soft(fetchRedditTrends(), "reddit"));
    tasks.push(soft(fetchFarcasterTrends(), "farcaster"));
  }
  if (needs.includes("commits")) {
    tasks.push(soft(fetchRecentCommits(), "github"));
  }

  const settled = await Promise.all(tasks);
  const all = settled.flat();

  // Commits bypass scoring — every one of them is on-topic by definition
  const commits = all.filter((i) => i.type === "commit");
  const rest = all.filter((i) => i.type !== "commit");

  for (const item of rest) item._score = scoreItem(item);

  const ranked = dedupeByTitle(rest)
    .filter((i) => i._score > 0)
    .sort((a, b) => b._score - a._score)
    .slice(0, limit);

  console.log(
    `[fetch] ${all.length} raw -> ${ranked.length} ranked (+${commits.length} commits)`
  );

  return [...commits, ...ranked];
}

export { scoreItem, dedupeByTitle };
