import "dotenv/config";
import { collectTrends } from "../fetchers/index.js";
import { youtubeSignals } from "../fetchers/youtube.js";
import { fetchGamingCoins } from "../fetchers/coingecko.js";
import { fetchGamingChainTVL } from "../fetchers/defillama.js";
import { loadHistory, saveSnapshot, compare, topicKey } from "../analysis/history.js";

/**
 * WEB3-GAMING MARKET INTELLIGENCE — detailed, free.
 *   npm run trends
 * Sources -> ranked topics with sources/age/engagement/YouTube; trending themes;
 * day-over-day momentum (NEW vs persisting); token<->news links; gaming token
 * movers; and gaming-chain TVL. No AI, no posts — the raw picture, real data only.
 */
const sig = (t = "") =>
  t.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 3);
const ageStr = (p) => (p ? Math.round((Date.now() - new Date(p).getTime()) / 3600_000) + "h" : "—");
const views = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : Math.round(n / 1000) + "k");
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const line = "═".repeat(64);

console.log(`\n🌐 WEB3-GAMING MARKET INTELLIGENCE\n${line}`);
console.log("Scanning all free sources (news + market + social)...\n");

const trends = await collectTrends({ needs: ["news", "market", "social"], limit: 40 });
if (!trends.length) {
  console.log("\nNo genuine Web3-gaming topics surfaced right now.");
  process.exit(0);
}
const coins = (await fetchGamingCoins()).filter((c) => c.volume > 0);

// ---- Day-over-day momentum --------------------------------------------------
const today = new Date().toISOString().slice(0, 10);
const current = {
  date: today,
  topics: trends.map((t) => ({ key: topicKey(t.title), title: t.title.slice(0, 80) })),
  tokens: coins.map((c) => ({ symbol: c.symbol, price: c.price })),
};
const cmp = compare(current, await loadHistory());
if (cmp.firstRun) {
  console.log("📈 MOMENTUM: baseline snapshot saved — run again (daily) to see NEW / persisting / token moves.");
} else {
  console.log(`📈 MOMENTUM (vs ${cmp.prevDate}):`);
  console.log(`   🆕 NEW since then: ${cmp.newTopics.length}`);
  cmp.newTopics.slice(0, 5).forEach((t) => console.log(`      • ${t.title.slice(0, 62)}`));
  console.log(`   🔁 Persisting (sustained stories): ${cmp.persisting.length}`);
  if (cmp.tokenMoves.length) {
    console.log(`   💹 Biggest token moves since ${cmp.prevDate}:`);
    cmp.tokenMoves.slice(0, 4).forEach((t) =>
      console.log(`      ${t.pct >= 0 ? "↑" : "↓"} ${t.symbol} ${t.pct >= 0 ? "+" : ""}${t.pct.toFixed(1)}%`)
    );
  }
}

// ---- Trending themes --------------------------------------------------------
const generic = new Set(["gaming", "game", "games", "web3", "crypto", "blockchain", "token", "gamefi"]);
const wc = {};
for (const t of trends) for (const w of new Set(sig(t.title))) if (!generic.has(w)) wc[w] = (wc[w] || 0) + 1;
const themes = Object.entries(wc).filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1]).slice(0, 6);
if (themes.length) {
  console.log("\n🔥 TRENDING THEMES (multiple topics share this):");
  themes.forEach(([w, c]) => console.log(`   • "${w}" — ${c} topics`));
}

// ---- Detailed topic cards ---------------------------------------------------
const N = Number(process.env.TRENDS_DETAIL || 6);
console.log(`\n📰 TOP ${Math.min(N, trends.length)} TOPICS (detailed):`);
for (let i = 0; i < Math.min(N, trends.length); i++) {
  const t = trends[i];
  const y = await youtubeSignals(sig(t.title).slice(0, 6).join(" "));
  const eng =
    [
      t.upvotes ? `↑${t.upvotes}` : null,
      t.comments ? `💬${t.comments}` : null,
      t.views ? `▶${views(t.views)} views` : null,
      t.priceChange != null ? `${t.priceChange >= 0 ? "+" : ""}${t.priceChange.toFixed(1)}% 24h` : null,
    ].filter(Boolean).join("  ") || "—";
  const yt = y
    ? `${y.competition ?? "?"} videos · ${Math.round(y.velocity || 0)} views/hr` +
      (y.competition != null && y.competition < 2000 ? "  · LOW COMPETITION ✓" : "")
    : "n/a";
  // token <-> news link: does a gaming token appear in the headline?
  const linked = coins.find(
    (c) =>
      new RegExp(`(?:^|[^a-z0-9])(${esc(c.name)})(?:[^a-z0-9]|$)`, "i").test(t.title) ||
      (c.symbol.length >= 3 && new RegExp(`(?:^|[^a-z0-9])${esc(c.symbol)}(?:[^a-z0-9]|$)`, "i").test(t.title))
  );
  console.log(`\n  [${i + 1}] ${t.title.slice(0, 70)}`);
  console.log(`      score ${(t._score ?? 0).toFixed(1)} · ${ageStr(t.publishedAt)} old · ${t.source}`);
  console.log(`      engagement: ${eng}`);
  console.log(`      YouTube:    ${yt}`);
  if (linked)
    console.log(
      `      💰 related token: ${linked.symbol} ${linked.priceChange >= 0 ? "+" : ""}${linked.priceChange.toFixed(1)}% 24h`
    );
  console.log(`      ${t.link || ""}`);
}

// ---- Gaming token movers ----------------------------------------------------
const sorted = [...coins].sort((a, b) => b.priceChange - a.priceChange);
if (sorted.length) {
  console.log(`\n💰 GAMING TOKEN MOVERS (CoinGecko gaming category, 24h):`);
  for (const c of [...sorted.slice(0, 4), ...sorted.slice(-3).reverse()]) {
    const a = c.priceChange >= 0 ? "↑" : "↓";
    console.log(
      `   ${a} ${c.symbol.padEnd(6)} ${c.priceChange >= 0 ? "+" : ""}${c.priceChange.toFixed(1)}%` +
        `  $${c.price}  vol $${Math.round(c.volume / 1e6)}M  (${c.name.slice(0, 20)})`
    );
  }
}

// ---- Gaming-chain TVL (DefiLlama) -------------------------------------------
const tvl = await fetchGamingChainTVL();
if (tvl.length) {
  console.log(`\n🏦 GAMING-CHAIN TVL (DefiLlama — real money locked on-chain):`);
  for (const c of tvl) console.log(`   ${c.name.padEnd(14)} $${(c.tvl / 1e6).toFixed(1)}M`);
}

await saveSnapshot(current);
console.log(`\n${line}`);
console.log("✅ Real data only — verifiable URLs. Snapshot saved for day-over-day momentum. `npm start` drafts posts.");
