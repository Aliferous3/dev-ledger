import { getSession } from '../../lib/auth.mjs'
import { github } from '../../lib/config.mjs'

export default async function handler(req, res) {
  const session = await getSession(req, res)
  const state = Buffer.from(JSON.stringify({ at: Date.now() })).toString('base64url')
  session.oauthState = state
  await session.save()
  const redirectUri = `${process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000'}/api/auth/callback`
  const url = new URL('https://github.com/login/oauth/authorize')
  url.searchParams.set('client_id', github.clientId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('state', state)
  res.writeHead(302, { Location: url.toString() })
  res.end()
}
