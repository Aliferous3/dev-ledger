import { getSession } from '../../lib/auth.mjs'
import { revokeSession } from '../../lib/sessions.mjs'
import { supabase } from '../../lib/db.mjs'

export default async function handler(req, res) {
  const session = await getSession(req, res)
  // Kill the server-side record first — a stolen copy of this cookie stops
  // working immediately, not just in this browser.
  if (supabase) await revokeSession(session.sid)
  await session.destroy()
  res.writeHead(302, { Location: '/' })
  res.end()
}
