# workers/fetcher

Standalone discovery/extraction worker for Morning.

## Scripts

Run Reddit discovery only:

```bash
npm run worker:discover:reddit
```

Run queued extraction only:

```bash
npm run worker:extract
```

Run both, discovery then extraction:

```bash
npm run worker:fetcher
```

Backward-compatible aliases:

```bash
npm run worker:fetcher:discover
npm run worker:fetcher:fetch
```

## Configuration

Required `.env` values:

```env
DATABASE_URL=postgres://...
R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
R2_BUCKET=morning
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
```

Optional values:

```env
KERNEL_API_KEY=...
KERNEL_CONCURRENCY=3
KERNEL_CREATE_RETRIES=6
KERNEL_RETRY_DELAY_MS=15000
MIN_WORDS=100
MAX_FETCH_PER_RUN=1000 # optional; unset means all queued articles
ARTICLE_FETCH_CONCURRENCY=1
REDDIT_FETCH_CONCURRENCY=1 # legacy name; still supported
REDDIT_PAGE_LIMIT=100
REDDIT_MAX_PAGES=10
REDDIT_SORT=top
REDDIT_TIME=year
REDDIT_LOOKBACK_DAYS=365
REQUEST_DELAY_MS=5000
FETCHER_SUBREDDITS_FILE=workers/fetcher/subreddits.txt
FETCHER_SUBREDDITS=longreads,TrueReddit
```

## Flow

### Discovery

`discover-reddit.js`:

1. Reads subreddits from `subreddits.txt` unless overridden by env.
2. Calls Reddit `.json` endpoints.
3. Normalizes and hashes outbound article URLs.
4. Upserts `sources`, `articles`, and `article_discoveries` in Neon.
5. Leaves articles as `status = 'queued'`.

### Extraction

`extract-queued.js`:

1. Reads queued articles from Neon.
2. Fetches article HTML.
3. Runs Mozilla Readability.
4. If normal fetch/Readability fails in a browser-worthy way — 403/401/429, too short, empty Readability output, JS/access-denied style errors — retries with Kernel browser rendering when `KERNEL_API_KEY` is configured.
   - Kernel browser fallback has its own internal concurrency gate, default `KERNEL_CONCURRENCY=3`; lower it to `1` if Kernel starts returning 429s.
   - Browser creation retries on Kernel `429 Too Many Requests` with backoff.
5. Uploads sanitized reader HTML to R2.
6. Updates Neon article metadata, searchable text, content hash, and R2 key.
7. Records `article_fetch_attempts`.

By default, extraction processes all queued articles one at a time and waits between attempts. Set `MAX_FETCH_PER_RUN` for a bounded test batch. Extraction concurrency is intentionally conservative:

```text
MAX_FETCH_PER_RUN=1000 # optional; unset means all queued articles
ARTICLE_FETCH_CONCURRENCY=1
REQUEST_DELAY_MS=5000
```

When we add subscription/news fetchers, they should get separate source-specific concurrency controls.
