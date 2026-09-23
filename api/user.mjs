import { getSession } from '../lib/auth.mjs'
import { github } from '../lib/config.mjs'
import { supabase } from '../lib/db.mjs'
import { getUserSync } from '../lib/sync.mjs'
import { revokeAllSessions, isSessionLive } from '../lib/sessions.mjs'
import { requestQuery } from '../lib/request-query.mjs'
import { forbidCrossSite } from '../lib/same-origin.mjs'

// GET    — current session user, installations, sync state.
// POST   — repository disconnect/retain/delete/resume action.
// DELETE — permanently delete the caller's Dev Ledger data, then sign out.
export default async function handler(req, res) {
  // Mutations must fail closed before getSession() runs: it can destroy an
  // expired session, which emits a Set-Cookie — a cross-site request must not
  // even reach cookie-writing code.
  if (req.method === 'POST' || req.method === 'DELETE') {
    if (forbidCrossSite(req, res)) return
  }
  if (!['GET', 'POST', 'DELETE'].includes(req.method)) {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const session = await getSession(req, res)

  if (req.method === 'DELETE') {
    if (!session?.userId || !supabase || !(await isSessionLive(session.sid))) {
      res.status(401).json({ error: 'Unauthenticated' })
      return
    }
    if ((requestQuery(req).confirm || '') !== '1') {
      res.status(400).json({ error: 'Pass confirm=1 to delete account data' })
      return
    }
    // Revoke every session server-side first — any other live copies of
    // this user's cookies die immediately, even before the cascade lands.
    await revokeAllSessions(session.userId)
    // users row cascades: installations, repositories (+languages), commits,
    // pull requests, repo_sync, user_sync, auth_sessions.
    await supabase.from('users').delete().eq('id', session.userId)
    await session.destroy()
    res.status(200).json({ ok: true, deleted: true })
    return
  }


  if (req.method === 'POST') {
    // Repository disconnect/keep/delete — mutations stay same-origin only.
    if (!session?.userId || !supabase || !(await isSessionLive(session.sid))) {
      res.status(401).json({ error: 'Unauthenticated' })
      return
    }

    let body = req.body
    if (typeof body === 'string') {
      try { body = JSON.parse(body) } catch { body = null }
    }

    const repositoryId = body?.repositoryId
    const mode = body?.mode
    if (!repositoryId || !['keep', 'delete', 'resume'].includes(mode)) {
      res.status(400).json({ error: 'repositoryId and mode (keep|delete|resume) required' })
      return
    }

    const userId = session.userId
    const { data: repo } = await supabase
      .from('repositories')
      .select('id, full_name, disconnected_at')
      .eq('id', repositoryId)
      .eq('user_id', userId)
      .maybeSingle()

    if (!repo) {
      res.status(404).json({ error: 'Repository not found' })
      return
    }

    if (mode === 'keep') {
      await supabase
        .from('repositories')
        .update({ disconnected_at: new Date().toISOString(), disconnect_source: 'user' })
        .eq('id', repo.id)
        .eq('user_id', userId)
      res.status(200).json({ ok: true, mode: 'keep' })
      return
    }

    if (mode === 'resume') {
      await supabase
        .from('repositories')
        .update({ disconnected_at: null, disconnect_source: null })
        .eq('id', repo.id)
        .eq('user_id', userId)
      res.status(200).json({ ok: true, mode: 'resume' })
      return
    }

    const repoId = repo.id
    await supabase.from('pull_requests').delete().eq('user_id', userId).eq('repository_id', repoId)
    await supabase.from('commits').delete().eq('user_id', userId).eq('repository_id', repoId)
    await supabase.from('repo_coverage').delete().eq('user_id', userId).eq('repository_id', repoId)
    await supabase.from('repo_sync').delete().eq('user_id', userId).eq('repository_id', repoId)
    await supabase.from('repository_languages').delete().eq('repository_id', repoId)
    await supabase.from('repositories').delete().eq('id', repoId).eq('user_id', userId)
    res.status(200).json({ ok: true, mode: 'delete' })
    return
  }

  // A revoked/unknown sid must not authenticate — the boot gate reads this
  // endpoint, so a stolen cookie has to die here too. When no DB is present
  // there is nothing to check (dev bypass path).
  if (!session?.userId || (supabase && !(await isSessionLive(session.sid)))) {
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
    // Lets the frontend run the inactivity heartbeat only for
    // non-persistent sessions; remembered sessions need none.
    persistent: session.persistent === true,
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
