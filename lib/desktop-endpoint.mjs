import { waitUntil } from '@vercel/functions'
import { supabase } from './db.mjs'
import { createAuthSession, isSessionLive } from './sessions.mjs'
import {
  authenticateBearer,
  consumeDesktopCode,
  gcDesktopAuth,
  issueDesktopToken,
  isDesktopFlowId,
  revokeDesktopToken,
} from './desktop-auth.mjs'
import { requestQuery } from './request-query.mjs'
import { securityEvent } from './security-events.mjs'

// Desktop auth endpoint — served through /api/user?action=desktop behind the
// /api/auth/desktop → /api/user rewrite (the /api/feedback precedent), so the
// Hobby serverless-function cap stays untouched.
//
//   POST ?op=exchange {flow, code, verifier}
//       Consumes the single-use handoff code the OAuth callback delivered
//       through the dev-ledger:// deep link, creates a dedicated
//       server-side session for the desktop client, and returns an opaque
//       bearer token (plaintext exactly once — stored hashed).
//       This path still sits behind the same-origin mutation guard on
//       /api/user — the desktop transport always sends the hosted Origin,
//       and a forged request can at most burn ITS OWN one-time code.
//
//   POST ?op=logout   (Authorization: Bearer <token>)
//       Revokes the token AND its bound server-side session — the desktop
//       mirror of /api/auth/logout.
//
// Anything else → 400. No GET variants exist: codes and tokens never
// travel in URLs or browser history.
export async function handleDesktopEndpoint(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  const { op } = requestQuery(req)

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  if (!supabase) {
    res.status(503).json({ error: 'Database unavailable' })
    return
  }

  if (op === 'exchange') {
    let body = req.body
    if (typeof body === 'string') {
      try { body = JSON.parse(body) } catch { body = null }
    }
    const flow = typeof body?.flow === 'string' ? body.flow : ''
    const code = typeof body?.code === 'string' ? body.code : ''
    const verifier = typeof body?.verifier === 'string' ? body.verifier : ''
    if (!isDesktopFlowId(flow) || !code.startsWith('dlc_') || !verifier) {
      securityEvent('desktop_exchange_failed', { req, reasonCode: 'bad_shape' })
      res.status(400).json({ error: 'flow and code are required' })
      return
    }

    const consumed = await consumeDesktopCode(code, flow, verifier)
    if (!consumed) {
      securityEvent('desktop_exchange_failed', { req, reasonCode: 'code_rejected' })
      res.status(400).json({ error: 'Code expired or already used' })
      return
    }
    // The handoff code was minted next to a live session; if that session
    // has since been revoked, the exchange must fail with it.
    if (!(await isSessionLive(consumed.sessionSid))) {
      securityEvent('desktop_exchange_failed', { req, reasonCode: 'session_dead' })
      res.status(400).json({ error: 'Session expired' })
      return
    }

    // Dedicated desktop session — independent of the browser session that
    // produced the handoff, so a web sign-out cannot surprise-kill the
    // app, while account deletion/kill-all still revokes both.
    const sid = await createAuthSession(consumed.userId, { persistent: true })
    const token = sid ? await issueDesktopToken(consumed.userId, sid) : null
    if (!token) {
      securityEvent('desktop_exchange_failed', { req, reasonCode: 'issue_failed' })
      res.status(500).json({ error: 'Token could not be issued' })
      return
    }

    const { data: user } = await supabase
      .from('users')
      .select('github_login, avatar_url, display_name')
      .eq('id', consumed.userId)
      .maybeSingle()

    waitUntil(gcDesktopAuth().catch(() => {}))
    securityEvent('desktop_exchange_completed', { req, actorId: consumed.userId })
    res.status(200).json({
      token,
      user: user
        ? {
            githubLogin: user.github_login,
            avatarUrl: user.avatar_url,
            displayName: user.display_name,
          }
        : null,
    })
    return
  }

  if (op === 'logout') {
    const bearer = await authenticateBearer(req)
    if (!bearer) {
      res.status(401).json({ error: 'Unauthenticated' })
      return
    }
    await revokeDesktopToken(bearer.tokenHash, bearer.sid)
    securityEvent('desktop_logout_completed', { req, actorId: bearer.userId })
    res.status(200).json({ ok: true })
    return
  }

  res.status(400).json({ error: 'Unknown action' })
}
