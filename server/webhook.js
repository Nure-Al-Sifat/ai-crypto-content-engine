import "dotenv/config";
import http from "node:http";
import {
  getPost,
  updatePostStatus,
  setChosenVariant,
  recordEngagement,
} from "../db/supabase.js";
import {
  answerCallback,
  editPostMessage,
  sendMessage,
} from "../notify/telegram.js";

/**
 * TELEGRAM CALLBACK HANDLER
 *
 * Callback data format: "<action>:<postId>:<variantIndex>"
 *   v = switch variant   a = approve
 *   r = regenerate       p = mark published
 *   s = skip
 *
 * Run locally:   node server/webhook.js   (then expose with ngrok/cloudflared)
 * Register once: https://api.telegram.org/bot<TOKEN>/setWebhook?url=<PUBLIC_URL>/telegram
 *
 * A Cloudflare Workers version of this same logic is in server/worker.js —
 * that one runs free with no machine of your own.
 */

async function handleCallback(cb) {
  const [action, postIdRaw, variantIdxRaw] = (cb.data || "").split(":");
  const postId = Number(postIdRaw);
  const variantIndex = Number(variantIdxRaw) || 0;
  const messageId = cb.message?.message_id;

  if (!action || Number.isNaN(postId)) {
    await answerCallback(cb.id, "Malformed action");
    return;
  }

  const post = await getPost(postId);
  const variants = post.variants || [];

  switch (action) {
    case "v": {
      await setChosenVariant(postId, variantIndex);
      await editPostMessage({
        messageId,
        postId,
        variants,
        variantIndex,
        pillar: post.pillar,
        sources: post.sources,
      });
      await answerCallback(cb.id, `Showing variant ${variantIndex + 1}`);
      break;
    }

    case "a": {
      await setChosenVariant(postId, variantIndex);
      await updatePostStatus(postId, "approved");
      await answerCallback(cb.id, "Approved — copy and post it");
      break;
    }

    case "p": {
      await setChosenVariant(postId, variantIndex);
      await updatePostStatus(postId, "published", {
        published_at: new Date().toISOString(),
      });
      await answerCallback(cb.id, "Marked published");
      await sendMessage(
        `📊 Post #${postId} marked published\\.\n\n` +
          `In 24\\-48h, reply with:\n\`/metrics ${postId} <impressions> <likes> <reposts> <replies>\`\n\n` +
          `That feeds the voice model so future posts get better\\.`,
        { markdown: true }
      );
      break;
    }

    case "s": {
      await updatePostStatus(postId, "skipped");
      await answerCallback(cb.id, "Skipped");
      break;
    }

    case "r": {
      await answerCallback(cb.id, "Regeneration queued");
      await updatePostStatus(postId, "skipped");
      await sendMessage(
        `🔄 Post \\#${postId} marked for regeneration\\.\n` +
          `Trigger the workflow manually with FORCE\\_RERUN\\=true, or run \`npm start \\-\\- \\-\\-force\` locally\\.`,
        { markdown: true }
      );
      break;
    }

    default:
      await answerCallback(cb.id, "Unknown action");
  }
}

/**
 * /metrics <postId> <impressions> <likes> <reposts> <replies>
 * This is the input side of the feedback loop.
 */
async function handleMessage(msg) {
  const text = (msg.text || "").trim();
  if (!text.startsWith("/metrics")) return;

  const parts = text.split(/\s+/).slice(1).map(Number);
  const [postId, impressions, likes = 0, reposts = 0, replies = 0] = parts;

  if (!postId || Number.isNaN(impressions)) {
    await sendMessage("Usage: /metrics <postId> <impressions> <likes> <reposts> <replies>");
    return;
  }

  try {
    await recordEngagement(postId, { impressions, likes, reposts, replies });
    const rate = (((likes + reposts * 2 + replies * 3) / impressions) * 100).toFixed(2);
    await sendMessage(
      `✅ Recorded for \\#${postId}\\. Engagement rate: ${rate.replace(".", "\\.")}%\n` +
        `Top performers now feed the voice model\\.`,
      { markdown: true }
    );
  } catch (err) {
    await sendMessage(`Failed to record: ${err.message}`);
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method !== "POST") {
    res.writeHead(200).end("ok");
    return;
  }

  let body = "";
  for await (const chunk of req) body += chunk;

  try {
    const update = JSON.parse(body);
    if (update.callback_query) await handleCallback(update.callback_query);
    else if (update.message) await handleMessage(update.message);
  } catch (err) {
    console.error("[webhook] error:", err.message);
  }

  // Always 200 — Telegram retries aggressively on non-200
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true }));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`[webhook] listening on :${PORT}`));
