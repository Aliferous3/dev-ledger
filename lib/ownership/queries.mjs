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

// Every builder output passes the same audit — run at module load so the
// constant query shapes are provably within contract before any use.
assertOwnershipQuerySafe(historyPathQuery())
