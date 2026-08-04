import Parser from "rss-parser";

const parser = new Parser({
  timeout: 10000,
  headers: { "User-Agent": "Mozilla/5.0" },
});

// Google News search RSS aggregates hundreds of outlets — free, no key. Each
// query returns genuinely on-topic Web3-gaming articles with real links + dates.
const DEFAULT_QUERIES = "web3 gaming,GameFi,play to earn,blockchain game,crypto gaming";

/**
 * Fetches recent Web3-gaming news via Google News search RSS.
 * Fails soft per query so one bad query doesn't kill the run.
 */
export async function fetchGoogleNews(itemsPerQuery = 6) {
  const queries = (process.env.GOOGLE_NEWS_QUERIES || DEFAULT_QUERIES)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const results = [];
  for (const q of queries) {
    try {
      const url = `https://news.google.com/rss/search?q=${encodeURIComponent(
        q
      )}&hl=en-US&gl=US&ceid=US:en`;
      const feed = await parser.parseURL(url);

      const items = (feed.items || []).slice(0, itemsPerQuery).map((item) => {
        // Google News titles look like "Headline - Publication" — split the
        // publication out so the real outlet shows as the source.
        let title = item.title || "";
        let pub = "";
        const dash = title.lastIndexOf(" - ");
        if (dash > 20) {
          pub = title.slice(dash + 3).trim();
          title = title.slice(0, dash).trim();
        }
        return {
          source: pub ? `GNews/${pub}` : "GoogleNews",
          title,
          link: item.link,
          publishedAt: item.pubDate || item.isoDate || null,
        };
      });
      results.push(...items);
    } catch (err) {
      console.warn(`[googlenews] Skipping "${q}": ${err.message}`);
    }
  }
  return results;
}
