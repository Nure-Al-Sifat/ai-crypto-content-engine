import { callLLM } from "./providers.js";
import { parseAndValidate } from "./schema.js";

/**
 * Calls the LLM and validates the response against a schema.
 * On a validation failure, the error text is fed back to the model so it can
 * correct itself — this recovers the large majority of malformed responses
 * without burning a whole run.
 */
export async function callStructured({ system, user, schema, maxAttempts = 3 }) {
  let lastError;
  let currentUser = user;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const { text, provider } = await callLLM({ system, user: currentUser });
      const data = parseAndValidate(text, schema);
      return { data, provider };
    } catch (err) {
      lastError = err;

      // Self-correcting retry: feed the error back so the model fixes it. This
      // is normal and recovers silently — we only surface it if every attempt
      // is exhausted (below), so a healed retry doesn't look like a failure.
      currentUser = `${user}

IMPORTANT: your previous response was rejected with this error:
"${err.message}"
Return ONLY valid JSON matching the requested schema exactly. No markdown fences, no prose.`;

      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 600 * attempt));
      }
    }
  }

  throw new Error(`callStructured exhausted ${maxAttempts} attempts: ${lastError.message}`);
}
