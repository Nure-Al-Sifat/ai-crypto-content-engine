import { z } from "zod";

/**
 * LLMs return malformed JSON often enough that unvalidated parsing will
 * eventually crash a scheduled run at 6am with no one watching.
 * Validate the shape, fail loudly, retry.
 */

export const CurationSchema = z.object({
  selected: z
    .array(
      z.object({
        index: z.number().int().min(0),
        relevance: z.number().min(0).max(10),
        reason: z.string().min(1),
      })
    )
    .min(1)
    .max(3),
  discard_reason: z.string().optional(),
});

export const PostVariantSchema = z.object({
  angle: z.string().min(1),
  x_post: z.string().min(1).max(400), // hard-trimmed to 280 later
  x_thread: z.array(z.string()).optional().default([]),
  linkedin_post: z.string().min(1),
  hashtags: z.array(z.string()).max(6).default([]),
  hook: z.string().min(1), // the single line used on the quote card
});

export const WriteSchema = z.object({
  variants: z.array(PostVariantSchema).min(1).max(3),
  source_used: z.string().min(1),
});

export const CritiqueSchema = z.object({
  verdict: z.enum(["ship", "revise"]),
  problems: z.array(z.string()).default([]),
  revised: PostVariantSchema.nullable().optional(),
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
