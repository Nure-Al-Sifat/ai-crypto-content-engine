import fetch from "node-fetch";

/**
 * Fetches an article URL and returns its main text (best-effort HTML strip).
 * Fails SOFT: returns null on any error, block (403/paywall), or timeout, so
 * the research step can fall back to the headline + related items.
 */
export async function fetchArticleText(url, { timeoutMs = 10000, maxChars = 8000 } = {}) {
  if (!url || !/^https?:\/\//.test(url)) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    if (!res.ok) {
      console.warn(`[article] ${res.status} for ${url}`);
      return null;
    }
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("html") && !ct.includes("text")) return null;

    const html = await res.text();
    const text = htmlToText(html).slice(0, maxChars);
    return text.length > 200 ? text : null; // too little text = probably a JS-only shell
  } catch (err) {
    console.warn(`[article] fetch failed for ${url}: ${err.message}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Crude but dependency-free: prefer <p> text, strip the rest, decode a few entities. */
function htmlToText(html) {
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");

  const paras = [...stripped.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => m[1]);
  const body = paras.length ? paras.join("\n") : stripped;

  return body
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}
