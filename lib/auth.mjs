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
// cannot be forged without the session secret. When the caller doesn't
// specify, we decode once to read the flag — getIronSession only writes
// Set-Cookie on save()/destroy(), so the peek is side-effect free.
export async function getSession(req, res, opts = {}) {
  let { persistent } = opts
  if (persistent === undefined) {
    const peek = await getIronSession(req, res, cookie)
    persistent = peek.persistent === true || peek.remember === true
  }
  return getIronSession(req, res, persistent ? persistentOptions() : cookie)
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
