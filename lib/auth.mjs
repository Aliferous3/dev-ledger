import { getIronSession } from 'iron-session'
import { createAppAuth } from '@octokit/auth-app'
import { Octokit } from '@octokit/rest'
import { cookie, github, persistentTtl, sessionLeaseMs } from './config.mjs'

// Persistent variant: drop the sentinel `maxAge: undefined` key so the ttl
// drives a real Max-Age on the emitted cookie (30 days).
function persistentOptions() {
  const { maxAge: _omit, ...cookieOptions } = cookie.cookieOptions
  return { ...cookie, ttl: persistentTtl, cookieOptions }
}

// The session's lifetime preference travels inside the sealed cookie itself
// (`persistent`/`remember` flags), so it survives the OAuth round-trip and
// cannot be forged without the session secret. Both lifetime modes use the
// same name/password/seal format — a single decode reads either. updateConfig
// only changes the attributes a later save()/destroy() emits, so the flag
// decoded from the incoming cookie picks the outgoing cookie lifetime.
// Non-persistent sessions carry `leaseUntil` (epoch ms) inside the sealed
// payload — a server-enforced sliding inactivity lease. The cookie itself
// stays browser-session scoped; the lease is what guarantees expiry after
// SESSION_LEASE_MINUTES without contact, regardless of whether the browser
// restores session cookies (e.g. Firefox Session Restore). Expired/missing
// lease on an authenticated non-persistent session → unauthenticated.
// Read paths destroy the stale cookie; write paths (login passes an explicit
// `persistent`) only clear keys, because save() after destroy() throws and
// the subsequent save() emits a fresh cookie anyway.
//
// VALIDATE ONLY — getSession never renews. The ONLY renewal is the explicit
// POST /api/auth/heartbeat from a live Dev Ledger page; letting arbitrary
// API calls slide the lease would let background polling make an idle
// session immortal.
export async function getSession(req, res, opts = {}) {
  let { persistent } = opts
  const session = await getIronSession(req, res, cookie)
  if (persistent === undefined) {
    persistent = session.persistent === true || session.remember === true
  }
  if (persistent) session.updateConfig(persistentOptions())

  if (sessionLeaseMs > 0 && session.userId && session.persistent !== true) {
    const now = Date.now()
    const until = Number(session.leaseUntil)
    if (!Number.isFinite(until) || until <= now) {
      if (opts.persistent === undefined) {
        session.destroy()
      } else {
        for (const k of Object.keys(session)) delete session[k]
      }
      return session
    }
  }
  return session
}

let appAuth = null
export function getAppAuth() {
  if (!github.appId || !github.privateKey) {
    throw new Error('GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY must be configured')
  }
  if (!appAuth) {
    appAuth = createAppAuth({ appId: github.appId, privateKey: github.privateKey })
  }
  return appAuth
}

// Octokit authenticated as the app itself (JWT). Throws 401/404 when the app
// credentials are wrong or an installation no longer exists.
export async function getAppOctokit() {
  const { token } = await getAppAuth()({ type: 'app' })
  return new Octokit({ auth: token })
}

export function getUserOctokit(accessToken) {
  return new Octokit({ auth: accessToken })
}
