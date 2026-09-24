// Shared operator-environment loader for db:* tooling.
//
// Precedence: real process environment > .env.local > .env.
// process.loadEnvFile never overrides an already-set variable, so loading
// .env.local first gives it priority over the older .env fallback while the
// exported environment always wins. Neither file may ever be committed —
// .gitignore covers both.
//
// These helpers must never print secret values.

import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export function loadOperatorEnv() {
  for (const name of ['.env.local', '.env']) {
    try {
      process.loadEnvFile(path.join(root, name))
    } catch {
      // optional — configuration may come entirely from the real environment
    }
  }
}

export function projectRef() {
  if (process.env.SUPABASE_PROJECT_REF) return process.env.SUPABASE_PROJECT_REF
  const raw = process.env.SUPABASE_URL
  return raw ? new URL(raw).hostname.split('.')[0] : null
}

// Direct db.<ref>.supabase.co is IPv6-only; the Supavisor pooler is
// reachable over IPv4. Supabase docs route dump/migrate/restore work
// through the SESSION pooler — port 5432, not the transaction pooler
// (6543) which can drop the session state long-running dump/restore
// connections rely on. Build the URL from parts so passwords containing
// URI-reserved characters are always percent-encoded correctly.
export function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  const password = process.env.SUPABASE_DB_PASSWORD
  const ref = projectRef()
  if (!password || !ref) {
    throw new Error(
      'Set DATABASE_URL, or SUPABASE_DB_PASSWORD with SUPABASE_URL (or SUPABASE_PROJECT_REF)'
    )
  }
  const host = process.env.SUPABASE_DB_HOST || 'aws-0-ap-southeast-2.pooler.supabase.com'
  const port = process.env.SUPABASE_DB_PORT || '5432' // Supavisor session pooler
  const user = encodeURIComponent(`postgres.${ref}`)
  const pass = encodeURIComponent(password)
  return `postgresql://${user}:${pass}@${host}:${port}/postgres`
}

// Splits a postgres URL into discrete PG* environment entries so client
// tools (pg_dump/pg_restore/psql) get the password through PGPASSWORD —
// never in argv, never in logs.
export function pgEnv(url) {
  const u = new URL(url)
  return {
    PGHOST: u.hostname,
    PGPORT: u.port || '5432',
    PGUSER: decodeURIComponent(u.username),
    PGPASSWORD: decodeURIComponent(u.password),
    PGDATABASE: u.pathname.replace(/^\//, '') || 'postgres',
  }
}

export function isLocalHost(hostname) {
  return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname)
}
