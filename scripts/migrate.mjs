import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'
import { loadOperatorEnv, databaseUrl } from './operator-env.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// Operator credentials: real environment first, then .env.local, then .env
// (shared loader — see operator-env.mjs). Values are never printed.
loadOperatorEnv()

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
