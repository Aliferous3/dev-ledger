import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const isProduction = process.env.NODE_ENV === 'production'

// Secure must track the origin the app is actually served on, not NODE_ENV:
// a production-mode server on http://localhost must not emit Secure cookies
// (Firefox refuses them on insecure origins), and vercel dev reports a
// localhost VERCEL_URL that is plain http.
const LOCAL_HOST = /^(localhost|127\.|0\.0\.0\.0|\[?::1)/i
export const appUrl =
  process.env.APP_URL ||
  (process.env.VERCEL_URL
    ? `${LOCAL_HOST.test(process.env.VERCEL_URL) ? 'http' : 'https'}://${process.env.VERCEL_URL}`
    : 'http://localhost:3000')
const isSecureOrigin = appUrl.startsWith('https://')

// 30-day lifetime for the opt-in "keep me signed in" variant.
export const persistentTtl = 60 * 60 * 24 * 30

export const cookie = {
  cookieName: process.env.SESSION_COOKIE_NAME || 'dev_ledger_session',
  password: process.env.SESSION_SECRET || (isProduction ? null : 'dev_ledger_session_secret_change_in_production'),
  // Default session: a true browser-session cookie. iron-session treats a
  // present-but-undefined cookieOptions.maxAge as "no Max-Age/Expires", so
  // the cookie dies with the browser session. Caveat: "browser session" is
  // defined by the browser — Firefox Session Restore (browser.startup.page=3
  // / crash recovery) intentionally re-injects session cookies on restart
  // (SessionCookies.sys.mjs), and a resident Firefox process never ends the
  // session. That is standards-compliant; no cookie attribute can force
  // process-exit expiry. See AGENTS.md.
  ttl: 0,
  cookieOptions: {
    secure: isSecureOrigin,
    sameSite: 'lax',
    httpOnly: true,
    maxAge: undefined,
  },
}

if (isProduction && !process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET is required in production')
}

export const github = {
  appId: process.env.GITHUB_APP_ID,
  appSlug: process.env.GITHUB_APP_SLUG,
  clientId: process.env.GITHUB_CLIENT_ID,
  clientSecret: process.env.GITHUB_CLIENT_SECRET,
  privateKey: process.env.GITHUB_APP_PRIVATE_KEY,
  webhookSecret: process.env.GITHUB_WEBHOOK_SECRET,
}

export const db = {
  // PostgREST endpoint for the supabase-js client (SUPABASE_URL),
  // distinct from DATABASE_URL which the migration runner uses.
  url: process.env.SUPABASE_URL,
  serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
}
