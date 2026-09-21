import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

// Sync instrument derivations + passive-poll cadence. Pure-function
// coverage plus source-level guards for the no-DOM test runner.

const {
  SYNC_PHASES,
  isSyncBlocked,
  syncTitle,
  syncVisible,
  pair,
  detailRows,
  syncPct,
  blockedCopy,
  rateLimitElapsed,
  passivePollMs,
} = await import('../src/ledger/syncModel.mjs')

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const src = (p) => readFileSync(path.join(root, p), 'utf8')

/* ── title + phase mapping ── */

test('syncTitle maps backend phases to instrument labels', () => {
  for (const [phase, label] of Object.entries(SYNC_PHASES)) {
    assert.equal(syncTitle({ status: 'syncing', phase }), `SYNC · ${label}`)
  }
  assert.equal(syncTitle({ status: 'syncing', phase: 'unknown' }), 'SYNC · WORKING')
  assert.equal(syncTitle({ status: 'syncing' }), 'SYNC · WORKING')
})

test('syncTitle surfaces blocked and complete states', () => {
  assert.equal(syncTitle({ status: 'rate_limited' }), 'SYNC · RATE LIMITED')
  assert.equal(syncTitle({ status: 'revoked' }), 'SYNC · ACCESS REVOKED')
  assert.equal(syncTitle({ status: 'error' }), 'SYNC · ERROR')
  assert.equal(syncTitle({ status: 'syncing', phase: 'commits' }, true), 'SYNC COMPLETE')
})

/* ── visibility ── */

test('syncVisible shows active, blocked, and just-completed states only', () => {
  assert.equal(syncVisible({ status: 'syncing' }), true)
  assert.equal(syncVisible({ status: 'rate_limited' }), true)
  assert.equal(syncVisible({ status: 'error' }), true)
  assert.equal(syncVisible({ status: 'revoked' }), true)
  assert.equal(syncVisible({ status: 'idle' }), false)
  assert.equal(syncVisible({ status: 'complete' }), false)
  assert.equal(syncVisible(null), false)
  assert.equal(syncVisible({ status: 'complete' }, true), true)
})

test('isSyncBlocked identifies only the hold states', () => {
  assert.equal(isSyncBlocked('rate_limited'), true)
  assert.equal(isSyncBlocked('error'), true)
  assert.equal(isSyncBlocked('revoked'), true)
  assert.equal(isSyncBlocked('syncing'), false)
  assert.equal(isSyncBlocked('idle'), false)
})

/* ── formatting ── */

test('pair renders done/total with grouping and placeholders', () => {
  assert.equal(pair({ done: 3, total: 7 }), '3 / 7')
  assert.equal(pair({ done: 1429, total: 1500 }), '1,429 / 1,500')
  assert.equal(pair({ done: 0 }), '0 / —')
  assert.equal(pair(null), '—')
  assert.equal(pair(undefined), '—')
})

test('detailRows render repos, history with commit count, and pulls', () => {
  const rows = detailRows({
    repos: { done: 4, total: 7 },
    history: { done: 1200, total: 1429, commits: 9832 },
    pulls: { done: true, count: 439 },
  })
  assert.deepEqual(rows.map(([k]) => k), ['REPOSITORIES', 'COMMIT HISTORY', 'PULL REQUESTS'])
  assert.equal(rows[0][1], '4 / 7')
  assert.equal(rows[1][1], '1,200 / 1,429 · 9,832')
  assert.equal(rows[2][1], 'DONE · 439')
})

test('detailRows degrade safely on sparse detail', () => {
  const rows = detailRows({})
  assert.equal(rows[0][1], '—')
  assert.equal(rows[1][1], '—')
  assert.equal(rows[2][1], 'PENDING')
  const pulls = detailRows({ pulls: { done: true } })
  assert.equal(pulls[2][1], 'DONE')
})

test('syncPct converts fractions, clamps to integer percent', () => {
  assert.equal(syncPct(0.413), 41)
  assert.equal(syncPct(1), 100)
  assert.equal(syncPct(0), 0)
  assert.equal(syncPct(undefined), 0)
})

/* ── blocked copy ── */

test('blockedCopy gives per-state recovery guidance', () => {
  assert.match(blockedCopy('rate_limited'), /RESUMES AUTOMATICALLY/)
  assert.match(blockedCopy('revoked'), /RECONNECT GITHUB/)
  assert.match(blockedCopy('error'), /SYNC NOW/)
  assert.match(blockedCopy('other'), /SYNC NOW/)
})

/* ── passive polling + resume ── */

test('passivePollMs polls fast while syncing, slower while rate-limited', () => {
  assert.equal(passivePollMs('syncing'), 2000)
  assert.equal(passivePollMs('rate_limited'), 30000)
  assert.equal(passivePollMs('idle'), null)
  assert.equal(passivePollMs('error'), null)
  assert.equal(passivePollMs('revoked'), null)
  assert.equal(passivePollMs(undefined), null)
})

test('rateLimitElapsed resumes only after resume_at passes', () => {
  const now = Date.now()
  const past = new Date(now - 1000).toISOString()
  const future = new Date(now + 60000).toISOString()
  assert.equal(rateLimitElapsed({ status: 'rate_limited', resumeAt: past }, now), true)
  assert.equal(rateLimitElapsed({ status: 'rate_limited', resumeAt: future }, now), false)
  // No resume_at recorded → treat as resumable rather than stuck.
  assert.equal(rateLimitElapsed({ status: 'rate_limited' }, now), true)
  assert.equal(rateLimitElapsed({ status: 'syncing', resumeAt: past }, now), false)
})

/* ── source guards ── */

test('instrument mounts once inside the ledger provider, not per-section', () => {
  const app = src('src/App.tsx')
  const mounts = app.match(/<SyncInstrument\s*\/>/g) || []
  assert.equal(mounts.length, 1)
})

test('instrument never carries credentials or raw payloads to the DOM', () => {
  const c = src('src/components/SyncInstrument.tsx')
  assert.ok(!/access_token|installation_token|service_role|SESSION_SECRET/i.test(c))
})

test('passive polling reuses /api/sync — no parallel sync implementation', () => {
  const store = src('src/store/live.ts')
  assert.ok(!store.includes('/api/sync-range'))
  const posts = store.match(/fetch\('\/api\/sync\?force=1'/g) || []
  assert.equal(posts.length, 1)
})

test('rate-limit resume goes through the existing pump', () => {
  const store = src('src/store/live.ts')
  assert.ok(/rateLimitElapsed\(s\)\s*.*syncNow/s.test(store) || /rateLimitElapsed\(s\)[\s\S]{0,60}syncNow\(\)/.test(store))
})
