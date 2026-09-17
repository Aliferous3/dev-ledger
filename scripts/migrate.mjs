import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// Single source of truth: .env at the project root. Existing process
// environment variables are not overridden.
try {
  process.loadEnvFile(path.join(root, '.env'))
} catch {
  // .env is optional when configuration comes from the real environment
}

function projectRef() {
  if (process.env.SUPABASE_PROJECT_REF) return process.env.SUPABASE_PROJECT_REF
  const raw = process.env.SUPABASE_URL
  return raw ? new URL(raw).hostname.split('.')[0] : null
}

// Direct db.<ref>.supabase.co is IPv6-only; the session pooler is reachable
// over IPv4. Build the URL from parts so passwords containing URI-reserved
// characters are always percent-encoded correctly.
function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  const password = process.env.SUPABASE_DB_PASSWORD
  const ref = projectRef()
  if (!password || !ref) {
    throw new Error(
      'Set DATABASE_URL, or SUPABASE_DB_PASSWORD with SUPABASE_URL (or SUPABASE_PROJECT_REF)'
    )
  }
  const host = process.env.SUPABASE_DB_HOST || 'aws-0-ap-southeast-2.pooler.supabase.com'
  const port = process.env.SUPABASE_DB_PORT || '6543'
  const user = encodeURIComponent(`postgres.${ref}`)
  const pass = encodeURIComponent(password)
  return `postgresql://${user}:${pass}@${host}:${port}/postgres`
}

const url = databaseUrl()
const target = new URL(url)
console.log(
  `connecting: ${decodeURIComponent(target.username)}@${target.hostname}:${target.port}${target.pathname}`
)

const sql = postgres(url, { onnotice: () => {} })

async function run() {
  const dir = path.join(root, 'migrations')
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.sql')).sort()

  await sql`
    create table if not exists schema_migrations (
      filename text primary key,
      applied_at timestamptz not null default now()
    )
  `
  const applied = new Set(
    (await sql`select filename from schema_migrations`).map((r) => r.filename)
  )

  for (const f of files) {
    if (applied.has(f)) {
      console.log('skipped (already applied):', f)
      continue
    }
    const text = await fs.readFile(path.join(dir, f), 'utf8')
    await sql.begin(async (t) => {
      await t.unsafe(text)
      await t`insert into schema_migrations (filename) values (${f})`
    })
    console.log('migrated:', f)
  }
  await sql.end()
}

run().catch((e) => {
  console.error('Migration failed:', e.message)
  process.exit(1)
})
