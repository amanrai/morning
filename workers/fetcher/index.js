#!/usr/bin/env node
import { loadEnv } from './env.js'
import { createDb } from './db.js'
import { runRedditDiscovery } from './discover-reddit.js'
import { runQueuedExtraction } from './extract-queued.js'

loadEnv()

const client = createDb()

try {
  await client.connect()
  await runRedditDiscovery(client)
  await runQueuedExtraction(client)
} finally {
  await client.end()
}
