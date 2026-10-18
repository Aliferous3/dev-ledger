// Hard-off feature gate for ownership ingestion.
//
// Contract (docs/ownership-data-privacy-spec.md §21-22): ownership work is
// allowed ONLY when BOTH hold:
//   1. OWNERSHIP_INGEST_ENABLED is exactly the literal string 'true'
//   2. the target repository's INTERNAL uuid is present in
//      OWNERSHIP_CANARY_REPOSITORY_IDS (comma-separated)
// Every other state — absent, false, malformed, empty allowlist, repo not
// listed — means DISABLED. No truthiness, no wildcards, no names/logins.
//
// This module is the single entry point a future runner must call BEFORE any
// ownership GitHub request or ownership DB write. Phase 1C-A ships no runner
// and no caller, so the gate can only ever evaluate false in production.

export const OWNERSHIP_FLAG_ENV = 'OWNERSHIP_INGEST_ENABLED'
export const OWNERSHIP_ALLOWLIST_ENV = 'OWNERSHIP_CANARY_REPOSITORY_IDS'

// Canonical uuid shape (8-4-4-4-12 hex). Internal repositories.id values are
// Postgres uuids; anything that is not uuid-shaped is rejected, never coerced.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export class OwnershipDisabledError extends Error {
  constructor() {
    // deliberately carries no repository id, flag value, or allowlist content
    super('ownership ingestion is disabled for this repository')
    this.name = 'OwnershipDisabledError'
  }
}

// Exact literal only. '1', 'yes', 'TRUE ' or any other value disables.
export function isOwnershipIngestEnabled(env = process.env) {
  return env[OWNERSHIP_FLAG_ENV] === 'true'
}

// Validated internal repository uuid allowlist. Malformed entries are dropped,
// whitespace is ignored, duplicates collapse, case is normalized.
export function canaryRepositoryIds(env = process.env) {
  const raw = env[OWNERSHIP_ALLOWLIST_ENV]
  if (typeof raw !== 'string' || raw.trim() === '') return new Set()
  const ids = new Set()
  for (const part of raw.split(',')) {
    const id = part.trim()
    if (UUID_RE.test(id)) ids.add(id.toLowerCase())
  }
  return ids
}

// The one predicate a runner calls: both conditions must hold.
export function ownershipIngestAllowed(repositoryId, env = process.env) {
  if (!isOwnershipIngestEnabled(env)) return false
  if (typeof repositoryId !== 'string' || !UUID_RE.test(repositoryId)) return false
  return canaryRepositoryIds(env).has(repositoryId.toLowerCase())
}

// Assertive form for the top of a future ingestion boundary — a disabled gate
// throws before any network or DB work can start.
export function assertOwnershipIngestAllowed(repositoryId, env = process.env) {
  if (!ownershipIngestAllowed(repositoryId, env)) {
    throw new OwnershipDisabledError()
  }
}
