// Public health probe — intentionally minimal. It answers "is the app up"
// and nothing else: no auth state, no database/config presence, no mode,
// no environment details. Any richer diagnostic belongs behind auth.
export default async function handler(req, res) {
  res.status(200).json({ ok: true })
}
