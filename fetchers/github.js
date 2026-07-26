import fetch from "node-fetch";

/**
 * BUILD LOG SOURCE
 *
 * The most authentic founder content you can produce, and it costs nothing:
 * pull what you actually shipped this week from your own commit history.
 *
 * Works unauthenticated (60 req/hr) but set GITHUB_TOKEN for 5,000 req/hr and
 * access to private repos. Inside GitHub Actions, ${{ secrets.GITHUB_TOKEN }}
 * is provided automatically.
 */
export async function fetchRecentCommits({ days = 7, maxPerRepo = 25 } = {}) {
  const repos = (process.env.GITHUB_REPOS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (!repos.length) {
    console.log("[github] GITHUB_REPOS not set — skipping build log source");
    return [];
  }

  const since = new Date(Date.now() - days * 86400_000).toISOString();
  const headers = { Accept: "application/vnd.github+json" };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  const results = [];

  for (const repo of repos) {
    try {
      const res = await fetch(
        `https://api.github.com/repos/${repo}/commits?since=${since}&per_page=${maxPerRepo}`,
        { headers }
      );
      if (!res.ok) throw new Error(`${res.status}`);
      const commits = await res.json();

      for (const c of commits) {
        const msg = c.commit?.message?.split("\n")[0] || "";
        // Filter out noise that says nothing about what was built
        if (/^(merge|bump|chore\(deps\)|wip|fix typo|update readme)/i.test(msg)) continue;
        if (msg.length < 10) continue;

        results.push({
          source: `github/${repo}`,
          title: msg,
          link: c.html_url,
          publishedAt: c.commit?.author?.date,
          type: "commit",
        });
      }
    } catch (err) {
      console.warn(`[github] Skipping ${repo}: ${err.message}`);
    }
  }

  console.log(`[github] Found ${results.length} meaningful commits in last ${days}d`);
  return results;
}
