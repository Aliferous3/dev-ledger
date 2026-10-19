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
import { checkpointingProofs } from './ownership-checkpoint-proofs.mjs'

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
  await sql`insert into pull_requests (user_id, repository_id, github_pr_id, state, created_at)
            values (${uid}, ${repoId}, 777, 'merged', now())`
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
  // ── ownership rows (synthetic fixtures — NOT production ingestion) ──
  // Covers every row shape: repo scope, dir scope, linked/unlinked/
  // aggregate contributors, monthly + head contributor and scope-total
  // snapshots, per-version scope membership, a mid-build V2 (building)
  // version, ephemeral work rows, and sync state at active_version=1.
  const scopeRepo = crypto.randomUUID()
  const scopeDir = crypto.randomUUID()
  const cLinked = crypto.randomUUID()
  const cUnlinked = crypto.randomUUID()
  const cOther = crypto.randomUUID()
  await sql`insert into ownership_scopes (id, user_id, repository_id, scope_path_hash, display_path, scope_type, depth)
            values (${scopeRepo}, ${uid}, ${repoId}, 'h-repo', null, 'repo', 0)`
  await sql`insert into ownership_scopes (id, user_id, repository_id, scope_path_hash, display_path, scope_type, depth)
            values (${scopeDir}, ${uid}, ${repoId}, 'h-src-api', 'src/api', 'dir', 2)`
  await sql`insert into ownership_contributors (id, user_id, repository_id, contributor_key, identity_kind, github_node_id, display_login)
            values (${cLinked}, ${uid}, ${repoId}, 'k-alice', 'linked', 'MDQ6VXNlcjExMQ==', 'alice')`
  await sql`insert into ownership_contributors (id, user_id, repository_id, contributor_key, identity_kind)
            values (${cUnlinked}, ${uid}, ${repoId}, 'unlinked', 'unlinked')`
  await sql`insert into ownership_contributors (id, user_id, repository_id, contributor_key, identity_kind)
            values (${cOther}, ${uid}, ${repoId}, 'other', 'aggregate')`
  // version membership precedes snapshots — the composite FK requires it
  await sql`insert into ownership_scope_versions (user_id, repository_id, scope_id, calculation_version)
            values (${uid}, ${repoId}, ${scopeRepo}, 1)`
  await sql`insert into ownership_scope_versions (user_id, repository_id, scope_id, calculation_version)
            values (${uid}, ${repoId}, ${scopeDir}, 1)`
  // building V2: committed scope snapshot + membership + ephemeral state —
  // the backup carries the CORE rows only; restore leaves an abandoned-
  // candidate building version whose canonical cleanup is proven below
  await sql`insert into ownership_scope_versions (user_id, repository_id, scope_id, calculation_version)
            values (${uid}, ${repoId}, ${scopeDir}, 2)`
  await sql`insert into ownership_snapshots
            (user_id, repository_id, scope_id, contributor_id, period_granularity, period_start,
             touch_commits, touch_share, calculation_version)
            values (${uid}, ${repoId}, ${scopeDir}, ${cLinked}, 'month', '2026-10-01T00:00:00Z', 4, 0.4, 2)`
  await sql`insert into ownership_history_work
            (user_id, repository_id, scope_id, calculation_version, period_start, work_key, is_bot, touch_commits)
            values (${uid}, ${repoId}, ${scopeDir}, 2, '2026-10-01T00:00:00Z',
                    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', false, 4)`
  await sql`insert into ownership_contributor_build_work
            (user_id, repository_id, calculation_version, work_key, github_node_id, display_login, is_bot)
            values (${uid}, ${repoId}, 2,
                    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'MDQ6VXNlcjExMQ==', 'alice', false)`
  await sql`insert into ownership_snapshots
            (user_id, repository_id, scope_id, contributor_id, period_granularity, period_start,
             touch_commits, touch_share, calculation_version)
            values (${uid}, ${repoId}, ${scopeDir}, ${cLinked}, 'month', '2026-09-01T00:00:00Z', 12, 0.5, 1)`
  await sql`insert into ownership_snapshots
            (user_id, repository_id, scope_id, contributor_id, period_granularity, period_start,
             total_touch_commits, human_contributor_count, unlinked_touch_share, calculation_version)
            values (${uid}, ${repoId}, ${scopeDir}, null, 'month', '2026-09-01T00:00:00Z', 24, 3, 0.2, 1)`
  await sql`insert into ownership_snapshots
            (user_id, repository_id, scope_id, contributor_id, period_granularity, period_start,
             surviving_lines, surviving_line_share, recent_touch_commits, last_meaningful_touch, calculation_version)
            values (${uid}, ${repoId}, ${scopeDir}, ${cLinked}, 'head', '1970-01-01T00:00:00Z', 500, 0.31, 5, now(), 1)`
  await sql`insert into ownership_snapshots
            (user_id, repository_id, scope_id, contributor_id, period_granularity, period_start,
             human_contributor_count, recent_human_maintainer_count, top_human_contributor_share,
             total_surviving_lines, unlinked_surviving_line_share, calculation_version)
            values (${uid}, ${repoId}, ${scopeDir}, null, 'head', '1970-01-01T00:00:00Z', 4, 2, 0.42, 1613, 0.15, 1)`
  await sql`insert into ownership_sync_state (user_id, repository_id, phase, active_version, building_version)
            values (${uid}, ${repoId}, 'done', 1, 2)`

  // Sentinel outside the allowlist — proves the dump cannot pick up
  // unrelated schemas/tables (Supabase internals, unclassified app tables).
  await sql`create schema drill_internal`
  await sql`create table drill_internal.do_not_backup (marker text)`
  await sql`insert into drill_internal.do_not_backup values ('must-not-survive')`
  return { uid, repoId, scopeRepo, scopeDir, cLinked, cUnlinked, cOther }
}

// ── ownership schema proofs against real Postgres ────────────────────────
// Runs on drill_src BEFORE the backup: negative inserts all fail at the
// constraint/FK level (no rows persist), and throwaway tenants prove repo +
// user cascade and the version serve-gate. Net DB effect is zero.
//
// mustFail asserts the SPECIFIC constraint that fired — a malformed insert
// (wrong column count, NOT NULL on an unrelated field) cannot masquerade
// as a passing invariant proof.
async function ownershipProofs(sql, { uid, repoId, scopeDir, cLinked, cOther }) {
  const problems = []
  const check = (ok, msg) => { if (!ok) problems.push(msg) }
  const mustFail = async (fn, label, expected = null) => {
    try {
      await fn()
      problems.push(`${label}: insert/update must have been rejected`)
    } catch (e) {
      if (!expected) return
      const names = [].concat(expected.name)
      const cname = e.constraint_name || e.constraint || ''
      const code = e.code || ''
      const msg = String(e.message || '')
      const hit = names.some((n) => cname === n || msg.includes(n))
      if (!hit) {
        problems.push(`${label}: expected constraint ${names.join('/')} `
          + `(${expected.code || 'any'}), got ${cname || code || msg.slice(0, 80)}`)
      }
      if (expected.code && code !== expected.code) {
        problems.push(`${label}: expected SQLSTATE ${expected.code}, got ${code || 'none'}`)
      }
    }
  }
  const CHK = (name) => ({ name, code: '23514' })   // check_violation
  const FK = (name) => ({ name, code: '23503' })    // foreign_key_violation

  // ── tenant mismatch: database must reject cross-tenant/cross-repo pairs.
  // Every attempted row is otherwise structurally valid so the ONLY thing
  // that can fire is the intended composite FK.
  const uidB = crypto.randomUUID()
  const repoB = crypto.randomUUID()
  const scopeB = crypto.randomUUID()
  const cB = crypto.randomUUID()
  await sql`insert into users (id, github_user_id, github_login) values (${uidB}, 43434343, 'drill-tenant-b')`
  await sql`insert into repositories (id, user_id, github_repo_id, owner_login, name, full_name)
            values (${repoB}, ${uidB}, 323232, 'drill-tenant-b', 'repo-b', 'drill-tenant-b/repo-b')`
  // valid repo-B ownership fixtures for isolated composite-FK proofs
  await sql`insert into ownership_scopes (id, user_id, repository_id, scope_path_hash, scope_type, depth)
            values (${scopeB}, ${uidB}, ${repoB}, 'h-b', 'repo', 0)`
  await sql`insert into ownership_contributors (id, user_id, repository_id, contributor_key, identity_kind, github_node_id, display_login)
            values (${cB}, ${uidB}, ${repoB}, 'k-bob', 'linked', 'MDQ6VXNlcjIyMg==', 'bob')`

  await mustFail(() => sql`insert into ownership_scopes
    (user_id, repository_id, scope_path_hash, scope_type, depth)
    values (${uid}, ${repoB}, 'x', 'repo', 0)`,
    'tenant A user_id + tenant B repository_id (scope)', FK('ownership_scopes_repo_tenant'))
  await mustFail(() => sql`insert into ownership_contributors
    (user_id, repository_id, contributor_key, identity_kind, github_node_id, display_login)
    values (${uid}, ${repoB}, 'k-b2', 'linked', 'MDQ6VXNlcjIyMw==', 'bob2')`,
    'tenant mismatch contributor', FK('ownership_contributors_repo_tenant'))
  // scope isolation: scope belongs to repo A, repository_id claims repo B,
  // contributor NULL (scope-total shape), fresh period so the unique key
  // cannot collide — only scope_repo FK can fire.
  await mustFail(() => sql`insert into ownership_snapshots
    (user_id, repository_id, scope_id, contributor_id, period_granularity, period_start,
     total_touch_commits, human_contributor_count, calculation_version)
    values (${uidB}, ${repoB}, ${scopeDir}, null, 'month', '2026-11-01T00:00:00Z', 3, 1, 1)`,
    'snapshot: scope from repo A + repository_id repo B', FK('ownership_snapshots_scope_repo'))
  // contributor isolation: scope belongs to repo B (consistent), contributor
  // belongs to repo A — only contrib_repo FK can fire.
  await mustFail(() => sql`insert into ownership_snapshots
    (user_id, repository_id, scope_id, contributor_id, period_granularity, period_start,
     touch_commits, calculation_version)
    values (${uidB}, ${repoB}, ${scopeB}, ${cLinked}, 'month', '2026-09-01T00:00:00Z', 1, 1)`,
    'snapshot: contributor from repo A + repository_id repo B', FK('ownership_snapshots_contrib_repo'))
  await mustFail(() => sql`insert into ownership_sync_state (user_id, repository_id)
    values (${uid}, ${repoB})`, 'tenant mismatch sync_state', FK('ownership_sync_state_repo_tenant'))

  // ── scope shape / type guards — structurally valid rows that violate
  // exactly the named invariant
  // 'file' violates both the type enum and the shape guard — either may be
  // reported; what matters is that no file scope can ever exist.
  await mustFail(() => sql`insert into ownership_scopes
    (user_id, repository_id, scope_path_hash, display_path, scope_type, depth)
    values (${uid}, ${repoId}, 'f', 'a.ts', 'file', 1)`, 'file scope type',
    CHK(['ownership_scopes_type', 'ownership_scopes_shape']))
  await mustFail(() => sql`insert into ownership_scopes
    (user_id, repository_id, scope_path_hash, display_path, scope_type, depth)
    values (${uid}, ${repoId}, 'd0', 'x', 'dir', 0)`, 'dir depth 0', CHK('ownership_scopes_shape'))
  await mustFail(() => sql`insert into ownership_scopes
    (user_id, repository_id, scope_path_hash, display_path, scope_type, depth)
    values (${uid}, ${repoId}, 'd5', 'a/b/c/d/e', 'dir', 5)`, 'dir depth 5', CHK('ownership_scopes_shape'))
  await mustFail(() => sql`insert into ownership_scopes
    (user_id, repository_id, scope_path_hash, display_path, scope_type, depth)
    values (${uid}, ${repoId}, 'rp', 'src/x', 'repo', 0)`, 'repo scope with path', CHK('ownership_scopes_shape'))
  await mustFail(() => sql`insert into ownership_scopes
    (user_id, repository_id, scope_path_hash, display_path, scope_type, depth, excluded, exclusion_reason)
    values (${uid}, ${repoId}, 'ex1', 'vendor/x', 'dir', 1, true, 'vendor')`,
    'exclusion_reason vendor', CHK('ownership_scopes_exclusion'))
  await mustFail(() => sql`insert into ownership_scopes
    (user_id, repository_id, scope_path_hash, display_path, scope_type, depth, excluded, exclusion_reason)
    values (${uid}, ${repoId}, 'ex2', 'x/y', 'dir', 1, false, 'cardinality_cap')`,
    'excluded=false with reason', CHK('ownership_scopes_exclusion'))
  // legal cardinality_cap row is allowed — insert then delete to keep seed counts
  const capId = crypto.randomUUID()
  await sql`insert into ownership_scopes (id, user_id, repository_id, scope_path_hash, display_path, scope_type, depth, excluded, exclusion_reason)
            values (${capId}, ${uid}, ${repoId}, 'h-deep', 'a/b/c/d', 'dir', 4, true, 'cardinality_cap')`
  await sql`delete from ownership_scopes where id = ${capId}`

  // ── identity-shape guards
  await mustFail(() => sql`insert into ownership_contributors
    (user_id, repository_id, contributor_key, identity_kind, github_node_id, display_login)
    values (${uid}, ${repoId}, 'k-noid', 'linked', null, 'bob')`,
    'linked without node id', CHK('ownership_contributors_linked'))
  await mustFail(() => sql`insert into ownership_contributors
    (user_id, repository_id, contributor_key, identity_kind, github_node_id, display_login)
    values (${uid}, ${repoId}, 'k-nologin', 'linked', 'MDQ6VXNlcjMzMw==', null)`,
    'linked without login', CHK('ownership_contributors_linked'))
  // reserved synthetic keys can never be squatted by a linked row
  await mustFail(() => sql`insert into ownership_contributors
    (user_id, repository_id, contributor_key, identity_kind, github_node_id, display_login)
    values (${uid}, ${repoId}, 'unlinked', 'linked', 'MDQ6VXNlcjMzNA==', 'squatter')`,
    'linked row keying unlinked', CHK('ownership_contributors_linked'))
  await mustFail(() => sql`insert into ownership_contributors
    (user_id, repository_id, contributor_key, identity_kind, github_node_id, display_login)
    values (${uid}, ${repoId}, 'other', 'linked', 'MDQ6VXNlcjMzNQ==', 'squatter')`,
    'linked row keying other', CHK('ownership_contributors_linked'))
  await mustFail(() => sql`insert into ownership_contributors
    (user_id, repository_id, contributor_key, identity_kind, github_node_id, display_login)
    values (${uid}, ${repoId}, 'unlinked2', 'unlinked', 'MDQ6VXNlcjQ0NA==', null)`,
    'unlinked with node id', CHK('ownership_contributors_unlinked'))
  await mustFail(() => sql`insert into ownership_contributors
    (user_id, repository_id, contributor_key, identity_kind)
    values (${uid}, ${repoId}, 'k-x', 'unlinked')`, 'unlinked with wrong key', CHK('ownership_contributors_unlinked'))
  await mustFail(() => sql`insert into ownership_contributors
    (user_id, repository_id, contributor_key, identity_kind, is_bot)
    values (${uid}, ${repoId}, 'other2', 'aggregate', false)`, 'aggregate with wrong key', CHK('ownership_contributors_aggregate'))
  // violates both the unlinked shape (is_bot=false) and the linked-only bot
  // rule — either constraint may be reported.
  await mustFail(() => sql`insert into ownership_contributors
    (user_id, repository_id, contributor_key, identity_kind, is_bot)
    values (${uid}, ${repoId}, 'unlinked-bot', 'unlinked', true)`, 'is_bot on unlinked',
    CHK(['ownership_contributors_unlinked', 'ownership_contributors_bot']))
  // bot must be linked — this insert is legal
  const botId = crypto.randomUUID()
  await sql`insert into ownership_contributors (id, user_id, repository_id, contributor_key, identity_kind, github_node_id, display_login, is_bot)
            values (${botId}, ${uid}, ${repoId}, 'k-bot', 'linked', 'MDQ6VXNlcjU1NQ==', 'dependabot[bot]', true)`
  await sql`delete from ownership_contributors where id = ${botId}`

  // ── snapshot guards
  await mustFail(() => sql`insert into ownership_snapshots
    (user_id, repository_id, scope_id, contributor_id, period_granularity, period_start, touch_commits, calculation_version)
    values (${uid}, ${repoId}, ${scopeDir}, ${cLinked}, 'month', '2026-09-01T00:00:00Z', 5, 0)`,
    'calculation_version 0', CHK('ownership_snapshots_version'))
  await mustFail(() => sql`insert into ownership_snapshots
    (user_id, repository_id, scope_id, contributor_id, period_granularity, period_start, touch_share, calculation_version)
    values (${uid}, ${repoId}, ${scopeDir}, ${cLinked}, 'month', '2026-09-01T00:00:00Z', 1.5, 1)`,
    'share > 1', CHK('ownership_snapshots_shares'))
  await mustFail(() => sql`insert into ownership_snapshots
    (user_id, repository_id, scope_id, contributor_id, period_granularity, period_start, touch_commits, calculation_version)
    values (${uid}, ${repoId}, ${scopeDir}, ${cLinked}, 'month', '2026-09-15T00:00:00Z', 1, 1)`,
    'month not first-of-month', CHK('ownership_snapshots_period'))
  await mustFail(() => sql`insert into ownership_snapshots
    (user_id, repository_id, scope_id, contributor_id, period_granularity, period_start, surviving_lines, calculation_version)
    values (${uid}, ${repoId}, ${scopeDir}, ${cLinked}, 'head', '2026-01-01T00:00:00Z', 1, 1)`,
    'head without sentinel period_start', CHK('ownership_snapshots_period'))
  await mustFail(() => sql`insert into ownership_snapshots
    (user_id, repository_id, scope_id, contributor_id, period_granularity, period_start, touch_commits, surviving_lines, calculation_version)
    values (${uid}, ${repoId}, ${scopeDir}, ${cLinked}, 'month', '2026-09-01T00:00:00Z', 3, 7, 1)`,
    'monthly contributor row carrying head fields', CHK('ownership_snapshots_shape'))
  await mustFail(() => sql`insert into ownership_snapshots
    (user_id, repository_id, scope_id, contributor_id, period_granularity, period_start, surviving_lines, touch_commits, calculation_version)
    values (${uid}, ${repoId}, ${scopeDir}, ${cLinked}, 'head', '1970-01-01T00:00:00Z', 5, 3, 1)`,
    'head contributor row carrying monthly fields', CHK('ownership_snapshots_shape'))
  await mustFail(() => sql`insert into ownership_snapshots
    (user_id, repository_id, scope_id, contributor_id, period_granularity, period_start, total_touch_commits, touch_commits, calculation_version)
    values (${uid}, ${repoId}, ${scopeDir}, null, 'month', '2026-10-01T00:00:00Z', 4, 4, 1)`,
    'scope-total row carrying contributor fields', CHK('ownership_snapshots_shape'))

  // ── month boundary is UTC, not session-timezone ──
  // On a dedicated connection (reserved so SET TIME ZONE sticks): in
  // Asia/Dubai, 2026-08-31T20:00:00Z is local-midnight Sep 1 — it must be
  // REJECTED while true UTC boundary 2026-09-01T00:00:00Z is accepted.
  {
    const conn = await sql.reserve()
    try {
      await conn`set time zone 'Asia/Dubai'`
      const okId = crypto.randomUUID()
      await conn`insert into ownership_snapshots
        (id, user_id, repository_id, scope_id, contributor_id, period_granularity, period_start, touch_commits, calculation_version)
        values (${okId}, ${uid}, ${repoId}, ${scopeDir}, ${cLinked}, 'month', '2026-10-01T00:00:00Z', 2, 1)`
      await conn`delete from ownership_snapshots where id = ${okId}`
      let rejected = false
      try {
        await conn`insert into ownership_snapshots
          (user_id, repository_id, scope_id, contributor_id, period_granularity, period_start, touch_commits, calculation_version)
          values (${uid}, ${repoId}, ${scopeDir}, ${cLinked}, 'month', '2026-08-31T20:00:00Z', 2, 1)`
      } catch (e) {
        rejected = String(e.message || '').includes('ownership_snapshots_period')
          || (e.constraint_name || e.constraint) === 'ownership_snapshots_period'
        if (!rejected) problems.push(`non-UTC boundary rejected by wrong constraint: ${e.message}`)
      }
      if (!rejected) problems.push('Asia/Dubai-local midnight 2026-08-31T20:00Z was accepted as month boundary — UTC check broken')
      await conn`reset time zone`
    } finally {
      conn.release()
    }
  }

  // ── sync_state guards
  await mustFail(() => sql`insert into ownership_sync_state (user_id, repository_id, phase)
    values (${uid}, ${repoId}, 'bogus')`, 'invalid phase', CHK('ownership_sync_state_phase'))
  await mustFail(() => sql`insert into ownership_sync_state (user_id, repository_id, error)
    values (${uid}, ${repoId}, 'ECONNRESET upstream socket hangup')`, 'raw error text', CHK('ownership_sync_state_error'))
  await mustFail(() => sql`insert into ownership_sync_state (user_id, repository_id, active_version, building_version)
    values (${uid}, ${repoId}, 1, 1)`, 'active = building', CHK('ownership_sync_state_versions'))
  // closed-taxonomy error is legal
  await sql`update ownership_sync_state set error = 'OWNERSHIP_BLAME_FAILED' where user_id = ${uid} and repository_id = ${repoId}`
  await sql`update ownership_sync_state set error = null where user_id = ${uid} and repository_id = ${repoId}`

  // ── version coexistence: v1 and v3 rows may coexist in storage
  // (v3 used here so the seeded building-V2 state survives to the backup)
  await sql`insert into ownership_scope_versions (user_id, repository_id, scope_id, calculation_version)
            values (${uid}, ${repoId}, ${scopeDir}, 3)`
  await sql`insert into ownership_snapshots
            (user_id, repository_id, scope_id, contributor_id, period_granularity, period_start,
             touch_commits, touch_share, calculation_version)
            values (${uid}, ${repoId}, ${scopeDir}, ${cLinked}, 'month', '2026-09-01T00:00:00Z', 99, 0.9, 3)`
  // RPC must still serve only active v1 (touch_commits 12, not 99)
  const tl = await sql`select touch_commits from dash_ownership_timeline(${uid}, ${repoId}, 'h-src-api')
                       where display_login = 'alice'`
  check(tl.length === 1 && Number(tl[0].touch_commits) === 12,
    `timeline served ${tl.length} rows with touch_commits ${tl[0]?.touch_commits} — expected exactly 1 row at v1 value 12`)
  const headRows = await sql`select * from dash_ownership_head(${uid}, ${repoId}, 'h-src-api')`
  check(headRows.length === 1 && headRows[0].display_login === 'alice' && Number(headRows[0].surviving_lines) === 500,
    'dash_ownership_head served wrong rows')
  check(headRows[0] && !('github_node_id' in headRows[0]) && !('contributor_key' in headRows[0]),
    'dash_ownership_head leaked identity internals')
  const scopes = await sql`select * from dash_ownership_scopes(${uid}, ${repoId})`
  check(scopes.length === 2 && scopes.some((s) => s.display_path === 'src/api' && Number(s.total_surviving_lines) === 1613),
    'dash_ownership_scopes served wrong rows')
  await sql`delete from ownership_snapshots where calculation_version = 3`
  await sql`delete from ownership_scope_versions where repository_id = ${repoId} and calculation_version = 3`

  // ── bootstrap + promotion + rebuild lifecycle on a throwaway tenant
  const uidC = crypto.randomUUID()
  const repoC = crypto.randomUUID()
  const scopeC = crypto.randomUUID()
  const cC = crypto.randomUUID()
  await sql`insert into users (id, github_user_id, github_login) values (${uidC}, 45454545, 'drill-tenant-c')`
  await sql`insert into repositories (id, user_id, github_repo_id, owner_login, name, full_name)
            values (${repoC}, ${uidC}, 333333, 'drill-tenant-c', 'repo-c', 'drill-tenant-c/repo-c')`
  await sql`insert into ownership_scopes (id, user_id, repository_id, scope_path_hash, scope_type, depth)
            values (${scopeC}, ${uidC}, ${repoC}, 'h-root', 'repo', 0)`
  await sql`insert into ownership_contributors (id, user_id, repository_id, contributor_key, identity_kind, github_node_id, display_login)
            values (${cC}, ${uidC}, ${repoC}, 'k-carol', 'linked', 'MDQ6VXNlcjY2Ng==', 'carol')`
  await sql`insert into ownership_scope_versions (user_id, repository_id, scope_id, calculation_version)
            values (${uidC}, ${repoC}, ${scopeC}, 1)`
  await sql`insert into ownership_snapshots
            (user_id, repository_id, scope_id, contributor_id, period_granularity, period_start, touch_commits, calculation_version)
            values (${uidC}, ${repoC}, ${scopeC}, ${cC}, 'month', '2026-09-01T00:00:00Z', 7, 1)`
  // FIRST BUILD: active null + building 1 → nothing served
  await sql`insert into ownership_sync_state (user_id, repository_id, phase, active_version, building_version)
            values (${uidC}, ${repoC}, 'history', null, 1)`
  const [{ c: notReady }] = await sql`select count(*)::int c from dash_ownership_scopes(${uidC}, ${repoC})`
  check(notReady === 0, 'partial first build was served — active_version gate broken')
  // PROMOTION: atomic flip → V1 visible
  await sql`update ownership_sync_state set active_version = 1, building_version = null, phase = 'done'
            where user_id = ${uidC} and repository_id = ${repoC}`
  const v1rows = await sql`select touch_commits from dash_ownership_timeline(${uidC}, ${repoC}, 'h-root')`
  check(v1rows.length === 1 && Number(v1rows[0].touch_commits) === 7, 'promoted V1 not visible')
  // RECALC: V2 rows coexist while V1 stays served
  await sql`update ownership_sync_state set building_version = 2 where user_id = ${uidC} and repository_id = ${repoC}`
  await sql`insert into ownership_scope_versions (user_id, repository_id, scope_id, calculation_version)
            values (${uidC}, ${repoC}, ${scopeC}, 2)`
  await sql`insert into ownership_snapshots
            (user_id, repository_id, scope_id, contributor_id, period_granularity, period_start, touch_commits, calculation_version)
            values (${uidC}, ${repoC}, ${scopeC}, ${cC}, 'month', '2026-09-01T00:00:00Z', 42, 2)`
  const stillV1 = await sql`select touch_commits from dash_ownership_timeline(${uidC}, ${repoC}, 'h-root')`
  check(stillV1.length === 1 && Number(stillV1[0].touch_commits) === 7, 'building V2 leaked into served results')
  // FLIP: atomic serve change
  await sql`update ownership_sync_state set active_version = 2, building_version = null
            where user_id = ${uidC} and repository_id = ${repoC}`
  const v2rows = await sql`select touch_commits from dash_ownership_timeline(${uidC}, ${repoC}, 'h-root')`
  check(v2rows.length === 1 && Number(v2rows[0].touch_commits) === 42, 'version flip did not change served results')
  // repo delete cascades every ownership table — single statement, all
  // seven relations including retained membership and both work tables
  await sql`delete from repositories where id = ${repoC}`
  for (const t of ['ownership_scopes', 'ownership_scope_versions', 'ownership_contributors',
    'ownership_snapshots', 'ownership_sync_state', 'ownership_history_work',
    'ownership_contributor_build_work']) {
    const [{ c }] = await sql`select count(*)::int c from ${sql(t)} where repository_id = ${repoC}`
    check(c === 0, `${t} rows survived repository delete (repo cascade broken)`)
  }
  await sql`delete from users where id = ${uidC}`

  // ── user-delete cascade proof on a SEPARATE tenant: the user row is
  // removed directly while its repository + all four ownership tables hold
  // live rows — exercising users -> repositories -> ownership_* through
  // the real FK chain (E).
  const uidD = crypto.randomUUID()
  const repoD = crypto.randomUUID()
  const scopeD = crypto.randomUUID()
  const cD = crypto.randomUUID()
  await sql`insert into users (id, github_user_id, github_login) values (${uidD}, 46464646, 'drill-tenant-d')`
  await sql`insert into repositories (id, user_id, github_repo_id, owner_login, name, full_name)
            values (${repoD}, ${uidD}, 343434, 'drill-tenant-d', 'repo-d', 'drill-tenant-d/repo-d')`
  await sql`insert into ownership_scopes (id, user_id, repository_id, scope_path_hash, scope_type, depth)
            values (${scopeD}, ${uidD}, ${repoD}, 'h-d', 'repo', 0)`
  await sql`insert into ownership_contributors (id, user_id, repository_id, contributor_key, identity_kind, github_node_id, display_login)
            values (${cD}, ${uidD}, ${repoD}, 'k-dana', 'linked', 'MDQ6VXNlcjc3Nw==', 'dana')`
  await sql`insert into ownership_scope_versions (user_id, repository_id, scope_id, calculation_version)
            values (${uidD}, ${repoD}, ${scopeD}, 1)`
  await sql`insert into ownership_snapshots
            (user_id, repository_id, scope_id, contributor_id, period_granularity, period_start, touch_commits, calculation_version)
            values (${uidD}, ${repoD}, ${scopeD}, ${cD}, 'month', '2026-09-01T00:00:00Z', 4, 1)`
  await sql`insert into ownership_sync_state (user_id, repository_id, phase, active_version)
            values (${uidD}, ${repoD}, 'done', 1)`
  await sql`delete from users where id = ${uidD}`   // no repo delete first
  for (const t of ['ownership_scopes', 'ownership_scope_versions', 'ownership_contributors',
    'ownership_snapshots', 'ownership_sync_state', 'ownership_history_work',
    'ownership_contributor_build_work']) {
    const [{ c }] = await sql`select count(*)::int c from ${sql(t)} where user_id = ${uidD}`
    check(c === 0, `${t} rows survived direct user delete (user cascade broken)`)
  }
  const [{ c: repoDLeft }] = await sql`select count(*)::int c from repositories where id = ${repoD}`
  check(repoDLeft === 0, 'repositories row survived user delete')

  // tenant B cleanup — its remaining rows exercise user cascade too
  await sql`delete from users where id = ${uidB}`

  return problems
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

// ── 012→013 upgrade leg ────────────────────────────────────────────────
// Runs against drill_upg, which has ONLY the chain through 012 applied.
// Seeds rows legal under 012 — crucially a snapshot with NO scope-version
// membership (the relation does not exist yet) — then applies the
// remaining migrations and proves the deployed-state upgrade contract:
// data preserved, membership backfilled, FK actions exact, new
// RLS/grants/functions present, teardown cascades intact.
async function upgradeProofs(upg, upgUrl) {
  const problems = []
  const check = (ok, msg) => { if (!ok) problems.push(msg) }

  const uid = crypto.randomUUID()
  const repoId = crypto.randomUUID()
  const scopeId = crypto.randomUUID()
  const contribId = crypto.randomUUID()
  await upg`insert into users (id, github_user_id, github_login) values (${uid}, 47474747, 'drill-upgrade')`
  await upg`insert into repositories (id, user_id, github_repo_id, owner_login, name, full_name)
            values (${repoId}, ${uid}, 353535, 'drill-upgrade', 'repo-u', 'drill-upgrade/repo-u')`
  await upg`insert into ownership_scopes (id, user_id, repository_id, scope_path_hash, display_path, scope_type, depth)
            values (${scopeId}, ${uid}, ${repoId}, 'h-upg', 'pkg', 'dir', 1)`
  await upg`insert into ownership_contributors (id, user_id, repository_id, contributor_key, identity_kind, github_node_id, display_login)
            values (${contribId}, ${uid}, ${repoId}, 'k-upg', 'linked', 'MDQ6VXNlcjg4OA==', 'upguser')`
  // legal under 012 — no membership row can exist
  await upg`insert into ownership_snapshots
            (user_id, repository_id, scope_id, contributor_id, period_granularity, period_start,
             touch_commits, calculation_version)
            values (${uid}, ${repoId}, ${scopeId}, ${contribId}, 'month', '2026-09-01T00:00:00Z', 6, 1)`
  await upg`insert into ownership_sync_state (user_id, repository_id, phase, active_version)
            values (${uid}, ${repoId}, 'done', 1)`
  const [{ c: preSnap }] = await upg`select count(*)::int c from ownership_snapshots`
  check(preSnap === 1, 'upgrade seed failed to create a 012-era snapshot')

  // apply the remainder of the chain (013+)
  run(process.execPath, ['scripts/migrate.mjs'], { DATABASE_URL: upgUrl })

  const [{ c: migC }] = await upg`select count(*)::int c from schema_migrations`
  check(migC === MIGRATION_COUNT, `upgrade applied ${migC} migrations, expected ${MIGRATION_COUNT}`)
  const [{ c: postSnap }] = await upg`select count(*)::int c from ownership_snapshots where repository_id = ${repoId}`
  check(postSnap === 1, '012-era snapshot lost in upgrade')
  const mem = await upg`select calculation_version, excluded from ownership_scope_versions
                        where scope_id = ${scopeId}`
  check(mem.length === 1 && mem[0].calculation_version === 1 && mem[0].excluded === false,
    `membership backfill wrong (${JSON.stringify(mem)})`)

  // exact FK actions — 'a' is NO ACTION in pg_constraint.confdeltype
  const fks = await upg`
    select conname, confdeltype from pg_constraint
    where conname in ('ownership_snapshots_scope_repo',
                      'ownership_snapshots_scope_version',
                      'ownership_scope_versions_scope_repo')`
  check(fks.length === 3, `expected 3 NO ACTION FKs, found ${JSON.stringify(fks)}`)
  for (const f of fks) check(f.confdeltype === 'a', `${f.conname} delete action is ${f.confdeltype}, expected 'a'`)

  // new relations exist with RLS + service-role-only grants
  for (const t of ['ownership_scope_versions', 'ownership_history_work', 'ownership_contributor_build_work']) {
    const [{ c: rlsC }] = await upg`
      select count(*)::int c from pg_class cl join pg_namespace n on n.oid = cl.relnamespace
      where n.nspname = 'public' and cl.relname = ${t} and cl.relrowsecurity`
    check(rlsC === 1, `${t} missing or RLS disabled after upgrade`)
  }
  const newFns = await upg`
    select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and proname like 'own\_%'`
  const fnSet = new Set(newFns.map((f) => f.proname))
  for (const f of ['own_checkpoint_page', 'own_restart_scope', 'own_promote_build',
    'own_abandon_build', 'own_build_preflight', 'own_build_init', 'own_sweep_stale_work']) {
    check(fnSet.has(f), `${f} missing after upgrade`)
  }

  // updated RPC compiles and serves active-version membership
  const scopes = await upg`select scope_path_hash, excluded from dash_ownership_scopes(${uid}, ${repoId})`
  check(scopes.length === 1 && scopes[0].scope_path_hash === 'h-upg',
    `upgraded dash_ownership_scopes served ${JSON.stringify(scopes)}`)

  // single-statement teardown still cascades the whole ownership graph
  await upg`delete from repositories where id = ${repoId}`
  for (const t of ['ownership_scopes', 'ownership_scope_versions', 'ownership_contributors',
    'ownership_snapshots', 'ownership_sync_state', 'ownership_history_work',
    'ownership_contributor_build_work']) {
    const [{ c }] = await upg`select count(*)::int c from ${upg(t)} where repository_id = ${repoId}`
    check(c === 0, `${t} rows survived repository delete post-upgrade`)
  }
  await upg`delete from users where id = ${uid}`

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
  // ephemeral tables exist but start empty — includes both ownership
  // work relations, which never enter the backup
  for (const t of ['auth_sessions', 'webhook_deliveries', 'security_events',
    'ownership_history_work', 'ownership_contributor_build_work']) {
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
  const sro = await dst`
    select privilege_type from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'ownership_scopes' and grantee = 'service_role'`
  check(sro.some((g) => g.privilege_type === 'SELECT') && sro.some((g) => g.privilege_type === 'INSERT'),
    'service_role missing SELECT/INSERT on ownership_scopes')
  // restored ownership RPCs still enforce the serve gate — building-V2
  // membership is invisible under active V1
  const [orow] = await dst`select count(*)::int c from dash_ownership_scopes(${ids.uid}, ${ids.repoId})`
  check(orow.c === 2, `restored dash_ownership_scopes returned ${orow.c}, expected 2`)

  // The seeded building V2 survives restore as an abandonment candidate
  // (its EPHEMERAL work rows do not — the backup omits them). Canonical
  // abandon must cleanly remove the V2 CORE rows without touching V1.
  {
    const [{ building_version }] =
      await dst`select building_version from ownership_sync_state
                where user_id = ${ids.uid} and repository_id = ${ids.repoId}`
    check(building_version === 2, `restored building_version expected 2, got ${building_version}`)
    const [r] = await dst`select own_abandon_build(${ids.uid}, ${ids.repoId}, 2) as r`
    check(r.r === 'abandoned', `restored-build abandon returned ${r.r}`)
    const [{ c: v2snap }] = await dst`select count(*)::int c from ownership_snapshots
                                      where repository_id = ${ids.repoId} and calculation_version = 2`
    const [{ c: v2mem }] = await dst`select count(*)::int c from ownership_scope_versions
                                     where repository_id = ${ids.repoId} and calculation_version = 2`
    const [{ c: v1snap }] = await dst`select count(*)::int c from ownership_snapshots
                                      where repository_id = ${ids.repoId} and calculation_version = 1`
    check(v2snap === 0 && v2mem === 0, 'restored building version not cleaned by abandon')
    check(v1snap === 4, `abandon touched active V1 data (${v1snap} snapshots)`)
    const [{ active_version, building_version: bAfter, phase }] =
      await dst`select active_version, building_version, phase from ownership_sync_state
                where user_id = ${ids.uid} and repository_id = ${ids.repoId}`
    check(active_version === 1 && bAfter === null && phase === 'done',
      `post-abandon sync state wrong (active=${active_version}, building=${bAfter}, phase=${phase})`)
    // active dashboards still serve V1 only after the cleanup
    const [orow2] = await dst`select count(*)::int c from dash_ownership_scopes(${ids.uid}, ${ids.repoId})`
    check(orow2.c === 2, `dash_ownership_scopes changed after abandon (${orow2.c} rows)`)
  }

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

  // privacy-removed columns stay removed; identity sequence live post-restore
  for (const [tbl, col] of [
    ['pull_requests', 'title'], ['pull_requests', 'number'], ['pull_requests', 'author_user_id'],
    ['pull_requests', 'author_login'], ['pull_requests', 'closed_at'],
    ['commits', 'message'], ['commits', 'author_user_id'], ['commits', 'author_login'],
    ['commits', 'authored_at'], ['commits', 'files_changed'], ['commits', 'is_merge'],
  ]) {
    const [c] = await dst`select count(*)::int c from information_schema.columns where table_name = ${tbl} and column_name = ${col}`
    check(c.c === 0, `${tbl}.${col} exists — privacy removal lost`)
  }
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

    for (const db of ['drill_src', 'drill_dst', 'drill_upg']) {
      await sqlAdmin`drop database if exists ${sqlAdmin.unsafe(db)} with (force)`
      await sqlAdmin`create database ${sqlAdmin.unsafe(db)}`
    }
  } finally {
    await sqlAdmin.end()
  }

  const srcUrl = dbAt(admin, 'drill_src')
  const dstUrl = dbAt(admin, 'drill_dst')
  const upgUrl = dbAt(admin, 'drill_upg')

  try {
    console.log('drill: applying migrations to drill_src')
    migrate(srcUrl)
    const src = postgres(srcUrl, { onnotice: () => {} })
    const seeded = await seed(src)
    Object.assign(ids, seeded)
    const oProblems = await ownershipProofs(src, seeded)
    const cProblems = oProblems.length ? [] : await checkpointingProofs(src)
    await src.end()
    const schemaProblems = [...oProblems, ...cProblems]
    if (schemaProblems.length) {
      for (const p of schemaProblems) console.error(`  FAIL ${p}`)
      fail(`${schemaProblems.length} ownership schema proof(s) failed`)
    }
    console.log('drill: seeded synthetic rows (user, repo, commit, PR, sync state, ownership, ephemeral rows)')
    console.log('drill: ownership proofs passed — tenant FKs, shape checks, closed error taxonomy,')
    console.log('       identity kinds, version serve-gate (build/promote/coexist/flip), cascades')
    console.log('drill: checkpointing proofs passed — membership/snapshot composite FK (A–F), NO ACTION')
    console.log('       scope protection (G–I), single-statement teardown (J–L), active-version dashboard')
    console.log('       isolation (M–O), canonical abandon (P–Q), restart staging (R–T), exact-set')
    console.log('       promotion (U–W), retired-version lifecycle gate (X–AA), checkpoint CAS/replay,')
    console.log('       stale/orphan sweep, work-key domain and privacy shape guards')

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
    console.log('  auth_sessions/webhook_deliveries/security_events + ownership work tables start empty')
    console.log('  privacy column (pull_requests.title) absent, sequences live')

    // ── upgrade leg: apply the deployed chain up to 012, seed
    // 012-era ownership rows (legal without membership), then run the
    // remaining migrations — proves the real 012→013 upgrade path
    console.log('drill: upgrade leg — apply chain through 012, seed legacy rows, migrate')
    run(process.execPath, ['scripts/migrate.mjs'],
      { DATABASE_URL: upgUrl, MIGRATE_UP_TO: '012' })
    const upg = postgres(upgUrl, { onnotice: () => {} })
    try {
      const uProblems = await upgradeProofs(upg, upgUrl)
      if (uProblems.length) {
        for (const p of uProblems) console.error(`  FAIL ${p}`)
        fail(`${uProblems.length} upgrade proof(s) failed`)
      }
    } finally {
      await upg.end()
    }
    console.log('drill: upgrade leg PASS — 012-era data preserved, membership backfilled,')
    console.log('  NO ACTION FK actions applied, new RLS/grants/functions live')
  } finally {
    const cleanup = postgres(admin, { onnotice: () => {} })
    try {
      for (const db of ['drill_src', 'drill_dst', 'drill_upg']) {
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
