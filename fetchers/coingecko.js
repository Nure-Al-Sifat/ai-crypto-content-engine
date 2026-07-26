import fetch from "node-fetch";

/**
 * CoinGecko's public /search/trending endpoint is free, no API key needed,
 * but is rate-limited (roughly 10-30 calls/min) — fine for a daily cron job.
 */
export async function fetchCoinGeckoTrends() {
  try {
    const res = await fetch("https://api.coingecko.com/api/v3/search/trending");
    if (!res.ok) throw new Error(`${res.status}`);
    const json = await res.json();

    return (json.coins || []).map((c) => ({
      source: "CoinGecko",
      title: `${c.item.name} (${c.item.symbol}) — trending, market cap rank #${c.item.market_cap_rank}`,
      link: `https://www.coingecko.com/en/coins/${c.item.id}`,
    }));
  } catch (err) {
    console.warn(`[coingecko] Skipped: ${err.message}`);
    return [];
  }
}
