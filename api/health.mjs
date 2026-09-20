import { getSession } from '../lib/auth.mjs'
import { supabase } from '../lib/db.mjs'

export default async function handler(req, res) {
  const session = await getSession(req, res)
  const ready = Boolean(supabase)
  res.status(200).json({
    ok: true,
    authenticated: Boolean(session?.userId),
    database: ready,
    mode: 'github-saas',
  })
}
