import pkg from "pg";
const { Pool } = pkg;

/**
 * POSTGRES DATASTORE (Railway, Neon, Supabase-direct, or any Postgres)
 *
 * A drop-in replacement for db/supabase.js with the same exported surface, so
 * index.js / server/webhook.js don't care which backend they talk to (see
 * db/store.js for the selector).
 *
 * It runs the exact schema in db/sql/schema.sql — including the generated
 * engagement_rate column — so the feedback loop works with no app-side math.
 *
 * Setup (Railway):
 *   1. railway.app -> New Project -> add a PostgreSQL database
 *   2. Copy the connection string (Variables tab -> DATABASE_URL, the *public*
 *      one for local/CI use) into .env
 *   3. Run `npm run init-db` once to create the tables
 */

let pool = null;

/** SSL is required for Railway's public proxy; skip it only for local hosts. */
function sslConfig(connectionString) {
  if (process.env.PGSSL === "false") return false;
  if (process.env.PGSSL === "true") return { rejectUnauthorized: false };
  try {
    const host = new URL(connectionString).hostname;
    const isLocal =
      host === "localhost" ||
      host === "127.0.0.1" ||
      host.endsWith(".railway.internal"); // Railway's private network needs no SSL
    return isLocal ? false : { rejectUnauthorized: false };
  } catch {
    return { rejectUnauthorized: false };
  }
}

function getPool() {
  if (pool) return pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("Missing DATABASE_URL (Railway Postgres connection string)");
  }
  pool = new Pool({
    connectionString,
    ssl: sslConfig(connectionString),
    max: 4,
    // Lets the daily one-shot run (index.js) exit cleanly once idle, instead of
    // the open pool keeping the Node process alive forever.
    allowExitOnIdle: true,
  });
  return pool;
}

async function query(text, params) {
  return getPool().query(text, params);
}

/** For one-shot scripts that need the process to exit promptly. */
export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

// ============================================================
// SHARED HELPERS (identical to the other backends)
// ============================================================

export function todayKey(date = new Date()) {
  return date.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

/** Normalizes a headline into a stable topic key for duplicate detection. */
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

// bigint (int8) comes back from node-postgres as a string; the app expects a
// number, and our ids are far below Number.MAX_SAFE_INTEGER.
const numId = (v) => (v === null || v === undefined ? v : Number(v));

// ============================================================
// IDEMPOTENCY
// ============================================================

export async function hasRunToday(runDate = todayKey()) {
  const { rows } = await query(
    "select id, pillar, status from posts where run_date = $1 limit 1",
    [runDate]
  );
  if (!rows.length) return null;
  return { id: numId(rows[0].id), pillar: rows[0].pillar, status: rows[0].status };
}

// ============================================================
// DEDUPE MEMORY
// ============================================================

export async function getRecentTopics(days = 14) {
  try {
    const { rows } = await query(
      `select topic from covered_topics
       where created_at >= now() - ($1::int * interval '1 day')
       order by created_at desc
       limit 60`,
      [days]
    );
    return rows.map((r) => r.topic);
  } catch (err) {
    console.warn(`[db] Could not load recent topics: ${err.message}`);
    return [];
  }
}

export async function recordTopics(postId, sources = []) {
  const usable = sources.filter((s) => s.title);
  if (!usable.length) return;
  try {
    const params = [];
    const tuples = usable.map((s, i) => {
      const b = i * 3;
      params.push(s.title.slice(0, 300), makeTopicKey(s.title), postId);
      return `($${b + 1}, $${b + 2}, $${b + 3})`;
    });
    await query(
      `insert into covered_topics (topic, topic_key, post_id) values ${tuples.join(", ")}`,
      params
    );
  } catch (err) {
    console.warn(`[db] Could not record topics: ${err.message}`);
  }
}

// ============================================================
// FEEDBACK LOOP — the compounding part
// ============================================================

export async function getTopPerformingExamples(limit = 8) {
  let rows;
  try {
    ({ rows } = await query(
      `select variants, chosen_index, engagement_rate from posts
       where status = 'published' and engagement_rate is not null
       order by engagement_rate desc
       limit $1`,
      [limit]
    ));
  } catch (err) {
    console.warn(`[db] Could not load top performers: ${err.message}`);
    return [];
  }

  const examples = [];
  for (const row of rows) {
    const v = row.variants?.[row.chosen_index ?? 0]; // jsonb -> parsed array
    if (!v) continue;
    if (v.x_post) examples.push({ platform: "x", text: v.x_post });
    if (v.linkedin_post) examples.push({ platform: "linkedin", text: v.linkedin_post });
  }

  if (examples.length) {
    console.log(
      `[db] Loaded ${examples.length} learned voice examples from top performers`
    );
  }
  return examples;
}

// ============================================================
// WRITE / READ
// ============================================================

export async function savePost({ runDate, pillar, variants, sources, critique }) {
  const { rows } = await query(
    `insert into posts (run_date, pillar, variants, sources, topic_key, critique, status)
     values ($1, $2, $3, $4, $5, $6, 'pending')
     returning *`,
    [
      runDate,
      pillar,
      JSON.stringify(variants ?? []),
      JSON.stringify(sources ?? []),
      makeTopicKey(sources?.[0]?.title),
      JSON.stringify(critique ?? {}),
    ]
  );
  const row = rows[0];
  row.id = numId(row.id);
  return row;
}

// Columns the app is allowed to patch, guarding the dynamic UPDATE below.
const JSON_COLS = new Set(["variants", "sources", "critique"]);
const UPDATABLE = new Set([
  "status",
  "published_at",
  "chosen_index",
  "impressions",
  "likes",
  "reposts",
  "replies",
  ...JSON_COLS,
]);

async function updatePost(postId, patch) {
  const keys = Object.keys(patch).filter((k) => UPDATABLE.has(k));
  if (!keys.length) return;
  const sets = keys.map((k, i) => `${k} = $${i + 1}`);
  const values = keys.map((k) => (JSON_COLS.has(k) ? JSON.stringify(patch[k]) : patch[k]));
  values.push(postId);
  const { rowCount } = await query(
    `update posts set ${sets.join(", ")} where id = $${keys.length + 1}`,
    values
  );
  if (!rowCount) throw new Error(`post ${postId} not found`);
}

export async function updatePostStatus(postId, status, extra = {}) {
  await updatePost(postId, { status, ...extra });
}

export async function setChosenVariant(postId, index) {
  await updatePost(postId, { chosen_index: index });
}

export async function recordEngagement(postId, { impressions, likes, reposts, replies }) {
  await updatePost(postId, { impressions, likes, reposts, replies });
}

export async function getPost(postId) {
  const { rows } = await query("select * from posts where id = $1", [postId]);
  if (!rows.length) throw new Error(`Post fetch failed: post ${postId} not found`);
  const row = rows[0];
  row.id = numId(row.id);
  return row;
}

export async function getPostsAwaitingMetrics() {
  try {
    const { rows } = await query(
      `select id, pillar, variants, chosen_index, published_at from posts
       where status = 'published'
         and impressions is null
         and published_at >= now() - interval '4 days'
         and published_at <= now() - interval '1 day'`
    );
    return rows.map((r) => ({ ...r, id: numId(r.id) }));
  } catch (err) {
    console.warn(`[db] Could not check awaiting metrics: ${err.message}`);
    return [];
  }
}

// ============================================================
// ONE-TIME SETUP — run the schema
// ============================================================

export async function initSchema(schemaSql) {
  await query(schemaSql); // DDL, multiple statements, no params — simple protocol
}
