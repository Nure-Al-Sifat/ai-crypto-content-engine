import { callStructured } from "./call.js";
import { WriteSchema } from "./schema.js";
import { buildVoiceBlock } from "../config/voice.js";

/**
 * PASS 2 — WRITING
 *
 * Now the model has 1-2 curated items plus a stated angle, and its whole
 * budget goes into craft rather than triage.
 *
 * It produces N genuinely different angles, not N rewordings. Forcing distinct
 * strategic angles is what makes the variant picker useful instead of cosmetic.
 */

const ANGLE_STRATEGIES = [
  "Contrarian — argue against the obvious reading of this news",
  "Builder's lens — what this changes for someone actually shipping in this space",
  "Personal — connect it to a specific moment from building GameReq",
];

export async function writePosts({ items, pillar, focus, voiceExamples = [], variantCount = 3 }) {
  const system = `You are ghostwriting for a Web3 gaming founder. You do not sound
like an AI, a marketer, or a newsletter. You sound like this specific person.

${buildVoiceBlock(voiceExamples)}

Respond ONLY with valid JSON. No markdown fences.`;

  const itemBlock = items
    .map(
      (it) =>
        `SOURCE: ${it.source}\nHEADLINE: ${it.title}\nLINK: ${it.link || "n/a"}\nSUGGESTED ANGLE: ${it.angle_seed}`
    )
    .join("\n\n");

  const strategies = ANGLE_STRATEGIES.slice(0, variantCount)
    .map((s, i) => `Variant ${i + 1} — ${s}`)
    .join("\n");

  const threadInstruction = pillar.preferThread
    ? `This pillar suits a thread. For at least one variant, populate x_thread with
5-7 tweets (each under 280 chars). The first thread item should equal x_post.`
    : `Leave x_thread as an empty array unless the idea genuinely needs more than
one tweet.`;

  const user = `Focus area: ${focus}
Content pillar: ${pillar.label}
Pillar angle: ${pillar.angle}

MATERIAL:
${itemBlock}

Write ${variantCount} variants. Each must take a genuinely DIFFERENT strategic
angle — not the same point reworded:
${strategies}

For each variant produce:
- angle: 3-6 words naming the strategic angle
- hook: the single most arresting line, under 90 characters (used on a graphic)
- x_post: under 280 characters. Do not pad to reach the limit.
- x_thread: ${threadInstruction}
- linkedin_post: 3-5 short paragraphs, more reflective, ends with a real
  question that invites disagreement — not "What do you think?"
- hashtags: up to 5, no # symbol, lowercase

Return JSON:
{"variants": [{"angle": "...", "hook": "...", "x_post": "...", "x_thread": [], "linkedin_post": "...", "hashtags": ["..."]}], "source_used": "..."}`;

  const { data, provider } = await callStructured({
    system,
    user,
    schema: WriteSchema,
  });

  console.log(`[write] ${provider} produced ${data.variants.length} variants`);
  return data;
}
