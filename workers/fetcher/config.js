import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const USER_AGENT = process.env.USER_AGENT || 'morning-fetcher/0.1 polite personal longform reader'

const here = dirname(fileURLToPath(import.meta.url))

export function readSubredditsFile(path = join(here, 'subreddits.txt')) {
  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
}

export const MIN_WORDS = Number(process.env.MIN_WORDS ?? 100)
export const MAX_FETCH_PER_RUN = process.env.MAX_FETCH_PER_RUN ? Number(process.env.MAX_FETCH_PER_RUN) : null
export const REDDIT_FETCH_CONCURRENCY = Number(process.env.REDDIT_FETCH_CONCURRENCY ?? process.env.ARTICLE_FETCH_CONCURRENCY ?? 1)
export const REDDIT_PAGE_LIMIT = Number(process.env.REDDIT_PAGE_LIMIT ?? 100)
export const REDDIT_MAX_PAGES = Number(process.env.REDDIT_MAX_PAGES ?? 10)
export const REDDIT_SORT = process.env.REDDIT_SORT || 'top'
export const REDDIT_TIME = process.env.REDDIT_TIME || 'year'
export const REDDIT_LOOKBACK_DAYS = Number(process.env.REDDIT_LOOKBACK_DAYS ?? 365)
export const REQUEST_DELAY_MS = Number(process.env.REQUEST_DELAY_MS ?? 1500)

export function configuredSubreddits() {
  if (process.env.FETCHER_SUBREDDITS) {
    return process.env.FETCHER_SUBREDDITS
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  }

  return readSubredditsFile(process.env.FETCHER_SUBREDDITS_FILE)
}
