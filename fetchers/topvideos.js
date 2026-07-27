import fetch from "node-fetch";

const API = "https://www.googleapis.com/youtube/v3";

/** ISO-8601 duration ("PT8M30S") -> seconds. */
function parseDuration(iso) {
  const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso || "") || [];
  return Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0);
}

/**
 * Collects the top-viewed videos in a niche via the YouTube Data API (free),
 * with full metadata for pattern mining. No video download — metadata only.
 *
 * Cost: ~101 quota units (search=100, videos=1). Free tier is 10,000/day.
 */
export async function fetchTopVideos(query, { max = 50, sinceDays = 365 } = {}) {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) throw new Error("Missing YOUTUBE_API_KEY");

  const publishedAfter = new Date(Date.now() - sinceDays * 86400_000).toISOString();
  const sres = await fetch(
    `${API}/search?part=snippet&type=video&order=viewCount&maxResults=${Math.min(
      max,
      50
    )}&q=${encodeURIComponent(query)}&publishedAfter=${publishedAfter}&key=${key}`
  );
  if (!sres.ok) throw new Error(`YouTube search ${sres.status}: ${(await sres.text()).slice(0, 140)}`);
  const sjson = await sres.json();

  const ids = (sjson.items || []).map((i) => i.id?.videoId).filter(Boolean);
  if (!ids.length) return [];

  const vres = await fetch(
    `${API}/videos?part=snippet,statistics,contentDetails&id=${ids.join(",")}&key=${key}`
  );
  if (!vres.ok) throw new Error(`YouTube videos ${vres.status}: ${(await vres.text()).slice(0, 140)}`);
  const vjson = await vres.json();

  return (vjson.items || []).map((v) => ({
    videoId: v.id,
    title: v.snippet?.title || "",
    channelTitle: v.snippet?.channelTitle || "",
    publishedAt: v.snippet?.publishedAt || null,
    tags: v.snippet?.tags || [],
    thumbnail: v.snippet?.thumbnails?.high?.url || v.snippet?.thumbnails?.default?.url || "",
    views: Number(v.statistics?.viewCount || 0),
    likes: Number(v.statistics?.likeCount || 0),
    comments: Number(v.statistics?.commentCount || 0),
    durationSec: parseDuration(v.contentDetails?.duration),
  }));
}
