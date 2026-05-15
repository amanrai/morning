import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'

let client

function required(name) {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is missing`)
  return value
}

export function createR2Client() {
  if (client) return client

  client = new S3Client({
    region: 'auto',
    endpoint: required('R2_ENDPOINT'),
    credentials: {
      accessKeyId: required('R2_ACCESS_KEY_ID'),
      secretAccessKey: required('R2_SECRET_ACCESS_KEY'),
    },
  })

  return client
}

export async function putArticleHtml({ key, html }) {
  const r2 = createR2Client()
  const bucket = required('R2_BUCKET')

  await r2.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: html,
    ContentType: 'text/html; charset=utf-8',
    CacheControl: 'private, max-age=31536000, immutable',
  }))

  return { bucket, key }
}
