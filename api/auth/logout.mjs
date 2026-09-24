import { getSession } from '../../lib/auth.mjs'
import { revokeSession } from '../../lib/sessions.mjs'
import { supabase } from '../../lib/db.mjs'
import { forbidCrossSite } from '../../lib/same-origin.mjs'
import { securityEvent } from '../../lib/security-events.mjs'

// POST /api/auth/logout — session destruction is a state change, so it is
// POST-only and same-origin-guarded. The old GET+302 navigation form let
// any cross-site page log a user out (or worse, be embedded as an image
// and fire without interaction); a top-level GET cannot carry an Origin
// we can trust, so it is rejected outright. The frontend POSTs and then
// navigates to '/' itself.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  if (forbidCrossSite(req, res)) return
  const session = await getSession(req, res)
  // Kill the server-side record first — a stolen copy of this cookie stops
  // working immediately, not just in this browser.
  if (supabase) await revokeSession(session.sid)
  // destroy() clears session.userId — capture the actor first.
  const actorId = session.userId
  await session.destroy()
  securityEvent('logout_completed', { req, actorId })
  res.status(200).json({ ok: true })
}
