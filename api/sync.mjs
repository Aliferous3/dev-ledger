import { getSession, getAppAuth } from '../lib/auth.mjs'
import { supabase } from '../lib/db.mjs'

export default async function handler(req, res) {
  const session = await getSession(req, res)
  if (!session?.userId || !supabase) {
    res.status(401).json({ error: 'Unauthenticated or database unavailable' })
    return
  }

  // Fetch installations for the user and enqueue repository discovery
  const { data: installs } = await supabase
    .from('github_installations')
    .select('*')
    .eq('user_id', session.userId)

  const auth = getAppAuth()
  for (const inst of installs || []) {
    const each = auth.getInstallationOctokit(inst.installation_id)
    const { data: repos } = await each.rest.apps.listReposAccessibleToInstallation({ per_page: 100 })
    for (const repo of repos.repositories) {
      await supabase.from('repositories').upsert({
        user_id: session.userId,
        github_repo_id: repo.id,
        owner_login: repo.owner.login,
        name: repo.name,
        full_name: repo.full_name,
        private: repo.private,
        default_branch: repo.default_branch,
        primary_language: repo.language,
        archived: repo.archived,
        fork: repo.fork,
      }, { onConflict: 'user_id,github_repo_id' })
    }
  }

  res.status(200).json({ ok: true, started: true })
}
