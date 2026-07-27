import "dotenv/config";
import { fetchTopVideos } from "../fetchers/topvideos.js";
import { computeDNA } from "../analysis/viraldna.js";
import { dnaReport } from "../ai/dna-report.js";
import { saveDNA } from "../db/excel.js";

/**
 * VIRAL DNA (metadata edition) — free, no video download.
 *
 *   npm run dna                 # uses CONTENT_FOCUS / DNA_QUERY
 *   npm run dna web3 gaming     # explicit query
 *
 * Collects the niche's top videos, mines the common patterns, and writes a
 * "Viral DNA" report + recommendations to the viral_dna sheet.
 */
const query =
  process.argv.slice(2).join(" ").trim() ||
  process.env.DNA_QUERY ||
  (process.env.CONTENT_FOCUS || "web3 gaming").split(",")[0].trim();

async function run() {
  console.log(`[dna] Analyzing top videos for: "${query}"`);
  const videos = await fetchTopVideos(query, { max: 50, sinceDays: 365 });
  if (!videos.length) {
    console.log("[dna] No videos found for that query.");
    return;
  }
  console.log(`[dna] Collected ${videos.length} top videos`);

  const stats = computeDNA(videos);
  const report = await dnaReport({
    query,
    stats,
    sampleTitles: videos.slice(0, 15).map((v) => v.title),
  });

  console.log(`\n════════ VIRAL DNA — ${query} ════════`);
  console.log(`(${stats.count} videos · avg ${Math.round(stats.duration.avg_seconds / 60)}min · avg ${stats.views.avg.toLocaleString()} views)\n`);
  console.log("PATTERNS:");
  report.summary.forEach((s) => console.log(`  • ${s}`));
  console.log("\nRECOMMENDATIONS:");
  report.recommendations.forEach((s) => console.log(`  → ${s}`));

  const id = await saveDNA({ query, stats, report });
  console.log(`\n[dna] Saved to Excel (viral_dna row #${id}).`);
}

run().catch((err) => {
  console.error("[dna] Fatal:", err.message);
  process.exit(1);
});
