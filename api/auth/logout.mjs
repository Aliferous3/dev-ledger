import { getSession } from '../../lib/auth.mjs'

export default async function handler(req, res) {
  const session = await getSession(req, res)
  await session.destroy()
  res.writeHead(302, { Location: '/' })
  res.end()
}
