import { getSession } from '../lib/auth.mjs'
import { supabase } from '../lib/db.mjs'

export default async function handler(req, res) {
  const session = await getSession(req, res)
  if (!session?.userId) {
    res.status(401).json({ authenticated: false })
    return
  }

  let user = null
  if (supabase) {
    const { data } = await supabase.from('users').select('*').eq('id', session.userId).single()
    user = data
  } else {
    user = { github_login: session.githubLogin }
  }

  const { data: installs } = supabase
    ? await supabase.from('github_installations').select('*').eq('user_id', session.userId)
    : { data: [] }

  res.status(200).json({
    authenticated: true,
    user: user
      ? {
          id: user.id,
          githubLogin: user.github_login,
          avatarUrl: user.avatar_url,
          displayName: user.display_name,
        }
      : null,
    installations: (installs || []).map((i) => ({
      id: i.installation_id,
      account: i.account_login,
      type: i.account_type,
    })),
  })
}
