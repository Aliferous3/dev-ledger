import { Octokit } from '@octokit/rest'
import { getAppAuth, getAppOctokit } from './auth.mjs'

export class RateLimitError extends Error {
  constructor(retryAt) {
    super('GitHub rate limit reached')
    this.name = 'RateLimitError'
    this.retryAt = retryAt
  }
}

export class GitHubAuthError extends Error {
  constructor(message) {
    super(message || 'GitHub authorization failed')
    this.name = 'GitHubAuthError'
  }
}

// Mints an installation access token and returns an Octokit bound to it.
// Throws (404) when the installation no longer exists on GitHub.
export async function getInstallationOctokit(installationId) {
  const { token } = await getAppAuth()({ type: 'installation', installationId })
  return new Octokit({ auth: token })
}

export { getAppOctokit }

function rateLimitReset(err) {
  const h = err?.response?.headers || {}
  const remaining = h['x-ratelimit-remaining']
  const reset = h['x-ratelimit-reset']
  if (err?.status === 403 && remaining === '0' && reset) {
    return new Date(Number(reset) * 1000)
  }
  if (err?.status === 429) {
    const retryAfter = Number(h['retry-after'])
    return new Date(Date.now() + (Number.isFinite(retryAfter) ? retryAfter : 60) * 1000)
  }
  if (err?.status === 403 && /secondary rate limit/i.test(err?.message || '')) {
    const retryAfter = Number(h['retry-after'])
    return new Date(Date.now() + (Number.isFinite(retryAfter) ? retryAfter : 120) * 1000)
  }
  return null
}

// Lightweight request telemetry for the sync engine. Every GitHub call made
// through withBackoff is appended with a caller-supplied tag and latency so
// instrumentation (and tests) can measure requests-per-phase without proxying
// Octokit. Bounded so a long-running process cannot grow it forever.
export const requestLog = []
const REQUEST_LOG_MAX = 10000

export function clearRequestLog() {
  requestLog.length = 0
}

export function summarizeRequestLog() {
  const byTag = new Map()
  for (const r of requestLog) {
    const s = byTag.get(r.tag) || { count: 0, ms: 0 }
    s.count++
    s.ms += r.ms
    byTag.set(r.tag, s)
  }
  return {
    total: requestLog.length,
    totalMs: requestLog.reduce((a, r) => a + r.ms, 0),
    byTag: Object.fromEntries(byTag),
  }
}

// Runs fn with limited retries on transient failures. A primary rate-limit
// exhaustion aborts immediately with RateLimitError carrying the reset time
// so the sync engine can persist a resume point instead of blocking.
export async function withBackoff(fn, { retries = 2, tag = 'github' } = {}) {
  let attempt = 0
  const t0 = Date.now()
  try {
    for (;;) {
      try {
        return await fn()
      } catch (err) {
        const retryAt = rateLimitReset(err)
        if (retryAt) {
          if (attempt < retries && retryAt.getTime() - Date.now() < 15000) {
            await sleep(retryAt.getTime() - Date.now() + 250)
            attempt++
            continue
          }
          throw new RateLimitError(retryAt)
        }
        if (err?.status === 401) throw new GitHubAuthError(err.message)
        if (attempt < retries && (err?.status >= 500 || err?.status === 403)) {
          await sleep(500 * 2 ** attempt)
          attempt++
          continue
        }
        throw err
      }
    }
  } finally {
    requestLog.push({ tag, ms: Date.now() - t0, at: t0 })
    if (requestLog.length > REQUEST_LOG_MAX) requestLog.splice(0, requestLog.length - REQUEST_LOG_MAX)
  }
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}
