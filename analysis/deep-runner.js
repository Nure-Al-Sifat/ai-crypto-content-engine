import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import path from "node:path";

const execFileP = promisify(execFile);
const PY = path.join(process.cwd(), ".venv", "bin", "python");
const SCRIPT = path.join(process.cwd(), "analysis", "deep_analyze.py");

/** Runs the Python deep analyzer on one video. Fail-soft: returns {error} on any failure. */
export async function deepAnalyze(videoId, thumbUrl = "", { timeoutMs = 180_000 } = {}) {
  if (!existsSync(PY)) {
    return { videoId, error: "python venv missing (run: python3 -m venv .venv && .venv/bin/pip install 'scenedetect[opencv]' librosa pytesseract)" };
  }
  try {
    const args = thumbUrl ? [SCRIPT, videoId, thumbUrl] : [SCRIPT, videoId];
    const { stdout } = await execFileP(PY, args, {
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
    });
    const line = stdout.trim().split("\n").filter(Boolean).pop();
    return JSON.parse(line);
  } catch (e) {
    return { videoId, error: String(e.stderr || e.message || "").slice(0, 120) };
  }
}

const topByCount = (tally, n = 5) =>
  Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);

/** Averages the per-video deep signals into niche-level patterns. */
export function aggregateDeep(results) {
  const ok = results.filter((r) => r && !r.error && r.duration_sec);
  const mean = (k) => {
    const v = ok.map((r) => r[k]).filter((x) => typeof x === "number");
    return v.length ? Number((v.reduce((a, b) => a + b, 0) / v.length).toFixed(2)) : null;
  };
  const pct = (pred) => (ok.length ? Math.round((ok.filter(pred).length / ok.length) * 100) : 0);

  const emoTally = {};
  const objTally = {};
  for (const r of ok) {
    if (r.dominant_emotion) emoTally[r.dominant_emotion] = (emoTally[r.dominant_emotion] || 0) + 1;
    for (const o of r.top_objects || []) objTally[o] = (objTally[o] || 0) + 1;
  }

  return {
    analyzed: ok.length,
    attempted: results.length,
    avg_shot_sec: mean("avg_shot_sec"),
    avg_cuts_per_min: mean("cuts_per_min"),
    avg_talking_head_ratio: mean("talking_head_ratio"),
    avg_tempo_bpm: mean("tempo_bpm"),
    avg_speech_wpm: mean("speech_wpm"),
    avg_silence_ratio: mean("silence_ratio"),
    dominant_emotion: topByCount(emoTally, 1)[0] || null,
    common_on_screen: topByCount(objTally, 5),
    pct_thumbnail_has_face: pct((r) => r.thumb_has_face),
    avg_thumbnail_text_words: mean("thumb_text_words"),
    pct_with_captions: pct((r) => r.has_captions),
    sample_hooks: ok.map((r) => r.hook_text).filter(Boolean).slice(0, 8),
  };
}
