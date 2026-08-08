import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

/**
 * DAY-OVER-DAY MOMENTUM
 *
 * Each market-research run saves a small snapshot (topics + token prices +
 * chain TVL). Comparing to the previous day's snapshot turns a point-in-time
 * scan into real trend detection: what's NEW today, what's PERSISTING, and how
 * tokens/TVL moved since last time. Stored in data/trend-history.json.
 */
const FILE = () => path.join(process.cwd(), "data", "trend-history.json");

/** Normalizes a headline into a stable key for matching across days. */
export function topicKey(title = "") {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .slice(0, 8)
    .sort()
    .join("-");
}

export async function loadHistory() {
  try {
    if (existsSync(FILE())) return JSON.parse(await readFile(FILE(), "utf8"));
  } catch {
    /* corrupt/empty — start fresh */
  }
  return [];
}

export async function saveSnapshot(snapshot) {
  const hist = await loadHistory();
  hist.push(snapshot);
  await mkdir(path.dirname(FILE()), { recursive: true });
  await writeFile(FILE(), JSON.stringify(hist.slice(-30))); // keep last 30
}

/**
 * Compares the current snapshot to the most recent PRIOR-day snapshot (falls
 * back to the last snapshot of any date, so a second same-day run still shows
 * the mechanism). Returns new vs persisting topics and token move-since.
 */
export function compare(current, history) {
  const prior = [...history].reverse().find((s) => s.date !== current.date);
  const prev = prior || (history.length ? history[history.length - 1] : null);
  if (!prev) return { firstRun: true, newTopics: current.topics, persisting: [], tokenMoves: [] };

  const prevKeys = new Set((prev.topics || []).map((t) => t.key));
  const newTopics = current.topics.filter((t) => !prevKeys.has(t.key));
  const persisting = current.topics.filter((t) => prevKeys.has(t.key));

  const prevPrice = Object.fromEntries((prev.tokens || []).map((t) => [t.symbol, t.price]));
  const tokenMoves = (current.tokens || [])
    .map((t) => {
      const p0 = prevPrice[t.symbol];
      return p0 > 0 ? { symbol: t.symbol, pct: ((t.price - p0) / p0) * 100 } : null;
    })
    .filter(Boolean)
    .sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));

  return { firstRun: false, prevDate: prev.date, newTopics, persisting, tokenMoves };
}
