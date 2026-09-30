import { RateLimitError, GitHubAuthError } from './github.mjs'

// Closed taxonomy for persisted sync errors.
//
// repo_sync.error / user_sync.error carry ONLY these codes. Raw exception
// text, provider response bodies, URLs and stack traces are never persisted:
// a thrown value is classified here at the write boundary and everything
// else collapses to SYNC_INTERNAL_ERROR. The presentation layer translates
// codes back to fixed human-readable strings via syncErrorMessage().

export const SYNC_ERROR_CODES = Object.freeze([
  'GITHUB_RATE_LIMIT',
  'GITHUB_ACCESS_REVOKED',
  'SYNC_HISTORY_FAILED',
  'SYNC_PULLS_FAILED',
  'SYNC_INTERNAL_ERROR',
])

const MESSAGES = Object.freeze({
  GITHUB_RATE_LIMIT: 'GitHub rate limit reached — will resume automatically',
  GITHUB_ACCESS_REVOKED: 'GitHub access was revoked',
  SYNC_HISTORY_FAILED: 'Repository history sync failed — will retry automatically',
  SYNC_PULLS_FAILED: 'Pull request sync failed — will retry automatically',
  SYNC_INTERNAL_ERROR: 'Sync failed — will retry automatically',
})

export function isSyncErrorCode(value) {
  return SYNC_ERROR_CODES.includes(value)
}

// Any thrown value → a taxonomy code. `fallback` distinguishes the phase the
// failure escaped from (e.g. 'SYNC_PULLS_FAILED'); unknown throws always map
// to SYNC_INTERNAL_ERROR — no exception property is ever returned.
export function syncErrorCode(err, fallback = 'SYNC_INTERNAL_ERROR') {
  if (err instanceof RateLimitError) return 'GITHUB_RATE_LIMIT'
  if (err instanceof GitHubAuthError) return 'GITHUB_ACCESS_REVOKED'
  return isSyncErrorCode(fallback) ? fallback : 'SYNC_INTERNAL_ERROR'
}

// Presentation boundary: stored code → fixed human-readable string. Legacy
// free-text values (pre-taxonomy rows) and anything unrecognized collapse to
// the generic message — the stored value is never echoed verbatim.
export function syncErrorMessage(stored) {
  if (stored == null || stored === '') return null
  return MESSAGES[stored] || MESSAGES.SYNC_INTERNAL_ERROR
}
