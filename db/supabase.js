import { createClient } from "@supabase/supabase-js";

let client = null;

function getClient() {
  if (client) return client;
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    throw new Error("Missing SUPABASE_URL / SUPABASE_SERVICE_KEY");
  }
  client = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });
  return client;
}

export function todayKey(date = new Date()) {
  return date.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

/**
 * Normalizes a headline into a stable topic key for duplicate detection.
 */
export function makeTopicKey(title) {
  return (title || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .slice(0, 8)
    .sort()
    .join("-");
}

// ============================================================
// IDEMPOTENCY
// ============================================================

/**
 * GitHub Actions can retry, and you can trigger a manual run on the same day.
 * Without this check you'd get duplicate posts and duplicate notifications.
 */
export async function hasRunToday(runDate = todayKey()) {
  const { data, error } = await getClient()
    .from("posts")
    .select("id, pillar, status")
    .eq("run_date", runDate)
    .maybeSingle();

  if (error) throw new Error(`Idempotency check failed: ${error.message}`);
  return data || null;
}

// ============================================================
// DEDUPE MEMORY
// ============================================================

/**
 * Returns topics covered in the last N days, so the curator can avoid
 * repeating itself. This is what stops the engine posting about the same
 * story three times in a fortnight.
 */
export async function getRecentTopics(days = 14) {
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  const { data, error } = await getClient()
    .from("covered_topics")
    .select("topic")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(60);

  if (error) {
    console.warn(`[db] Could not load recent topics: ${error.message}`);
    return [];
  }
  return data.map((r) => r.topic);
}

export async function recordTopics(postId, sources = []) {
  if (!sources.length) return;
  const rows = sources
    .filter((s) => s.title)
    .map((s) => ({
      topic: s.title.slice(0, 300),
      topic_key: makeTopicKey(s.title),
      post_id: postId,
    }));

  const { error } = await getClient().from("covered_topics").insert(rows);
  if (error) console.warn(`[db] Could not record topics: ${error.message}`);
}

// ============================================================
// FEEDBACK LOOP — the compounding part
// ============================================================

/**
 * Pulls your best-performing published posts to use as few-shot examples.
 * This is what makes the engine improve week over week instead of producing
 * day-1 quality forever.
 *
 * Falls back to an empty array until you have real engagement data, at which
 * point voice.js's static seed examples carry the load alone.
 */
export async function getTopPerformingExamples(limit = 8) {
  const { data, error } = await getClient()
    .from("posts")
    .select("variants, chosen_index, engagement_rate")
    .eq("status", "published")
    .not("engagement_rate", "is", null)
    .order("engagement_rate", { ascending: false })
    .limit(limit);

  if (error) {
    console.warn(`[db] Could not load top performers: ${error.message}`);
    return [];
  }

  const examples = [];
  for (const row of data || []) {
    const v = row.variants?.[row.chosen_index ?? 0];
    if (!v) continue;
    if (v.x_post) examples.push({ platform: "x", text: v.x_post });
    if (v.linkedin_post) examples.push({ platform: "linkedin", text: v.linkedin_post });
  }

  if (examples.length) {
    console.log(`[db] Loaded ${examples.length} learned voice examples from top performers`);
  }
  return examples;
}

// ============================================================
// WRITE / READ
// ============================================================

export async function savePost({ runDate, pillar, variants, sources, critique }) {
  const { data, error } = await getClient()
    .from("posts")
    .insert({
      run_date: runDate,
      pillar,
      variants,
      sources,
      topic_key: makeTopicKey(sources?.[0]?.title),
      critique,
      status: "pending",
    })
    .select()
    .single();

  if (error) throw new Error(`Supabase insert failed: ${error.message}`);
  return data;
}

export async function updatePostStatus(postId, status, extra = {}) {
  const { error } = await getClient()
    .from("posts")
    .update({ status, ...extra })
    .eq("id", postId);

  if (error) throw new Error(`Status update failed: ${error.message}`);
}

export async function setChosenVariant(postId, index) {
  const { error } = await getClient()
    .from("posts")
    .update({ chosen_index: index })
    .eq("id", postId);

  if (error) throw new Error(`Variant selection failed: ${error.message}`);
}

export async function recordEngagement(postId, { impressions, likes, reposts, replies }) {
  const { error } = await getClient()
    .from("posts")
    .update({ impressions, likes, reposts, replies })
    .eq("id", postId);

  if (error) throw new Error(`Engagement update failed: ${error.message}`);
}

export async function getPost(postId) {
  const { data, error } = await getClient()
    .from("posts")
    .select("*")
    .eq("id", postId)
    .single();

  if (error) throw new Error(`Post fetch failed: ${error.message}`);
  return data;
}

/**
 * Posts published 1-3 days ago that still have no engagement numbers —
 * used to nudge you to enter them so the feedback loop keeps learning.
 */
export async function getPostsAwaitingMetrics() {
  const from = new Date(Date.now() - 4 * 86400_000).toISOString();
  const to = new Date(Date.now() - 24 * 3600_000).toISOString();

  const { data, error } = await getClient()
    .from("posts")
    .select("id, pillar, variants, chosen_index, published_at")
    .eq("status", "published")
    .is("impressions", null)
    .gte("published_at", from)
    .lte("published_at", to);

  if (error) {
    console.warn(`[db] Could not check awaiting metrics: ${error.message}`);
    return [];
  }
  return data || [];
}
