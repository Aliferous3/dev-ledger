import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

// Stale-dashboard recovery: a sync nobody local drove (login-kicked initial
// run, cron, another tab) completes while the held dashboard payloads
// predate it — the store must refresh once, never loop, never fire a
// duplicate sync. Pure derivations + source-level wiring guards (node:test
// has no DOM runner).

const { snapshotPredatesSync, passivePollMs, SYNC_BOOT_WATCH_MS } = await import('../src/ledger/syncModel.mjs')
const {
  ASSIST_DELAY_MS,
  ASSIST_DISMISS_KEY,
  assistArmed,
  metricsEmpty,
} = await import('../src/ledger/syncAssistModel.mjs')

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const src = (p) => readFileSync(path.join(root, p), 'utf8')
const liveSrc = src('src/store/live.ts')

/* ── snapshotPredatesSync — the staleness predicate ─────────────────── */

test('snapshot generated before a completed sync is stale', () => {
  assert.equal(
    snapshotPredatesSync({ all: Date.parse('2026-01-01T10:00:00Z') }, '2026-01-01T10:05:00Z'),
    true,
  )
})

test('snapshot generated after completion is fresh — no refresh loop', () => {
  const done = '2026-01-01T10:05:00Z'
  assert.equal(snapshotPredatesSync({ all: Date.parse(done) + 1 }, done), false)
  assert.equal(snapshotPredatesSync({ all: Date.parse(done) }, done), false)
})

test('multiple payloads: any stale payload triggers refresh', () => {
  const done = Date.parse('2026-01-01T10:05:00Z')
  assert.equal(
    snapshotPredatesSync(
      { '90d': done + 5000, all: done - 5000 },
      '2026-01-01T10:05:00Z',
    ),
    true,
  )
  assert.equal(
    snapshotPredatesSync({ '90d': done + 5000, all: done + 5000 }, '2026-01-01T10:05:00Z'),
    false,
  )
})

test('missing/invalid stamps never trigger a refresh', () => {
  assert.equal(snapshotPredatesSync({}, '2026-01-01T10:00:00Z'), false)
  assert.equal(snapshotPredatesSync({ all: Date.now() }, null), false)
  assert.equal(snapshotPredatesSync({ all: Date.now() }, undefined), false)
  assert.equal(snapshotPredatesSync({ all: Date.now() }, 'garbage'), false)
  assert.equal(snapshotPredatesSync({ all: NaN }, '2026-01-01T10:00:00Z'), false)
})

/* ── wiring: the passive poll must refresh on externally-completed sync ── */

test('live.ts records each payload generatedAt stamp', () => {
  assert.match(liveSrc, /genAt\.current\[m\]\s*=\s*Date\.parse\(d\.generatedAt\)/)
})

test('passive poll consumes a completion once and refreshes both payloads', () => {
  // The refresh trigger lives inside the passive /api/sync poll — the only
  // place an externally-driven completion is observed.
  const pollRegion = liveSrc.slice(liveSrc.indexOf('setInterval'))
  assert.match(pollRegion, /snapshotPredatesSync\(genAt\.current,\s*s\.lastSyncedAt\)/)
  assert.match(pollRegion, /consumedSyncAt\.current\s*!==\s*s\.lastSyncedAt/)
  assert.match(pollRegion, /consumedSyncAt\.current\s*=\s*s\.lastSyncedAt/)
  // refresh() clears `requested` and re-fetches [mode, 'all'] — both payloads.
  const refreshFn = liveSrc.slice(liveSrc.indexOf('const refresh = useCallback'))
  assert.match(refreshFn, /requested\.current\.clear\(\)/)
  assert.match(refreshFn, /setFetchTick/)
})

test('boot window + idle watch catch the login-kick race', () => {
  // The reported lifecycle: delete → login → auto-sync completes while the
  // held payload still claims 'idle' (the sync row hadn't stamped its claim
  // before /api/dashboard was generated). Two guarantees close the gap:
  // 1. the first SYNC_BOOT_WATCH_MS after mount polls at the in-flight
  //    cadence even when the payload says idle — a kicked sync is seen
  //    within seconds, not missed entirely;
  // 2. after the window an idle watch keeps polling slowly forever, so a
  //    cron/other-tab completion mid-session still lands.
  assert.equal(SYNC_BOOT_WATCH_MS, 90_000)
  assert.equal(passivePollMs('idle', true), 2000)
  assert.equal(passivePollMs('idle'), 60_000)
  // Wiring: the poll interval is no longer skipped for idle payloads and
  // receives the boot flag.
  assert.match(liveSrc, /passivePollMs\(syncStatus, booting\)/)
  assert.match(liveSrc, /SYNC_BOOT_WATCH_MS/)
  assert.doesNotMatch(liveSrc, /cadence == null/)
})

test('the refresh path never starts a sync — refresh() only re-fetches', () => {
  const refreshFn = liveSrc.slice(
    liveSrc.indexOf('const refresh = useCallback'),
    liveSrc.indexOf('// Passive sync observation'),
  )
  assert.doesNotMatch(refreshFn, /syncNow|\/api\/sync/)
})

/* ── zero-metrics assist model ──────────────────────────────────────── */

const emptyAll = { summary: { commits: 0, activeDays: 0 } }
const liveAll = { summary: { commits: 128, activeDays: 42 } }

test('metricsEmpty reads the all-time payload', () => {
  assert.equal(metricsEmpty(emptyAll), true)
  assert.equal(metricsEmpty(liveAll), false)
  assert.equal(metricsEmpty(null), false)
  assert.equal(metricsEmpty({}), false)
})

test('assist delay is ten seconds', () => {
  assert.equal(ASSIST_DELAY_MS, 10_000)
})

test('assist arms only for a live, resolved, empty, idle ledger', () => {
  const base = { live: true, resolving: false, empty: true, status: 'idle', pumping: false, dismissed: false }
  assert.equal(assistArmed(base), true)
  assert.equal(assistArmed({ ...base, live: false }), false)        // no payload / unauthenticated
  assert.equal(assistArmed({ ...base, resolving: true }), false)   // still loading — never flash
  assert.equal(assistArmed({ ...base, empty: false }), false)      // populated account
  assert.equal(assistArmed({ ...base, pumping: true }), false)     // local pump running
  assert.equal(assistArmed({ ...base, dismissed: true }), false)   // dismissed this session
})

test('assist is suppressed while a sync is running or queued behind a rate limit', () => {
  const base = { live: true, resolving: false, empty: true, pumping: false, dismissed: false }
  assert.equal(assistArmed({ ...base, status: 'syncing' }), false)
  assert.equal(assistArmed({ ...base, status: 'rate_limited' }), false)
  assert.equal(assistArmed({ ...base, status: 'complete' }), true)
  assert.equal(assistArmed({ ...base, status: 'error' }), true)
  assert.equal(assistArmed({ ...base, status: 'needs_install' }), true)
})

/* ── assist component wiring ────────────────────────────────────────── */

const assistSrc = src('src/components/SyncAssist.tsx')

test('assist fires the canonical syncNow pump — no parallel sync', () => {
  assert.match(assistSrc, /syncNow\(\)/)
  assert.doesNotMatch(assistSrc, /fetch\(['"]\/api\/sync/)
})

test('assist has a live region, a real dismiss control, and session dismissal', () => {
  assert.match(assistSrc, /aria-live="polite"/)
  assert.match(assistSrc, /aria-label="dismiss sync prompt"/)
  assert.ok(assistSrc.includes('ASSIST_DISMISS_KEY'))
  assert.match(assistSrc, /sessionStorage\.setItem\(ASSIST_DISMISS_KEY/)
})

test('assist waits the full delay before it can render', () => {
  assert.ok(assistSrc.includes('ASSIST_DELAY_MS'))
  assert.match(assistSrc, /setTimeout\(\(\) => setVisible\(true\),\s*ASSIST_DELAY_MS\)/)
})

test('assist mounts inside the app shell next to the sync monitor', () => {
  const app = src('src/App.tsx')
  assert.match(app, /<SyncAssist \/>/)
  assert.match(app, /<SyncMonitor \/>/)
})
