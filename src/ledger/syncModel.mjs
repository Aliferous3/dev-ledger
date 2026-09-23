// Pure derivations for the sync instrument + passive /api/sync polling.
// Mirrors the production SyncInstrument semantics (phase titles, per-stage
// counts, blocked copy, brief complete flash) so they stay unit-testable.

export const SYNC_PHASES = {
  discover: 'DISCOVERING',
  metadata: 'METADATA',
  commits: 'HISTORY',
  pulls: 'PULL REQUESTS',
  range: 'RANGE',
  finalizing: 'FINALIZING',
}

const BLOCKED = new Set(['rate_limited', 'error', 'revoked'])

export function isSyncBlocked(status) {
  return BLOCKED.has(status)
}

export function syncTitle(sync, justDone = false) {
  if (justDone) return 'SYNC COMPLETE'
  const status = sync?.status
  if (status === 'rate_limited') return 'SYNC · RATE LIMITED'
  if (status === 'revoked') return 'SYNC · ACCESS REVOKED'
  if (status === 'error') return 'SYNC · ERROR'
  return `SYNC · ${SYNC_PHASES[sync?.phase] || 'WORKING'}`
}

// Visible while a sync runs, while blocked, and briefly after a run ends.
export function syncVisible(sync, justDone = false) {
  const status = sync?.status
  return status === 'syncing' || isSyncBlocked(status) || justDone
}

const fmt = new Intl.NumberFormat('en-US')
export const pair = (d) =>
  d ? `${fmt.format(d.done ?? 0)} / ${d.total == null ? '—' : fmt.format(d.total)}` : '—'

// Per-stage rows under the title — same detail contract the backend emits:
// detail.repos {done,total}, detail.history {done,total,active,commits},
// detail.pulls {done,count}.
export function detailRows(detail = {}) {
  return [
    ['REPOSITORIES', pair(detail?.repos)],
    [
      'COMMIT HISTORY',
      `${pair(detail?.history)}${detail?.history?.commits ? ` · ${fmt.format(detail.history.commits)}` : ''}`,
    ],
    [
      'PULL REQUESTS',
      detail?.pulls?.done
        ? `DONE${detail.pulls.count ? ` · ${fmt.format(detail.pulls.count)}` : ''}`
        : 'PENDING',
    ],
  ]
}

export const syncPct = (progress) => Math.round((progress || 0) * 100)

export function blockedCopy(status) {
  if (status === 'rate_limited') {
    return 'GITHUB QUOTA EXHAUSTED — SYNC RESUMES AUTOMATICALLY WHEN THE LIMIT RESETS.'
  }
  if (status === 'revoked') {
    return 'RECONNECT GITHUB FROM THE ACCOUNT MENU TO RESUME SYNCHRONIZATION.'
  }
  return 'SYNCHRONIZATION FAILED — USE SYNC NOW TO RETRY.'
}

// Whether a rate_limited state may resume now: resume_at already passed.
export function rateLimitElapsed(sync, now = Date.now()) {
  if (sync?.status !== 'rate_limited') return false
  const resume = sync?.resumeAt ? new Date(sync.resumeAt).getTime() : NaN
  return !Number.isFinite(resume) || resume <= now
}

// A 'syncing' row with no recent writer is wedged: live slices beat
// updated_at every few seconds, so anything older than the slice budget
// means no worker owns the claim and the UI should offer/drive a resume.
export const SYNC_STALE_MS = 45_000
export function isSyncStale(sync, now = Date.now()) {
  if (sync?.status !== 'syncing') return false
  const updated = sync?.updatedAt ? new Date(sync.updatedAt).getTime() : NaN
  return !Number.isFinite(updated) || now - updated > SYNC_STALE_MS
}

// Passive-poll cadence while the local pump isn't running: short while a
// sync is in flight (cron or another tab may be driving it), slower while
// waiting out a rate limit. Null means no polling needed.
export function passivePollMs(status) {
  if (status === 'syncing') return 2000
  if (status === 'rate_limited') return 30000
  return null
}
