import { waitUntil } from '@vercel/functions'
import { requireUser } from '../lib/require-user.mjs'
import { runRangeSync, findOutsideCommits, getCoverage, getUserSync } from '../lib/sync.mjs'
import { rangeCoverageStatus, coversRange } from '../lib/coverage.mjs'
import { validateRange } from '../lib/range.mjs'
import { supabase } from '../lib/db.mjs'

// POST /api/sync-range?from=YYYY-MM-DD&to=YYYY-MM-DD
// Kicks off a targeted historical backfill in a background continuation and
// returns immediately; repeat POSTs poll progress until the requested window
// is covered by every authorized repository. When coverage is complete it
// also reports commits found on GitHub in repositories outside the
// installation, so the UI can explain "zero" honestly.
export default async function handler(req, res) {
  const userId = await requireUser(req, res)
  if (!userId) return
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  let from, to
  try {
    ;({ from, to } = validateRange(req.query?.from || null, req.query?.to || null))
  } catch (e) {
    res.status(400).json({ error: e.message })
    return
  }
  if (!from || !to) {
    res.status(400).json({ error: 'from and to are required' })
    return
  }

  const prev = await getUserSync(userId)
  const rs = prev?.detail?.rangeSync
  const inFlight =
    rs?.from === from && rs?.to === to &&
    prev?.status === 'syncing' &&
    Date.now() - new Date(prev.updated_at).getTime() < 60_000
  if (!inFlight) {
    waitUntil(
      runRangeSync(userId, from, to, { budgetMs: 45_000 }).catch((err) => {
        console.error('range sync failed:', String(err?.message || err).slice(0, 300))
      })
    )
  }

  const [{ data: repos }, coverage] = await Promise.all([
    supabase.from('repositories').select('id').eq('user_id', userId),
    getCoverage(userId),
  ])
  const perRepo = (repos || []).map((r) => coverage.get(r.id) || [])
  const fromIso = `${from}T00:00:00.000Z`
  const toIso = `${to}T23:59:59.999Z`
  const done = perRepo.every((iv) => coversRange(iv, fromIso, toIso))
  const rangeCoverage = rangeCoverageStatus(perRepo, { from, to }, !done)

  let outsideCommits = null
  if (rangeCoverage.status === 'complete') {
    outsideCommits = await findOutsideCommits(userId, from, to)
  }

  res.status(200).json({ ok: true, done, rangeCoverage, outsideCommits })
}
