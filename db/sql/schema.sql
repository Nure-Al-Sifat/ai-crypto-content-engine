-- Applied automatically by `npm run init-db` (Railway/any Postgres).
-- Or paste into a SQL console (Supabase, psql, etc.) to run it by hand.

-- ============================================================
-- posts: one row per generated post set
-- ============================================================
create table if not exists posts (
  id            bigint generated always as identity primary key,
  created_at    timestamptz default now(),
  run_date      date not null,               -- idempotency key
  pillar        text not null,

  variants      jsonb not null,              -- all generated variants
  chosen_index  int default 0,               -- which variant you picked
  sources       jsonb,                       -- what it was based on
  topic_key     text,                        -- normalized topic, for dedupe

  status        text default 'pending',      -- pending | approved | published | skipped
  critique      jsonb,

  -- feedback loop
  published_at  timestamptz,
  impressions   int,
  likes         int,
  reposts       int,
  replies       int,
  engagement_rate numeric generated always as (
    case when impressions > 0
      then (coalesce(likes,0) + coalesce(reposts,0)*2 + coalesce(replies,0)*3)::numeric
           / impressions
      else null end
  ) stored
);

-- One post set per day. Makes re-runs of the GitHub Action idempotent.
create unique index if not exists posts_run_date_uniq on posts (run_date);

create index if not exists posts_status_idx on posts (status);
create index if not exists posts_engagement_idx on posts (engagement_rate desc nulls last);

-- ============================================================
-- covered_topics: what we've already talked about
-- ============================================================
create table if not exists covered_topics (
  id          bigint generated always as identity primary key,
  created_at  timestamptz default now(),
  topic       text not null,
  topic_key   text not null,
  post_id     bigint references posts(id) on delete cascade
);

create index if not exists covered_topics_key_idx on covered_topics (topic_key);
create index if not exists covered_topics_created_idx on covered_topics (created_at desc);

-- ============================================================
-- OPTIONAL: semantic dedupe with pgvector (free tier supports it)
-- ------------------------------------------------------------
-- Keyword dedupe misses "Base launches gaming fund" vs "Coinbase L2 backs
-- game studios". Embeddings catch it. Enable if you want the stronger version.
-- ============================================================
-- create extension if not exists vector;
-- alter table covered_topics add column if not exists embedding vector(768);
-- create index on covered_topics using ivfflat (embedding vector_cosine_ops);
