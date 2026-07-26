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
      console.warn(`[ai] attempt ${attempt}/${maxAttempts} failed: ${err.message}`);

      // Feed the failure back so the next attempt corrects it
      currentUser = `${user}

IMPORTANT: your previous response was rejected with this error:
"${err.message}"
Return ONLY valid JSON matching the requested schema exactly. No markdown fences, no prose.`;

      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 1000 * 2 ** (attempt - 1)));
      }
    }
  }

  throw new Error(`callStructured exhausted ${maxAttempts} attempts: ${lastError.message}`);
}
