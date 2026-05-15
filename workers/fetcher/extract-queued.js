#!/usr/bin/env node
import { loadEnv } from './env.js'
import { MAX_FETCH_PER_RUN, REDDIT_FETCH_CONCURRENCY, REQUEST_DELAY_MS } from './config.js'
import { createDb, getQueuedArticles, markArticleFailed, markArticleReady, markFetching, recordFetchAttempt } from './db.js'
import { extractArticle } from './extract.js'
import { extractArticleWithKernel, shouldUseKernelFallback } from './kernel.js'
import { putArticleHtml } from './r2.js'

loadEnv()

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function runPool(items, concurrency, worker) {
  const results = []
  let next = 0

  async function loop(workerIndex) {
    if (workerIndex > 0 && REQUEST_DELAY_MS > 0) await sleep(workerIndex * REQUEST_DELAY_MS)

    while (next < items.length) {
      const index = next++
      if (index > 0 && REQUEST_DELAY_MS > 0) await sleep(REQUEST_DELAY_MS)
      results[index] = await worker(items[index], index)
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, (_, index) => loop(index))
  await Promise.all(workers)
  return results
}

async function extractOne(row) {
  const client = createDb()
  const startedAt = new Date()

  try {
    await client.connect()
    await markFetching(client, row.id)

    try {
      let extracted
      let method = 'fetch'

      try {
        extracted = await extractArticle(row.original_url)
      } catch (err) {
        if (!process.env.KERNEL_API_KEY || !shouldUseKernelFallback(err)) throw err
        console.warn(`origin fetch failed ${row.id}: ${err.message}; trying Kernel browser fallback`)
        extracted = await extractArticleWithKernel(row.original_url)
        method = 'playwright'
      }

      await putArticleHtml({ key: extracted.contentKey, html: extracted.contentHtml })
      await markArticleReady(client, row.id, extracted)
      await recordFetchAttempt(client, {
        articleId: row.id,
        url: row.original_url,
        method,
        status: 'ready',
        httpStatus: extracted.httpStatus,
        startedAt,
      })
      console.log(`ready ${row.id} method=${method} words=${extracted.wordCount} r2=${extracted.contentKey} ${extracted.title}`)
      return { id: row.id, status: 'ready', method, words: extracted.wordCount, contentKey: extracted.contentKey }
    } catch (err) {
      await markArticleFailed(client, row.id, err)
      await recordFetchAttempt(client, {
        articleId: row.id,
        url: row.original_url,
        method: 'fetch',
        status: 'failed',
        httpStatus: err.httpStatus ?? null,
        error: err.message,
        startedAt,
      })
      console.error(`failed ${row.id}: ${err.message}`)
      return { id: row.id, status: 'failed', error: err.message }
    }
  } finally {
    await client.end().catch(() => {})
  }
}

export async function runQueuedExtraction(client, options = {}) {
  const limit = options.limit ?? MAX_FETCH_PER_RUN
  const concurrency = options.concurrency ?? REDDIT_FETCH_CONCURRENCY
  const queued = await getQueuedArticles(client, limit)

  console.log(`extract queued=${queued.length} concurrency=${concurrency}`)
  return runPool(queued, concurrency, extractOne)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const client = createDb()
  try {
    await client.connect()
    await runQueuedExtraction(client)
  } finally {
    await client.end()
  }
}
