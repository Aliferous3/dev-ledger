// npm run db:backup — logical data backup of the production database.
//
// Format: pg_dump --data-only --format=custom --table=public.<t> …
// ALLOWLIST-ONLY: only the classified application tables in
// backup-scope.mjs are requested — never a whole-database dump, so
// Supabase-internal schemas/objects and any unclassified future table
// cannot enter the archive. Schema is NOT in the backup — migrations
// 001..N are the schema source of truth; restore is always
// "migrate fresh, then pg_restore --data-only". Ephemeral tables
// (auth_sessions, webhook_deliveries, security_events, schema_migrations)
// are simply not requested — see backup-scope.mjs.
//
// Output: .recovery/dev-ledger-<UTC timestamp>.dump + .dump.sha256 sidecar.
// Artifacts are gitignored, sensitive (usernames, repo metadata, commit
// stats), and belong ONLY in an encrypted vault/off-site location.
//
// Credentials come from operator-env.mjs (env > .env.local > .env) and reach
// pg_dump through PG* env vars — never argv, never printed.

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'
import { loadOperatorEnv, databaseUrl, pgEnv } from './operator-env.mjs'
import { runPgTool } from './pg-tools.mjs'
import { BACKUP_TABLES } from './backup-scope.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export function backupDir() {
  return process.env.BACKUP_DIR || path.join(root, '.recovery')
}

async function main() {
  loadOperatorEnv()
  const url = databaseUrl() // throws a clear error when creds are absent
  const env = pgEnv(url)

  const sql = postgres(url, { onnotice: () => {} })
  let serverMajor
  try {
    const [{ server_version_num }] = await sql`show server_version_num`
    serverMajor = Math.floor(Number(server_version_num) / 10000)
  } finally {
    await sql.end()
  }

  const dir = backupDir()
  fs.mkdirSync(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19) + 'Z'
  const file = path.join(dir, `dev-ledger-${stamp}.dump`)

  // Archive streams over stdout so the docker fallback never needs host
  // filesystem access; we write the file ourselves.
  const { stdout } = runPgTool('pg_dump', serverMajor, env, [
    '--format=custom',
    '--data-only',
    '--no-owner',
    '--no-privileges',
    ...BACKUP_TABLES.map((t) => `--table=public.${t}`),
  ], { binaryOut: true })
  fs.writeFileSync(file, stdout)

  const sha = crypto.createHash('sha256').update(stdout).digest('hex')
  fs.writeFileSync(`${file}.sha256`, `${sha}  ${path.basename(file)}\n`)

  // Metadata only — never the connection string, host, or credentials.
  console.log('backup complete')
  console.log(`  file:     ${path.basename(file)}`)
  console.log(`  dir:      ${dir}`)
  console.log(`  bytes:    ${fs.statSync(file).size}`)
  console.log(`  sha256:   ${sha}`)
  console.log(`  postgres: server major ${serverMajor}`)
  console.log(`  tables:   ${BACKUP_TABLES.length} allowlisted (${BACKUP_TABLES.join(', ')})`)
  console.log('store this artifact ONLY in an encrypted vault / encrypted disk / encrypted off-site location')
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
if (isMain) {
  main().catch((e) => {
    console.error('backup failed:', e.message)
    process.exit(1)
  })
}
