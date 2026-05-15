import { JSDOM, VirtualConsole } from 'jsdom'
import { Readability } from '@mozilla/readability'
import { MIN_WORDS, USER_AGENT } from './config.js'
import { contentKeyForHash, sha256 } from './url.js'

function wordCount(text = '') {
  return (text.trim().match(/\S+/g) ?? []).length
}

function readingMinutes(words) {
  return Math.max(1, Math.round(words / 230))
}

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

function createDom(html, url) {
  const virtualConsole = new VirtualConsole()
  virtualConsole.on('jsdomError', (error) => {
    if (String(error?.message || '').includes('Could not parse CSS stylesheet')) return
    console.warn(error?.message || error)
  })
  return new JSDOM(html, { url, virtualConsole })
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: {
      'user-agent': USER_AGENT,
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  })

  if (!res.ok) {
    const err = new Error(`${res.status} ${res.statusText}`)
    err.httpStatus = res.status
    throw err
  }

  const contentType = res.headers.get('content-type') || ''
  if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
    throw new Error(`not html: ${contentType}`)
  }

  return { html: await res.text(), finalUrl: res.url, httpStatus: res.status }
}

export function parseArticleHtml({ html, finalUrl, httpStatus = 200 }) {
  const dom = createDom(html, finalUrl)
  const publishedAt = getPublishedAt(dom.window.document)
  const parsed = new Readability(dom.window.document, { keepClasses: false }).parse()

  if (!parsed?.textContent || !parsed?.content) throw new Error('readability found no article text')

  const words = wordCount(parsed.textContent)
  if (words < MIN_WORDS) throw new Error(`too short: ${words} words`)

  const contentHash = sha256(parsed.content)

  return {
    canonicalUrl: finalUrl,
    title: parsed.title || finalUrl,
    byline: parsed.byline || null,
    excerpt: parsed.excerpt || null,
    siteName: parsed.siteName || new URL(finalUrl).hostname.replace(/^www\./, ''),
    publishedAt,
    contentHtml: parsed.content,
    contentHash,
    contentKey: contentKeyForHash(contentHash),
    contentBytes: Buffer.byteLength(parsed.content, 'utf8'),
    searchableText: parsed.textContent,
    wordCount: words,
    readingMinutes: readingMinutes(words),
    httpStatus,
  }
}

export async function extractArticle(url) {
  const { html, finalUrl, httpStatus } = await fetchHtml(url)
  return parseArticleHtml({ html, finalUrl, httpStatus })
}
