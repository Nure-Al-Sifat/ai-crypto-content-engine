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
export async function dnaReport({ query, stats, sampleTitles = [] }) {
  const system = `You are a YouTube strategist for a Web3 gaming creator. Given
aggregate stats from the niche's TOP videos, produce:
1) summary — the common "Viral DNA" patterns, each a short data-backed sentence
   (e.g. "72% of top titles include a number").
2) recommendations — concrete, specific advice for the creator's next video
   (title style, ideal length, best upload day, hook approach, tags).

Base EVERY point on the provided stats — do not invent numbers or claims.
Respond ONLY with valid JSON. No markdown fences.`;

  const user = `Niche: ${query}

AGGREGATE STATS (JSON):
${JSON.stringify(stats, null, 2)}

SAMPLE TOP TITLES:
${sampleTitles.map((t) => `- ${t}`).join("\n")}

Return JSON: {"summary":["..."],"recommendations":["..."]}`;

  const { data, provider } = await callStructured({ system, user, schema: DnaReportSchema });
  console.log(`[dna] ${provider} wrote the report`);
  return data;
}
