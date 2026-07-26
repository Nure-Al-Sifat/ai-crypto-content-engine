import Parser from "rss-parser";
import fetch from "node-fetch";

const parser = new Parser({ timeout: 10000 });

/**
 * YouTube exposes a per-channel RSS feed with no API key and no quota:
 *   https://www.youtube.com/feeds/videos.xml?channel_id=UCxxxx
 * Find a channel_id by viewing page source and searching for "channelId".
 */
export async function fetchYouTubeTrends(itemsPerChannel = 3) {
  const ids = (process.env.YOUTUBE_CHANNEL_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (!ids.length) return [];

  const results = [];
  for (const id of ids) {
    try {
      const feed = await parser.parseURL(
        `https://www.youtube.com/feeds/videos.xml?channel_id=${id}`
      );
      const items = (feed.items || []).slice(0, itemsPerChannel).map((item) => ({
        source: `youtube/${feed.title || id}`,
        title: item.title,
        link: item.link,
        publishedAt: item.pubDate || item.isoDate,
      }));
      results.push(...items);
    } catch (err) {
      console.warn(`[youtube] Skipping ${id}: ${err.message}`);
    }
  }
  return results;
}

/**
 * Hacker News Algolia search — free, no key, no auth.
 */
export async function fetchHackerNewsTrends(limit = 10) {
  const queries = (process.env.HN_QUERIES || "web3 gaming,crypto payments,esports")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const results = [];
  const since = Math.floor(Date.now() / 1000) - 60 * 60 * 48; // last 48h

  for (const q of queries) {
    try {
      const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(
        q
      )}&tags=story&numericFilters=created_at_i>${since}&hitsPerPage=${limit}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status}`);
      const json = await res.json();

      for (const hit of json.hits || []) {
        if (!hit.title) continue;
        results.push({
          source: "HackerNews",
          title: hit.title,
          link: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
          upvotes: hit.points,
          publishedAt: hit.created_at,
        });
      }
    } catch (err) {
      console.warn(`[hn] Skipping "${q}": ${err.message}`);
    }
  }
  return results;
}
