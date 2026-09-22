import { supabase } from '../../lib/db.mjs'
import { runSync } from '../../lib/sync.mjs'

// Vercel Cron continuation. Continues any sync that is mid-flight or paused
// on a rate limit whose resume time has passed, so a user can close the tab
// during initial history import and it still finishes in the background.
export default async function handler(req, res) {
  // Fail closed: without CRON_SECRET there is nothing to authenticate
  // against, so an unconfigured deployment must reject rather than expose
  // a public "run sync work" trigger.
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const { data: rows } = await supabase
    .from('user_sync')
    .select('user_id, status, resume_at')
    .or('status.eq.syncing,and(status.eq.rate_limited,resume_at.lt.' + new Date().toISOString() + ')')
    .limit(2)

  const results = []
  for (const row of rows || []) {
    const r = await runSync(row.user_id, { budgetMs: 20000 })
    results.push({ user: row.user_id, status: r?.status })
  }
  res.status(200).json({ ok: true, continued: results.length, results })
}
