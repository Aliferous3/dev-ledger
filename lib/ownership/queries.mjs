// Production GitHub GraphQL query builders for ownership ingestion.
//
// These are the audited metadata-only production implementations — promoted
// from the measured spike family (scripts/spikes/ownership/queries.mjs,
// results in docs/ownership-graphql-spike-results.md) but owned here; runtime
// code never imports the spike module.
//
// HARD CONTRACT (spec §5, §7): no query built here may select source-bearing
// or identity-creep fields. Blame ranges, path-filtered history metadata,
// author identity (user id + login only), and rate-limit telemetry are the
// entire allowed payload. The static audit (assertQueriesMetadataOnly plus
// test/ownership-queries.test.mjs) inspects the query STRINGS so a future
// edit cannot silently widen them.

// Fields that must never appear in an ownership production query. 'files',
// 'additions' and 'deletions' are listed even though they carry no source —
// path-filtered history returns them as WHOLE-COMMIT statistics, not
// directory churn (measured in the spike), so they can never serve as
// path-volume metrics.
export const FORBIDDEN_OWNERSHIP_FIELDS = [
  'text', 'byteSize', 'patch', 'diff',
  'message', 'messageHeadline', 'messageBody',
  'email', 'signature', 'committer', 'databaseId',
  'files', 'changedFiles', 'additions', 'deletions',
  'isTruncated', 'treeHash', 'zipballUrl', 'tarballUrl',
]

export const FORBIDDEN_OWNERSHIP_FIELD_RE = new RegExp(
  `\\b(${FORBIDDEN_OWNERSHIP_FIELDS.join('|')})\\b`,
)

// The ONLY identity selection allowed anywhere in an ownership query.
export const AUTHOR_USER_FIELDS = 'user { id login }'

const RATE_LIMIT = 'rateLimit { cost remaining resetAt }'

// Alias ceiling for batched blame — the spike measured 1/5/10/20/50 aliases;
// 50 is the tested production ceiling and may not be raised without another
// measurement pass.
export const BLAME_BATCH_LIMIT = 50

// history(path:) — V1 monthly maintenance/touch signal.
// Nodes carry ONLY the reducer's needs: committedDate + linked identity.
// Deliberately absent: oid (not needed by the Phase-1C reducer), all
// whole-commit stats, message/email/name, files. $path may be null for the
// repository scope (unfiltered history).
export function historyPathQuery() {
  return `query ($owner: String!, $name: String!, $path: String, $cursor: String) {
  repository(owner: $owner, name: $name) {
    defaultBranchRef {
      target {
        ... on Commit {
          history(first: 100, path: $path, after: $cursor) {
            pageInfo { hasNextPage endCursor }
            nodes {
              committedDate
              author { ${AUTHOR_USER_FIELDS} }
            }
          }
        }
      }
    }
  }
  ${RATE_LIMIT}
}`
}

// Alias-batched HEAD blame, up to BLAME_BATCH_LIMIT file paths per request.
// Phase 1C-A builds NO blame callsite and no blame reducer — this builder is
// promoted only to fix the audited query shape for a later tranche. Nothing
// may call it from runtime.
export function batchedBlameQuery(paths) {
  if (!Array.isArray(paths) || paths.length === 0) {
    throw new RangeError('batchedBlameQuery requires at least one path')
  }
  if (paths.length > BLAME_BATCH_LIMIT) {
    throw new RangeError(
      `batchedBlameQuery is capped at ${BLAME_BATCH_LIMIT} aliases per request`,
    )
  }
  const varDecls = paths.map((_, i) => `$p${i}: String!`).join(', ')
  const aliases = paths
    .map(
      (_, i) => `b${i}: blame(path: $p${i}) {
        ranges { startingLine endingLine commit { oid committedDate author { ${AUTHOR_USER_FIELDS} } } }
      }`,
    )
    .join('\n')
  return `query ($owner: String!, $name: String!, ${varDecls}) {
  repository(owner: $owner, name: $name) {
    object(expression: "HEAD") {
      ... on Commit {
        ${aliases}
      }
    }
  }
  ${RATE_LIMIT}
}`
}

// ── pinned-revision queries (Phase 1C-B, checkpoint architecture §10) ────
// Every ACCUMULATE build page is anchored at the build's immutable
// pinned_oid via object(oid:) — NEVER defaultBranchRef, which resolves at
// query time and drifts mid-build. historyPathQuery above remains the
// pre-checkpoint reference shape only; the checkpoint engine must use the
// pinned forms exclusively.

// HEAD probe — the ONLY place the mutable branch tip may be read: a fresh
// build resolves it exactly once to pin the immutable revision.
export function ownershipHeadProbeQuery() {
  return `query ($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    defaultBranchRef { target { oid } }
  }
  ${RATE_LIMIT}
}`
}

// Pin validation — resolves the candidate oid once at build start: the
// object must be a Commit and its returned oid must equal the probe's.
// Also captures the pinned commit's tree oid so scope enumeration is
// revision-pinned too (B0.5 measured form).
export function pinnedObjectQuery() {
  return `query ($owner: String!, $name: String!, $oid: GitObjectID!) {
  repository(owner: $owner, name: $name) {
    object(oid: $oid) {
      __typename
      ... on Commit { oid tree { oid } }
    }
  }
  ${RATE_LIMIT}
}`
}

// The ACCUMULATE history page — the empirically proven B0.5 shape:
// Repository.object(oid: $pinnedOid) -> Commit -> history(path:, after:).
// Nodes carry ONLY what the reducer needs (committedDate + linked
// identity); no node oid, no message/email/name, no whole-commit stats,
// no files — a page's worth of deltas is derivable from these alone.
export function pinnedHistoryPageQuery() {
  return `query ($owner: String!, $name: String!, $oid: GitObjectID!, $path: String, $cursor: String) {
  repository(owner: $owner, name: $name) {
    object(oid: $oid) {
      __typename
      ... on Commit {
        oid
        history(first: 100, path: $path, after: $cursor) {
          pageInfo { hasNextPage endCursor }
          nodes {
            committedDate
            author { ${AUTHOR_USER_FIELDS} }
          }
        }
      }
    }
  }
  ${RATE_LIMIT}
}`
}

// Static audit — throws when a built query widened past the metadata
// contract. Also verifies every user-selection is exactly id+login so a
// stray name/email field cannot hide inside an author block.
export function assertOwnershipQuerySafe(query) {
  const m = query.match(FORBIDDEN_OWNERSHIP_FIELD_RE)
  if (m) throw new Error(`ownership query selects forbidden field: ${m[0]}`)
  const userBlocks = query.match(/user\s*\{[^}]*\}/g) ?? []
  for (const block of userBlocks) {
    const fields = block.replace(/^user\s*\{|\}$/g, '').trim().split(/\s+/)
    for (const f of fields) {
      if (f !== 'id' && f !== 'login') {
        throw new Error(`ownership query selects non-contract user field: ${f}`)
      }
    }
  }
  return query
}

// Raised when a GraphQL RESPONSE carries a key outside the metadata
// contract — a privacy tripwire at the trust boundary, not a data error.
export class OwnershipResponseContractError extends Error {
  constructor() {
    // deliberately carries no field name, payload, or response fragment
    super('ownership response violates the metadata contract')
    this.name = 'OwnershipResponseContractError'
  }
}

// Recursively scan a response payload for keys that may never appear. Any
// hit throws — the caller treats it as a closed-contract failure, never a
// retryable data shape. Deliberately walks EVERY nested object/array.
export function assertOwnershipResponseSafe(payload) {
  const walk = (v) => {
    if (!v || typeof v !== 'object') return
    if (Array.isArray(v)) {
      for (const item of v) walk(item)
      return
    }
    for (const [k, val] of Object.entries(v)) {
      if (FORBIDDEN_OWNERSHIP_FIELDS.includes(k)) {
        throw new OwnershipResponseContractError()
      }
      walk(val)
    }
  }
  walk(payload)
  return payload
}

// Every builder output passes the same audit — run at module load so the
// constant query shapes are provably within contract before any use.
for (const q of [
  historyPathQuery(),
  ownershipHeadProbeQuery(),
  pinnedObjectQuery(),
  pinnedHistoryPageQuery(),
]) {
  assertOwnershipQuerySafe(q)
}
