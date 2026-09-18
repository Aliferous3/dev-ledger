import { getSession, getAppOctokit } from '../lib/auth.mjs'
import { supabase } from '../lib/db.mjs'
import { setUserSync } from '../lib/sync.mjs'

// GitHub App "Setup URL". After a user installs the app or modifies the
// repository selection, GitHub redirects here with ?installation_id&setup_action.
export default async function handler(req, res) {
  const session = await getSession(req, res)
  if (!session?.userId) {
    res.writeHead(302, { Location: '/api/auth/login' })
    res.end()
    return
  }

  const { installation_id: installationId } = req.query || {}
  if (installationId && supabase) {
    try {
      const octokit = await getAppOctokit()
      const { data: inst } = await octokit.rest.apps.getInstallation({ installation_id: Number(installationId) })
      await supabase.from('github_installations').upsert({
        user_id: session.userId,
        installation_id: inst.id,
        account_id: inst.account?.id,
        account_login: inst.account?.login,
        account_type: inst.account?.type,
      }, { onConflict: 'user_id,installation_id' })
    } catch {
      // Still record the installation id — discovery will surface problems.
      await supabase.from('github_installations').upsert({
        user_id: session.userId,
        installation_id: Number(installationId),
      }, { onConflict: 'user_id,installation_id' })
    }
    await setUserSync(session.userId, { status: 'syncing', phase: 'discover' })
  }

  res.writeHead(302, { Location: '/?installed=1' })
  res.end()
}
