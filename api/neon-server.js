import express from 'express'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { getObjectText } from './r2-client.js'
import { getCurrentUserId, loadEnv, rowToArticle, withDb } from './neon-db.js'

loadEnv()

const app = express()
const port = Number(process.env.NEON_API_PORT ?? 34568)
const root = dirname(dirname(fileURLToPath(import.meta.url)))
const distDir = join(root, 'dist')

app.use(express.json({ limit: '1mb' }))

function orderByForSort(sort) {
  return {
    synced: 'a.last_fetched_at DESC NULLS LAST, a.discovered_at DESC',
    published: 'a.published_at DESC NULLS LAST, a.discovered_at DESC',
    score: 'COALESCE(d.score, 0) DESC, a.discovered_at DESC',
    longest: 'a.word_count DESC, a.discovered_at DESC',
    shortest: 'a.word_count ASC, a.discovered_at DESC',
    unread: 'COALESCE(s.seen, false) ASC, a.discovered_at DESC',
    saved: 's.saved_at DESC NULLS LAST',
  }[sort] || 'a.last_fetched_at DESC NULLS LAST, a.discovered_at DESC'
}

function searchQuery(q) {
  return q
    .split(/\s+/)
    .map((term) => term.replace(/[^\p{L}\p{N}_-]/gu, '').trim())
    .filter(Boolean)
    .map((term) => `${term}:*`)
    .join(' | ')
}

function articleSelectSql({ discoveryFilter = '' } = {}) {
  return `WITH best_discovery AS (
    SELECT DISTINCT ON (article_id)
      article_id,
      source_kind,
      source_name AS subreddit,
      score,
      comments_count
    FROM article_discoveries
    ${discoveryFilter}
    ORDER BY article_id, COALESCE(score, 0) DESC, discovered_at DESC
  )
  SELECT
    a.id, a.original_url, a.canonical_url, a.title, a.byline, a.excerpt, a.site_name,
    a.word_count, a.reading_minutes, a.status, a.discovered_at, a.last_fetched_at,
    a.published_at, a.content_key, a.searchable_text,
    d.source_kind, d.subreddit, d.score, d.comments_count,
    COALESCE(s.saved, false) AS saved, s.saved_at,
    COALESCE(s.archived, false) AS archived, s.archived_at,
    COALESCE(s.seen, false) AS seen, s.liked
  FROM articles a
  LEFT JOIN best_discovery d ON d.article_id = a.id
  LEFT JOIN user_article_state s ON s.article_id = a.id AND s.user_id = $1`
}

app.get('/api/health', async (_req, res, next) => {
  try {
    const result = await withDb(async (db) => db.query('SELECT status, count(*)::int AS count FROM articles GROUP BY status ORDER BY status'))
    res.json({ ok: true, backend: 'neon', counts: result.rows })
  } catch (err) {
    next(err)
  }
})

app.get('/api/articles', async (req, res, next) => {
  try {
    const status = String(req.query.status || 'ready')
    const sort = String(req.query.sort || 'published')
    const q = String(req.query.q || '').trim()
    const limit = Math.min(Number(req.query.limit || 40), 100)
    const offset = Number(req.query.offset || 0)
    const minWords = Number(req.query.min_words ?? req.query.minWords ?? 100)

    const result = await withDb(async (db) => {
      const userId = await getCurrentUserId(db)
      const where = []
      const params = [userId]

      if (status !== 'all') {
        params.push(status)
        where.push(`a.status = $${params.length}`)
      }

      if (sort === 'saved') where.push('COALESCE(s.saved, false) = true')
      where.push('COALESCE(s.archived, false) = false')

      if (Number.isFinite(minWords) && minWords > 0) {
        params.push(minWords)
        where.push(`a.word_count >= $${params.length}`)
      }

      if (q) {
        params.push(searchQuery(q))
        where.push(`a.search_vector @@ to_tsquery('english', $${params.length})`)
      }

      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
      params.push(limit, offset)

      return db.query(
        `${articleSelectSql()}
         ${whereSql}
         ORDER BY ${orderByForSort(sort)}
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      )
    })

    res.json({ articles: result.rows.map(rowToArticle) })
  } catch (err) {
    next(err)
  }
})

app.get('/api/articles/:id', async (req, res, next) => {
  try {
    const result = await withDb(async (db) => {
      const userId = await getCurrentUserId(db)
      return db.query(
        `${articleSelectSql({ discoveryFilter: 'WHERE article_id = $2' })}
         WHERE a.id = $2`,
        [userId, req.params.id],
      )
    })

    if (!result.rows[0]) return res.status(404).json({ error: 'not found' })

    const row = result.rows[0]
    let htmlContent = null
    if (row.content_key) {
      try {
        htmlContent = await getObjectText(row.content_key)
      } catch (err) {
        console.error(`failed to read R2 object ${row.content_key}: ${err.message}`)
      }
    }

    await withDb(async (db) => {
      const userId = await getCurrentUserId(db)
      await upsertUserArticleState(db, userId, req.params.id, { seen: true })
    })

    res.json({ article: rowToArticle({ ...row, seen: true, html_content: htmlContent }) })
  } catch (err) {
    next(err)
  }
})

async function upsertUserArticleState(db, userId, articleId, patch) {
  await db.query(
    `INSERT INTO user_article_state (
       user_id, article_id, saved, saved_at, archived, archived_at, seen, first_seen_at, last_seen_at, liked
     ) VALUES (
       $1, $2,
       COALESCE($3, false), CASE WHEN COALESCE($3, false) THEN now() ELSE NULL END,
       COALESCE($4, false), CASE WHEN COALESCE($4, false) THEN now() ELSE NULL END,
       COALESCE($5, false), CASE WHEN COALESCE($5, false) THEN now() ELSE NULL END, CASE WHEN COALESCE($5, false) THEN now() ELSE NULL END,
       $6
     )
     ON CONFLICT (user_id, article_id) DO UPDATE SET
       saved = COALESCE($3, user_article_state.saved),
       saved_at = CASE
         WHEN $3 IS TRUE AND user_article_state.saved_at IS NULL THEN now()
         WHEN $3 IS FALSE THEN NULL
         ELSE user_article_state.saved_at
       END,
       archived = COALESCE($4, user_article_state.archived),
       archived_at = CASE
         WHEN $4 IS TRUE AND user_article_state.archived_at IS NULL THEN now()
         WHEN $4 IS FALSE THEN NULL
         ELSE user_article_state.archived_at
       END,
       seen = COALESCE($5, user_article_state.seen),
       first_seen_at = CASE
         WHEN $5 IS TRUE THEN COALESCE(user_article_state.first_seen_at, now())
         ELSE user_article_state.first_seen_at
       END,
       last_seen_at = CASE WHEN $5 IS TRUE THEN now() ELSE user_article_state.last_seen_at END,
       liked = CASE WHEN $7 IS TRUE THEN $6 ELSE user_article_state.liked END,
       updated_at = now()`,
    [
      userId,
      articleId,
      'saved' in patch ? Boolean(patch.saved) : null,
      'archived' in patch ? Boolean(patch.archived) : null,
      'seen' in patch ? Boolean(patch.seen) : null,
      'liked' in patch ? (patch.liked === null ? null : Boolean(patch.liked)) : null,
      'liked' in patch,
    ],
  )
}

app.patch('/api/articles/:id', async (req, res, next) => {
  try {
    const articleId = req.params.id
    const patch = req.body || {}

    const result = await withDb(async (db) => {
      const userId = await getCurrentUserId(db)
      const existing = await db.query('SELECT id FROM articles WHERE id = $1', [articleId])
      if (!existing.rowCount) return null

      await upsertUserArticleState(db, userId, articleId, patch)
      return db.query(
        `${articleSelectSql({ discoveryFilter: 'WHERE article_id = $2' })}
         WHERE a.id = $2`,
        [userId, articleId],
      )
    })

    if (!result) return res.status(404).json({ error: 'not found' })
    res.json({ article: rowToArticle(result.rows[0]) })
  } catch (err) {
    next(err)
  }
})

app.post('/api/discover', (_req, res) => res.status(501).json({ error: 'run worker:discover:reddit separately' }))
app.post('/api/fetch-queued', (_req, res) => res.status(501).json({ error: 'run worker:extract separately' }))
app.get('/api/runs', (_req, res) => res.json({ runs: [] }))

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(distDir))
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/')) return next()
    res.sendFile('index.html', { root: distDir })
  })
}

app.use((err, _req, res, _next) => {
  console.error(err)
  res.status(500).json({ error: err.message || 'internal error' })
})

app.listen(port, '0.0.0.0', () => {
  console.log(`neon api listening on http://0.0.0.0:${port}`)
})
