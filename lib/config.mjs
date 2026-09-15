import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const isProduction = process.env.NODE_ENV === 'production'

export const cookie = {
  name: process.env.SESSION_COOKIE_NAME || 'dev_ledger_session',
  password: process.env.SESSION_SECRET || (isProduction ? null : 'dev_ledger_session_secret_change_in_production'),
  secure: isProduction,
  sameSite: 'lax',
  httpOnly: true,
  maxAge: 60 * 60 * 24 * 7, // 7 days
}

if (isProduction && !process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET is required in production')
}

export const github = {
  appId: process.env.GITHUB_APP_ID,
  clientId: process.env.GITHUB_CLIENT_ID,
  clientSecret: process.env.GITHUB_CLIENT_SECRET,
  privateKey: process.env.GITHUB_APP_PRIVATE_KEY,
  webhookSecret: process.env.GITHUB_WEBHOOK_SECRET,
}

export const db = {
  url: process.env.DATABASE_URL,
  serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
}
