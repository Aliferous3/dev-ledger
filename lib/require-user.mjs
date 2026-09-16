import { getSession } from './auth.mjs'
import { supabase } from './db.mjs'

// Single auth gate for every API route that touches user data.
// Returns the internal user id (never client-supplied) or sends 401 and
// returns null — callers must bail out.
export async function requireUser(req, res) {
  const session = await getSession(req, res)
  if (!session?.userId || !supabase) {
    res.status(401).json({ error: 'Unauthenticated or database unavailable' })
    return null
  }
  return session.userId
}
