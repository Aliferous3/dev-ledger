import { waitUntil } from '@vercel/functions'
import { getSession, getAppOctokit } from '../lib/auth.mjs'
import { supabase } from '../lib/db.mjs'
import { isSessionLive } from '../lib/sessions.mjs'
import { desktopHandoff } from '../lib/desktop-auth.mjs'
import { kickSync, runSync } from '../lib/sync.mjs'
import { requestQuery } from '../lib/request-query.mjs'

// GitHub App "Setup URL". After a user installs the app or modifies the
// repository selection, GitHub redirects here with ?installation_id&setup_action.
export default async function handler(req, res) {
  const session = await getSession(req, res)
  if (!session?.userId || (supabase && !(await isSessionLive(session.sid)))) {
    // Restarting login mid-install must not strand a desktop handoff —
    // carry the sealed flow id forward so the resumed OAuth still returns
    // to the app. Unauthenticated installs (no flow) are unchanged.
    const flow = session?.desktopFlow ? `?desktop_flow=${encodeURIComponent(session.desktopFlow)}` : ''
    res.writeHead(302, { Location: `/api/auth/login${flow}` })
    res.end()
    return
  }

  const { installation_id: installationId } = requestQuery(req)
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
        // Kick a real first slice — the 'syncing' claim must be backed by a
        // worker, otherwise the marker sits wedged until cron.
        await kickSync(session.userId)
        waitUntil(runSync(session.userId, { budgetMs: 45_000, force: true }).catch(() => {}))
      }
    } catch {
      // Unknown/foreign installation — never record an unverified id.
    }
  }

  // A desktop login pending handoff finishes here (first-time installs
  // arrive via this Setup URL rather than the OAuth callback tail).
  if (await desktopHandoff(res, session, '/?installed=1')) return
  res.writeHead(302, { Location: '/?installed=1' })
  res.end()
}
