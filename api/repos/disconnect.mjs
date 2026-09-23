import { requireUser } from '../../lib/require-user.mjs'
import { supabase } from '../../lib/db.mjs'

// POST /api/repos/disconnect — the two explicit repository-removal choices.
//
//   { repositoryId, mode: 'keep' }   → STOP SYNCING, KEEP HISTORY
//     marks the repo disconnected (source 'user'); sync + webhook ingestion
//     skip it, stored analytics stay queryable.
//
//   { repositoryId, mode: 'delete' } → DISCONNECT & DELETE HISTORY
//     removes every row attributable to that repository for this user:
//     repository metadata, languages, commits, pull requests, repo_sync,
//     repo_coverage. Other users' rows for the same GitHub repo are
//     untouched (every statement is user_id-scoped).
//
//   { repositoryId, mode: 'resume' } → clear a retained disconnect so a
//     still-authorized repo syncs again.
//
// The repository id is verified against the authenticated user's own row —
// a client cannot disconnect or delete another tenant's data.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  const userId = await requireUser(req, res)
  if (!userId) return

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

  // mode === 'delete' — order matters: children first (commits/PRs use
  // ON DELETE SET NULL on repository_id and would otherwise orphan),
  // repository row last. All scoped to the authenticated user.
  const repoId = repo.id
  await supabase.from('pull_requests').delete().eq('user_id', userId).eq('repository_id', repoId)
  await supabase.from('commits').delete().eq('user_id', userId).eq('repository_id', repoId)
  await supabase.from('repo_coverage').delete().eq('user_id', userId).eq('repository_id', repoId)
  await supabase.from('repo_sync').delete().eq('user_id', userId).eq('repository_id', repoId)
  await supabase.from('sync_state').delete().eq('user_id', userId).eq('repository_id', repoId)
  await supabase.from('repository_languages').delete().eq('repository_id', repoId)
  await supabase.from('repositories').delete().eq('id', repoId).eq('user_id', userId)
  res.status(200).json({ ok: true, mode: 'delete' })
}
