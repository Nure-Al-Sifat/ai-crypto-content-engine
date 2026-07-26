import fetch from "node-fetch";

const API = (method) =>
  `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`;

function isConfigured() {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}

/** Telegram's MarkdownV2 requires escaping a long list of characters. */
function escapeMd(text = "") {
  return String(text).replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
}

async function call(method, body) {
  const res = await fetch(API(method), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!json.ok) {
    console.warn(`[telegram] ${method} failed: ${JSON.stringify(json)}`);
  }
  return json;
}

/**
 * The review interface. Without these buttons the friction of "open Supabase
 * to mark it published" means you stop using the engine within two weeks.
 */
function buildKeyboard(postId, variantIndex, variantCount) {
  const variantRow = [];
  for (let i = 0; i < variantCount; i++) {
    variantRow.push({
      text: i === variantIndex ? `● ${i + 1}` : `${i + 1}`,
      callback_data: `v:${postId}:${i}`,
    });
  }

  return {
    inline_keyboard: [
      variantRow.length > 1 ? variantRow : [],
      [
        { text: "✅ Approve", callback_data: `a:${postId}:${variantIndex}` },
        { text: "🔄 Regenerate", callback_data: `r:${postId}:${variantIndex}` },
      ],
      [
        { text: "📤 Mark published", callback_data: `p:${postId}:${variantIndex}` },
        { text: "❌ Skip", callback_data: `s:${postId}:${variantIndex}` },
      ],
    ].filter((row) => row.length),
  };
}

export function formatPost({ variant, pillar, sources, variantIndex, variantCount, warnings = [] }) {
  const hashtags = (variant.hashtags || []).map((h) => `#${h}`).join(" ");
  const threadNote = variant.x_thread?.length
    ? `\n\n🧵 *Thread:* ${variant.x_thread.length} tweets \\(see below\\)`
    : "";

  const warnBlock = warnings.length
    ? `\n\n⚠️ ${warnings.map(escapeMd).join("\n⚠️ ")}`
    : "";

  return (
    `📅 *${escapeMd(pillar)}* · variant ${variantIndex + 1}/${variantCount}\n` +
    `_${escapeMd(variant.angle)}_\n\n` +
    `━━━ *X POST* ━━━\n${escapeMd(variant.x_post)}${threadNote}\n\n` +
    `━━━ *LINKEDIN* ━━━\n${escapeMd(variant.linkedin_post)}\n\n` +
    `${escapeMd(hashtags)}\n\n` +
    `_Source: ${escapeMd(sources?.[0]?.title?.slice(0, 90) || "n/a")}_` +
    warnBlock
  );
}

export async function sendPostForReview({ postId, variants, variantIndex = 0, pillar, sources, warnings }) {
  if (!isConfigured()) {
    console.warn("[telegram] Not configured — printing to console instead\n");
    console.log(JSON.stringify(variants[variantIndex], null, 2));
    return null;
  }

  const text = formatPost({
    variant: variants[variantIndex],
    pillar,
    sources,
    variantIndex,
    variantCount: variants.length,
    warnings,
  });

  const res = await call("sendMessage", {
    chat_id: process.env.TELEGRAM_CHAT_ID,
    text,
    parse_mode: "MarkdownV2",
    disable_web_page_preview: true,
    reply_markup: buildKeyboard(postId, variantIndex, variants.length),
  });

  // Send the thread as a follow-up so it's copy-pasteable tweet by tweet
  const thread = variants[variantIndex].x_thread;
  if (thread?.length) {
    const threadText = thread
      .map((t, i) => `*${i + 1}/${thread.length}*\n${escapeMd(t)}`)
      .join("\n\n───\n\n");
    await call("sendMessage", {
      chat_id: process.env.TELEGRAM_CHAT_ID,
      text: `🧵 *THREAD*\n\n${threadText}`,
      parse_mode: "MarkdownV2",
      disable_web_page_preview: true,
    });
  }

  return res.result?.message_id || null;
}

/** Edits an existing message in place — used when switching variants. */
export async function editPostMessage({ messageId, postId, variants, variantIndex, pillar, sources }) {
  if (!isConfigured()) return;

  const text = formatPost({
    variant: variants[variantIndex],
    pillar,
    sources,
    variantIndex,
    variantCount: variants.length,
  });

  await call("editMessageText", {
    chat_id: process.env.TELEGRAM_CHAT_ID,
    message_id: messageId,
    text,
    parse_mode: "MarkdownV2",
    disable_web_page_preview: true,
    reply_markup: buildKeyboard(postId, variantIndex, variants.length),
  });
}

export async function sendPhoto(buffer, caption = "") {
  if (!isConfigured()) return;

  // multipart upload
  const form = new FormData();
  form.append("chat_id", process.env.TELEGRAM_CHAT_ID);
  form.append("caption", caption.slice(0, 1000));
  form.append("photo", new Blob([buffer], { type: "image/png" }), "card.png");

  const res = await fetch(API("sendPhoto"), { method: "POST", body: form });
  if (!res.ok) console.warn(`[telegram] sendPhoto failed: ${await res.text()}`);
}

export async function sendMessage(text, { markdown = false } = {}) {
  if (!isConfigured()) {
    console.log(`[telegram not configured] ${text}`);
    return;
  }
  await call("sendMessage", {
    chat_id: process.env.TELEGRAM_CHAT_ID,
    text: markdown ? text : escapeMd(text),
    parse_mode: "MarkdownV2",
    disable_web_page_preview: true,
  });
}

export async function answerCallback(callbackQueryId, text) {
  await call("answerCallbackQuery", { callback_query_id: callbackQueryId, text });
}
