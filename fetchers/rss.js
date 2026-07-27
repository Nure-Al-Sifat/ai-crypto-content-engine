import Parser from "rss-parser";

const parser = new Parser({ timeout: 10000 });

// Free, no-auth RSS feeds. Add/remove as you like.
const FEEDS = [
  { name: "CoinDesk", url: "https://www.coindesk.com/arc/outboundfeeds/rss/" },
  { name: "Decrypt", url: "https://decrypt.co/feed" },
];

/**
 * Fetches the latest N items from each RSS feed.
 * Fails soft per-feed so one dead feed doesn't kill the run.
 */
export async function fetchRssTrends(itemsPerFeed = 5) {
  const results = [];

  for (const feed of FEEDS) {
    try {
      const parsed = await parser.parseURL(feed.url);
      const items = (parsed.items || []).slice(0, itemsPerFeed).map((item) => ({
        source: feed.name,
        title: item.title,
        link: item.link,
        publishedAt: item.pubDate || item.isoDate || null,
      }));
      results.push(...items);
    } catch (err) {
      console.warn(`[rss] Skipping ${feed.name}: ${err.message}`);
    }
  }

  return results;
}
