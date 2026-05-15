import { REDDIT_LOOKBACK_DAYS, REDDIT_MAX_PAGES, REDDIT_PAGE_LIMIT, REDDIT_SORT, REDDIT_TIME, REQUEST_DELAY_MS, USER_AGENT } from './config.js'
import { normalizeUrl, sha256 } from './url.js'

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function getJson(url) {
  const res = await fetch(url, {
    headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`reddit ${res.status} ${res.statusText}`)
  return res.json()
}

export async function discoverSubreddit(subreddit) {
  const items = []
  let after = undefined
  const cutoffMs = Date.now() - REDDIT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000

  for (let page = 0; page < REDDIT_MAX_PAGES; page++) {
    const params = new URLSearchParams({ limit: String(REDDIT_PAGE_LIMIT) })
    if (REDDIT_SORT === 'top' || REDDIT_SORT === 'controversial') params.set('t', REDDIT_TIME)
    if (after) params.set('after', after)

    const json = await getJson(`https://www.reddit.com/r/${subreddit}/${REDDIT_SORT}.json?${params}`)
    const posts = json?.data?.children ?? []
    after = json?.data?.after
    if (!posts.length) break

    let reachedCutoff = false

    for (const child of posts) {
    const post = child.data
    if (!post || post.is_self || post.over_18) continue

    if (post.created_utc && post.created_utc * 1000 < cutoffMs) {
      reachedCutoff = true
      continue
    }

    const normalizedUrl = normalizeUrl(post.url)
    if (!normalizedUrl) continue

    items.push({
      originalUrl: post.url,
      canonicalUrl: normalizedUrl,
      normalizedUrl,
      normalizedUrlHash: sha256(normalizedUrl),
      title: post.title || normalizedUrl,
      excerpt: post.selftext?.slice(0, 500) || null,
      siteName: (() => {
        try { return new URL(normalizedUrl).hostname.replace(/^www\./, '') } catch { return null }
      })(),
      sourceKind: 'reddit',
      sourceName: subreddit,
      externalId: post.id,
      externalUrl: `https://www.reddit.com${post.permalink}`,
      score: post.score ?? null,
      commentsCount: post.num_comments ?? null,
      payload: {
        subreddit,
        reddit_id: post.id,
        permalink: post.permalink,
        author: post.author,
        created_utc: post.created_utc,
      },
    })
    }

    if (!after || reachedCutoff) break
    await sleep(REQUEST_DELAY_MS)
  }

  return items
}
