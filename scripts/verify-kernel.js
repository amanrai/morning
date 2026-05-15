#!/usr/bin/env node
import { readFileSync } from 'node:fs'

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

async function kernelFetch(path, options = {}) {
  const res = await fetch(`https://api.onkernel.com${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${process.env.KERNEL_API_KEY}`,
      'content-type': 'application/json',
      ...(options.headers || {}),
    },
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Kernel ${options.method || 'GET'} ${path} failed: ${res.status} ${res.statusText}${text ? `\n${text}` : ''}`)
  }

  if (res.status === 204) return null
  return res.json()
}

loadEnv()

if (!process.env.KERNEL_API_KEY) {
  console.error('KERNEL_API_KEY is missing. Add it to .env')
  process.exit(1)
}

let browser
try {
  console.log('creating Kernel browser session')
  browser = await kernelFetch('/browsers', {
    method: 'POST',
    body: JSON.stringify({
      headless: true,
      stealth: true,
      timeout_seconds: 60,
      viewport: { width: 1280, height: 800 },
    }),
  })

  console.log(`✓ browser created: ${browser.session_id}`)
  if (browser.cdp_ws_url) console.log('✓ cdp_ws_url present')

  console.log('executing Playwright in browser')
  const result = await kernelFetch(`/browsers/${browser.session_id}/playwright/execute`, {
    method: 'POST',
    body: JSON.stringify({
      timeout_sec: 30,
      code: `
        await page.goto('https://example.com', { waitUntil: 'domcontentloaded' });
        return {
          url: page.url(),
          title: await page.title(),
          text: (await page.locator('body').innerText()).slice(0, 120)
        };
      `,
    }),
  })

  if (!result.success) throw new Error(`Playwright execution failed: ${result.error || 'unknown error'}`)

  console.log('✓ playwright execution ok')
  console.log(JSON.stringify(result.result, null, 2))
  console.log('\nKernel verification complete')
} catch (err) {
  console.error('\nKernel verification failed')
  console.error(err.message || err)
  process.exitCode = 1
} finally {
  if (browser?.session_id) {
    try {
      console.log(`deleting browser session: ${browser.session_id}`)
      await kernelFetch(`/browsers/${browser.session_id}`, { method: 'DELETE' })
      console.log('✓ browser deleted')
    } catch (err) {
      console.error(`warning: failed to delete browser ${browser.session_id}`)
      console.error(err.message || err)
      process.exitCode = process.exitCode || 1
    }
  }
}
