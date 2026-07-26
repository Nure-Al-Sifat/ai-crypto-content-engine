import fetch from "node-fetch";

/**
 * Farcaster carries Web3-native conversation days before it reaches Reddit.
 * Neynar has a free tier; set NEYNAR_API_KEY to enable. Without a key this
 * fetcher no-ops rather than failing the run.
 */
export async function fetchFarcasterTrends(limit = 10) {
  const key = process.env.NEYNAR_API_KEY;
  if (!key) {
    console.log("[farcaster] NEYNAR_API_KEY not set — skipping");
    return [];
  }

  const channels = (process.env.FARCASTER_CHANNELS || "gaming,base,ethereum")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const results = [];

  for (const channel of channels) {
    try {
      const url = `https://api.neynar.com/v2/farcaster/feed/channels?channel_ids=${channel}&limit=${limit}&with_recasts=false`;
      const res = await fetch(url, {
        headers: { accept: "application/json", "x-api-key": key },
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const json = await res.json();

      for (const cast of json.casts || []) {
        const text = (cast.text || "").trim();
        if (text.length < 40) continue; // skip one-liners and reactions

        results.push({
          source: `farcaster/${channel}`,
          title: text.slice(0, 240),
          link: `https://warpcast.com/${cast.author?.username}/${cast.hash?.slice(0, 10)}`,
          engagement:
            (cast.reactions?.likes_count || 0) + (cast.replies?.count || 0) * 2,
          publishedAt: cast.timestamp,
        });
      }
    } catch (err) {
      console.warn(`[farcaster] Skipping /${channel}: ${err.message}`);
    }
  }

  return results;
}
