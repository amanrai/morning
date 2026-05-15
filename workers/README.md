# workers

Background workers for Morning.

These are intentionally separate from the hosted website/API. They can run on a private machine, tailnet host, or any box with credentials for Neon and R2.

Current workers:

- `fetcher/` — discovery and extraction pipeline.

The long-term shape is multiple discovery workers feeding a shared extraction queue:

```text
worker:discover:reddit
worker:discover:news
worker:discover:subs
worker:discover:rss
        │
        ▼
Neon articles.status = queued
        │
        ▼
worker:extract → R2 + Neon
```
