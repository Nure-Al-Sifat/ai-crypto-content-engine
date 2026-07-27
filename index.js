import "dotenv/config";
import { getPillarForDate, getPillarByKey } from "./config/pillars.js";
import { collectTrends } from "./fetchers/index.js";
import { judgeVirality } from "./ai/viral.js";
import { generateContent } from "./ai/generate.js";
import {
  todayKey,
  hasRunToday,
  getRecentTopics,
  recordTopic,
  savePost,
} from "./db/excel.js";

const args = process.argv.slice(2);
const FORCE = args.includes("--force") || process.env.FORCE_RERUN === "true";
const PILLAR_OVERRIDE =
  args.find((a) => a.startsWith("--pillar="))?.split("=")[1] || process.env.PILLAR_OVERRIDE;

const sig = (t = "") =>
  t.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 3);

/** The few other headlines most related to the topic, for research context. */
function findRelated(topic, trends, n = 3) {
  const words = new Set(sig(topic.title));
  return trends
    .filter((t) => t.title && t.title !== topic.title)
    .map((t) => ({ t, overlap: sig(t.title).filter((w) => words.has(w)).length }))
    .filter((x) => x.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap)
    .slice(0, n)
    .map((x) => x.t);
}

function printSummary(topic, viral, content, id) {
  const outline = (content.youtube_outline || "")
    .split("\n")
    .map((l) => `     ${l}`)
    .join("\n");
  console.log(`
════════════════════════════════════════════════════════════
🔥 TOPIC: ${topic.title}${viral.score != null ? `  (viral ${viral.score}/100)` : ""}
   Why:  ${viral.why}
   Saved to Excel as row #${id} — post from there.
────────────────────────────────────────────────────────────
🐦 X:
${content.x_post}

💼 LINKEDIN:
${content.linkedin_post}

▶️  YOUTUBE:
   Title: ${content.youtube_title}
   Hook:  ${content.youtube_hook}
   Outline:
${outline}

📘 FACEBOOK:
${content.facebook_post}

#  ${(content.hashtags || []).join(" ")}
════════════════════════════════════════════════════════════`);
}

async function run() {
  const runDate = todayKey();

  // 1. Idempotency — one post set per day unless forced.
  const existing = await hasRunToday(runDate);
  if (existing && !FORCE) {
    console.log(
      `[engine] Already ran today (row #${existing.id}, ${existing.status}). Use --force to override.`
    );
    return;
  }

  // 2. Pillar for today.
  const pillar = PILLAR_OVERRIDE ? getPillarByKey(PILLAR_OVERRIDE) : getPillarForDate();
  console.log(`[engine] Pillar: ${pillar.label} (needs: ${pillar.needs.join(", ") || "none"})`);

  const recentTopics = await getRecentTopics(14).catch(() => []);
  const focus =
    process.env.CONTENT_FOCUS ||
    "Web3 gaming, esports monetization, streamer micropayments";

  // 3. Choose the topic.
  let topic;
  let related = [];
  let viral = { score: null, why: "" };

  if (pillar.needs.length) {
    const trends = await collectTrends({ needs: pillar.needs });
    if (!trends.length) {
      console.log(`[engine] No usable items for ${pillar.label} after filtering. Nothing saved.`);
      return;
    }

    const ranked = await judgeVirality({ trends, focus, pillar, recentTopics });
    topic = ranked[0];
    related = findRelated(topic, trends, 3);
    viral = { score: topic.viral_score, why: topic.why };

    console.log(`\n🔥 BEST TOPIC — ${topic.viral_score}/100: ${topic.title}`);
    ranked
      .slice(1, 3)
      .forEach((r) => console.log(`   runner-up (${r.viral_score}/100): ${r.title.slice(0, 60)}`));
  } else {
    // Pillars like founder_story run on voice + context, no external trend.
    topic = {
      source: "internal",
      title: `${pillar.label} — founder perspective`,
      angle_seed: pillar.angle,
      link: null,
    };
    viral = { score: null, why: "No external trend — voice/context pillar" };
  }

  // 4. Research + write per-platform drafts.
  const { content } = await generateContent({ topic, pillar, focus, related });

  // 5. Save one clean row + remember the topic for dedupe.
  const { id } = await savePost({
    runDate,
    pillar: pillar.key,
    topic: topic.title,
    sourceLink: topic.link,
    viral,
    content,
  });
  await recordTopic(topic.title);

  printSummary(topic, viral, content, id);
  console.log("[engine] Done.");
}

run().catch((err) => {
  console.error("[engine] Fatal:", err.message);
  process.exit(1);
});
