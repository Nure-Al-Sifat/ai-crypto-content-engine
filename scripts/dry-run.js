import "dotenv/config";
import { getPillarForDate, getPillarByKey } from "../config/pillars.js";
import { collectTrends } from "../fetchers/index.js";

/**
 * Fetch and score only — no AI calls, no DB writes, no notifications.
 *
 * Use this to tune KEYWORD_WEIGHTS in fetchers/index.js. If the items at the
 * top of this list aren't things you'd actually want to post about, fix the
 * weights before blaming the model.
 *
 *   npm run dry
 *   npm run dry -- --pillar=build_log
 */
const override = process.argv.find((a) => a.startsWith("--pillar="))?.split("=")[1];
const pillar = override ? getPillarByKey(override) : getPillarForDate();

console.log(`\nPillar: ${pillar.label}`);
console.log(`Needs:  [${pillar.needs.join(", ") || "none"}]\n`);

if (!pillar.needs.length) {
  console.log("This pillar uses no external data — nothing to fetch.\n");
  process.exit(0);
}

const trends = await collectTrends({ needs: pillar.needs });

console.log(`\n${"SCORE".padStart(7)}  ${"SOURCE".padEnd(22)}  TITLE`);
console.log("─".repeat(100));
for (const t of trends) {
  const score = t._score !== undefined ? t._score.toFixed(1) : "—";
  console.log(
    `${String(score).padStart(7)}  ${String(t.source).slice(0, 22).padEnd(22)}  ${String(t.title).slice(0, 68)}`
  );
}
console.log(`\n${trends.length} items would be sent to the curator.\n`);
