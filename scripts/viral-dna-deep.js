import "dotenv/config";
import { fetchTopVideos } from "../fetchers/topvideos.js";
import { computeDNA } from "../analysis/viraldna.js";
import { deepAnalyze, aggregateDeep } from "../analysis/deep-runner.js";
import { dnaReport } from "../ai/dna-report.js";
import { saveDNA } from "../db/excel.js";

/**
 * VIRAL DNA (DEEP) — metadata + actual video-content analysis.
 *
 *   npm run dna:deep                # CONTENT_FOCUS / DNA_QUERY
 *   npm run dna:deep web3 gaming    # explicit query
 *
 * Collects the niche's top videos, then downloads + analyzes the top few
 * (scenes, talking-head ratio, tempo, speech rate, hooks) via the local Python
 * pipeline, and writes a combined report. Deep analysis is best-effort per
 * video — YouTube rate-limits, so some videos are skipped without failing.
 */
const query =
  process.argv.slice(2).join(" ").trim() ||
  process.env.DNA_QUERY ||
  (process.env.CONTENT_FOCUS || "web3 gaming").split(",")[0].trim();
const DEEP_N = Number(process.env.DNA_DEEP_COUNT || 5);

async function run() {
  console.log(`[dna] Analyzing top videos for: "${query}"`);
  const videos = await fetchTopVideos(query, { max: 50, sinceDays: 365 });
  if (!videos.length) {
    console.log("[dna] No videos found for that query.");
    return;
  }
  console.log(`[dna] Collected ${videos.length} top videos`);
  const stats = computeDNA(videos);

  console.log(`[dna] Deep-analyzing top ${DEEP_N} (download + scene + vision + audio)...`);
  const deepResults = [];
  for (const v of videos.slice(0, DEEP_N)) {
    process.stdout.write(`  • ${v.title.slice(0, 42)} ... `);
    const r = await deepAnalyze(v.videoId, v.thumbnail);
    console.log(
      r.error
        ? `skipped (${r.error.slice(0, 40)})`
        : `ok — ${r.scenes ?? "?"} scenes, ${
            r.talking_head_ratio != null ? Math.round(r.talking_head_ratio * 100) + "% face" : "?"
          }, ${r.dominant_emotion ?? "?"}, ${(r.top_objects || []).slice(0, 2).join("/") || "?"}`
    );
    deepResults.push(r);
  }
  const deep = aggregateDeep(deepResults);
  const combined = { ...stats, deep };

  const report = await dnaReport({
    query,
    stats: combined,
    sampleTitles: videos.slice(0, 15).map((v) => v.title),
    sampleHooks: deep.sample_hooks,
  });

  console.log(`\n════════ VIRAL DNA (deep) — ${query} ════════`);
  console.log(`(metadata: ${stats.count} videos · deep: ${deep.analyzed}/${deep.attempted} analyzed)\n`);
  console.log("PATTERNS:");
  report.summary.forEach((s) => console.log(`  • ${s}`));
  console.log("\nRECOMMENDATIONS:");
  report.recommendations.forEach((s) => console.log(`  → ${s}`));

  const id = await saveDNA({ query, stats: combined, report });
  console.log(`\n[dna] Saved to Excel (viral_dna row #${id}).`);
}

run().catch((err) => {
  console.error("[dna] Fatal:", err.message);
  process.exit(1);
});
