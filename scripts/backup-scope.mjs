// Backup scope — the single classification of every public table.
//
// The backup is ALLOWLIST-ONLY: pg_dump receives repeated
// --table=public.<name> for exactly the tables resolveBackupTables()
// returns — a subset of BACKUP_TABLES valid for the target's applied
// migration state. Supabase warns that raw pg_dump can pick up
// platform-internal schemas/objects, so the safe property here is
// "unknown/new schema or table → NOT backed up until explicitly
// classified". backup-db.mjs, recovery-drill.mjs, the tests and the docs
// all derive from these lists; a new table added by a migration but not
// classified fails CI loudly instead of silently entering (or silently
// missing) the dump.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// CORE — irreplaceable business data. Losing these means real user loss.
export const CORE_TABLES = [
  'users',                 // account identity (internal uuid ↔ github user)
  'github_installations',  // installation ↔ user link — resync anchor
  'repositories',          // tracked repos incl. disconnect state
  'repository_languages',  // byte-share language stats
  'commits',               // ingested commit rows — the expensive history
  'pull_requests',         // ingested PR rows (no titles/numbers/authors — data minimization)
  'feedback',              // user-submitted transmissions — not re-ingestable
  'ownership_scopes',      // ownership scope map — irreplaceable for
                           // retained/disconnected repos GitHub can no
                           // longer serve
  'ownership_contributors',// repo-scoped contributor identity rows
  'ownership_snapshots',   // ownership aggregates — same irreplaceability
]

// OPERATIONAL — reconstructable in principle, but restoring them avoids a
// full cold resync of every repo. Small, self-healing: sync treats these
// rows as hints (stale 'syncing' locks expire via LOCK_STALE_MS takeover;
// repo_coverage rows are superseded by the next completed run).
export const OPERATIONAL_TABLES = [
  'repo_coverage',         // derived from commits, but rebuilding needs a
                           // full GitHub re-ingest — cheap to keep
  'repo_sync',             // per-repo sync phase markers (push kicks)
  'user_sync',             // per-user sync status; 'syncing' rows resume via cron
  'ownership_sync_state',  // ownership cursors/version markers — losing it
                           // means a re-ingest, same as repo_sync
]

// EPHEMERAL — intentionally excluded from backups.
export const EPHEMERAL_TABLES = [
  'auth_sessions',         // live sids — recovery must force re-auth, never
                           // resurrect server-side session records
  'webhook_deliveries',    // replay-dedup history; post-restore deliveries
                           // reprocess idempotently — safe to start empty
  'security_events',       // operational telemetry, 30-day retention anyway
  'schema_migrations',     // rebuilt by the migration runner, not restored
]

// The canonical dump allowlist — the ONLY tables pg_dump may ever be asked
// for. The set actually requested for a given target is computed by
// resolveBackupTables().
export const BACKUP_TABLES = [...CORE_TABLES, ...OPERATIONAL_TABLES]

// ── migration-aware resolution ───────────────────────────────────────────
//
// A target database may lag repository main (e.g. a mandatory pre-migration
// backup taken while migrations/012_ownership.sql is committed but not yet
// applied). Requesting --table for an absent table makes pg_dump fail —
// but silently skipping absent allowlisted tables would mask a broken
// schema. So resolution is:
//
//   backup set = BACKUP_TABLES ∩ tables the APPLIED migrations create
//
// plus fail-closed validation:
//   * a table the applied schema expects but the DB lacks → broken schema
//   * an allowlisted table physically present whose migration is NOT
//     recorded in schema_migrations → bookkeeping inconsistency
//
// Unknown/unclassified tables in the database never enter the result.

// filename -> { created, dropped } Sets of tables that migration touches,
// parsed from the repo migration files — the schema source of truth.
export function migrationTables() {
  const dir = path.join(root, 'migrations')
  const map = new Map()
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8')
    const created = new Set()
    const dropped = new Set()
    for (const m of text.matchAll(/create table(?:\s+if not exists)?\s+(?:public\.)?(\w+)/gi)) created.add(m[1])
    for (const m of text.matchAll(/drop table(?:\s+if exists)?\s+(?:public\.)?(\w+)/gi)) dropped.add(m[1])
    map.set(f, { created, dropped })
  }
  return map
}

export function migrationFiles() {
  return [...migrationTables().keys()]
}

// The applied set must be EXACTLY a prefix of this checkout's ordered
// migration list:
//   * an applied filename unknown to this checkout → the target schema is
//     ahead of the code — an older backup tool cannot know whether its
//     allowlist is still complete, so it must fail closed
//   * a skipped known migration (a gap) → broken migration bookkeeping
// Lagging repo main is legitimate and valid.
export function validateAppliedMigrationPrefix(applied) {
  const repoFiles = migrationFiles()
  const repoSet = new Set(repoFiles)
  const seen = new Set()
  for (const f of applied) {
    if (!repoSet.has(f)) {
      throw new Error(
        `target database schema is ahead of this repository checkout ` +
        `(unknown applied migration ${f}); update the repository before creating a backup`
      )
    }
    seen.add(f)
  }
  const prefix = repoFiles.slice(0, seen.size)
  const missing = prefix.filter((f) => !seen.has(f))
  if (missing.length) {
    throw new Error(
      `applied migrations are not a contiguous prefix of the repo list — ` +
      `missing ${missing.join(', ')}; refusing to reason about a gapped schema`
    )
  }
  return true
}

// Tables the applied migration set is expected to have created, replayed
// in filename order so drops in later migrations (e.g. 002 dropping 001's
// sync_state/daily_activity) actually remove them.
export function expectedTables(applied) {
  const byMig = migrationTables()
  const appliedSet = new Set(applied)
  const expected = new Set()
  for (const [file, { created, dropped }] of byMig) {
    if (!appliedSet.has(file)) continue
    for (const t of dropped) expected.delete(t)
    for (const t of created) expected.add(t)
  }
  return expected
}

// Exact safe table list for the target DB.
//   applied  — iterable of filenames recorded in public.schema_migrations
//   existing — iterable of BASE TABLE names present in the public schema
// Returns BACKUP_TABLES filtered to the applied-schema table set, or throws.
export function resolveBackupTables({ applied, existing }) {
  // The applied ledger must be a contiguous prefix of this checkout's
  // migration list before any resolution happens.
  const appliedList = [...applied]
  validateAppliedMigrationPrefix(appliedList)
  const appliedSet = new Set(appliedList)
  const existingSet = new Set(existing)
  const expected = expectedTables(appliedSet)

  // fail closed: applied schema claims tables the DB does not have
  const missing = [...expected].filter((t) => !existingSet.has(t))
  if (missing.length) {
    throw new Error(
      `applied schema expects table(s) that do not exist: ${missing.join(', ')} — refusing to produce a partial backup`
    )
  }

  // fail closed: an allowlisted table exists but its migration is not
  // recorded — the schema and schema_migrations disagree.
  const unrecorded = [...existingSet].filter(
    (t) => BACKUP_TABLES.includes(t) && !expected.has(t)
  )
  if (unrecorded.length) {
    throw new Error(
      `allowlisted table(s) present without a recorded migration: ${unrecorded.join(', ')} — refusing to guess backup scope`
    )
  }

  return BACKUP_TABLES.filter((t) => expected.has(t))
}
