import fetch from "node-fetch";

const API = "https://www.googleapis.com/youtube/v3";

// Gaming search terms — recent videos with their REAL view counts, so trending
// gaming videos rank on actual traction. Uses the existing YOUTUBE_API_KEY.
const DEFAULT_QUERIES = "web3 gaming,GameFi,play to earn crypto,blockchain game";

/**
 * Searches YouTube for recent Web3-gaming videos and returns them as trend
 * items carrying real view counts. Fail-soft: returns [] (or partial) on any
 * error, missing key, or quota.
 *
 * Cost: ~101 quota units per query (search=100, videos=1). Free tier 10k/day.
 */
export async function fetchYouTubeSearch({ perQuery = 6, sinceDays = 45 } = {}) {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) {
    console.warn("[youtube-search] YOUTUBE_API_KEY not set — skipping");
    return [];
  }

  const queries = (process.env.YT_SEARCH_QUERIES || DEFAULT_QUERIES)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const publishedAfter = new Date(Date.now() - sinceDays * 86400_000).toISOString();

  const results = [];
  for (const q of queries) {
    try {
      const sres = await fetch(
        `${API}/search?part=snippet&type=video&order=viewCount&maxResults=${perQuery}` +
          `&relevanceLanguage=en&regionCode=US` +
          `&publishedAfter=${publishedAfter}&q=${encodeURIComponent(q)}&key=${key}`
      );
      if (!sres.ok) throw new Error(`search ${sres.status}`);
      const sjson = await sres.json();

      const ids = (sjson.items || []).map((i) => i.id?.videoId).filter(Boolean);
      if (!ids.length) continue;

      const vres = await fetch(
        `${API}/videos?part=snippet,statistics&id=${ids.join(",")}&key=${key}`
      );
      if (!vres.ok) throw new Error(`videos ${vres.status}`);
      const vjson = await vres.json();

      for (const v of vjson.items || []) {
        results.push({
          source: `YouTube/${(v.snippet?.channelTitle || "").slice(0, 20)}`,
          title: v.snippet?.title || "",
          link: `https://www.youtube.com/watch?v=${v.id}`,
          publishedAt: v.snippet?.publishedAt || null,
          views: Number(v.statistics?.viewCount || 0),
          comments: Number(v.statistics?.commentCount || 0),
        });
      }
    } catch (err) {
      console.warn(`[youtube-search] Skipping "${q}": ${err.message}`);
    }
  }
  return results;
}
