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

/**
 * Real gaming-token market data (CoinGecko "gaming" category, no key): price,
 * 24h change, volume. Strong, verifiable signal for which Web3-gaming projects
 * are actually moving right now.
 */
export async function fetchGamingCoins() {
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&category=gaming" +
        "&order=volume_desc&per_page=25&price_change_percentage=24h"
    );
    if (!res.ok) throw new Error(`${res.status}`);
    const json = await res.json();
    if (!Array.isArray(json)) return [];

    return json.map((c) => {
      const chg = c.price_change_percentage_24h ?? 0;
      return {
        source: "GamingToken",
        title: `${c.name} (${(c.symbol || "").toUpperCase()}) gaming token ${
          chg >= 0 ? "up" : "down"
        } ${Math.abs(chg).toFixed(1)}% in 24h`,
        link: `https://www.coingecko.com/en/coins/${c.id}`,
        symbol: (c.symbol || "").toUpperCase(),
        name: c.name,
        price: c.current_price,
        priceChange: chg,
        volume: c.total_volume || 0,
      };
    });
  } catch (err) {
    console.warn(`[coingecko-gaming] Skipped: ${err.message}`);
    return [];
  }
}
