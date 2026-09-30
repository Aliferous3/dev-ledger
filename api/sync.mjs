import { waitUntil } from '@vercel/functions'
import { requireUser } from '../lib/require-user.mjs'
import { forbidCrossSite } from '../lib/same-origin.mjs'
import { runSync, getUserSync } from '../lib/sync.mjs'
import { syncErrorMessage } from '../lib/sync-errors.mjs'
import { requestQuery } from '../lib/request-query.mjs'

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
        updatedAt: s.updated_at,
        error: syncErrorMessage(s.error),
      }
    : { status: 'idle', progress: 0 }

// GET  — return the caller's sync status (progress, phase, errors).
// POST — run a bounded ingestion slice inside this request (≤45s of the 60s
//        function limit), then report status. Cursors persist between slices;
//        the UI re-POSTs while status stays 'syncing', /api/cron/sync resumes
//        anything abandoned, and a best-effort waitUntil continuation covers
//        the gap when the runtime honors it.
export default async function handler(req, res) {
  // Live sync state must never be served stale from a shared cache.
  res.setHeader('Cache-Control', 'no-store')

  if (req.method === 'POST') {
    // Browser-triggered ingestion — a cross-site page must not be able to
    // burn the user's GitHub rate limit through their ambient cookie.
    if (forbidCrossSite(req, res)) return
    const userId = await requireUser(req, res)
    if (!userId) return
    const force = requestQuery(req).force === '1'
    const result = await runSync(userId, { budgetMs: 45_000, force })
    // Only continue post-response when THIS request actually ran a slice
    // that expired mid-work. Previously waitUntil fired on every 'syncing'
    // response — including lock-hit early returns — so each pump poll spawned
    // another concurrent runSync and cold bootstraps duplicated GitHub work.
    if (result?.status === 'syncing' && result?.ran) {
      // Best-effort: keep ingesting after the response on runtimes that
      // support it; harmless when suspended — cursors make it resumable.
      waitUntil(runSync(userId, { budgetMs: 45_000, resume: true }).catch(() => {}))
    }
    res.status(200).json(shape(result))
    return
  }

  if (req.method === 'GET') {
    const userId = await requireUser(req, res)
    if (!userId) return
    res.status(200).json(shape(await getUserSync(userId)))
    return
  }

  res.status(405).json({ error: 'Method not allowed' })
}
