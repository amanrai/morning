import { createHash } from 'node:crypto'

const badHosts = new Set([
  'youtube.com', 'www.youtube.com', 'youtu.be', 'vimeo.com', 'twitter.com', 'x.com',
  'instagram.com', 'www.instagram.com', 'reddit.com', 'www.reddit.com', 'old.reddit.com',
])

export function normalizeUrl(raw) {
  try {
    const u = new URL(raw)
    if (!['http:', 'https:'].includes(u.protocol)) return null
    const host = u.hostname.replace(/^www\./, '')
    if (badHosts.has(u.hostname) || badHosts.has(host)) return null
    for (const key of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|mc_|ref$|ref_src$)/i.test(key)) u.searchParams.delete(key)
    }
    u.hostname = u.hostname.toLowerCase()
    u.hash = ''
    return u.toString()
  } catch {
    return null
  }
}

export function sha256(input) {
  return createHash('sha256').update(input).digest('hex')
}

export function contentKeyForHash(hash) {
  return `articles/${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash}.html`
}
