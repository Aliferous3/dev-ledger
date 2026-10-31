import crypto from 'node:crypto'
import { getSession } from '../../lib/auth.mjs'
import { github, appUrl } from '../../lib/config.mjs'
import { isDesktopFlowId, isDesktopChallenge } from '../../lib/desktop-auth.mjs'
import { requestQuery } from '../../lib/request-query.mjs'

export default async function handler(req, res) {
  // Opt-in persistence: ?remember=1 → 30-day cookie, otherwise a true
  // browser-session cookie (no Max-Age/Expires).
  const query = requestQuery(req)
  const remember = query.remember === '1' || query.remember === 'true'
  const session = await getSession(req, res, { persistent: remember })
  // Random state bound to the sealed session + a 15-minute freshness bound
  // enforced at the callback.
  const state = Buffer.from(
    JSON.stringify({ at: Date.now(), r: crypto.randomBytes(16).toString('base64url') }),
  ).toString('base64url')
  // One browser cookie can service both a normal website login and a
  // desktop-initiated OAuth login. Track a small, bounded set of attempts
  // rather than overwriting the ONLY valid state when another login begins.
  // Each state binds its own remember choice and desktop PKCE handoff; a
  // web login must never inherit a previous desktop_flow from the cookie.
  // GitHub's 15-minute code flow is the upper bound for retained attempts.
  const now = Date.now()
  const previous = Array.isArray(session.oauthAttempts) ? session.oauthAttempts : []
  session.oauthAttempts = previous
    .filter((entry) => entry && typeof entry.state === 'string'
      && Number.isFinite(entry.at) && now - entry.at >= 0
      && now - entry.at < 15 * 60 * 1000)
    .slice(-3)
  const desktop = isDesktopFlowId(query.desktop_flow) && isDesktopChallenge(query.desktop_challenge)
  const desktopFlow = desktop ? query.desktop_flow.toLowerCase() : null
  const desktopChallenge = desktop ? query.desktop_challenge.toLowerCase() : null
  session.oauthAttempts.push({
    state, at: now, remember, desktopFlow, desktopChallenge,
  })
  // Keep the last state's legacy fields for callbacks created before the
  // deployment and for the GitHub App first-install setup hop.
  session.oauthState = state
  session.remember = remember
  session.persistent = remember
  delete session.desktopFlow
  delete session.desktopChallenge
  if (desktop) {
    session.desktopFlow = desktopFlow
    session.desktopChallenge = desktopChallenge
  }
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
