/**
 * CLOUDFLARE WORKER — free Telegram callback handler
 *
 * 100,000 requests/day on the free plan, always warm, no server to keep alive.
 * This is the recommended way to make the inline buttons work.
 *
 * Deploy:
 *   npm i -g wrangler
 *   wrangler deploy server/worker.js --name content-engine-hook --compatibility-date 2026-01-01
 *   wrangler secret put TELEGRAM_BOT_TOKEN
 *   wrangler secret put TELEGRAM_CHAT_ID
 *   wrangler secret put SUPABASE_URL
 *   wrangler secret put SUPABASE_SERVICE_KEY
 *
 * Then register the webhook once:
 *   curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<worker>.workers.dev"
 */

const esc = (t = "") => String(t).replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, "\\$1");

async function tg(env, method, body) {
  return fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => r.json());
}

async function sb(env, pathname, { method = "GET", body, headers = {} } = {}) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${pathname}`, {
    method,
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

function keyboard(postId, idx, count) {
  const variantRow = [];
  for (let i = 0; i < count; i++) {
    variantRow.push({
      text: i === idx ? `● ${i + 1}` : `${i + 1}`,
      callback_data: `v:${postId}:${i}`,
    });
  }
  return {
    inline_keyboard: [
      ...(variantRow.length > 1 ? [variantRow] : []),
      [
        { text: "✅ Approve", callback_data: `a:${postId}:${idx}` },
        { text: "🔄 Regenerate", callback_data: `r:${postId}:${idx}` },
      ],
      [
        { text: "📤 Mark published", callback_data: `p:${postId}:${idx}` },
        { text: "❌ Skip", callback_data: `s:${postId}:${idx}` },
      ],
    ],
  };
}

function render(post, idx) {
  const v = post.variants[idx];
  const tags = (v.hashtags || []).map((h) => `#${h}`).join(" ");
  return (
    `📅 *${esc(post.pillar)}* · variant ${idx + 1}/${post.variants.length}\n` +
    `_${esc(v.angle)}_\n\n` +
    `━━━ *X POST* ━━━\n${esc(v.x_post)}\n\n` +
    `━━━ *LINKEDIN* ━━━\n${esc(v.linkedin_post)}\n\n${esc(tags)}`
  );
}

async function handleCallback(env, cb) {
  const [action, idRaw, idxRaw] = (cb.data || "").split(":");
  const postId = Number(idRaw);
  const idx = Number(idxRaw) || 0;

  const rows = await sb(env, `posts?id=eq.${postId}&select=*`);
  const post = rows?.[0];
  if (!post) {
    await tg(env, "answerCallbackQuery", { callback_query_id: cb.id, text: "Post not found" });
    return;
  }

  const patch = (body) =>
    sb(env, `posts?id=eq.${postId}`, {
      method: "PATCH",
      body,
      headers: { Prefer: "return=minimal" },
    });

  const ack = (text) =>
    tg(env, "answerCallbackQuery", { callback_query_id: cb.id, text });

  switch (action) {
    case "v":
      await patch({ chosen_index: idx });
      await tg(env, "editMessageText", {
        chat_id: env.TELEGRAM_CHAT_ID,
        message_id: cb.message.message_id,
        text: render(post, idx),
        parse_mode: "MarkdownV2",
        disable_web_page_preview: true,
        reply_markup: keyboard(postId, idx, post.variants.length),
      });
      await ack(`Variant ${idx + 1}`);
      break;

    case "a":
      await patch({ chosen_index: idx, status: "approved" });
      await ack("Approved");
      break;

    case "p":
      await patch({
        chosen_index: idx,
        status: "published",
        published_at: new Date().toISOString(),
      });
      await ack("Marked published");
      await tg(env, "sendMessage", {
        chat_id: env.TELEGRAM_CHAT_ID,
        text: `📊 In 24\\-48h send:\n\`/metrics ${postId} <impressions> <likes> <reposts> <replies>\``,
        parse_mode: "MarkdownV2",
      });
      break;

    case "s":
      await patch({ status: "skipped" });
      await ack("Skipped");
      break;

    case "r":
      await patch({ status: "skipped" });
      await ack("Marked for regeneration");
      break;

    default:
      await ack("Unknown action");
  }
}

async function handleMessage(env, msg) {
  const text = (msg.text || "").trim();
  if (!text.startsWith("/metrics")) return;

  const [postId, impressions, likes = 0, reposts = 0, replies = 0] = text
    .split(/\s+/)
    .slice(1)
    .map(Number);

  if (!postId || !impressions) {
    await tg(env, "sendMessage", {
      chat_id: env.TELEGRAM_CHAT_ID,
      text: "Usage: /metrics <postId> <impressions> <likes> <reposts> <replies>",
    });
    return;
  }

  await sb(env, `posts?id=eq.${postId}`, {
    method: "PATCH",
    body: { impressions, likes, reposts, replies },
    headers: { Prefer: "return=minimal" },
  });

  const rate = (((likes + reposts * 2 + replies * 3) / impressions) * 100).toFixed(2);
  await tg(env, "sendMessage", {
    chat_id: env.TELEGRAM_CHAT_ID,
    text: `✅ Recorded for \\#${postId}\\. Engagement: ${rate.replace(".", "\\.")}%`,
    parse_mode: "MarkdownV2",
  });
}

export default {
  async fetch(request, env) {
    if (request.method !== "POST") return new Response("ok");

    try {
      const update = await request.json();
      if (update.callback_query) await handleCallback(env, update.callback_query);
      else if (update.message) await handleMessage(env, update.message);
    } catch (err) {
      console.error(err);
    }

    // Always 200 — Telegram retries hard on anything else
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" },
    });
  },
};
