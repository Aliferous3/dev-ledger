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
  session.oauthState = state
  // Carried inside the sealed session so the preference survives the GitHub
  // OAuth round-trip without weakening state validation.
  session.remember = remember
  session.persistent = remember
  // Desktop handoff: the app generated a flow id and opened this URL in the
  // system browser. Sealed inside the session so the callback knows to
  // return the session through a dev-ledger:// deep link instead of '/'.
  // Anything that is not a well-formed UUID is ignored — the web flow is
  // unchanged when the parameter is absent or malformed.
  // The flow is honored only as a complete pair: the UUID binds the
  // handoff to this app instance's login intent, and the challenge (sha256
  // of a verifier held only in app memory) makes an intercepted
  // dev-ledger:// URL unexchangeable — PKCE discipline for custom schemes.
  if (isDesktopFlowId(query.desktop_flow) && isDesktopChallenge(query.desktop_challenge)) {
    session.desktopFlow = query.desktop_flow.toLowerCase()
    session.desktopChallenge = query.desktop_challenge.toLowerCase()
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
