import { getSession } from '../../lib/auth.mjs'
import { sessionLeaseMs } from '../../lib/config.mjs'

// POST /api/auth/heartbeat — keeps a non-persistent session's inactivity
// lease alive while a Dev Ledger tab is open. Pure cookie re-seal: no DB
// writes, no GitHub calls. getSession already rejects expired leases, so an
// overdue beat arrives unauthenticated → 401.
export default async function handler(req, res) {
  const session = await getSession(req, res)
  if (!session.userId) {
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
