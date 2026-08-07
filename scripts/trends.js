import "dotenv/config";
import { collectTrends } from "../fetchers/index.js";
import { youtubeSignals } from "../fetchers/youtube.js";
import { fetchGamingCoins } from "../fetchers/coingecko.js";

/**
 * WEB3-GAMING MARKET INTELLIGENCE — a detailed, free report.
 *
 *   npm run trends
 *
 * Scans every free source, then for the top topics shows: sources, age, real
 * engagement, and YouTube competition/velocity; plus trending themes, gaming
 * token movers (real prices), and low-competition content gaps. No AI, no posts.
 */
const sig = (t = "") =>
  t.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 3);
const ageStr = (p) => (p ? Math.round((Date.now() - new Date(p).getTime()) / 3600_000) + "h" : "—");
const views = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : Math.round(n / 1000) + "k");
const line = "═".repeat(64);

console.log(`\n🌐 WEB3-GAMING MARKET INTELLIGENCE\n${line}`);
console.log("Scanning all free sources (news + market + social)...\n");

const trends = await collectTrends({ needs: ["news", "market", "social"], limit: 40 });
if (!trends.length) {
  console.log("\nNo genuine Web3-gaming topics surfaced right now.");
  process.exit(0);
}

// ---- Trending themes: topics sharing a distinctive keyword -------------------
const generic = new Set(["gaming", "game", "games", "web3", "crypto", "blockchain", "token", "gamefi"]);
const wc = {};
for (const t of trends) for (const w of new Set(sig(t.title))) if (!generic.has(w)) wc[w] = (wc[w] || 0) + 1;
const themes = Object.entries(wc).filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1]).slice(0, 6);
if (themes.length) {
  console.log("🔥 TRENDING THEMES (multiple topics share this):");
  themes.forEach(([w, c]) => console.log(`   • "${w}" — ${c} topics`));
}

// ---- Detailed cards for the top topics (with a live YouTube check) -----------
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
    ]
      .filter(Boolean)
      .join("  ") || "—";
  const yt = y
    ? `${y.competition ?? "?"} videos · ${Math.round(y.velocity || 0)} views/hr` +
      (y.competition != null && y.competition < 2000 ? "  · LOW COMPETITION ✓" : "")
    : "n/a";
  console.log(`\n  [${i + 1}] ${t.title.slice(0, 70)}`);
  console.log(`      score ${(t._score ?? 0).toFixed(1)} · ${ageStr(t.publishedAt)} old · ${t.source}`);
  console.log(`      engagement: ${eng}`);
  console.log(`      YouTube:    ${yt}`);
  console.log(`      ${t.link || ""}`);
}

// ---- Gaming token movers (real market data) ---------------------------------
const coins = (await fetchGamingCoins()).filter((c) => c.volume > 0).sort((a, b) => b.priceChange - a.priceChange);
if (coins.length) {
  console.log(`\n💰 GAMING TOKEN MOVERS (CoinGecko gaming category, 24h):`);
  const pick = [...coins.slice(0, 4), ...coins.slice(-3).reverse()];
  for (const c of pick) {
    const a = c.priceChange >= 0 ? "↑" : "↓";
    console.log(
      `   ${a} ${c.symbol.padEnd(6)} ${c.priceChange >= 0 ? "+" : ""}${c.priceChange.toFixed(1)}%` +
        `  $${c.price}  vol $${Math.round(c.volume / 1e6)}M  (${c.name.slice(0, 20)})`
    );
  }
}

console.log(`\n${line}`);
console.log("✅ Real data only — every topic has a verifiable URL. Run `npm start` to draft posts from the top topic.");
