import { callStructured } from "./call.js";
import { CritiqueSchema } from "./schema.js";
import { STYLE_RULES } from "../config/voice.js";

/**
 * PASS 3 — SELF-CRITIQUE
 *
 * Models are far better at spotting weak writing than at avoiding it on the
 * first attempt. One critique-and-revise round is the cheapest quality gain
 * available — roughly one extra call for a noticeably better post.
 *
 * The rubric is deliberately harsh. A lenient critic always says "ship".
 */

const RUBRIC = `Judge against these, and be harsh:

1. GENERIC TEST — could this exact post have been written by someone who is not
   building this product? If yes, it fails.
2. HOOK TEST — does the first line make a reader stop scrolling? "Interesting
   news today" fails. A specific claim, number, or admission passes.
3. CONSENSUS TEST — is this the take everyone else already posted? If it merely
   restates the news, it fails.
4. FABRICATION TEST — does it assert any metric, partnership, user count, or
   milestone not present in the source material? If yes, it fails. This is the
   most serious failure mode.
5. SLOP TEST — banned phrases, emoji walls, hashtag stuffing, LinkedIn-broetry
   line breaks used for their own sake.
6. LENGTH TEST — is x_post under 280 characters?`;

export async function critiqueAndRevise({ variant, pillar, sourceMaterial }) {
  const system = `You are a brutal editor reviewing a draft social post for a Web3
gaming founder. Your default is "revise". You only say "ship" when the post
would genuinely make a well-informed reader stop and think.

STYLE RULES the post must obey:
${STYLE_RULES}

Respond ONLY with valid JSON. No markdown fences.`;

  const user = `${RUBRIC}

SOURCE MATERIAL THE POST MUST STAY FAITHFUL TO:
${sourceMaterial}

CONTENT PILLAR: ${pillar.label}

DRAFT UNDER REVIEW:
${JSON.stringify(variant, null, 2)}

If it fails any test, set verdict to "revise", list the problems, and return a
fully rewritten version in "revised" with the same JSON shape as the draft.
If it passes everything, set verdict to "ship" and leave revised as null.

Return JSON:
{"verdict": "revise", "problems": ["..."], "revised": { ...same shape as draft... }}`;

  try {
    const { data, provider } = await callStructured({
      system,
      user,
      schema: CritiqueSchema,
    });

    if (data.verdict === "ship") {
      console.log(`[critique] ${provider}: shipped as-is`);
      return { variant, critique: data };
    }

    if (data.revised) {
      console.log(`[critique] ${provider}: revised — ${data.problems.join("; ")}`);
      return { variant: data.revised, critique: data };
    }

    // Said revise but gave nothing back — keep the original
    console.warn("[critique] verdict was revise but no revision returned; keeping original");
    return { variant, critique: data };
  } catch (err) {
    // Critique is an enhancement, not a hard dependency. Never let it kill a run.
    console.warn(`[critique] skipped: ${err.message}`);
    return { variant, critique: null };
  }
}
