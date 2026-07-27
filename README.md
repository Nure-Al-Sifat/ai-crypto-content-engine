# AI Web3-Gaming Content Engine

Finds the most viral topic in your niche right now, researches it, and drafts
ready-to-post content for **X, LinkedIn, YouTube, and Facebook** — into one
clean Excel sheet. You review and post. It never touches your accounts.

---

## Pipeline

```
1. FETCH        Web3-gaming sources (RSS, Reddit, Hacker News, Farcaster, CoinGecko)   plain code
2. SCORE        momentum (engagement/hour) + niche keywords, dedupe                     plain code
3. JUDGE   🤖   score each candidate 0–100 on viral criteria, pick #1                   AI decides
4. RESEARCH 🤖  read the winning article, pull the real facts + angle                   AI helps
5. WRITE   🤖   draft X + LinkedIn + YouTube + Facebook, grounded in those facts        AI creates
6. SAVE         one clean row → data/content-engine.xlsx                                plain code
                                    ↓
                       YOU review the row and post          human decides — no auto-posting
```

**What the AI does, and doesn't:** the AI *decides* the topic (stage 3),
*helps* by researching it (4), and *creates* the drafts (5). Fetching, scoring,
and saving are plain code — cheaper and error-free without a model. Publishing
is 100% yours.

Every AI call runs through a provider fallback chain (Groq → Gemini → Ollama)
with schema validation and self-correcting retries.

---

## The viral criteria (stage 3)

The judge scores each candidate 0–100 on: **hook** (stops the scroll),
**novelty** (a non-consensus take exists), **emotion/stakes**, **timeliness**
(momentum in the stats), **shareability**, and **fit** to your niche. It's
calibrated to be honest — most topics score below 40; 80+ is reserved for a
genuinely sharp, timely hook. The rubric lives in `ai/viral.js`.

> Honest limit: this maximizes the *odds*, it can't guarantee virality. And
> "worldwide everything" isn't free — X's trend API is paid and no tool scans
> all of the internet. What's real: the strong free Web3-gaming sources above,
> ranked by momentum, with the AI deciding the winner.

---

## The Excel output

`data/content-engine.xlsx`, one row per run:

`date · pillar · topic · source_link · viral_score · why · x_post · linkedin_post · youtube_title · youtube_hook · youtube_outline · facebook_post · hashtags · status`

Open it, read the row, post from it. Mark `status` yourself when done.

---

## Setup

```bash
npm install
cp .env.example .env
```

1. **AI key** — put a `GROQ_API_KEY` (free, fast, from console.groq.com) in
   `.env`. Gemini is a fallback; any one provider is enough.
2. **Your voice** — this matters most. Open `config/voice.js` and replace
   `SEED_EXAMPLES` with 10–15 of your *actual* posts. Generic examples produce
   generic posts.
3. *(Optional)* Reddit and Farcaster keys widen the source pool — skip-safe if
   blank. Hacker News, CoinGecko, and RSS need no keys.

```bash
npm run dry     # fetch + score only, no AI — tune keyword weights here
npm run card    # preview the branded card design (optional)
npm start       # full run → writes a row to data/content-engine.xlsx
```

`FORCE_RERUN=true` (default in `.env`) makes every run produce a fresh row.
Set it to `false` for one-per-day.

---

## The five pillars

Rotation is deterministic by weekday, so a re-run produces the same pillar.
Each pillar decides which sources get pulled. Edit `config/pillars.js` to change
the rotation or the angles.

| Day | Pillar | Pulls |
|---|---|---|
| Sun / Fri | Market Insight | news, market |
| Mon | Build Log | your GitHub commits |
| Tue / Sat | Technical Explainer | news |
| Wed | Ecosystem Commentary | news, social |
| Thu | Founder Story | none — voice + context only |

---

## Scheduling (free)

Push to GitHub. `.github/workflows/daily-content.yml` runs daily and uploads the
Excel file as a downloadable **artifact** on each run. Add repo secrets
`GROQ_API_KEY` (and optionally `GEMINI_API_KEY`, `REDDIT_CLIENT_ID`,
`REDDIT_CLIENT_SECRET`, `NEYNAR_API_KEY`), plus repo variable `GITHUB_REPOS`.

---

## Tuning

- **Output feels generic** → `config/voice.js`. Add more real posts. Almost
  always the cause.
- **Wrong topics picked** → `KEYWORD_WEIGHTS` in `fetchers/index.js`. Run
  `npm run dry` and check the ranking.
- **Viral scores feel off** → the rubric in `ai/viral.js`.
- **Repeating itself** → topic memory looks back 14 days (`getRecentTopics(14)`
  in `index.js`).

---

## Project layout

```
config/   pillars.js (rotation)   voice.js (your voice — highest leverage)
fetchers/ index.js (fetch + momentum score + dedupe)
          rss / reddit / coingecko / farcaster / misc / github / article.js
ai/       providers.js (fallback chain)   call.js (retry)   schema.js (zod)
          viral.js (judge)   research.js (grounding)   write.js (per-platform)
          generate.js (orchestrates research + write)
db/       excel.js (the single datastore)
image/    card.js (optional branded card — `npm run card`)
index.js  the orchestrator
```
