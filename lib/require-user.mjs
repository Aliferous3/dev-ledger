import { getSession } from './auth.mjs'
import { supabase } from './db.mjs'
import { isSessionLive } from './sessions.mjs'
import { authenticateBearer } from './desktop-auth.mjs'
import { sessionDenied } from './security-events.mjs'

// Single auth gate for every API route that touches user data.
// Returns the internal user id (never client-supplied) or sends 401 and
// returns null — callers must bail out.
//
// Two credential forms, both resolving to a server-side live session:
//   1. Authorization: Bearer — the desktop app's opaque token, bound to a
//      dedicated auth_sessions row. Checked first; it carries no ambient
//      semantics so it cannot be CSRF'd.
//   2. The sealed session cookie — which alone is no longer sufficient:
//      the session must also carry a server-side sid that is still live
//      in auth_sessions. A revoked (logout, DELETE MY DATA, invalidate-all)
//      or pre-migration sid-less cookie fails closed here.
export async function requireUser(req, res) {
  const bearer = await authenticateBearer(req)
  if (bearer) return bearer.userId
  const session = await getSession(req, res)
  if (!session?.userId || !supabase) {
    res.status(401).json({ error: 'Unauthenticated or database unavailable' })
    return null
  }
  if (!(await isSessionLive(session.sid))) {
    // Seal valid + lease alive + dead server-side record — anomalous.
    // (An absent/expired cookie above is routine and stays unlogged.)
    sessionDenied(req, session)
    res.status(401).json({ error: 'Session revoked or expired' })
    return null
  }
  return session.userId
}
