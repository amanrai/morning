#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'

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

async function bodyToString(body) {
  if (!body) return ''
  if (typeof body.transformToString === 'function') return body.transformToString()
  const chunks = []
  for await (const chunk of body) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8')
}

loadEnv()

const required = ['R2_ENDPOINT', 'R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY']
const missing = required.filter((key) => !process.env[key])
if (missing.length) {
  console.error(`Missing env vars: ${missing.join(', ')}`)
  process.exit(1)
}

const client = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
})

const bucket = process.env.R2_BUCKET
const key = `healthcheck/${Date.now()}-${Math.random().toString(16).slice(2)}.txt`
const content = `morning r2 healthcheck ${new Date().toISOString()}\n`

try {
  console.log(`checking bucket: ${bucket}`)
  await client.send(new HeadBucketCommand({ Bucket: bucket }))
  console.log('✓ bucket reachable')

  console.log(`writing object: ${key}`)
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: content,
    ContentType: 'text/plain; charset=utf-8',
  }))
  console.log('✓ write ok')

  console.log('reading object')
  const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
  const readBack = await bodyToString(result.Body)
  if (readBack !== content) throw new Error('read-back content mismatch')
  console.log('✓ read ok')

  console.log('deleting object')
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
  console.log('✓ delete ok')

  console.log('\nR2 verification complete')
} catch (err) {
  console.error('\nR2 verification failed')
  console.error(err)
  process.exit(1)
}
