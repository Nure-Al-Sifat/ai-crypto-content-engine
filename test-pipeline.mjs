// Mock the LLM so we can test the full wiring with zero API keys.
import { getPillarForDate, getPillarByKey, PILLARS } from "./config/pillars.js";
import { parseAndValidate, CurationSchema, WriteSchema, CritiqueSchema } from "./ai/schema.js";
import { xLength } from "./ai/generate.js";
import { buildVoiceBlock } from "./config/voice.js";
import { scoreItem } from "./fetchers/index.js";

console.log("=== 1. PILLAR ROTATION (7 days) ===");
for (let i = 0; i < 7; i++) {
  const d = new Date(Date.UTC(2026, 6, 26 + i));
  const p = getPillarForDate(d);
  console.log(`  ${d.toISOString().slice(0,10)} (${["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d.getUTCDay()]}) -> ${p.label.padEnd(22)} needs: [${p.needs.join(",")}]`);
}

console.log("\n=== 2. SCHEMA VALIDATION ===");
const good = '```json\n{"selected":[{"index":0,"relevance":8.5,"reason":"specific angle"}]}\n```';
console.log("  fenced JSON  ->", JSON.stringify(parseAndValidate(good, CurationSchema)));

const prosey = 'Sure! Here is the result:\n{"selected":[{"index":2,"relevance":7,"reason":"ok"}]}\nHope that helps!';
console.log("  prose-wrapped ->", JSON.stringify(parseAndValidate(prosey, CurationSchema)));

try {
  parseAndValidate('{"selected":[{"index":0,"relevance":99,"reason":"x"}]}', CurationSchema);
} catch (e) { console.log("  out-of-range  -> correctly rejected:", e.message.slice(0,60)); }

try {
  parseAndValidate('not json at all', CurationSchema);
} catch (e) { console.log("  garbage       -> correctly rejected:", e.message.slice(0,50)); }

console.log("\n=== 3. X LENGTH (weighted) ===");
const cases = [
  "Short and clean.",
  "Check this out https://gamereq.io/some/very/long/path/that/goes/on/forever/really",
  "রিয়েল-টাইম মাইক্রোপেমেন্ট নিয়ে কাজ করছি",
  "a".repeat(295),
];
for (const c of cases) {
  const l = xLength(c);
  console.log(`  ${String(l).padStart(4)} chars ${l > 280 ? "OVER " : "ok   "} | ${c.slice(0,50)}`);
}

console.log("\n=== 4. VOICE BLOCK ===");
const vb = buildVoiceBlock([{ platform: "x", text: "A learned top-performer post." }]);
console.log(`  built, ${vb.length} chars, ${(vb.match(/--- Example/g)||[]).length} examples`);
console.log(`  learned example placed last: ${vb.lastIndexOf("learned top-performer") > vb.lastIndexOf("Example 3")}`);

console.log("\n=== 5. WRITE SCHEMA w/ defaults ===");
const w = parseAndValidate(JSON.stringify({
  variants: [{ angle:"Contrarian", hook:"A hook", x_post:"Post text", linkedin_post:"LI text" }],
  source_used: "CoinDesk"
}), WriteSchema);
console.log("  defaults applied ->", JSON.stringify(w.variants[0].hashtags), JSON.stringify(w.variants[0].x_thread));

console.log("\n=== 6. CRITIQUE SCHEMA ===");
const c1 = parseAndValidate('{"verdict":"ship","problems":[],"revised":null}', CritiqueSchema);
console.log("  ship verdict ->", c1.verdict, "| revised:", c1.revised);
