import { z } from "zod";
import { callStructured } from "./call.js";

const DnaReportSchema = z.object({
  summary: z.array(z.string()).min(1), // the common "Viral DNA" patterns
  recommendations: z.array(z.string()).min(1), // concrete next-video advice
});

/**
 * Turns the aggregate stats into a plain-language Viral DNA report + concrete
 * recommendations. Grounded strictly in the numbers — told not to invent any.
 */
export async function dnaReport({ query, stats, sampleTitles = [], sampleHooks = [] }) {
  const system = `You are a YouTube strategist for a Web3 gaming creator. Given
aggregate stats from the niche's TOP videos (metadata plus, when present, "deep"
signals from actual video analysis — shot length, talking-head ratio, tempo,
speech rate), produce:
1) summary — the common "Viral DNA" patterns, each a short data-backed sentence
   (e.g. "72% of top titles include a number", "avg shot length 2.4s").
2) recommendations — concrete, specific advice for the creator's next video
   (title style, ideal length, best upload day, hook approach, pacing, tags).

Base EVERY point on the provided stats — do not invent numbers or claims.
Respond ONLY with valid JSON. No markdown fences.`;

  const hookBlock = sampleHooks.length
    ? `\nSAMPLE OPENING HOOKS (first ~30s of top videos):\n${sampleHooks.map((h) => `- ${h}`).join("\n")}`
    : "";

  const user = `Niche: ${query}

AGGREGATE STATS (JSON):
${JSON.stringify(stats, null, 2)}

SAMPLE TOP TITLES:
${sampleTitles.map((t) => `- ${t}`).join("\n")}
${hookBlock}

Return JSON: {"summary":["..."],"recommendations":["..."]}`;

  const { data, provider } = await callStructured({ system, user, schema: DnaReportSchema });
  console.log(`[dna] ${provider} wrote the report`);
  return data;
}
