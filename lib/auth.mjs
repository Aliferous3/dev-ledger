import { getIronSession } from 'iron-session'
import { createAppAuth } from '@octokit/auth-app'
import { Octokit } from '@octokit/rest'
import { cookie, github } from './config.mjs'

export async function getSession(req, res) {
  return getIronSession(req, res, cookie)
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
