import { getSession } from '../lib/auth.mjs'
import { supabase } from '../lib/db.mjs'

export default async function handler(req, res) {
  const session = await getSession(req, res)
  if (!session?.userId || !supabase) {
    res.status(401).json({ error: 'Unauthenticated or database unavailable' })
    return
  }

  const { data: user } = await supabase.from('users').select('*').eq('id', session.userId).single()
  const { data: prs } = await supabase
    .from('pull_requests')
    .select('state, merged_at')
    .eq('user_id', session.userId)
    .eq('author_user_id', session.githubUserId)

  const pullRequests = (prs || []).length
  const mergedPrs = (prs || []).filter((p) => p.merged_at).length

  res.status(200).json({
    connected: true,
    login: user?.github_login,
    avatar: user?.avatar_url,
    pullRequests,
    mergedPrs,
    contributions: 0,
    ownedRepos: 0,
    stars: 0,
    forks: 0,
  })
}
