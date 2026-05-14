import { JSDOM } from 'jsdom'
import { Readability } from '@mozilla/readability'
import { db } from './db.js'
import { SUBREDDITS, USER_AGENT } from './sources.js'

const MIN_WORDS = 1200
const FETCH_INTERVAL_MS = Number(process.env.DISCOVERY_INTERVAL_MS ?? 4 * 60 * 1000)
const MAX_FETCH_PER_TICK = Number(process.env.MAX_FETCH_PER_TICK ?? 18)
const SUBREDDITS_PER_TICK = Number(process.env.SUBREDDITS_PER_TICK ?? 2)

const badHosts = new Set([
  'youtube.com', 'www.youtube.com', 'youtu.be', 'vimeo.com', 'twitter.com', 'x.com',
  'instagram.com', 'www.instagram.com', 'reddit.com', 'www.reddit.com', 'old.reddit.com',
])

function now() { return new Date().toISOString() }
function readingMinutes(words) { return Math.max(1, Math.round(words / 230)) }
function wordCount(text = '') { return (text.trim().match(/\S+/g) ?? []).length }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }
function parseDate(value) {
  if (!value) return null
  const t = Date.parse(value)
  return Number.isFinite(t) ? new Date(t).toISOString() : null
}
function getPublishedAt(document) {
  const selectors = [
    'meta[property="article:published_time"]',
    'meta[name="article:published_time"]',
    'meta[name="pubdate"]',
    'meta[name="publishdate"]',
    'meta[name="date"]',
    'meta[itemprop="datePublished"]',
    'time[datetime]',
  ]
  for (const selector of selectors) {
    const el = document.querySelector(selector)
    const value = el?.getAttribute('content') || el?.getAttribute('datetime') || el?.textContent
    const parsed = parseDate(value)
    if (parsed) return parsed
  }
  return null
}

function normalizeUrl(raw) {
  try {
    const u = new URL(raw)
    if (!['http:', 'https:'].includes(u.protocol)) return null
    const host = u.hostname.replace(/^www\./, '')
    if (badHosts.has(u.hostname) || badHosts.has(host)) return null
    for (const key of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|mc_|ref$|ref_src$)/i.test(key)) u.searchParams.delete(key)
    }
    u.hash = ''
    return u.toString()
  } catch {
    return null
  }
}

async function getJson(url) {
  const res = await fetch(url, { headers: { 'user-agent': USER_AGENT, accept: 'application/json' } })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json()
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: {
      'user-agent': USER_AGENT,
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  const contentType = res.headers.get('content-type') || ''
  if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
    throw new Error(`not html: ${contentType}`)
  }
  return { html: await res.text(), finalUrl: res.url }
}

const insertDiscovered = db.prepare(`
INSERT INTO articles (url, source, subreddit, reddit_id, reddit_permalink, reddit_score, reddit_comments, title, excerpt, status, last_seen_at)
VALUES (?, 'reddit', ?, ?, ?, ?, ?, ?, ?, 'queued', CURRENT_TIMESTAMP)
ON CONFLICT(url) DO UPDATE SET
  reddit_score = max(reddit_score, excluded.reddit_score),
  reddit_comments = max(reddit_comments, excluded.reddit_comments),
  last_seen_at = CURRENT_TIMESTAMP
`)

export async function discoverSubreddit(subreddit) {
  const run = db.prepare('INSERT INTO discovery_runs (source) VALUES (?)').run(`reddit:${subreddit}`)
  let found = 0, imported = 0
  try {
    const json = await getJson(`https://www.reddit.com/r/${subreddit}/hot.json?limit=50`)
    const posts = json?.data?.children ?? []
    for (const child of posts) {
      const p = child.data
      if (!p || p.is_self || p.over_18) continue
      const url = normalizeUrl(p.url)
      if (!url) continue
      found++
      insertDiscovered.run(url, subreddit, p.id, `https://www.reddit.com${p.permalink}`, p.score ?? 0, p.num_comments ?? 0, p.title ?? url, p.selftext?.slice(0, 500) ?? '')
      if (db.prepare('SELECT changes() AS c').get().c > 0) imported++
    }
    db.prepare('UPDATE discovery_runs SET finished_at = CURRENT_TIMESTAMP, found_count = ?, imported_count = ? WHERE id = ?').run(found, imported, run.lastInsertRowid)
    return { subreddit, found, imported }
  } catch (err) {
    db.prepare('UPDATE discovery_runs SET finished_at = CURRENT_TIMESTAMP, found_count = ?, imported_count = ?, error = ? WHERE id = ?').run(found, imported, err.message, run.lastInsertRowid)
    throw err
  }
}

export async function fetchArticle(id, url) {
  try {
    const { html, finalUrl } = await fetchHtml(url)
    const dom = new JSDOM(html, { url: finalUrl })
    const publishedAt = getPublishedAt(dom.window.document)
    const article = new Readability(dom.window.document, { keepClasses: false }).parse()
    if (!article?.textContent) throw new Error('readability found no article text')

    const words = wordCount(article.textContent)
    if (words < MIN_WORDS) throw new Error(`too short: ${words} words`)

    db.prepare(`
      UPDATE articles SET
        canonical_url = ?, title = ?, byline = ?, excerpt = ?, site_name = ?,
        text_content = ?, html_content = ?, word_count = ?, reading_minutes = ?,
        status = 'ready', error = NULL, fetched_at = CURRENT_TIMESTAMP, published_at = ?
      WHERE id = ?
    `).run(finalUrl, article.title || url, article.byline || null, article.excerpt || null, article.siteName || new URL(finalUrl).hostname, article.textContent, article.content, words, readingMinutes(words), publishedAt, id)
    return { id, status: 'ready', words }
  } catch (err) {
    db.prepare("UPDATE articles SET status = 'failed', error = ?, fetched_at = CURRENT_TIMESTAMP WHERE id = ?").run(err.message, id)
    return { id, status: 'failed', error: err.message }
  }
}

export async function fetchQueuedArticles(limit = MAX_FETCH_PER_TICK) {
  const rows = db.prepare("SELECT id, url FROM articles WHERE status = 'queued' ORDER BY reddit_score DESC, discovered_at DESC LIMIT ?").all(limit)
  const results = []
  for (const row of rows) {
    results.push(await fetchArticle(row.id, row.url))
    await sleep(1500)
  }
  return results
}

let running = false
let subredditIndex = 0
export async function tickDiscovery() {
  if (running) return { skipped: true }
  running = true
  try {
    const picked = SUBREDDITS.slice(subredditIndex, subredditIndex + SUBREDDITS_PER_TICK)
    if (picked.length < SUBREDDITS_PER_TICK) picked.push(...SUBREDDITS.slice(0, SUBREDDITS_PER_TICK - picked.length))
    subredditIndex = (subredditIndex + SUBREDDITS_PER_TICK) % SUBREDDITS.length
    const discovered = []
    for (const sub of picked) {
      try { discovered.push(await discoverSubreddit(sub)) } catch (e) { discovered.push({ subreddit: sub, error: e.message }) }
      await sleep(1200)
    }
    const fetched = await fetchQueuedArticles()
    return { discovered, fetched }
  } finally {
    running = false
  }
}

export function startDiscovery() {
  setTimeout(() => tickDiscovery().catch(console.error), 1500)
  setInterval(() => tickDiscovery().catch(console.error), FETCH_INTERVAL_MS)
}
