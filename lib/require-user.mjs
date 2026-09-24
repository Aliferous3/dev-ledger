import { getSession } from './auth.mjs'
import { supabase } from './db.mjs'
import { isSessionLive } from './sessions.mjs'
import { sessionDenied } from './security-events.mjs'

// Single auth gate for every API route that touches user data.
// Returns the internal user id (never client-supplied) or sends 401 and
// returns null — callers must bail out.
//
// The sealed cookie alone is no longer sufficient: the session must also
// carry a server-side sid that is still live in auth_sessions. A revoked
// (logout, DELETE MY DATA, invalidate-all) or pre-migration sid-less
// cookie fails closed here.
export async function requireUser(req, res) {
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
