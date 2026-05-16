#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { Client } from 'pg'

const CONCURRENCY = Number(process.env.FAVICON_FETCH_CONCURRENCY ?? 5)
const TIMEOUT_MS = Number(process.env.FAVICON_FETCH_TIMEOUT_MS ?? 5000)

function loadEnv(path = '.env') {
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

function fallbackFavicon(hostname) {
  return `https://${hostname}/favicon.ico`
}

function absUrl(href, base) {
  try { return new URL(href, base).toString() } catch { return null }
}

function findFavicon(html, baseUrl) {
  const links = [...html.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0])
  const candidates = []

  for (const tag of links) {
    const rel = attr(tag, 'rel')?.toLowerCase() || ''
    if (!rel.includes('icon')) continue
    const href = attr(tag, 'href')
    if (!href || href.startsWith('data:')) continue
    const sizes = attr(tag, 'sizes') || ''
    const score = (rel.includes('apple-touch-icon') ? 30 : 0) + (rel === 'icon' ? 20 : 0) + sizeScore(sizes)
    candidates.push({ url: absUrl(href, baseUrl), score })
  }

  return candidates
    .filter((candidate) => candidate.url)
    .sort((a, b) => b.score - a.score)[0]?.url || null
}

function attr(tag, name) {
  const re = new RegExp(`${name}\\s*=\\s*(["'])(.*?)\\1`, 'i')
  return tag.match(re)?.[2] || null
}

function sizeScore(sizes) {
  const nums = [...sizes.matchAll(/(\d+)x(\d+)/g)].map((m) => Number(m[1]) * Number(m[2]))
  return nums.length ? Math.max(...nums) / 1000 : 0
}

async function fetchFavicon(hostname) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const homepage = `https://${hostname}/`
    const res = await fetch(homepage, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent': 'morning-fetcher/0.1 favicon backfill',
        accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
      },
    })
    if (!res.ok) return fallbackFavicon(hostname)
    const contentType = res.headers.get('content-type') || ''
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) return fallbackFavicon(hostname)
    const html = await res.text()
    return findFavicon(html, res.url) || fallbackFavicon(hostname)
  } catch {
    return fallbackFavicon(hostname)
  } finally {
    clearTimeout(timeout)
  }
}

async function runPool(items, concurrency, worker) {
  let next = 0
  async function loop() {
    while (next < items.length) {
      const index = next++
      await worker(items[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, loop))
}

loadEnv()

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is missing')
  process.exit(1)
}

const client = new Client({ connectionString: process.env.DATABASE_URL })

try {
  await client.connect()

  console.log('backfill sites: upserting site rows from articles')
  await client.query(`
    INSERT INTO sites (hostname, display_name, favicon_url, first_seen_at, last_seen_at)
    SELECT
      hostname,
      max(NULLIF(site_name, '')) AS display_name,
      'https://' || hostname || '/favicon.ico' AS favicon_url,
      min(discovered_at) AS first_seen_at,
      max(COALESCE(last_fetched_at, discovered_at)) AS last_seen_at
    FROM (
      SELECT
        regexp_replace(COALESCE(canonical_url, original_url, normalized_url), '^https?://(www\\.)?([^/]+).*$','\\2') AS hostname,
        site_name,
        discovered_at,
        last_fetched_at
      FROM articles
      WHERE COALESCE(canonical_url, original_url, normalized_url) ~ '^https?://'
    ) article_hosts
    WHERE hostname IS NOT NULL AND hostname <> ''
    GROUP BY hostname
    ON CONFLICT (hostname) DO UPDATE SET
      display_name = COALESCE(NULLIF(sites.display_name, ''), EXCLUDED.display_name),
      favicon_url = COALESCE(NULLIF(sites.favicon_url, ''), EXCLUDED.favicon_url),
      first_seen_at = LEAST(sites.first_seen_at, EXCLUDED.first_seen_at),
      last_seen_at = GREATEST(sites.last_seen_at, EXCLUDED.last_seen_at),
      updated_at = now()
  `)

  console.log('backfill sites: setting articles.site_hostname')
  const updated = await client.query(`
    UPDATE articles
    SET site_hostname = regexp_replace(COALESCE(canonical_url, original_url, normalized_url), '^https?://(www\\.)?([^/]+).*$','\\2'),
        updated_at = now()
    WHERE COALESCE(canonical_url, original_url, normalized_url) ~ '^https?://'
      AND (site_hostname IS NULL OR site_hostname = '')
  `)
  console.log(`backfill sites: updated_articles=${updated.rowCount}`)

  const sites = (await client.query(
    `SELECT hostname FROM sites ORDER BY last_seen_at DESC NULLS LAST, hostname ASC`,
  )).rows
  console.log(`backfill favicons: sites=${sites.length} concurrency=${CONCURRENCY}`)

  let done = 0
  const faviconResults = []
  await runPool(sites, CONCURRENCY, async (site) => {
    const faviconUrl = await fetchFavicon(site.hostname)
    faviconResults.push({ hostname: site.hostname, faviconUrl })
    done++
    if (done === 1 || done % 25 === 0 || done === sites.length) {
      console.log(`backfill favicons: fetched=${done}/${sites.length}`)
    }
  })

  console.log('backfill favicons: writing results')
  for (const result of faviconResults) {
    await client.query(
      `UPDATE sites SET favicon_url = $2, updated_at = now() WHERE hostname = $1`,
      [result.hostname, result.faviconUrl],
    )
  }

  const siteRows = (await client.query(
    `SELECT count(*)::int AS sites,
            count(*) FILTER (WHERE favicon_url IS NOT NULL)::int AS with_favicon
     FROM sites`,
  )).rows[0]

  console.log(`backfill sites complete: sites=${siteRows.sites} with_favicon=${siteRows.with_favicon}`)
} finally {
  await client.end()
}
