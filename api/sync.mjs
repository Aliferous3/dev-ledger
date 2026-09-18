import { waitUntil } from '@vercel/functions'
import { requireUser } from '../lib/require-user.mjs'
import { runSync, getUserSync } from '../lib/sync.mjs'

const shape = (s) =>
  s
    ? {
        status: s.status,
        phase: s.phase,
        progress: Number(s.progress || 0),
        detail: s.detail || null,
        reposDone: s.repos_done || 0,
        reposTotal: s.repos_total || 0,
        resumeAt: s.resume_at,
        lastSyncedAt: s.last_synced_at,
        error: s.error,
      }
    : { status: 'idle', progress: 0 }

// GET  — return the caller's sync status (progress, phase, errors).
// POST — kick off ingestion. The heavy work runs in a serverless background
//        continuation (waitUntil) so the response returns immediately and the
//        browser polls GET for progress; each pass has a ~45s budget inside
//        the 60s function limit and persists cursors, so anything unfinished
//        is picked up by the next POST or by /api/cron/sync.
export default async function handler(req, res) {
  const userId = await requireUser(req, res)
  if (!userId) return

  if (req.method === 'GET') {
    res.status(200).json(shape(await getUserSync(userId)))
    return
  }

  if (req.method === 'POST') {
    const force = req.query?.force === '1'
    const existing = await getUserSync(userId)
    // Refuse to start a second pass while one is in flight — the lock also
    // lives inside runSync, but checking here keeps the response honest.
    const inFlight =
      existing?.status === 'syncing' &&
      Date.now() - new Date(existing.updated_at).getTime() < 60_000
    const fresh =
      existing?.status === 'complete' &&
      existing.last_synced_at &&
      Date.now() - new Date(existing.last_synced_at).getTime() < 60_000
    if ((inFlight || fresh) && !force) {
      res.status(200).json(shape(existing))
      return
    }
    waitUntil(
      runSync(userId, { budgetMs: 45_000, force }).catch(async (err) => {
        // runSync already persists error states; this is the last-resort log.
        console.error('background sync failed:', String(err?.message || err).slice(0, 300))
      })
    )
    res.status(202).json(shape({ ...(existing || {}), status: 'syncing' }))
    return
  }

  res.status(405).json({ error: 'Method not allowed' })
}
