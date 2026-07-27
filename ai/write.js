import { callStructured } from "./call.js";
import { PlatformContentSchema } from "./schema.js";
import { buildVoiceBlock } from "../config/voice.js";

/**
 * STAGE 5 — WRITE
 *
 * The topic is chosen (virality judge) and grounded (research). This produces
 * one ready-to-post draft PER PLATFORM, each shaped to how that platform
 * actually works — not the same text reposted four times.
 */
export async function writePlatformContent({ topic, research, pillar, focus, voiceExamples = [] }) {
  const system = `You are ghostwriting for a Web3 gaming founder. You do not sound
like an AI, a marketer, or a newsletter. You sound like this specific person.

${buildVoiceBlock(voiceExamples)}

Respond ONLY with valid JSON. No markdown fences.`;

  const researchBlock = research
    ? `RESEARCH (ground every claim in these — do not invent beyond them):
- What happened: ${research.summary}
${research.key_facts?.length ? `- Key facts: ${research.key_facts.join("; ")}` : ""}
${research.quotes?.length ? `- Quotes/stats: ${research.quotes.join(" | ")}` : ""}
- Why it matters: ${research.why_it_matters}
- Sharpest angle: ${research.sharp_angle}
${research.contrarian_take ? `- Contrarian take: ${research.contrarian_take}` : ""}`
    : `No external research available — write from the angle and the founder's
voice. Do NOT invent statistics, quotes, or events.`;

  const user = `Niche: ${focus}
Content pillar: ${pillar.label} — ${pillar.angle}

TOPIC
HEADLINE: ${topic.title}
SOURCE: ${topic.source}
LINK: ${topic.link || "n/a"}
ANGLE: ${topic.angle_seed || research?.sharp_angle || pillar.angle}

${researchBlock}

Write one ready-to-post draft for EACH platform, tuned to that platform:

- x_post: under 280 characters. Hook on the first line. At most 1 hashtag,
  usually none. Do not pad to the limit.
- linkedin_post: 3-5 short paragraphs, more reflective. Ends with a real
  question that invites disagreement — not "What do you think?".
- youtube_title: under 70 chars, curiosity-driven, no clickbait lies.
- youtube_hook: the spoken first ~10 seconds that stops the scroll.
- youtube_outline: 4-6 beats for a 60-90s video, ONE beat per line, each line
  starting with "- ". A single string, not a list.
- facebook_post: conversational and community-first, a little warmer/longer
  than X, 2-4 short paragraphs.
- hook: the single most arresting line (used as a summary).
- hashtags: up to 6, lowercase, no # symbol.

Return a FLAT JSON object exactly like this:
{"hook":"...","x_post":"...","linkedin_post":"...","youtube_title":"...","youtube_hook":"...","youtube_outline":"- beat one\n- beat two","facebook_post":"...","hashtags":["..."]}`;

  const { data, provider } = await callStructured({
    system,
    user,
    schema: PlatformContentSchema,
  });

  console.log(`[write] ${provider} drafted X / LinkedIn / YouTube / Facebook`);
  return data;
}
