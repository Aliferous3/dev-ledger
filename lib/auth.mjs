import { getIronSession } from 'iron-session'
import { App } from '@octokit/auth-app'
import { Octokit } from '@octokit/rest'
import { cookie, github } from './config.mjs'

export async function getSession(req, res) {
  return getIronSession(req, res, cookie)
}

export function getAppAuth() {
  if (!github.appId || !github.privateKey) {
    throw new Error('GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY must be configured')
  }
  return new App({ appId: github.appId, privateKey: github.privateKey })
}

export async function getInstallationToken(installationId) {
  const auth = getAppAuth()
  const { data: tokenData } = await auth.octokit.apps.createInstallationAccessToken({ installation_id: installationId })
  return tokenData.token
}

export function getUserOctokit(accessToken) {
  return new Octokit({ auth: accessToken })
}

export function getInstallationOctokit(installationToken) {
  return new Octokit({ auth: installationToken })
}
