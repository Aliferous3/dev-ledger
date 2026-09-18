import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const isProduction = process.env.NODE_ENV === 'production'

export const cookie = {
  cookieName: process.env.SESSION_COOKIE_NAME || 'dev_ledger_session',
  password: process.env.SESSION_SECRET || (isProduction ? null : 'dev_ledger_session_secret_change_in_production'),
  ttl: 60 * 60 * 24 * 7, // 7 days
  cookieOptions: {
    secure: isProduction,
    sameSite: 'lax',
    httpOnly: true,
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

export const appUrl =
  process.env.APP_URL ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000')

export const db = {
  // PostgREST endpoint for the supabase-js client (SUPABASE_URL),
  // distinct from DATABASE_URL which the migration runner uses.
  url: process.env.SUPABASE_URL,
  serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
}
