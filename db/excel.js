import ExcelJS from "exceljs";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";

/**
 * EXCEL STORE — the single datastore.
 *
 * One workbook, two sheets:
 *   posts          — one row per run: the viral topic + a ready draft per platform
 *   covered_topics — what we've already posted about (14-day dedupe memory)
 *
 * Path: EXCEL_FILE, or ./data/content-engine.xlsx by default. You open this
 * file, read the row, and post manually — the engine never touches your accounts.
 */

const FILE = () =>
  process.env.EXCEL_FILE || path.join(process.cwd(), "data", "content-engine.xlsx");

const POSTS_TAB = "posts";
const TOPICS_TAB = "covered_topics";

// One row = one day's viral topic and everything you need to post it.
const POSTS_COLS = [
  "id",
  "created_at",
  "run_date",
  "pillar",
  "topic",
  "source_link",
  "opportunity_score",
  "why",
  "signals",
  "x_post",
  "linkedin_post",
  "youtube_title",
  "youtube_hook",
  "youtube_outline",
  "facebook_post",
  "hashtags",
  "status", // pending — mark it yourself once posted
];

const TOPICS_COLS = ["id", "created_at", "topic", "topic_key"];

// ---- helpers ---------------------------------------------------------------

export function todayKey(date = new Date()) {
  return date.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

/** Normalizes a headline into a stable key for duplicate detection. */
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

function ensureSheet(wb, name, cols) {
  let ws = wb.getWorksheet(name);
  if (!ws) {
    ws = wb.addWorksheet(name);
    ws.addRow(cols);
  } else if (ws.rowCount === 0) {
    ws.addRow(cols);
  }
  return ws;
}

async function load() {
  const wb = new ExcelJS.Workbook();
  if (existsSync(FILE())) await wb.xlsx.readFile(FILE());
  return {
    wb,
    posts: ensureSheet(wb, POSTS_TAB, POSTS_COLS),
    topics: ensureSheet(wb, TOPICS_TAB, TOPICS_COLS),
  };
}

async function save(wb) {
  await mkdir(path.dirname(FILE()), { recursive: true });
  await wb.xlsx.writeFile(FILE());
}

const cell = (c) => {
  const v = c?.value;
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") return String(v.text ?? v.result ?? "");
  return v;
};

function readRows(ws, cols) {
  const rows = [];
  ws.eachRow({ includeEmpty: false }, (row, n) => {
    if (n === 1) return; // header
    const obj = {};
    cols.forEach((c, i) => (obj[c] = cell(row.getCell(i + 1))));
    if (obj.id !== "") rows.push(obj);
  });
  return rows;
}

function nextId(rows) {
  return rows.reduce((max, r) => Math.max(max, Number(r.id) || 0), 0) + 1;
}

// ---- public API ------------------------------------------------------------

/** Idempotency: has a post already been generated for this run date? */
export async function hasRunToday(runDate = todayKey()) {
  const { posts } = await load();
  const hit = readRows(posts, POSTS_COLS).find((r) => r.run_date === runDate);
  return hit ? { id: Number(hit.id), pillar: hit.pillar, status: hit.status } : null;
}

/** Topics covered in the last N days, so the judge avoids repeats. */
export async function getRecentTopics(days = 14) {
  const since = Date.now() - days * 86400_000;
  const { topics } = await load();
  return readRows(topics, TOPICS_COLS)
    .filter((r) => new Date(r.created_at).getTime() >= since)
    .map((r) => r.topic);
}

export async function recordTopic(title) {
  if (!title) return;
  const { wb, topics } = await load();
  const id = nextId(readRows(topics, TOPICS_COLS));
  topics.addRow([id, new Date().toISOString(), String(title).slice(0, 300), makeTopicKey(title)]);
  await save(wb);
}

/** Saves the run as one clean row and returns its id. */
export async function savePost({ runDate, pillar, topic, sourceLink, viral, content }) {
  const { wb, posts } = await load();
  const id = nextId(readRows(posts, POSTS_COLS));
  posts.addRow([
    id,
    new Date().toISOString(),
    runDate,
    pillar,
    topic,
    sourceLink || "",
    viral?.score ?? "",
    viral?.why || "",
    viral?.signals || "",
    content.x_post || "",
    content.linkedin_post || "",
    content.youtube_title || "",
    content.youtube_hook || "",
    content.youtube_outline || "",
    content.facebook_post || "",
    (content.hashtags || []).join(" "),
    "pending",
  ]);
  await save(wb);
  return { id };
}
