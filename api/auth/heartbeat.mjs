import { getSession } from '../../lib/auth.mjs'
import { sessionLeaseMs } from '../../lib/config.mjs'
import { isSessionLive } from '../../lib/sessions.mjs'
import { supabase } from '../../lib/db.mjs'

// POST /api/auth/heartbeat — keeps a non-persistent session's inactivity
// lease alive while a Dev Ledger tab is open. Pure cookie re-seal: no DB
// writes, no GitHub calls — aside from the session-liveness read, which
// prevents a revoked cookie from renewing its lease. getSession already
// rejects expired leases, so an overdue beat arrives unauthenticated → 401.
export default async function handler(req, res) {
  // POST-only: the lease must never renew from a GET — otherwise any
  // embedded image/prefetch could extend a session without real intent.
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  const session = await getSession(req, res)
  // Revocation check only applies when a database backs sessions — without
  // one there are no auth_sessions rows to revoke and nothing to check.
  if (!session.userId || (supabase && !(await isSessionLive(session.sid)))) {
    res.status(401).json({ ok: false, authenticated: false })
    return
  }
  if (session.persistent === true) {
    res.status(200).json({ ok: true, persistent: true })
    return
  }
  if (sessionLeaseMs > 0) {
    session.leaseUntil = Date.now() + sessionLeaseMs
    await session.save()
  }
  res.status(200).json({ ok: true, leaseUntil: session.leaseUntil ?? null })
}
