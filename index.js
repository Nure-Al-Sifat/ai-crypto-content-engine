import "dotenv/config";
import { getPillarForDate, getPillarByKey } from "./config/pillars.js";
import { collectTrends } from "./fetchers/index.js";
import { generateContent } from "./ai/generate.js";
import { generateCard } from "./image/card.js";
import {
  todayKey,
  hasRunToday,
  getRecentTopics,
  getTopPerformingExamples,
  savePost,
  recordTopics,
  getPostsAwaitingMetrics,
} from "./db/supabase.js";
import {
  sendPostForReview,
  sendPhoto,
  sendMessage,
} from "./notify/telegram.js";

const args = process.argv.slice(2);
const FORCE = args.includes("--force") || process.env.FORCE_RERUN === "true";
const PILLAR_OVERRIDE =
  args.find((a) => a.startsWith("--pillar="))?.split("=")[1] || process.env.PILLAR_OVERRIDE;

async function run() {
  const runDate = todayKey();

  // ---- 1. Idempotency -------------------------------------------------
  const existing = await hasRunToday(runDate);
  if (existing && !FORCE) {
    console.log(`[engine] Already ran today (post #${existing.id}, ${existing.status}). Use --force to override.`);
    return;
  }
  if (existing && FORCE) {
    console.log(`[engine] Forcing re-run over post #${existing.id}`);
  }

  // ---- 2. Pillar for today -------------------------------------------
  const pillar = PILLAR_OVERRIDE
    ? getPillarByKey(PILLAR_OVERRIDE)
    : getPillarForDate();
  console.log(`[engine] Pillar: ${pillar.label} (needs: ${pillar.needs.join(", ") || "none"})`);

  // ---- 3. Load memory + learned voice in parallel ---------------------
  const [recentTopics, voiceExamples] = await Promise.all([
    getRecentTopics(14).catch(() => []),
    getTopPerformingExamples(8).catch(() => []),
  ]);

  // ---- 4. Fetch only what this pillar needs ---------------------------
  const trends = pillar.needs.length
    ? await collectTrends({ needs: pillar.needs })
    : [];

  if (pillar.needs.length && !trends.length) {
    await sendMessage(
      `⚠️ Engine ran for ${pillar.label} but found zero usable items after filtering. Check feeds and keyword weights.`
    );
    return;
  }

  // ---- 5. Generate (curate -> write -> critique) ----------------------
  const focus =
    process.env.CONTENT_FOCUS ||
    "Web3 gaming, esports monetization, streamer micropayments";

  const result = await generateContent({
    trends,
    pillar,
    focus,
    voiceExamples,
    recentTopics,
    variantCount: Number(process.env.VARIANT_COUNT || 3),
  });

  // ---- 6. Persist -----------------------------------------------------
  const saved = await savePost({
    runDate,
    pillar: pillar.key,
    variants: result.variants,
    sources: result.sources,
    critique: { problems: result.critique_problems },
  });
  await recordTopics(saved.id, result.sources);
  console.log(`[engine] Saved post #${saved.id}`);

  // ---- 7. Branded card (non-fatal if it fails) ------------------------
  try {
    const png = await generateCard({
      hook: result.variants[0].hook,
      pillar: pillar.label,
      handle: process.env.X_HANDLE || "@yourhandle",
    });
    await sendPhoto(png, `${pillar.label} — card for post #${saved.id}`);
  } catch (err) {
    console.warn(`[engine] Card generation skipped: ${err.message}`);
  }

  // ---- 8. Send for review --------------------------------------------
  const warnings = [];
  if (result.critique_problems.length) {
    warnings.push(`Editor flagged: ${result.critique_problems.join("; ")}`);
  }
  if (result.variants.some((v) => v.length_warning)) {
    warnings.push("A variant was auto-trimmed to fit 280 chars");
  }

  await sendPostForReview({
    postId: saved.id,
    variants: result.variants,
    variantIndex: 0,
    pillar: pillar.label,
    sources: result.sources,
    warnings,
  });

  // ---- 9. Nudge for engagement data (closes the feedback loop) --------
  const awaiting = await getPostsAwaitingMetrics();
  if (awaiting.length) {
    const list = awaiting.map((p) => `#${p.id} (${p.pillar})`).join(", ");
    await sendMessage(
      `📊 Waiting on metrics for: ${list}\nReply /metrics <id> <impressions> <likes> <reposts> <replies>`
    );
  }

  console.log("[engine] Done.");
}

run().catch(async (err) => {
  console.error("[engine] Fatal:", err);
  try {
    await sendMessage(`🚨 Content engine failed: ${err.message}`);
  } catch {
    /* notification is best-effort */
  }
  process.exit(1);
});
