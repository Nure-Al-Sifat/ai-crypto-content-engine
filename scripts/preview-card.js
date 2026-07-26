import "dotenv/config";
import { writeFile } from "node:fs/promises";
import { generateCard } from "../image/card.js";

/**
 * Renders a sample card to card-preview.png so you can iterate on the brand
 * design without burning an AI call.
 *
 *   npm run card
 *   npm run card -- "Your custom hook line here"
 */
const hook =
  process.argv[2] ||
  "If your onboarding has the words \"seed phrase\" in it, you don't have a product yet.";

const png = await generateCard({
  hook,
  pillar: "Market Insight",
  handle: process.env.X_HANDLE || "@yourhandle",
});

await writeFile("card-preview.png", png);
console.log(`Wrote card-preview.png (${(png.length / 1024).toFixed(1)} KB)`);
console.log(`Hook length: ${hook.length} chars`);
