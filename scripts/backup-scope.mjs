// Backup scope — the single classification of every public table.
//
// The backup is ALLOWLIST-ONLY: pg_dump receives repeated
// --table=public.<name> for exactly BACKUP_TABLES. Supabase warns that raw
// pg_dump can pick up platform-internal schemas/objects, so the safe
// property here is "unknown/new schema or table → NOT backed up until
// explicitly classified". backup-db.mjs, recovery-drill.mjs, the tests and
// the docs all derive from these lists; a new table added by a migration
// but not classified fails CI loudly instead of silently entering (or
// silently missing) the dump.

// CORE — irreplaceable business data. Losing these means real user loss.
export const CORE_TABLES = [
  'users',                 // account identity (internal uuid ↔ github user)
  'github_installations',  // installation ↔ user link — resync anchor
  'repositories',          // tracked repos incl. disconnect state
  'repository_languages',  // byte-share language stats
  'commits',               // ingested commit rows — the expensive history
  'pull_requests',         // ingested PR rows (no titles/numbers/authors — data minimization)
  'feedback',              // user-submitted transmissions — not re-ingestable
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

// The canonical dump allowlist — the ONLY tables pg_dump is asked for.
export const BACKUP_TABLES = [...CORE_TABLES, ...OPERATIONAL_TABLES]
