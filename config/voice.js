/**
 * VOICE CONFIG
 *
 * This is the single highest-leverage file in the project. Generic prompts
 * produce generic "AI-sounding" posts that Crypto Twitter spots instantly.
 * Feeding the model your ACTUAL posts teaches it your rhythm, sentence length,
 * vocabulary, and — just as importantly — what you never say.
 *
 * HOW TO USE:
 * 1. Paste 10-15 of your own best posts into SEED_EXAMPLES below.
 *    Real ones. Not idealized ones. The model copies what's here.
 * 2. Once the feedback loop has data, top-performing posts are pulled from
 *    Supabase automatically and merged in (see getVoiceExamples).
 */

// --- Hard style rules. These are constraints, not suggestions. ---
export const STYLE_RULES = `
- Write like a founder who is actually building, not a commentator watching.
- First line is a hook. No throat-clearing, no "In today's rapidly evolving landscape".
- Short sentences. Vary length. One idea per line.
- Concrete over abstract: name the chain, the number, the specific problem.
- Never use: "game-changer", "revolutionize", "unlock", "leverage", "seamless",
  "in the world of", "let's dive in", "the future of X is here".
- No emoji walls. At most one emoji, and only if it genuinely adds meaning.
- Max 2 hashtags on X. Often zero is better.
- Do not explain crypto basics to a crypto audience.
- It is fine to be uncertain or to disagree with the consensus take.
- Never claim a GameReq metric, partnership, or milestone that is not in the
  provided context. Made-up traction numbers are the worst possible failure.
`;

// --- Replace these with your own real posts. ---
export const SEED_EXAMPLES = [
  {
    platform: "x",
    text: `Spent three weeks trying to make in-game tipping work with normal onchain txs.

Every tip = a signature popup + gas + 12s wait.

Nobody tips twice under those conditions.

State channels fixed it. Tip is instant, settlement happens later. The user never sees a wallet.`,
  },
  {
    platform: "x",
    text: `Most "Web3 gaming" projects are still asking players to understand wallets.

That's the whole adoption problem in one sentence.

If your onboarding has the word "seed phrase" in it, you don't have a product yet.`,
  },
  {
    platform: "linkedin",
    text: `We onboarded our first 40 tournament players in Dhaka last month — manually, one by one, over WhatsApp.

Not scalable. Deliberately so.

Every single onboarding surfaced something our docs got wrong. Players didn't understand why a payout took a day. Organizers didn't trust a balance they couldn't see move.

You cannot learn either of those things from a dashboard.

We'll automate this eventually. But not before we understand exactly what we're automating.

For other founders in early-stage marketplaces: how long did you stay manual before you scaled?`,
  },
];

/**
 * Formats voice examples into a prompt block.
 * @param {Array<{platform: string, text: string}>} learnedExamples
 *   Top-performing past posts pulled from the DB (optional).
 */
export function buildVoiceBlock(learnedExamples = []) {
  // Learned examples go LAST — models weight recent context more heavily,
  // so proven winners sit closest to the instruction.
  const all = [...SEED_EXAMPLES, ...learnedExamples];

  const formatted = all
    .map((ex, i) => `--- Example ${i + 1} (${ex.platform}) ---\n${ex.text}`)
    .join("\n\n");

  return `Here are posts written in the exact voice you must match:

${formatted}

STYLE RULES (non-negotiable):
${STYLE_RULES}`;
}
