import { getSession } from '../lib/auth.mjs'
import { supabase } from '../lib/db.mjs'

export default async function handler(req, res) {
  const session = await getSession(req, res)
  if (!session?.userId || !supabase) {
    res.status(401).json({ error: 'Unauthenticated or database unavailable' })
    return
  }

  const [{ data: repos }, { data: daily }] = await Promise.all([
    supabase.from('repositories').select('*').eq('user_id', session.userId).limit(1000),
    supabase.from('daily_activity').select('*').eq('user_id', session.userId).limit(3650),
  ])

  const summary = {
    repos: (repos || []).length,
    commits: 0,
    sourceAdded: 0,
    sourceDeleted: 0,
    activeDays: new Set(daily?.map((d) => d.date)).size,
  }

  res.status(200).json({
    generatedAt: new Date().toISOString(),
    repositories: repos || [],
    daily: daily || [],
    summary,
  })
}
