#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { Client } from 'pg'

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

loadEnv()

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  console.error('DATABASE_URL is missing. Put your Neon connection string in .env')
  process.exit(1)
}

const expectedTables = [
  'schema_migrations',
  'app_users',
  'sources',
  'articles',
  'article_discoveries',
  'user_article_state',
  'article_fetch_attempts',
  'worker_instances',
  'worker_releases',
  'agent_runs',
  'agent_tool_calls',
]

const client = new Client({ connectionString: databaseUrl })

try {
  await client.connect()

  const version = await client.query('SELECT version() AS version')
  console.log(`connected: ${version.rows[0].version.split(',')[0]}`)

  const tables = await client.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
    ORDER BY table_name
  `)
  const actualTables = new Set(tables.rows.map((row) => row.table_name))

  console.log('\ntables:')
  for (const table of expectedTables) {
    console.log(`  ${actualTables.has(table) ? '✓' : '✗'} ${table}`)
  }

  const missing = expectedTables.filter((table) => !actualTables.has(table))
  if (missing.length) {
    console.error(`\nmissing tables: ${missing.join(', ')}`)
    process.exitCode = 1
  }

  const migrations = await client.query('SELECT filename, applied_at FROM schema_migrations ORDER BY filename')
  console.log('\nmigrations:')
  for (const row of migrations.rows) {
    console.log(`  ✓ ${row.filename} (${row.applied_at.toISOString()})`)
  }

  const counts = await Promise.all(
    expectedTables
      .filter((table) => actualTables.has(table) && table !== 'schema_migrations')
      .map(async (table) => {
        const result = await client.query(`SELECT count(*)::int AS count FROM ${table}`)
        return [table, result.rows[0].count]
      }),
  )

  console.log('\nrow counts:')
  for (const [table, count] of counts) {
    console.log(`  ${table}: ${count}`)
  }

  const searchIndex = await client.query(`
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'articles'
      AND indexname = 'articles_search_vector_idx'
  `)
  console.log(`\nfts index: ${searchIndex.rowCount ? '✓ articles_search_vector_idx' : '✗ missing'}`)
  if (!searchIndex.rowCount) process.exitCode = 1

  const triggerCheck = await client.query(`
    SELECT trigger_name
    FROM information_schema.triggers
    WHERE event_object_schema = 'public'
    ORDER BY trigger_name
  `)
  console.log('\ntriggers:')
  for (const row of triggerCheck.rows) {
    console.log(`  ✓ ${row.trigger_name}`)
  }

  if (!process.exitCode) console.log('\nverification complete')
} finally {
  await client.end()
}
