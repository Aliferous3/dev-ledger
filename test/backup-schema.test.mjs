// Schema-aware backup resolution — unit tests for
// scripts/backup-scope.mjs resolveBackupTables(). Covers the transition
// window where repository main has migration 012 but a target database has
// not applied it yet: the backup must request only the tables the applied
// schema actually created, and fail closed on any broken/inconsistent
// schema state. The live end-to-end path (real Postgres) is exercised by
// scripts/recovery-drill.mjs, whose target is post-012 and therefore backs
// up all allowlisted tables.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  BACKUP_TABLES,
  CORE_TABLES,
  EPHEMERAL_TABLES,
  migrationFiles,
  migrationTables,
  resolveBackupTables,
  validateAppliedMigrationPrefix,
} from '../scripts/backup-scope.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const src = (rel) => readFileSync(path.join(ROOT, rel), 'utf8')

const files = migrationFiles()
const byMig = migrationTables()
// replay creates/drops like expectedTables() does — includes honoring 002's
// drops of 001-era tables
const expected = (applied) => {
  const out = new Set()
  const set = new Set(applied)
  for (const [f, { created, dropped }] of byMig) {
    if (!set.has(f)) continue
    for (const t of dropped) out.delete(t)
    for (const t of created) out.add(t)
  }
  return out
}
const allCreated = expected(files)
const pre012Files = files.filter((f) => !f.startsWith('012'))
const pre012Created = expected(pre012Files)
const OWNERSHIP = ['ownership_scopes', 'ownership_contributors', 'ownership_snapshots', 'ownership_sync_state']

/* ── mapping sanity ──────────────────────────────────────────────────── */

test('migrationTables maps 001..012 to their created/dropped tables', () => {
  assert.ok(files.length >= 12, `expected >=12 migration files, got ${files.length}`)
  assert.deepEqual(files.at(-1), '012_ownership.sql')
  for (const t of OWNERSHIP) assert.ok(byMig.get('012_ownership.sql').created.has(t), `012 must create ${t}`)
  assert.ok(byMig.get('001_initial.sql').created.has('users'))
  assert.ok(byMig.get('001_initial.sql').created.has('repositories'))
  // 001-era tables dropped by 002 must not remain expected
  assert.ok(byMig.get('002_sync_and_analytics.sql').dropped.has('sync_state'))
  assert.ok(byMig.get('002_sync_and_analytics.sql').dropped.has('daily_activity'))
  assert.ok(!allCreated.has('sync_state') && !allCreated.has('daily_activity'),
    'dropped tables must not be expected on the applied schema')
})

/* ── A. pre-012 target ───────────────────────────────────────────────── */

test('PRE-012 target: resolves the 10 pre-012 tables, excludes ownership + unknowns', () => {
  const existing = new Set([...pre012Created, 'drill_internal', 'pg_stat_statements_info'])
  const resolved = resolveBackupTables({ applied: pre012Files, existing })
  assert.equal(resolved.length, BACKUP_TABLES.length - OWNERSHIP.length)
  for (const t of OWNERSHIP) assert.ok(!resolved.includes(t), `${t} must not be requested pre-012`)
  assert.ok(resolved.includes('commits') && resolved.includes('users'), 'old core tables must be included')
  assert.ok(!resolved.includes('drill_internal'), 'unknown table must never be requested')
  assert.deepEqual(resolved, BACKUP_TABLES.filter((t) => !OWNERSHIP.includes(t)),
    'resolution must preserve allowlist ordering')
})

/* ── B. post-012 target ──────────────────────────────────────────────── */

test('POST-012 target: all 14 allowlisted tables resolve', () => {
  const resolved = resolveBackupTables({ applied: files, existing: allCreated })
  assert.deepEqual(resolved, BACKUP_TABLES)
  assert.equal(resolved.length, 14)
})

/* ── C. broken post-012 target fails closed ──────────────────────────── */

test('BROKEN post-012: recorded 012 + missing ownership table fails closed', () => {
  for (const t of OWNERSHIP) {
    const existing = new Set([...allCreated].filter((x) => x !== t))
    assert.throws(
      () => resolveBackupTables({ applied: files, existing }),
      new RegExp(t),
      `missing ${t} with 012 applied must fail`,
    )
  }
})

/* ── D. unknown tables never enter the backup ────────────────────────── */

test('UNKNOWN public tables are never included regardless of schema state', () => {
  const withJunk = new Set([...allCreated, 'unclassified_secret_table', 'pg_toast_thing'])
  const resolved = resolveBackupTables({ applied: files, existing: withJunk })
  assert.deepEqual(resolved, BACKUP_TABLES)
  assert.ok(!resolved.includes('unclassified_secret_table'))
})

/* ── E. required old table missing fails closed ──────────────────────── */

test('missing core table under applied schema fails closed', () => {
  for (const t of ['users', 'repositories', 'commits', 'repo_sync']) {
    const existing = new Set([...allCreated].filter((x) => x !== t))
    assert.throws(
      () => resolveBackupTables({ applied: files, existing }),
      new RegExp(t),
      `missing ${t} must fail closed`,
    )
  }
})

/* ── bookkeeping inconsistencies fail closed ─────────────────────────── */

test('allowlisted table present without recorded migration fails closed', () => {
  // 012 tables exist on disk but 012 is not in schema_migrations — the
  // schema and the bookkeeping disagree; never silently skip the data.
  const existing = new Set(allCreated)
  assert.throws(
    () => resolveBackupTables({ applied: pre012Files, existing }),
    /without a recorded migration/,
  )
})

test('applied filename unknown to this checkout fails closed (ahead-of-checkout)', () => {
  // a target one migration AHEAD of the checkout must never be backed up —
  // the older tool cannot know whether its allowlist is still complete
  assert.throws(
    () => resolveBackupTables({ applied: [...files, '013_future.sql'], existing: allCreated }),
    /ahead of this repository checkout/,
  )
  assert.throws(
    () => resolveBackupTables({ applied: [...files, '999_anything.sql'], existing: allCreated }),
    /ahead of this repository checkout/,
  )
})

/* ── contiguous-prefix validation ────────────────────────────────────── */

test('prefix validator: exact prefixes pass, gaps and unknowns fail', () => {
  // A. exact 001..011 — legitimate lag
  assert.equal(validateAppliedMigrationPrefix(pre012Files), true)
  // B. exact 001..012 — fully migrated
  assert.equal(validateAppliedMigrationPrefix(files), true)
  // C. gap: 005 missing but later migrations applied
  const gapped = files.filter((f) => !f.startsWith('005'))
  assert.throws(() => validateAppliedMigrationPrefix(gapped), /contiguous prefix/)
  // D. 012 recorded while 011 missing
  const noEleven = files.filter((f) => !f.startsWith('011'))
  assert.throws(() => validateAppliedMigrationPrefix(noEleven), /contiguous prefix/)
  // E. unknown future migration
  assert.throws(() => validateAppliedMigrationPrefix([...files, '013_future.sql']), /ahead of this repository checkout/)
})

test('resolver refuses a gapped ledger before resolving any tables', () => {
  const gapped = files.filter((f) => !f.startsWith('005'))
  assert.throws(
    () => resolveBackupTables({ applied: gapped, existing: allCreated }),
    /contiguous prefix/,
  )
})

/* ── BASE TABLE requirement ──────────────────────────────────────────── */

test('a required name present only as a view fails closed', () => {
  // backup-db.mjs collects BASE TABLE rows only, so a view named like a
  // required table cannot satisfy the schema check — simulate it by the
  // name being absent from the base-table set.
  const existing = new Set([...allCreated].filter((x) => x !== 'commits'))
  assert.throws(
    () => resolveBackupTables({ applied: files, existing }),
    /commits/,
    'view-only commits must not satisfy the check',
  )
  assert.match(src('scripts/backup-db.mjs'), /table_type = 'BASE TABLE'/,
    'the live schema query must restrict to BASE TABLE')
})

test('unmigrated target (schema_migrations empty) resolves nothing and is refused', () => {
  // With no applied files, expected set is empty — an existing allowlisted
  // table would be "unrecorded" and throw, but a truly empty DB resolves
  // to zero tables which backup-db.mjs refuses outright.
  assert.throws(() => resolveBackupTables({ applied: [], existing: ['users'] }), /without a recorded migration/)
  const resolved = resolveBackupTables({ applied: [], existing: [] })
  assert.deepEqual(resolved, [])
})

test('the exact production transition: pre-012 then post-012', () => {
  // checkout has 001..012; production applied exactly 001..011 with the
  // ownership tables absent — the real mandatory pre-migration backup
  assert.equal(validateAppliedMigrationPrefix(pre012Files), true)
  const pre = resolveBackupTables({ applied: pre012Files, existing: pre012Created })
  assert.deepEqual(pre, BACKUP_TABLES.filter((t) => !OWNERSHIP.includes(t)))
  assert.equal(pre.length, 10)
  // after 012 is applied, all 14 resolve
  assert.equal(validateAppliedMigrationPrefix(files), true)
  const post = resolveBackupTables({ applied: files, existing: allCreated })
  assert.equal(post.length, 14)
})

/* ── integration surface ─────────────────────────────────────────────── */

test('backup-db.mjs resolves against the live DB and refuses an empty set', () => {
  const b = src('scripts/backup-db.mjs')
  assert.match(b, /select filename from public\.schema_migrations/)
  assert.match(b, /information_schema\.tables/)
  assert.match(b, /resolveBackupTables\(\{ applied, existing \}\)/)
  assert.match(b, /resolved\.length === 0/)
  assert.match(b, /resolved\.map\(\(t\) => `--table=public\.\$\{t\}`\)/)
  // metadata reporting without secrets
  assert.match(b, /migrations applied/)
  assert.doesNotMatch(b, /console\.log[^\n]*(DATABASE_URL|password|PGPASSWORD)/i)
})

test('ephemeral tables still never enter the resolved set', () => {
  const resolved = resolveBackupTables({ applied: files, existing: allCreated })
  for (const t of EPHEMERAL_TABLES) assert.ok(!resolved.includes(t))
})
