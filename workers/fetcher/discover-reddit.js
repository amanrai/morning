#!/usr/bin/env node
import { loadEnv } from './env.js'
import { configuredSubreddits, REQUEST_DELAY_MS } from './config.js'
import { createDb, recordDiscovery, upsertDiscoveredArticle, upsertSource } from './db.js'
import { discoverSubreddit } from './reddit.js'

loadEnv()

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function runRedditDiscovery(client) {
  const subreddits = configuredSubreddits()
  const summary = []

  for (const subreddit of subreddits) {
    const sourceId = await upsertSource(client, {
      kind: 'reddit',
      name: subreddit,
      url: `https://www.reddit.com/r/${subreddit}`,
    })

    try {
      const items = await discoverSubreddit(subreddit)
      let imported = 0

      for (const item of items) {
        const articleId = await upsertDiscoveredArticle(client, item)
        await recordDiscovery(client, {
          articleId,
          sourceId,
          sourceKind: item.sourceKind,
          sourceName: item.sourceName,
          externalId: item.externalId,
          externalUrl: item.externalUrl,
          score: item.score,
          commentsCount: item.commentsCount,
          payload: item.payload,
        })
        imported++
      }

      summary.push({ subreddit, found: items.length, imported })
      console.log(`reddit:${subreddit} found=${items.length} imported=${imported}`)
    } catch (err) {
      summary.push({ subreddit, error: err.message })
      console.error(`reddit:${subreddit} failed: ${err.message}`)
    }

    await sleep(REQUEST_DELAY_MS)
  }

  return summary
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const client = createDb()
  try {
    await client.connect()
    await runRedditDiscovery(client)
  } finally {
    await client.end()
  }
}
