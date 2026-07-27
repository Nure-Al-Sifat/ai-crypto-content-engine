/**
 * VIRAL DNA — pattern mining over the niche's top videos (metadata level).
 *
 * Pure functions, no network. Turns a list of top videos into aggregate
 * patterns: title formulas, duration, upload timing, view velocity, engagement,
 * and common tags. This is the free/no-download half of the video analysis.
 */

const POWER_WORDS = [
  "how", "why", "stop", "nobody", "secret", "truth", "never", "best", "worst",
  "new", "free", "easy", "fast", "mistake", "vs", "top", "warning", "hidden",
  "insane", "crazy", "ultimate", "proven", "guide",
];

const avg = (a) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : 0);
const median = (a) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};
const pct = (count, n) => (n ? Math.round((count / n) * 100) : 0);
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function computeDNA(videos) {
  const n = videos.length;
  const titles = videos.map((v) => v.title.toLowerCase());

  const withNumber = titles.filter((t) => /\d/.test(t)).length;
  const withQuestion = titles.filter((t) => /\?|\b(how|why|what|which|should|can)\b/.test(t)).length;
  const withPower = titles.filter((t) => POWER_WORDS.some((w) => t.includes(w))).length;
  const titleWordCounts = videos.map((v) => v.title.split(/\s+/).filter(Boolean).length);

  const durations = videos.map((v) => v.durationSec);
  const shortForm = durations.filter((d) => d > 0 && d <= 60).length; // Shorts

  // Upload timing (UTC day-of-week).
  const dayCount = {};
  for (const v of videos) {
    if (!v.publishedAt) continue;
    const d = DOW[new Date(v.publishedAt).getUTCDay()];
    dayCount[d] = (dayCount[d] || 0) + 1;
  }
  const topDays = Object.entries(dayCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([d, c]) => `${d} (${c})`);

  // View velocity (views per hour since publish).
  const velocities = videos.map((v) => {
    if (!v.publishedAt) return 0;
    const ageH = (Date.now() - new Date(v.publishedAt).getTime()) / 3600_000;
    return ageH > 0 ? v.views / ageH : 0;
  });

  // Engagement (like/view, comment/view) over videos with visible counts.
  const likeRatios = videos.filter((v) => v.views > 0).map((v) => (v.likes / v.views) * 100);
  const commentRatios = videos.filter((v) => v.views > 0).map((v) => (v.comments / v.views) * 100);

  // Common tags.
  const tagCount = {};
  for (const v of videos) for (const t of v.tags) {
    const k = t.toLowerCase().trim();
    if (k) tagCount[k] = (tagCount[k] || 0) + 1;
  }
  const topTags = Object.entries(tagCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([t, c]) => `${t} (${c})`);

  return {
    count: n,
    title: {
      pct_with_number: pct(withNumber, n),
      pct_question_style: pct(withQuestion, n),
      pct_power_words: pct(withPower, n),
      avg_word_count: avg(titleWordCounts),
    },
    duration: {
      avg_seconds: avg(durations),
      median_seconds: median(durations),
      pct_short_form: pct(shortForm, n),
    },
    views: { avg: avg(videos.map((v) => v.views)), max: Math.max(0, ...videos.map((v) => v.views)) },
    engagement: {
      avg_like_view_pct: Number((likeRatios.reduce((a, b) => a + b, 0) / (likeRatios.length || 1)).toFixed(2)),
      avg_comment_view_pct: Number((commentRatios.reduce((a, b) => a + b, 0) / (commentRatios.length || 1)).toFixed(3)),
    },
    top_upload_days: topDays,
    avg_view_velocity_per_hour: avg(velocities),
    top_tags: topTags,
  };
}
