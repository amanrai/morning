import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3'

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

async function bodyToString(body) {
  if (!body) return ''
  if (typeof body.transformToString === 'function') return body.transformToString()
  const chunks = []
  for await (const chunk of body) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8')
}

export async function getObjectText(key) {
  if (!key) return null
  const r2 = createR2Client()
  const result = await r2.send(new GetObjectCommand({ Bucket: required('R2_BUCKET'), Key: key }))
  return bodyToString(result.Body)
}
