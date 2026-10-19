// GraphQL query builders for the pinned-revision history spike (B0.5).
//
// Same hard contract as queries.mjs: no source-bearing fields may be
// selected — no text, byteSize, patch, message, email, signature.
// Only commit oids, committedDate, author.user.{id,login}, pageInfo,
// tree oid, typenames, and rate-limit telemetry.

export { FORBIDDEN_FIELD_RE, assertNoSourceFields, assertResponseMetadataOnly } from './queries.mjs'

const AUTHOR_FIELDS = 'author { user { id login } }'
const RATE_LIMIT = 'rateLimit { cost remaining resetAt }'

// Repo probe: live HEAD oid + branch name + privacy flag.
export function probeQuery() {
  return `query ($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    nameWithOwner
    isPrivate
    defaultBranchRef { name target { oid } }
  }
  ${RATE_LIMIT}
}`
}

// Resolve an arbitrary oid to its object type; when it is a Commit,
// also return oid + committedDate + tree oid.
export function objectLookupQuery() {
  return `query ($owner: String!, $name: String!, $oid: GitObjectID!) {
  repository(owner: $owner, name: $name) {
    object(oid: $oid) {
      __typename
      oid
      ... on Commit { committedDate tree { oid } }
    }
  }
  ${RATE_LIMIT}
}`
}

// Pinned history page — the exact production-intended shape:
// Repository.object(oid: <sha>) -> Commit -> history(path:, first:, after:).
export function pinnedHistoryQuery() {
  return `query ($owner: String!, $name: String!, $oid: GitObjectID!, $path: String, $cursor: String) {
  repository(owner: $owner, name: $name) {
    object(oid: $oid) {
      __typename
      ... on Commit {
        oid
        history(first: 100, path: $path, after: $cursor) {
          pageInfo { hasNextPage endCursor }
          nodes { oid committedDate ${AUTHOR_FIELDS} }
        }
      }
    }
  }
  ${RATE_LIMIT}
}`
}

// HEAD history page (control for the pinned walk).
export function headHistoryQuery() {
  return `query ($owner: String!, $name: String!, $path: String, $cursor: String) {
  repository(owner: $owner, name: $name) {
    defaultBranchRef {
      target {
        ... on Commit {
          oid
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

// Branch refs — used to find a commit unreachable from default-branch HEAD.
export function branchesQuery() {
  return `query ($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    refs(refPrefix: "refs/heads/", first: 20) {
      nodes { name target { oid } }
    }
  }
  ${RATE_LIMIT}
}`
}

// Recently closed/merged PR head oids — approximates "commit whose
// source ref may no longer exist on the default branch".
export function closedPrHeadsQuery() {
  return `query ($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    pullRequests(last: 5, states: [MERGED, CLOSED]) {
      nodes { headRefOid closedAt merged }
    }
  }
  ${RATE_LIMIT}
}`
}
