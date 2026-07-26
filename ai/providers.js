import fetch from "node-fetch";

/**
 * PROVIDER FALLBACK CHAIN
 *
 * Free tiers run out, rate-limit, or go down. A single-provider setup means a
 * silently missed day. Each provider is tried in order until one succeeds.
 *
 * Configure order with AI_PROVIDERS=gemini,groq,ollama
 */

const TIMEOUT_MS = 60_000;

async function withTimeout(promise, ms = TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await promise(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

// ---------- Gemini (free tier, works from GitHub Actions) ----------
async function callGemini({ system, user }) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY not set");

  const model = process.env.GEMINI_MODEL || "gemini-2.0-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

  const res = await withTimeout((signal) =>
    fetch(url, {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.85,
        },
      }),
    })
  );

  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini returned empty content (quota or safety filter)");
  return text;
}

// ---------- Groq (free tier, very fast) ----------
async function callGroq({ system, user }) {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error("GROQ_API_KEY not set");

  const res = await withTimeout((signal) =>
    fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        response_format: { type: "json_object" },
        temperature: 0.85,
      }),
    })
  );

  if (!res.ok) throw new Error(`Groq ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error("Groq returned empty content");
  return text;
}

// ---------- Ollama (fully local, zero cost, no cloud runner) ----------
async function callOllama({ system, user }) {
  const base = process.env.OLLAMA_URL || "http://localhost:11434";

  const res = await withTimeout(
    (signal) =>
      fetch(`${base}/api/chat`, {
        method: "POST",
        signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: process.env.OLLAMA_MODEL || "llama3.1",
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          stream: false,
          format: "json",
          options: { temperature: 0.85 },
        }),
      }),
    120_000 // local models on modest hardware are slower
  );

  if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = data.message?.content;
  if (!text) throw new Error("Ollama returned empty content");
  return text;
}

const PROVIDERS = { gemini: callGemini, groq: callGroq, ollama: callOllama };

/**
 * Calls the first provider that succeeds. Returns { text, provider }.
 */
export async function callLLM({ system, user }) {
  const order = (process.env.AI_PROVIDERS || "gemini,groq,ollama")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((p) => PROVIDERS[p]);

  if (!order.length) throw new Error("No valid providers in AI_PROVIDERS");

  const errors = [];
  for (const name of order) {
    try {
      const text = await PROVIDERS[name]({ system, user });
      return { text, provider: name };
    } catch (err) {
      console.warn(`[ai] ${name} failed: ${err.message}`);
      errors.push(`${name}: ${err.message}`);
    }
  }

  throw new Error(`All AI providers failed —\n${errors.join("\n")}`);
}
