import "dotenv/config";
import { getPillarForDate, getPillarByKey } from "./config/pillars.js";
import { collectTrends } from "./fetchers/index.js";
import { youtubeSignals } from "./fetchers/youtube.js";
import { judgeVirality } from "./ai/viral.js";
import { opportunityScore, signalsLine } from "./ai/opportunity.js";
import { generateContent } from "./ai/generate.js";
import {
  todayKey,
  hasRunToday,
  getRecentTopics,
  recordTopic,
  savePost,
  getLatestDNA,
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
  let viral = { score: null, why: "", signals: "" };

  if (pillar.needs.length) {
    let trends = await collectTrends({ needs: pillar.needs });
    // Fall back to news+market so a run never comes up empty — e.g. Build Log
    // days when you have no recent commits (or GitHub is rate-limited).
    if (!trends.length && !pillar.needs.includes("news")) {
      console.log(`[engine] No ${pillar.label} items; falling back to news + market.`);
      trends = await collectTrends({ needs: ["news", "market"] });
    }
    if (!trends.length) {
      console.log(`[engine] No usable items after filtering. Nothing saved.`);
      return;
    }

    // AI judge shortlists; then the Opportunity Score (momentum, competition,
    // confirmation, freshness, niche + the judge's read) picks the real winner.
    const shortlist = await judgeVirality({ trends, focus, pillar, recentTopics });
    await Promise.all(
      shortlist.map(async (c) => {
        c.youtube = await youtubeSignals(sig(c.title).slice(0, 6).join(" "));
      })
    );
    const batchMaxNiche = Math.max(1, ...shortlist.map((c) => c._score || 0));
    for (const c of shortlist) c.opportunity = opportunityScore(c, { batchMaxNiche });
    shortlist.sort((a, b) => b.opportunity.score - a.opportunity.score);

    topic = shortlist[0];
    related = findRelated(topic, trends, 3);
    viral = {
      score: topic.opportunity.score,
      why: topic.why,
      signals: signalsLine(topic.opportunity),
    };

    console.log(`\n🔥 BEST OPPORTUNITY — ${topic.opportunity.score}/100: ${topic.title}`);
    console.log(`   ${viral.signals}`);
    shortlist
      .slice(1, 3)
      .forEach((r) =>
        console.log(`   runner-up (${r.opportunity.score}/100): ${r.title.slice(0, 55)}`)
      );
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

  // 4. Research + write per-platform drafts (YouTube draft follows the latest
  //    Viral DNA patterns from `npm run dna:deep`, when available).
  const dna = await getLatestDNA().catch(() => null);
  if (dna) console.log(`[engine] Applying Viral DNA patterns (${dna.query})`);
  const { content } = await generateContent({ topic, pillar, focus, related, dna });

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
