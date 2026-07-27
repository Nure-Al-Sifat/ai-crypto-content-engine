import "dotenv/config";
import { collectTrends, formatTrendTable } from "../fetchers/index.js";
import { youtubeSignals } from "../fetchers/youtube.js";

/**
 * TRENDING DASHBOARD — what's trending right now and how much traction it has.
 *
 *   npm run trends
 *
 * Scans every free source, shows the ranked landscape with engagement, then
 * checks YouTube competition + view velocity on the top topics. No AI, no posts
 * — just the raw picture so you can see exactly what the engine sees.
 */
const sig = (t = "") =>
  t.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 3);

console.log("🌐 Scanning trending topics across all free sources (news + market + social)...\n");
const trends = await collectTrends({ needs: ["news", "market", "social"], limit: 40 });

console.log(`\n📊 TRENDING LANDSCAPE — ${trends.length} topics (ranked by keyword + momentum):`);
console.log(formatTrendTable(trends, 40));

const N = Number(process.env.TRENDS_YT_COUNT || 8);
console.log(`\n🎬 YouTube check on the top ${N} (competition = # of videos, velocity = views/hr on hot uploads):`);
for (const t of trends.slice(0, N)) {
  const y = await youtubeSignals(sig(t.title).slice(0, 6).join(" "));
  const gap = y && y.competition != null && y.competition < 2000 ? "  · LOW COMPETITION ✓ (content gap)" : "";
  const line = y
    ? `${y.competition ?? "?"} videos · ${Math.round(y.velocity || 0)} views/hr${gap}`
    : "no YouTube data";
  console.log(`  • ${t.title.slice(0, 58)}`);
  console.log(`      ${line}`);
}

console.log("\n✅ Done. This is the raw landscape — run `npm start` to turn the best one into posts.");
