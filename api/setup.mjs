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
    // The query param is attacker-controllable — an installation id only
    // proves the app was installed SOMEWHERE. Linking a foreign id here
    // would mint that installation's tokens under this user and ingest its
    // repositories into the wrong tenant. Link only when the installation's
    // target account IS the signed-in user; org installs are linked by the
    // OAuth-callback discovery (listInstallationsForAuthenticatedUser)
    // which GitHub itself verifies against the user's token.
    try {
      const octokit = await getAppOctokit()
      const { data: inst } = await octokit.rest.apps.getInstallation({ installation_id: Number(installationId) })
      if (inst?.account?.id === session.githubUserId) {
        await supabase.from('github_installations').upsert({
          user_id: session.userId,
          installation_id: inst.id,
          account_id: inst.account?.id,
          account_login: inst.account?.login,
          account_type: inst.account?.type,
        }, { onConflict: 'user_id,installation_id' })
        await setUserSync(session.userId, { status: 'syncing', phase: 'discover' })
      }
    } catch {
      // Unknown/foreign installation — never record an unverified id.
    }
  }

  res.writeHead(302, { Location: '/?installed=1' })
  res.end()
}
