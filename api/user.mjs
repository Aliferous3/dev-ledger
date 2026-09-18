import { getSession } from '../lib/auth.mjs'
import { github } from '../lib/config.mjs'
import { supabase } from '../lib/db.mjs'
import { getUserSync } from '../lib/sync.mjs'

// GET    — current session user, installations, sync state.
// DELETE — permanently delete the caller's Dev Ledger data, then sign out.
export default async function handler(req, res) {
  const session = await getSession(req, res)

  if (req.method === 'DELETE') {
    if (!session?.userId || !supabase) {
      res.status(401).json({ error: 'Unauthenticated' })
      return
    }
    if ((req.query?.confirm || '') !== '1') {
      res.status(400).json({ error: 'Pass confirm=1 to delete account data' })
      return
    }
    // users row cascades: installations, repositories (+languages), commits,
    // pull requests, repo_sync, user_sync.
    await supabase.from('users').delete().eq('id', session.userId)
    await session.destroy()
    res.status(200).json({ ok: true, deleted: true })
    return
  }

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  if (!session?.userId) {
    res.status(401).json({ authenticated: false })
    return
  }

  let user = null
  let installs = []
  let sync = null
  if (supabase) {
    const [{ data: u }, { data: i }] = await Promise.all([
      supabase.from('users').select('*').eq('id', session.userId).single(),
      supabase.from('github_installations').select('*').eq('user_id', session.userId),
    ])
    user = u
    installs = i || []
    sync = await getUserSync(session.userId)
  } else {
    user = { github_login: session.githubLogin }
  }

  res.status(200).json({
    authenticated: true,
    user: user
      ? {
          githubLogin: user.github_login,
          avatarUrl: user.avatar_url,
          displayName: user.display_name,
        }
      : null,
    installations: installs.map((i) => ({
      id: i.installation_id,
      account: i.account_login,
      type: i.account_type,
      url: `https://github.com/settings/installations/${i.installation_id}`,
    })),
    appSlug: github.appSlug || null,
    sync: sync
      ? {
          status: sync.status,
          phase: sync.phase,
          progress: sync.progress,
          detail: sync.detail || null,
          lastSyncedAt: sync.last_synced_at,
          error: sync.error,
        }
      : null,
  })
}
