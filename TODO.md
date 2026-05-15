# Morning TODO

## Current architecture direction

Hosted/public-ish path:

```text
973858987.xyz
  -> Cloudflare Pages React UI
  -> Cloudflare Worker API at /api/*
       -> Neon metadata/search
       -> Cloudflare R2 article HTML
       -> Clerk auth later
```

Private/tailnet path:

```text
Tailnet worker host
  -> discovery workers
  -> extraction workers
  -> Kernel/browser fallback
  -> subscriptions/logged-in fetches later
  -> writes Neon + R2
```

The hosted API must only read already-ingested content and user state. It should not fetch arbitrary websites or run extraction.

---

## Immediate deployment path

### 1. Cloudflare Worker API

Create a Hono-based Worker that mirrors the current Neon API shape.

Routes:

- `GET /api/health`
- `GET /api/articles?status=ready&q=&sort=&limit=&offset=`
- `GET /api/articles/:id`

Responsibilities:

- read article metadata/search from Neon
- read article HTML from R2 by `content_key`
- return same response shape expected by the existing React UI
- no web fetching, no extraction, no browser automation

### 2. Cloudflare config

Add Worker config:

- `wrangler.toml`
- Worker source folder, likely `cloudflare/api-worker/`
- Hono dependency

Worker secrets/bindings:

- `DATABASE_URL`
- R2 bucket binding preferred if possible
- if not binding, R2 S3 credentials temporarily
- later `CLERK_SECRET_KEY`

### 3. Frontend deploy to Cloudflare Pages

Use current React/Vite app.

Cloudflare Pages settings:

- GitHub repo: `amanrai/morning`
- production branch: `main`
- build command: `npm run build`
- output directory: `dist`
- custom domain: `973858987.xyz`

Frontend should continue using relative API calls:

```js
fetch('/api/...')
```

Cloudflare route should send:

```text
/api/* -> Worker
/*     -> Pages static asset
```

### 4. Verify hosted app

Check:

- `https://973858987.xyz`
- `https://973858987.xyz/api/health`
- article list loads
- article detail loads HTML from R2
- search/sort works against Neon

---

## Worker/fetcher path

### Current worker scripts

- `npm run worker:discover:reddit`
- `npm run worker:extract`
- `npm run worker:fetcher` for discovery then extraction

Current behavior:

- Reddit discovery writes queued article metadata to Neon
- extractor reads queued articles
- normal fetch + Readability first
- Kernel browser fallback for browser-worthy failures when `KERNEL_API_KEY` exists
- extracted HTML uploads to R2
- Neon stores metadata/search text/content key

### Near-term worker improvements

- Confirm R2 upload path for extractor in a real run
- Add source-specific concurrency controls
- Separate future workers:
  - `worker:discover:news`
  - `worker:discover:subs`
  - `worker:discover:rss`
- Keep extraction queue shared through Neon initially
- Later move orchestration to Cloudflare Queues + polling tailnet worker

---

## Auth/user model

Use Clerk eventually.

Design principle:

- shared family library
- only per-user state differs

Per-user state:

- saved
- archived
- seen/read history
- liked/disliked/preference score
- font/theme preferences eventually

Initial hosted launch can be single-user/no Clerk if necessary, but schema already supports multi-user.

Once Clerk is added:

- no public signup after owner account exists
- allowlist or admin-controlled user creation later
- Worker verifies Clerk session/JWT
- Worker maps Clerk user id to `app_users`

---

## Recommendation system

Do not add new content sources until the recommendation system is good.

Goal: build the world's single best "Recommended for Aman" algorithm.

First version should be deterministic/scored:

```text
recommendation_score =
  freshness
+ source/subreddit quality
+ title/excerpt/content topic affinity
+ length preference
+ social signal
+ diversity bonus
- already seen
- archived/disliked
- duplicate/topic fatigue penalty
```

Later:

- embeddings/vector search in Neon or adjacent service
- agent-generated tags/summaries
- "more like saved"
- daily diversity constraints
- explanations: "recommended because..."

---

## Do not forget

- `.env` must stay uncommitted
- secrets only in local `.env`, Cloudflare secrets, or deploy environment
- hosted Worker must not expose extraction/fetching endpoints
- tailnet worker can be powerful/agentic; hosted API should remain boring and safe
