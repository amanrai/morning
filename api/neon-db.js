import { readFileSync } from 'node:fs'
import { Client } from 'pg'

export function loadEnv(path = '.env') {
  try {
    const text = readFileSync(path, 'utf8')
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq === -1) continue
      const key = trimmed.slice(0, eq).trim()
      const value = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '')
      if (!(key in process.env)) process.env[key] = value
    }
  } catch {}
}

export function createClient() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is missing')
  return new Client({ connectionString: process.env.DATABASE_URL })
}

export async function getCurrentUserId(client) {
  const clerkUserId = process.env.MORNING_CLERK_USER_ID || process.env.MORNING_USER_ID || 'local-owner'
  const email = process.env.MORNING_USER_EMAIL || null
  const displayName = process.env.MORNING_USER_NAME || 'Aman'

  const result = await client.query(
    `INSERT INTO app_users (clerk_user_id, email, display_name, role)
     VALUES ($1, $2, $3, 'owner')
     ON CONFLICT (clerk_user_id) DO UPDATE SET
       email = COALESCE(EXCLUDED.email, app_users.email),
       display_name = COALESCE(EXCLUDED.display_name, app_users.display_name),
       updated_at = now()
     RETURNING id`,
    [clerkUserId, email, displayName],
  )
  return result.rows[0].id
}

export async function withDb(fn) {
  const client = createClient()
  try {
    await client.connect()
    return await fn(client)
  } finally {
    await client.end()
  }
}

function decodeEntities(str) {
  if (!str) return str
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&hellip;/g, '…')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
}

export function rowToArticle(row) {
  if (!row) return null
  return {
    id: row.id,
    url: row.original_url,
    canonical_url: row.canonical_url,
    source: row.source_kind || null,
    subreddit: row.subreddit || null,
    reddit_score: row.score ?? 0,
    reddit_comments: row.comments_count ?? 0,
    title: decodeEntities(row.title),
    byline: decodeEntities(row.byline),
    excerpt: decodeEntities(row.excerpt),
    site_name: row.site_name,
    word_count: row.word_count ?? 0,
    reading_minutes: row.reading_minutes ?? 0,
    status: row.status,
    saved: Boolean(row.saved),
    saved_at: row.saved_at,
    archived: Boolean(row.archived),
    archived_at: row.archived_at,
    seen: Boolean(row.seen),
    liked: row.liked,
    discovered_at: row.discovered_at,
    fetched_at: row.last_fetched_at,
    published_at: row.published_at,
    html_content: row.html_content,
    text_content: row.searchable_text,
    content_key: row.content_key,
  }
}
