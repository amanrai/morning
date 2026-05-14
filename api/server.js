import express from 'express'
import { db, rowToArticle } from './db.js'
import { fetchQueuedArticles, startDiscovery, tickDiscovery } from './discovery.js'
import { SUBREDDITS } from './sources.js'

const app = express()
const port = Number(process.env.API_PORT ?? 34567)

app.use(express.json({ limit: '1mb' }))

app.get('/api/health', (_req, res) => {
  const counts = db.prepare('SELECT status, count(*) AS count FROM articles GROUP BY status').all()
  res.json({ ok: true, counts, sources: SUBREDDITS })
})

app.get('/api/articles', (req, res) => {
  const status = req.query.status || 'ready'
  const q = String(req.query.q || '').trim()
  const limit = Math.min(Number(req.query.limit || 40), 100)
  const offset = Number(req.query.offset || 0)
  const sort = String(req.query.sort || 'synced')
  const orderBy = {
    synced: 'COALESCE(fetched_at, discovered_at) DESC',
    published: 'COALESCE(published_at, fetched_at, discovered_at) DESC',
    score: 'reddit_score DESC, discovered_at DESC',
    longest: 'word_count DESC, discovered_at DESC',
    shortest: 'word_count ASC, discovered_at DESC',
    unread: 'seen ASC, discovered_at DESC',
    saved: 'saved_at DESC',
  }[sort] || 'COALESCE(fetched_at, discovered_at) DESC'

  const where = []
  const params = []
  if (status !== 'all') { where.push('status = ?'); params.push(status) }
  if (sort === 'saved') where.push('saved = 1')
  if (q) {
    where.push(`id IN (SELECT rowid FROM articles_fts WHERE articles_fts MATCH ?)`)
    params.push(q.split(/\s+/).map(term => `${term.replace(/[^\p{L}\p{N}_-]/gu, '')}*`).filter(Boolean).join(' OR ') || q)
  }
  where.push('archived = 0')
  const sqlWhere = where.length ? `WHERE ${where.join(' AND ')}` : ''

  const rows = db.prepare(`
    SELECT id, url, source, subreddit, reddit_score, reddit_comments, title, byline, excerpt, site_name,
      word_count, reading_minutes, status, saved, saved_at, archived, seen, liked, discovered_at, fetched_at, published_at
    FROM articles
    ${sqlWhere}
    ORDER BY saved DESC, ${orderBy}
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset)

  res.json({ articles: rows.map(rowToArticle) })
})

app.get('/api/articles/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM articles WHERE id = ?').get(Number(req.params.id))
  if (!row) return res.status(404).json({ error: 'not found' })
  db.prepare('UPDATE articles SET seen = 1 WHERE id = ?').run(row.id)
  res.json({ article: rowToArticle({ ...row, seen: 1 }) })
})

app.patch('/api/articles/:id', (req, res) => {
  const id = Number(req.params.id)
  const allowed = ['saved', 'archived', 'seen', 'liked']
  const updates = []
  const params = []
  for (const key of allowed) {
    if (key in req.body) {
      updates.push(`${key} = ?`)
      const v = req.body[key]
      params.push(v === null ? null : v ? 1 : 0)
      if (key === 'saved') {
        updates.push('saved_at = ?')
        params.push(v ? new Date().toISOString() : null)
      }
    }
  }
  if (!updates.length) return res.status(400).json({ error: 'no allowed fields' })
  db.prepare(`UPDATE articles SET ${updates.join(', ')} WHERE id = ?`).run(...params, id)
  const row = db.prepare('SELECT * FROM articles WHERE id = ?').get(id)
  res.json({ article: rowToArticle(row) })
})

app.post('/api/discover', (_req, res) => {
  tickDiscovery().catch(console.error)
  res.json({ started: true })
})

app.post('/api/fetch-queued', async (req, res) => {
  const result = await fetchQueuedArticles(Math.min(Number(req.body?.limit ?? 10), 30))
  res.json({ fetched: result })
})

app.get('/api/runs', (_req, res) => {
  const runs = db.prepare('SELECT * FROM discovery_runs ORDER BY started_at DESC LIMIT 30').all()
  res.json({ runs })
})

if (process.env.NODE_ENV === 'production') {
  app.use(express.static('dist'))
  app.get('*', (_req, res) => res.sendFile('index.html', { root: 'dist' }))
}

app.listen(port, '0.0.0.0', () => {
  console.log(`api listening on http://0.0.0.0:${port}`)
  startDiscovery()
})
