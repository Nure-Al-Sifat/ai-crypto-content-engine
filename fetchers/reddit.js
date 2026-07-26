import fetch from "node-fetch";

let cachedToken = null;
let tokenExpiresAt = 0;

/**
 * Reddit requires OAuth even for read-only free access.
 * Create a "script" app at https://www.reddit.com/prefs/apps to get
 * REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET.
 */
async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken;

  const { REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USER_AGENT } = process.env;
  if (!REDDIT_CLIENT_ID || !REDDIT_CLIENT_SECRET) {
    throw new Error("Missing REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET in .env");
  }

  const basicAuth = Buffer.from(`${REDDIT_CLIENT_ID}:${REDDIT_CLIENT_SECRET}`).toString("base64");

  const res = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": REDDIT_USER_AGENT || "ai-crypto-content-engine/1.0",
    },
    body: "grant_type=client_credentials",
  });

  if (!res.ok) throw new Error(`Reddit auth failed: ${res.status} ${await res.text()}`);

  const data = await res.json();
  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000; // refresh 1 min early
  return cachedToken;
}

/**
 * Pulls top "hot" posts from each configured subreddit.
 */
export async function fetchRedditTrends(postsPerSub = 5) {
  const subs = (process.env.REDDIT_SUBREDDITS || "CryptoCurrency")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const token = await getAccessToken();
  const results = [];

  for (const sub of subs) {
    try {
      const res = await fetch(
        `https://oauth.reddit.com/r/${sub}/hot?limit=${postsPerSub}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "User-Agent": process.env.REDDIT_USER_AGENT || "ai-crypto-content-engine/1.0",
          },
        }
      );
      if (!res.ok) throw new Error(`${res.status}`);
      const json = await res.json();

      const posts = (json.data?.children || [])
        .filter((p) => !p.data.stickied)
        .map((p) => ({
          source: `r/${sub}`,
          title: p.data.title,
          link: `https://reddit.com${p.data.permalink}`,
          upvotes: p.data.ups,
        }));

      results.push(...posts);
    } catch (err) {
      console.warn(`[reddit] Skipping r/${sub}: ${err.message}`);
    }
  }

  return results;
}
