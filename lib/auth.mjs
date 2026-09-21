import { getIronSession } from 'iron-session'
import { createAppAuth } from '@octokit/auth-app'
import { Octokit } from '@octokit/rest'
import { cookie, github, persistentTtl } from './config.mjs'

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
export async function getSession(req, res, opts = {}) {
  let { persistent } = opts
  const session = await getIronSession(req, res, cookie)
  if (persistent === undefined) {
    persistent = session.persistent === true || session.remember === true
  }
  if (persistent) session.updateConfig(persistentOptions())
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
