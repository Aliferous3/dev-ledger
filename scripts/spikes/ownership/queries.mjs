// GraphQL query builders for the ownership feasibility spike.
//
// HARD CONTRACT (source-exposure audit, TEST K): no query built here may
// select source-bearing fields. Forbidden: text, byteSize, patch, message,
// messageHeadline, messageBody, email, isTruncated-based content reads, and
// any object(expression:) that reaches a Blob's content. Blame ranges,
// commit metadata, author identity (id/login only), paths, and rate-limit
// telemetry are the only allowed payloads.

export const FORBIDDEN_FIELD_RE =
  /\b(text|byteSize|patch|message|messageHeadline|messageBody|email|signature)\b/

const AUTHOR_FIELDS = 'author { user { id login } }'
const RATE_LIMIT = 'rateLimit { cost remaining resetAt }'

// Path-filtered history (file or directory). touch signals only — no
// additions/deletions selected because they are whole-commit statistics.
export function historyPathQuery() {
  return `query ($owner: String!, $name: String!, $path: String, $cursor: String) {
  repository(owner: $owner, name: $name) {
    defaultBranchRef {
      target {
        ... on Commit {
          history(first: 100, path: $path, after: $cursor) {
            pageInfo { hasNextPage endCursor }
            nodes { oid committedDate ${AUTHOR_FIELDS} }
          }
        }
      }
    }
  }
  ${RATE_LIMIT}
}`
}

// Single-file blame at HEAD.
export function blameQuery() {
  return `query ($owner: String!, $name: String!, $path: String!) {
  repository(owner: $owner, name: $name) {
    object(expression: "HEAD") {
      ... on Commit {
        blame(path: $path) {
          ranges {
            startingLine
            endingLine
            commit { oid committedDate ${AUTHOR_FIELDS} }
          }
        }
      }
    }
  }
  ${RATE_LIMIT}
}`
}

// Alias-batched blame: N blame fields on the same HEAD commit object.
// vars: p0..pN-1 are the file paths.
export function batchedBlameQuery(paths) {
  const varDecls = paths.map((_, i) => `$p${i}: String!`).join(', ')
  const aliases = paths
    .map(
      (_, i) => `b${i}: blame(path: $p${i}) {
        ranges { startingLine endingLine commit { oid committedDate ${AUTHOR_FIELDS} } }
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

// Minimal repo lookup for permission verification.
export function repoProbeQuery() {
  return `query ($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    nameWithOwner
    isPrivate
    defaultBranchRef { name target { oid } }
  }
  ${RATE_LIMIT}
}`
}

// Whole-commit stats demonstration — ISOLATED correctness test only.
// Proves additions/deletions are repo-wide, not path-scoped.
export function wholeCommitStatsDemoQuery() {
  return `query ($owner: String!, $name: String!, $path: String!) {
  repository(owner: $owner, name: $name) {
    defaultBranchRef {
      target {
        ... on Commit {
          history(first: 3, path: $path) {
            nodes { oid additions deletions }
          }
        }
      }
    }
  }
  ${RATE_LIMIT}
}`
}

// Release tags (for the RFC's optional tag-snapshot idea; cost check only).
export function tagsQuery() {
  return `query ($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    refs(refPrefix: "refs/tags/", first: 24) {
      nodes { name target { ... on Commit { committedDate } } }
    }
  }
  ${RATE_LIMIT}
}`
}

// TEST K audit: throws if any built query selects a forbidden field.
export function assertNoSourceFields(query) {
  const m = query.match(FORBIDDEN_FIELD_RE)
  if (m) throw new Error(`Query selects forbidden source field: ${m[0]}`)
  return query
}

// Recursively scan a GraphQL response for keys that should never appear.
export function assertResponseMetadataOnly(payload, forbiddenKeys = ['text', 'patch', 'message', 'email', 'byteSize']) {
  const seen = new Set()
  const walk = (v) => {
    if (!v || typeof v !== 'object') return
    for (const [k, val] of Object.entries(v)) {
      if (forbiddenKeys.includes(k)) seen.add(k)
      walk(val)
    }
  }
  walk(payload)
  return [...seen]
}
