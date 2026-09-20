import { getSession } from '../../lib/auth.mjs'
import { github, appUrl } from '../../lib/config.mjs'

export default async function handler(req, res) {
  const session = await getSession(req, res)
  const state = Buffer.from(JSON.stringify({ at: Date.now() })).toString('base64url')
  session.oauthState = state
  await session.save()
  const redirectUri = `${appUrl}/api/auth/callback`
  const url = new URL('https://github.com/login/oauth/authorize')
  url.searchParams.set('client_id', github.clientId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('state', state)
  url.searchParams.set('prompt', 'select_account')
  res.writeHead(302, { Location: url.toString() })
  res.end()
}
