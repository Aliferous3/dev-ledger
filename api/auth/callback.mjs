import { getSession, getUserOctokit, getAppAuth } from '../../lib/auth.mjs'
import { github } from '../../lib/config.mjs'
import { supabase } from '../../lib/db.mjs'

export default async function handler(req, res) {
  const { code, state, installation_id: installationId } = req.query || {}
  const session = await getSession(req, res)
  if (!code || !state || state !== session.oauthState) {
    res.status(400).json({ error: 'Invalid OAuth state' })
    return
  }
  delete session.oauthState

  const redirectUri = `${process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000'}/api/auth/callback`
  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: github.clientId,
      client_secret: github.clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  })
  const tokenData = await tokenRes.json()
  if (!tokenData.access_token) {
    res.status(400).json({ error: 'GitHub token exchange failed' })
    return
  }

  const userOctokit = getUserOctokit(tokenData.access_token)
  const { data: user } = await userOctokit.rest.users.getAuthenticated()

  if (supabase) {
    const { data: dbUser, error } = await supabase
      .from('users')
      .upsert({
        github_user_id: user.id,
        github_login: user.login,
        github_node_id: user.node_id,
        avatar_url: user.avatar_url,
        display_name: user.name,
      }, { onConflict: 'github_user_id' })
      .select()
      .single()
    if (error) {
      res.status(500).json({ error: 'Database error' })
      return
    }
    session.userId = dbUser.id
    session.githubUserId = user.id
    session.githubLogin = user.login
    await session.save()

    if (installationId) {
      await supabase.from('github_installations').upsert({
        user_id: dbUser.id,
        installation_id: Number(installationId),
      }, { onConflict: 'user_id,installation_id' })
    } else {
      // Discover installations accessible to the user token
      const { data: installs } = await userOctokit.rest.apps.listInstallationsForAuthenticatedUser()
      for (const inst of installs.installations) {
        await supabase.from('github_installations').upsert({
          user_id: dbUser.id,
          installation_id: inst.id,
          account_id: inst.account?.id,
          account_login: inst.account?.login,
          account_type: inst.account?.type,
        }, { onConflict: 'user_id,installation_id' })
      }
    }
  } else {
    session.userId = String(user.id)
    session.githubUserId = user.id
    session.githubLogin = user.login
    await session.save()
  }

  res.writeHead(302, { Location: '/' })
  res.end()
}
