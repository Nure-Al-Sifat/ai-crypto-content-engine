import fetch from "node-fetch";

const API = "https://www.googleapis.com/youtube/v3";

/**
 * YouTube signals for one topic, used by the Opportunity Score:
 *   competition — how many videos already cover it (saturation)
 *   velocity    — best views-per-hour among the top results (is it hot NOW)
 *
 * Fails SOFT: returns null on missing key, quota, or any error, so scoring
 * just falls back to neutral competition + our own engagement velocity.
 *
 * Cost: ~101 quota units per call (search=100, videos=1). Free tier is
 * 10,000/day, so scoring a handful of finalists per run is well within budget.
 */
export async function youtubeSignals(query) {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key || !query) return null;

  try {
    const q = encodeURIComponent(query.slice(0, 120));
    const sres = await fetch(
      `${API}/search?part=snippet&type=video&maxResults=10&order=relevance&q=${q}&key=${key}`
    );
    if (!sres.ok) return null;
    const sjson = await sres.json();

    // Approximate count of videos on this topic (YouTube rounds this, so it's a
    // relative signal, not an exact number — good enough for competition).
    const competition = sjson.pageInfo?.totalResults ?? null;

    const ids = (sjson.items || []).map((i) => i.id?.videoId).filter(Boolean);
    if (!ids.length) return { competition, velocity: 0, hottest: null };

    const vres = await fetch(
      `${API}/videos?part=statistics,snippet&id=${ids.join(",")}&key=${key}`
    );
    if (!vres.ok) return { competition, velocity: 0, hottest: null };
    const vjson = await vres.json();

    // Best views-per-hour surfaces a recent video that's blowing up.
    let velocity = 0;
    let hottest = null;
    for (const v of vjson.items || []) {
      const views = Number(v.statistics?.viewCount || 0);
      const ageHours = (Date.now() - new Date(v.snippet?.publishedAt).getTime()) / 3600_000;
      if (ageHours > 0 && views > 0) {
        const vph = views / Math.max(ageHours, 2);
        if (vph > velocity) {
          velocity = vph;
          hottest = v.snippet?.title || null;
        }
      }
    }

    return { competition, velocity, hottest };
  } catch {
    return null;
  }
}
