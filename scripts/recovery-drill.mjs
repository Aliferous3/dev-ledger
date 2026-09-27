// npm run db:drill — NON-DESTRUCTIVE synthetic backup/restore drill.
//
// Proves the real recovery path end to end on disposable databases only:
//   create scratch DB → run repo migrations → seed synthetic rows →
//   run the SAME pg_dump path as db:backup → create second scratch DB →
//   migrate → pg_restore → verify schema/RLS/grants/data → drop both DBs.
//
// HARD GUARD: the admin URL must point at localhost / 127.0.0.1 / ::1.
// There is intentionally no production-restore mode here — real disaster
// recovery is a runbook procedure (docs/disaster-recovery.md), not a command.
//
// Env: DRILL_DATABASE_URL (preferred) or DATABASE_URL — postgres superuser
// connection to a throwaway local/CI Postgres. Synthetic data only.

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'
import { loadOperatorEnv, pgEnv, isLocalHost } from './operator-env.mjs'
import { runPgTool } from './pg-tools.mjs'
import { BACKUP_TABLES, EPHEMERAL_TABLES } from './backup-scope.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BACKED_UP = BACKUP_TABLES
const DATA_TABLES = [...BACKED_UP, ...EPHEMERAL_TABLES.filter((t) => t !== 'schema_migrations')]

// The number of migrations the runner applies = the .sql files in
// migrations/ — derived, so adding a migration never desyncs the drill.
const MIGRATION_COUNT = fs
  .readdirSync(path.join(root, 'migrations'))
  .filter((f) => f.endsWith('.sql')).length

// Deterministic bytea fixture — a real PNG signature + payload so the
// drill proves binary data survives the dump/restore byte-identically.
const DRILL_SCREENSHOT = Buffer.from(
  '89504e470d0a1a0a' + '00010203040506070809fffefdfcfbfaf9f8',
  'hex'
)

function fail(msg) {
  console.error(`drill: ${msg}`)
  process.exit(1)
}

function drillUrl() {
  const raw = process.env.DRILL_DATABASE_URL || process.env.DATABASE_URL
  if (!raw) fail('set DRILL_DATABASE_URL to a LOCAL throwaway Postgres (e.g. postgres://postgres:pw@localhost:5432/postgres)')
  let u
  try { u = new URL(raw) } catch { fail('DRILL_DATABASE_URL is not a valid URL') }
  if (!isLocalHost(u.hostname)) {
    fail(`refusing non-local host "${u.hostname}" — the drill only runs against localhost/127.0.0.1/::1`)
  }
  return raw
}

function dbAt(adminUrl, name) {
  const u = new URL(adminUrl)
  u.pathname = `/${name}`
  return u.toString()
}

function run(cmd, args, env = {}) {
  const r = spawnSync(cmd, args, { env: { ...process.env, ...env }, encoding: 'utf8', cwd: root })
  if (r.status !== 0) fail(`${cmd} ${args[0] || ''} failed: ${(r.stderr || r.stdout || '').trim().split('\n').pop()}`)
  return r
}

function migrate(url) {
  run(process.execPath, ['scripts/migrate.mjs'], { DATABASE_URL: url })
}

async function seed(sql) {
  const uid = crypto.randomUUID()
  const repoId = crypto.randomUUID()
  await sql`insert into users (id, github_user_id, github_login) values (${uid}, 42424242, 'drill-user')`
  await sql`insert into github_installations (user_id, installation_id, account_id, account_login, account_type)
            values (${uid}, 909090, 42424242, 'drill-user', 'User')`
  await sql`insert into repositories (id, user_id, github_repo_id, owner_login, name, full_name)
            values (${repoId}, ${uid}, 313131, 'drill-user', 'drill-repo', 'drill-user/drill-repo')`
  await sql`insert into repository_languages (repository_id, language, bytes) values (${repoId}, 'TypeScript', 12345)`
  await sql`insert into commits (user_id, repository_id, github_sha, committed_at, additions, deletions)
            values (${uid}, ${repoId}, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', now(), 10, 2)`
  await sql`insert into pull_requests (user_id, repository_id, github_pr_id, number, author_user_id, author_login, state, created_at)
            values (${uid}, ${repoId}, 777, 3, 42424242, 'drill-user', 'merged', now())`
  await sql`insert into repo_sync (user_id, repository_id, phase) values (${uid}, ${repoId}, 'done')`
  await sql`insert into user_sync (user_id, status, phase, progress) values (${uid}, 'complete', 'done', 1)`
  await sql`insert into repo_coverage (user_id, repository_id, covered_from, covered_to, complete)
            values (${uid}, ${repoId}, now() - interval '30 days', now(), true)`
  // 010_feedback — user-authored, not re-ingestable; the drill must prove
  // the bytea screenshot survives the round-trip byte-identically.
  await sql`insert into feedback (user_id, type, title, description, screenshot, screenshot_mime, screenshot_name, page, selected_range, build)
            values (${uid}, 'BUG', 'drill transmission', 'synthetic drill row', ${DRILL_SCREENSHOT},
                    'image/png', 'drill.png', 'OVERVIEW', '90D', 'V1.3.0')`
  // ephemeral rows — must NOT survive the backup
  await sql`insert into auth_sessions (sid, user_id, expires_at) values ('drill-sid', ${uid}, now() + interval '1 day')`
  await sql`insert into webhook_deliveries (delivery_id, event) values ('drill-delivery', 'push')`
  await sql`insert into security_events (event, severity, route, method, status, reason_code)
            values ('logout_completed', 'info', '/api/auth/logout', 'POST', 200, null)`
  // Sentinel outside the allowlist — proves the dump cannot pick up
  // unrelated schemas/tables (Supabase internals, unclassified app tables).
  await sql`create schema drill_internal`
  await sql`create table drill_internal.do_not_backup (marker text)`
  await sql`insert into drill_internal.do_not_backup values ('must-not-survive')`
  return { uid, repoId }
}

// Archive TOC proof: pg_restore --list shows exactly which TABLE DATA
// entries exist — asserts allowlist-only with no unrelated/excluded schema.
function tocProblems(dumpPath, serverMajor, env) {
  const problems = []
  const toc = runPgTool('pg_restore', serverMajor, env, ['--list'],
    { input: fs.readFileSync(dumpPath) }).stdout
  const dumped = [...toc.matchAll(/TABLE DATA public (\S+)/g)].map((m) => m[1])
  for (const t of BACKED_UP) {
    if (!dumped.includes(t)) problems.push(`TOC missing expected table ${t}`)
  }
  for (const t of dumped) {
    if (!BACKED_UP.includes(t)) problems.push(`TOC contains unclassified table ${t}`)
  }
  if (/drill_internal/.test(toc)) problems.push('drill_internal leaked into the archive')
  return problems
}

async function verify(src, dst, ids, extraProblems = []) {
  const problems = [...extraProblems]
  const check = (ok, msg) => { if (!ok) problems.push(msg) }

  // the unclassified sentinel must not exist in the restored database
  const [sent] = await dst`
    select count(*)::int c from information_schema.tables
    where table_schema = 'drill_internal'`
  check(sent.c === 0, 'drill_internal.do_not_backup present after restore')

  // core + operational data round-tripped
  for (const t of BACKED_UP) {
    const [a] = await src`select count(*)::int c from ${src(t)}`
    const [b] = await dst`select count(*)::int c from ${dst(t)}`
    check(a.c === b.c && a.c > 0, `${t}: src ${a.c} rows, dst ${b.c} (expected equal, nonzero)`)
  }
  // ephemeral tables exist but start empty
  for (const t of ['auth_sessions', 'webhook_deliveries', 'security_events']) {
    const [b] = await dst`select count(*)::int c from ${dst(t)}`
    check(b.c === 0, `${t}: expected empty after restore, found ${b.c}`)
  }
  // schema_migrations rebuilt by the runner, not the dump
  const [mig] = await dst`select count(*)::int c from schema_migrations`
  check(mig.c === MIGRATION_COUNT, `schema_migrations: expected ${MIGRATION_COUNT} rows, found ${mig.c}`)

  // feedback field-level round-trip — counts alone would miss a bytea that
  // silently corrupted across the dump/restore boundary.
  const [fb] = await dst`
    select user_id, type, title, description, encode(screenshot, 'hex') as shot_hex,
           screenshot_mime, screenshot_name, page, selected_range, build
    from feedback`
  check(fb?.user_id === ids.uid, 'feedback user_id did not round-trip')
  check(fb?.type === 'BUG' && fb?.title === 'drill transmission' && fb?.description === 'synthetic drill row',
    'feedback type/title/description did not round-trip')
  check(fb?.shot_hex === DRILL_SCREENSHOT.toString('hex'),
    'feedback screenshot bytes differ after restore')
  check(fb?.screenshot_mime === 'image/png' && fb?.screenshot_name === 'drill.png',
    'feedback screenshot metadata did not round-trip')
  check(fb?.page === 'OVERVIEW' && fb?.selected_range === '90D' && fb?.build === 'V1.3.0',
    'feedback context fields did not round-trip')

  // FK integrity + uuid round-trip
  const [orphans] = await dst`select count(*)::int c from commits c left join repositories r on c.repository_id = r.id where r.id is null`
  check(orphans.c === 0, 'commits → repositories FK orphaned rows')
  const [u] = await dst`select id from users where github_login = 'drill-user'`
  check(u?.id === ids.uid, 'user uuid did not round-trip')

  // security posture survives: RLS on, browser roles denied, service_role granted
  const rls = await dst`
    select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and relrowsecurity`
  const rlsSet = new Set(rls.map((r) => r.relname))
  for (const t of DATA_TABLES) check(rlsSet.has(t), `RLS not enabled on ${t}`)

  const grants = await dst`
    select grantee, table_name, privilege_type from information_schema.role_table_grants
    where table_schema = 'public' and grantee in ('anon', 'authenticated')`
  const appGrants = grants.filter((g) => DATA_TABLES.includes(g.table_name))
  check(appGrants.length === 0, `anon/authenticated hold grants: ${JSON.stringify(appGrants)}`)

  const sr = await dst`
    select privilege_type from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'commits' and grantee = 'service_role'`
  check(sr.some((g) => g.privilege_type === 'SELECT'), 'service_role missing SELECT on commits')

  // Behavioral proof, not just grant inspection: switch into each role the
  // way Supabase's authenticator does and actually read an app table.
  for (const role of ['anon', 'authenticated']) {
    try {
      await dst.unsafe(`set role ${role}`)
      await dst`select count(*) from users`
      problems.push(`${role} read users — RLS/grants broken`)
    } catch {
      // expected — no grants and RLS denies
    } finally {
      await dst.unsafe('reset role').catch(() => {})
    }
  }
  try {
    await dst.unsafe('set role service_role')
    await dst`select count(*) from commits`
  } catch {
    problems.push('service_role could not read commits — BYPASSRLS/grants broken')
  } finally {
    await dst.unsafe('reset role').catch(() => {})
  }

  // functions are SECURITY INVOKER (prosecdef = false), views are security_invoker
  const fns = await dst`
    select proname, prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and proname like 'dash_%'`
  check(fns.length >= 3, 'dash_* functions missing after restore')
  for (const f of fns) check(f.prosecdef === false, `${f.proname} is SECURITY DEFINER`)
  const views = await dst`
    select relname, reloptions from pg_class where relkind = 'v' and relname in ('dash_repo_monthly', 'dash_span')`
  for (const v of views) check((v.reloptions || []).join(',').includes('security_invoker'), `${v.relname} missing security_invoker`)

  // privacy-removed column stays removed; identity sequence live post-restore
  const [col] = await dst`select count(*)::int c from information_schema.columns where table_name = 'pull_requests' and column_name = 'title'`
  check(col.c === 0, 'pull_requests.title exists — privacy removal lost')
  await dst`insert into security_events (event, severity) values ('security_internal_error', 'warning')`
  const [se] = await dst`select count(*)::int c from security_events`
  check(se.c === 1, 'security_events insert failed — identity sequence broken?')
  await dst`delete from security_events`

  return problems
}

async function main() {
  loadOperatorEnv()
  const admin = drillUrl()
  const ids = { uid: null, repoId: null }

  const sqlAdmin = postgres(admin, { onnotice: () => {} })
  let serverMajor
  try {
    const [{ server_version_num }] = await sqlAdmin`show server_version_num`
    serverMajor = Math.floor(Number(server_version_num) / 10000)
    console.log(`drill: postgres server major ${serverMajor}`)

    // Supabase-compatible roles the migrations grant/revoke against.
    // service_role is BYPASSRLS — the real managed role has rolbypassrls,
    // and the behavioral SET ROLE checks below depend on it.
    for (const role of ['anon', 'authenticated']) {
      const [{ exists }] = await sqlAdmin`select exists(select from pg_roles where rolname = ${role})`
      if (!exists) await sqlAdmin.unsafe(`create role ${role} nologin`)
    }
    const [{ exists: srExists }] = await sqlAdmin`select exists(select from pg_roles where rolname = 'service_role')`
    if (!srExists) await sqlAdmin.unsafe('create role service_role nologin bypassrls')

    for (const db of ['drill_src', 'drill_dst']) {
      await sqlAdmin`drop database if exists ${sqlAdmin.unsafe(db)} with (force)`
      await sqlAdmin`create database ${sqlAdmin.unsafe(db)}`
    }
  } finally {
    await sqlAdmin.end()
  }

  const srcUrl = dbAt(admin, 'drill_src')
  const dstUrl = dbAt(admin, 'drill_dst')

  try {
    console.log('drill: applying migrations to drill_src')
    migrate(srcUrl)
    const src = postgres(srcUrl, { onnotice: () => {} })
    const seeded = await seed(src)
    Object.assign(ids, seeded)
    await src.end()
    console.log('drill: seeded synthetic rows (user, repo, commit, PR, sync state, ephemeral rows)')

    // same backup path the operator uses
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-drill-'))
    run(process.execPath, ['scripts/backup-db.mjs'], { DATABASE_URL: srcUrl, BACKUP_DIR: tmp })
    const dump = fs.readdirSync(tmp).find((f) => f.endsWith('.dump'))
    if (!dump) fail('backup produced no .dump artifact')
    console.log(`drill: backup produced ${dump}`)

    console.log('drill: applying migrations to drill_dst')
    migrate(dstUrl)
    // Same restore shape the hosted runbook prescribes — FK constraints
    // ACTIVE (no --disable-triggers: its emitted commands need superuser,
    // which the managed Supabase postgres role does not have). Archive
    // dependency ordering handles the FK graph; --single-transaction makes
    // the fresh-target restore all-or-nothing.
    const dumpPath = path.join(tmp, dump)
    runPgTool('pg_restore', serverMajor, pgEnv(dstUrl), [
      '--data-only', '--no-owner', '--no-privileges',
      '--single-transaction', '--exit-on-error',
      `--dbname=${pgEnv(dstUrl).PGDATABASE}`,
    ], { input: fs.readFileSync(dumpPath) })
    console.log('drill: restore complete — verifying')

    const src2 = postgres(srcUrl, { onnotice: () => {} })
    const dst = postgres(dstUrl, { onnotice: () => {} })
    const toc = tocProblems(dumpPath, serverMajor, pgEnv(srcUrl))
    const problems = await verify(src2, dst, ids, toc)
    await src2.end(); await dst.end()

    fs.rmSync(tmp, { recursive: true, force: true })

    if (problems.length) {
      for (const p of problems) console.error(`  FAIL ${p}`)
      fail(`${problems.length} verification problem(s)`)
    }
    console.log('drill: PASS — synthetic backup → migrate → restore round-trip verified')
    console.log('  core/operational rows preserved, FKs intact, uuids stable')
    console.log('  RLS enabled, anon/authenticated denied, service_role scoped')
    console.log('  auth_sessions/webhook_deliveries/security_events start empty')
    console.log('  privacy column (pull_requests.title) absent, sequences live')
  } finally {
    const cleanup = postgres(admin, { onnotice: () => {} })
    try {
      for (const db of ['drill_src', 'drill_dst']) {
        await cleanup`drop database if exists ${cleanup.unsafe(db)} with (force)`
      }
    } finally {
      await cleanup.end()
    }
    console.log('drill: scratch databases dropped')
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
if (isMain) {
  main().catch((e) => {
    console.error('drill failed:', e.message)
    process.exit(1)
  })
}
