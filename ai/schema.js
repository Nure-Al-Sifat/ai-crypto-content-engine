import { z } from "zod";

/**
 * LLMs return malformed JSON often enough that unvalidated parsing will
 * eventually crash a scheduled run at 6am with no one watching.
 * Validate the shape, fail loudly, and let call.js retry.
 */

// Stage 3 — the virality judge ranks candidates by viral potential.
export const ViralSchema = z.object({
  ranked: z
    .array(
      z.object({
        index: z.number().int().min(0),
        viral_score: z.number().min(0).max(100),
        why: z.string().min(1),
        angle: z.string().min(1),
        risk: z.string().optional().default(""),
      })
    )
    .min(1),
});

// Stage 4 — research grounds the chosen topic in real facts.
export const ResearchSchema = z.object({
  summary: z.string().min(1),
  key_facts: z.array(z.string()).default([]),
  quotes: z.array(z.string()).default([]),
  why_it_matters: z.string().min(1),
  sharp_angle: z.string().min(1),
  contrarian_take: z.string().optional().default(""),
});

// Stage 5 — one ready-to-post draft per platform.
// Deliberately FLAT (no nested objects/arrays except hashtags): flat JSON is
// far more reliable for LLM json-mode than nested structures.
export const PlatformContentSchema = z.object({
  hook: z.string().min(1), // one arresting line (also the summary)
  x_post: z.string().min(1), // hard-trimmed to 280 later
  linkedin_post: z.string().min(1),
  youtube_title: z.string().min(1),
  youtube_hook: z.string().min(1), // spoken opening, first ~10 seconds
  youtube_outline: z.string().min(1), // beats, one per line ("- ...")
  facebook_post: z.string().min(1),
  hashtags: z.array(z.string()).max(8).default([]),
});

/**
 * Strips markdown fences and parses. Throws a descriptive error on failure
 * so the retry layer can feed it back to the model.
 */
export function parseAndValidate(rawText, schema) {
  let cleaned = String(rawText).trim();

  // Strip ```json ... ``` fences if the model added them despite instructions
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");

  // Some models prepend prose. Grab the outermost JSON object if so.
  if (!cleaned.startsWith("{")) {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start !== -1 && end > start) cleaned = cleaned.slice(start, end + 1);
  }

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(`Model returned invalid JSON: ${err.message}`);
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`Model output failed validation: ${issues}`);
  }

  return result.data;
}
