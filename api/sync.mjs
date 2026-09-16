import { requireUser } from '../lib/require-user.mjs'
import { runSync, getUserSync } from '../lib/sync.mjs'

const shape = (s) =>
  s
    ? {
        status: s.status,
        phase: s.phase,
        progress: Number(s.progress || 0),
        reposDone: s.repos_done || 0,
        reposTotal: s.repos_total || 0,
        resumeAt: s.resume_at,
        lastSyncedAt: s.last_synced_at,
        error: s.error,
      }
    : { status: 'idle', progress: 0 }

// GET  — return the caller's sync status (progress, phase, errors).
// POST — run one bounded sync pass (~20s). The frontend pumps this endpoint
//        while status is 'syncing'; Vercel Cron continues it in the
//        background via /api/cron/sync.
export default async function handler(req, res) {
  const userId = await requireUser(req, res)
  if (!userId) return

  if (req.method === 'GET') {
    res.status(200).json(shape(await getUserSync(userId)))
    return
  }

  if (req.method === 'POST') {
    const force = req.query?.force === '1'
    res.status(200).json(shape(await runSync(userId, { budgetMs: 20000, force })))
    return
  }

  res.status(405).json({ error: 'Method not allowed' })
}
