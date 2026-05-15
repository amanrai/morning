import { parseArticleHtml } from './extract.js'

let activeKernelSessions = 0
const kernelWaiters = []

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function kernelConcurrency() {
  const n = Number(process.env.KERNEL_CONCURRENCY ?? 3)
  return Number.isFinite(n) && n > 0 ? n : 3
}

async function acquireKernelSlot() {
  while (activeKernelSessions >= kernelConcurrency()) {
    await new Promise((resolve) => kernelWaiters.push(resolve))
  }
  activeKernelSessions += 1
}

function releaseKernelSlot() {
  activeKernelSessions = Math.max(0, activeKernelSessions - 1)
  const next = kernelWaiters.shift()
  if (next) next()
}

function required(name) {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is missing`)
  return value
}

async function kernelFetch(path, options = {}) {
  const res = await fetch(`https://api.onkernel.com${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${required('KERNEL_API_KEY')}`,
      'content-type': 'application/json',
      ...(options.headers || {}),
    },
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    const err = new Error(`Kernel ${options.method || 'GET'} ${path} failed: ${res.status} ${res.statusText}${text ? ` ${text}` : ''}`)
    err.httpStatus = res.status
    throw err
  }

  if (res.status === 204) return null
  return res.json()
}

async function createBrowser(startUrl) {
  const maxAttempts = Number(process.env.KERNEL_CREATE_RETRIES ?? 6)
  let delayMs = Number(process.env.KERNEL_RETRY_DELAY_MS ?? 15000)

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await kernelFetch('/browsers', {
        method: 'POST',
        body: JSON.stringify({
          headless: true,
          stealth: true,
          timeout_seconds: 120,
          start_url: startUrl,
          viewport: { width: 1280, height: 900 },
        }),
      })
    } catch (err) {
      if (err.httpStatus !== 429 || attempt === maxAttempts) throw err
      console.warn(`Kernel rate limited creating browser; retrying in ${Math.round(delayMs / 1000)}s (${attempt}/${maxAttempts})`)
      await sleep(delayMs)
      delayMs = Math.min(delayMs * 1.5, 60000)
    }
  }
}

async function deleteBrowser(sessionId) {
  return kernelFetch(`/browsers/${sessionId}`, { method: 'DELETE' })
}

async function executePlaywright(sessionId, code, timeoutSec = 60) {
  const result = await kernelFetch(`/browsers/${sessionId}/playwright/execute`, {
    method: 'POST',
    body: JSON.stringify({ code, timeout_sec: timeoutSec }),
  })

  if (!result.success) throw new Error(`Kernel Playwright failed: ${result.error || 'unknown error'}`)
  return result.result
}

export function shouldUseKernelFallback(err) {
  const message = String(err?.message || err || '').toLowerCase()
  return (
    err?.httpStatus === 401 ||
    err?.httpStatus === 403 ||
    err?.httpStatus === 429 ||
    message.includes('403 forbidden') ||
    message.includes('401 unauthorized') ||
    message.includes('429') ||
    message.includes('too short') ||
    message.includes('readability found no article text') ||
    message.includes('not html') ||
    message.includes('access denied') ||
    message.includes('enable javascript') ||
    message.includes('just a moment')
  )
}

export async function extractArticleWithKernel(url) {
  let browser
  await acquireKernelSlot()
  try {
    browser = await createBrowser(url)
    const rendered = await executePlaywright(browser.session_id, `
      await page.goto(${JSON.stringify(url)}, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(2500);
      await page.evaluate(() => window.scrollTo(0, Math.min(document.body.scrollHeight, 2400)));
      await page.waitForTimeout(1000);
      return {
        url: page.url(),
        title: await page.title(),
        html: await page.content(),
        text: (await page.locator('body').innerText().catch(() => '')).slice(0, 2000)
      };
    `, 60)

    const extracted = parseArticleHtml({ html: rendered.html, finalUrl: rendered.url, httpStatus: 200 })
    return { ...extracted, extractionMethod: 'kernel' }
  } finally {
    if (browser?.session_id) {
      await deleteBrowser(browser.session_id).catch((err) => {
        console.error(`warning: failed to delete Kernel browser ${browser.session_id}: ${err.message}`)
      })
    }
    releaseKernelSlot()
  }
}
