import fetch from "node-fetch";

// Web3-gaming chains on DefiLlama (exact names, case-insensitive match).
const GAMING_CHAINS = new Set(
  ["ronin", "immutable x", "beam", "xai", "oasys", "wax", "treasure", "apechain", "redstone"]
);

/**
 * Real TVL (total value locked) for Web3-gaming chains — DefiLlama, no key.
 * Shows which gaming ecosystems actually hold money (and, with day-over-day
 * snapshots, which are growing or shrinking).
 */
export async function fetchGamingChainTVL() {
  try {
    const res = await fetch("https://api.llama.fi/v2/chains");
    if (!res.ok) throw new Error(`${res.status}`);
    const json = await res.json();
    if (!Array.isArray(json)) return [];

    return json
      .filter((c) => GAMING_CHAINS.has((c.name || "").toLowerCase()))
      .map((c) => ({ name: c.name, tvl: c.tvl || 0 }))
      .sort((a, b) => b.tvl - a.tvl);
  } catch (err) {
    console.warn(`[defillama] Skipped: ${err.message}`);
    return [];
  }
}
