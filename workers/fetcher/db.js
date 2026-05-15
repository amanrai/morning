import { Client } from 'pg'

export function createDb() {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error('DATABASE_URL is missing')
  return new Client({ connectionString: databaseUrl })
}

export async function upsertSource(client, { kind, name, url = null, config = {} }) {
  const result = await client.query(
    `INSERT INTO sources (kind, name, url, config)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (kind, name) DO UPDATE SET
       url = COALESCE(EXCLUDED.url, sources.url),
       config = sources.config || EXCLUDED.config,
       updated_at = now()
     RETURNING id`,
    [kind, name, url, config],
  )
  return result.rows[0].id
}

export async function upsertDiscoveredArticle(client, article) {
  const result = await client.query(
    `INSERT INTO articles (
       original_url, canonical_url, normalized_url, normalized_url_hash,
       title, excerpt, site_name, status, discovered_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'queued', now())
     ON CONFLICT (normalized_url_hash) DO UPDATE SET
       title = COALESCE(NULLIF(EXCLUDED.title, ''), articles.title),
       excerpt = COALESCE(NULLIF(EXCLUDED.excerpt, ''), articles.excerpt),
       updated_at = now()
     RETURNING id`,
    [
      article.originalUrl,
      article.canonicalUrl ?? null,
      article.normalizedUrl,
      article.normalizedUrlHash,
      article.title,
      article.excerpt ?? null,
      article.siteName ?? null,
    ],
  )
  return result.rows[0].id
}

export async function recordDiscovery(client, discovery) {
  await client.query(
    `INSERT INTO article_discoveries (
       article_id, source_id, source_kind, source_name, external_id, external_url,
       score, comments_count, payload, discovered_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
     ON CONFLICT (source_kind, external_id) DO UPDATE SET
       score = GREATEST(COALESCE(article_discoveries.score, 0), COALESCE(EXCLUDED.score, 0)),
       comments_count = GREATEST(COALESCE(article_discoveries.comments_count, 0), COALESCE(EXCLUDED.comments_count, 0)),
       payload = EXCLUDED.payload`,
    [
      discovery.articleId,
      discovery.sourceId,
      discovery.sourceKind,
      discovery.sourceName,
      discovery.externalId,
      discovery.externalUrl,
      discovery.score ?? null,
      discovery.commentsCount ?? null,
      discovery.payload ?? {},
    ],
  )
}

export async function getQueuedArticles(client, limit) {
  const limitClause = Number.isFinite(limit) && limit > 0 ? 'LIMIT $1' : ''
  const params = limitClause ? [limit] : []
  const result = await client.query(
    `SELECT id, original_url, normalized_url
     FROM articles
     WHERE status = 'queued'
     ORDER BY discovered_at DESC
     ${limitClause}`,
    params,
  )
  return result.rows
}

export async function markFetching(client, articleId) {
  await client.query(
    `UPDATE articles
     SET status = 'fetching', error = NULL, updated_at = now()
     WHERE id = $1 AND status IN ('queued', 'failed')`,
    [articleId],
  )
}

export async function markArticleReady(client, articleId, article) {
  await client.query(
    `UPDATE articles SET
       canonical_url = $2,
       title = $3,
       byline = $4,
       excerpt = $5,
       site_name = $6,
       published_at = $7,
       content_key = $8,
       content_hash = $9,
       content_bytes = $10,
       searchable_text = $11,
       word_count = $12,
       reading_minutes = $13,
       status = 'ready',
       error = NULL,
       first_fetched_at = COALESCE(first_fetched_at, now()),
       last_fetched_at = now(),
       updated_at = now()
     WHERE id = $1`,
    [
      articleId,
      article.canonicalUrl,
      article.title,
      article.byline,
      article.excerpt,
      article.siteName,
      article.publishedAt,
      article.contentKey,
      article.contentHash,
      article.contentBytes,
      article.searchableText,
      article.wordCount,
      article.readingMinutes,
    ],
  )
}

export async function markArticleFailed(client, articleId, error) {
  await client.query(
    `UPDATE articles SET
       status = 'failed',
       error = $2,
       last_fetched_at = now(),
       updated_at = now()
     WHERE id = $1`,
    [articleId, error instanceof Error ? error.message : String(error)],
  )
}

export async function recordFetchAttempt(client, attempt) {
  await client.query(
    `INSERT INTO article_fetch_attempts (
       article_id, url, worker_id, method, status, http_status, error, started_at, finished_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())`,
    [
      attempt.articleId,
      attempt.url,
      attempt.workerId ?? null,
      attempt.method ?? 'fetch',
      attempt.status,
      attempt.httpStatus ?? null,
      attempt.error ?? null,
      attempt.startedAt ?? new Date(),
    ],
  )
}
