# AI Crypto Content Engine v2

A free daily content pipeline for a Web3 gaming founder. Pulls trending signal, curates it ruthlessly, writes in *your* voice across rotating content pillars, self-edits, renders a branded card, and hands you three variants in Telegram with approve/regenerate buttons.

Publishing stays manual by design — see [Why publishing is manual](#why-publishing-is-manual).

---

## Architecture

```
                    ┌─ RSS (CoinDesk, Decrypt, The Block)
                    ├─ Reddit (OAuth, free)
   PILLAR ROTATION  ├─ CoinGecko trending
   decides which ───┤─ Farcaster (Neynar free tier)
   sources to pull  ├─ Hacker News (no key)
                    ├─ YouTube RSS (no key)
                    └─ GitHub commits ──► Build Log pillar
                              │
                              ▼
                    PRE-FILTER SCORING
          keyword weights + engagement + recency decay
              + cross-source duplicate collapse
                              │
                              ▼
              ┌───────────────────────────────┐
              │  PASS 1 — CURATOR             │
              │  scores 25 items, keeps 1-3   │
              │  (knows what you covered      │
              │   in the last 14 days)        │
              └───────────────┬───────────────┘
                              ▼
              ┌───────────────────────────────┐
              │  PASS 2 — WRITER              │
              │  3 variants, distinct angles  │
              │  few-shot on YOUR best posts  │
              └───────────────┬───────────────┘
                              ▼
              ┌───────────────────────────────┐
              │  PASS 3 — CRITIC              │
              │  6-point rubric, revises      │
              │  (fabrication check included) │
              └───────────────┬───────────────┘
                              ▼
         Supabase  ◄──────────┼──────────►  Branded PNG card
        (idempotent,          │              (satori + resvg)
         topic memory,        ▼
         engagement)   TELEGRAM REVIEW
                    [1][2][3] variant switch
                    [✅ Approve] [🔄 Regenerate]
                    [📤 Published] [❌ Skip]
                              │
                              ▼
                    /metrics <id> <impressions> ...
                              │
                              └──► top performers become
                                   few-shot examples ──┐
                                                       │
                    ◄──────────────────────────────────┘
                         the engine improves weekly
```

Every AI call goes through a fallback chain (Gemini → Groq → Ollama) with schema validation and self-correcting retries.

---

## The five pillars

Rotation is deterministic by weekday, so a re-run produces the same pillar.

| Day | Pillar | Data it pulls |
|---|---|---|
| Sun | Market Insight | news, market |
| Mon | Build Log | your GitHub commits |
| Tue | Technical Explainer | news (prefers threads) |
| Wed | Ecosystem Commentary | news, social |
| Thu | Founder Story | none — voice + context only |
| Fri | Market Insight | news, market |
| Sat | Technical Explainer | news |

Edit `config/pillars.js` to change the rotation or the angles.

---

## Setup

### 1. Install
```bash
npm install
cp .env.example .env
```

### 2. Database
Create a free Supabase project, then run `db/sql/schema.sql` in the SQL editor. Copy the project URL and `service_role` key into `.env`.

### 3. AI provider
Fill in at least one. The chain skips any provider whose key is missing.

| Provider | Free? | Works in GitHub Actions? |
|---|---|---|
| Gemini (`ai.google.dev`) | free tier | yes |
| Groq (`console.groq.com`) | free tier, very fast | yes |
| Ollama (local) | fully free | no — needs a local server |

### 4. Data sources
- **Reddit**: create a *script* app at `reddit.com/prefs/apps`
- **Farcaster**: optional Neynar key — high signal for Web3, skip-safe without it
- **GitHub**: set `GITHUB_REPOS=owner/repo` to power Build Log
- **Hacker News / YouTube / CoinGecko / RSS**: no keys needed

### 5. Telegram
Create a bot via [@BotFather](https://t.me/BotFather). Message it once, then open `https://api.telegram.org/bot<TOKEN>/getUpdates` to find your `chat.id`.

### 6. **Tune the voice — do not skip this**
Open `config/voice.js` and replace `SEED_EXAMPLES` with 10-15 of your *actual* posts. This single file has more effect on output quality than every other setting combined. Generic examples produce generic posts.

### 7. Run
```bash
npm run dry     # fetch + score only, no AI calls — tune keyword weights here
npm run card    # preview the branded card design
npm start       # full pipeline
npm run force   # re-run over today's existing post
```

---

## Making the buttons work

The buttons need a public endpoint to receive callbacks. Two options:

**Cloudflare Workers (recommended — free, always warm)**
```bash
npm i -g wrangler
wrangler deploy server/worker.js --name content-engine-hook --compatibility-date 2026-01-01
wrangler secret put TELEGRAM_BOT_TOKEN
wrangler secret put TELEGRAM_CHAT_ID
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_SERVICE_KEY

curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<worker>.workers.dev"
```

**Local Node server** (for development)
```bash
npm run webhook          # listens on :3000
cloudflared tunnel --url http://localhost:3000
```

Without a webhook the engine still works — you just lose the buttons and mark things published manually.

---

## Scheduling (free)

Push to GitHub. `.github/workflows/daily-content.yml` runs daily at 12:00 UTC (6 PM Bangladesh). Add these repo secrets:

`GEMINI_API_KEY`, `GROQ_API_KEY`, `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, `NEYNAR_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`

And these repo *variables*: `GITHUB_REPOS`, `X_HANDLE`.

The workflow also supports manual runs with a pillar override from the Actions tab.

---

## Tuning guide

**Output feels generic** → `config/voice.js`. Add more real examples. This is almost always the cause.

**Wrong topics selected** → `KEYWORD_WEIGHTS` in `fetchers/index.js`. Run `npm run dry` and look at the ranking. If the top items aren't things you'd post about, the weights are wrong — not the model.

**Repeating itself** → topic memory looks back 14 days by default (`getRecentTopics(14)` in `index.js`). Increase it. For stronger semantic matching, enable the pgvector block at the bottom of `db/sql/schema.sql`.

**Critic too harsh / too soft** → the `RUBRIC` constant in `ai/critique.js`.

**Costs too many calls** → drop `VARIANT_COUNT` to 1 and comment out the critique pass in `ai/generate.js`. That takes it from 3 calls/day to 2.

---

## Why publishing is manual

X removed its free API tier for new developers in February 2026 and moved to pay-per-use — roughly $0.015 per plain-text post and $0.20 per post containing a URL. At 1-2 posts a day that's genuinely cheap (a dollar or two a month), but it is no longer free, and it requires buying credits up front.

LinkedIn's posting API needs developer program approval for personal profiles.

Browser automation would technically work but risks your account, which is a bad trade for a founder whose account *is* the distribution.

So the engine stops at "ready to post" and hands you the text. Copy, paste, publish. Zero API cost, zero account risk, and you keep final editorial control — which for founder content is a feature, not a compromise.

**When you want to automate it:** X pay-per-use is the natural first upgrade. Add a `publish/x.js` module, call it from the `a:` (approve) branch of the webhook handler, and the rest of the pipeline is already in place.

---

## Project layout

```
config/
  pillars.js       five pillars, rotation, per-pillar angles
  voice.js         ← your voice. the highest-leverage file here.
fetchers/
  index.js         aggregation, scoring, cross-source dedupe
  rss/reddit/coingecko/farcaster/misc/github.js
ai/
  providers.js     Gemini → Groq → Ollama fallback chain
  schema.js        zod schemas + tolerant JSON parsing
  call.js          retry that feeds errors back to the model
  curate.js        pass 1
  write.js         pass 2
  critique.js      pass 3
  generate.js      orchestration + X length enforcement
db/
  supabase.js      idempotency, topic memory, feedback loop
  sql/schema.sql   run this once
notify/telegram.js review UI with inline buttons
image/card.js      branded PNG cards, no AI image gen
server/
  worker.js        Cloudflare Worker callback handler (free)
  webhook.js       local Node equivalent
scripts/
  dry-run.js       fetch + score, no AI
  preview-card.js  card design iteration
```
