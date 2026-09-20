import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  mergeIntervals,
  addInterval,
  coversRange,
  contiguousCoverageFrom,
  rangeCoverageStatus,
  computeSyncProgress,
} from '../lib/coverage.mjs'
import { walkHistory } from '../lib/sync.mjs'

const iv = (from, to, complete = false) => ({ from, to, complete })

// ---- intervals -------------------------------------------------------------

test('mergeIntervals merges overlapping intervals', () => {
  const merged = mergeIntervals([
    iv('2025-08-01T00:00:00Z', '2025-09-01T00:00:00Z'),
    iv('2025-08-15T00:00:00Z', '2025-10-01T00:00:00Z'),
    iv('2025-01-01T00:00:00Z', '2025-02-01T00:00:00Z'),
  ])
  assert.equal(merged.length, 2)
  assert.equal(merged[0].from, '2025-01-01T00:00:00Z')
  assert.equal(merged[1].to, '2025-10-01T00:00:00Z')
})

test('complete flag is sticky when intervals merge', () => {
  const merged = mergeIntervals([
    iv('2025-08-01T00:00:00Z', '2025-09-01T00:00:00Z', true),
    iv('2025-08-15T00:00:00Z', '2025-10-01T00:00:00Z'),
  ])
  assert.equal(merged.length, 1)
  assert.equal(merged[0].complete, true)
})

// ---- per-repo coverage ------------------------------------------------------

test('coversRange: fully covered range', () => {
  const ivs = [iv('2025-01-01T00:00:00Z', '2026-01-01T00:00:00Z')]
  assert.equal(coversRange(ivs, '2025-07-17T00:00:00.000Z', '2025-07-24T23:59:59.999Z'), true)
})

test('coversRange: range before coverage is not covered', () => {
  const ivs = [iv('2025-08-01T00:00:00Z', '2026-01-01T00:00:00Z')]
  assert.equal(coversRange(ivs, '2025-07-17T00:00:00.000Z', '2025-07-24T23:59:59.999Z'), false)
})

test('coversRange: open-ended from requires complete interval', () => {
  const partial = [iv('2025-08-01T00:00:00Z', '2026-01-01T00:00:00Z')]
  const complete = [iv('2025-08-01T00:00:00Z', '2026-01-01T00:00:00Z', true)]
  assert.equal(coversRange(partial, null, '2026-01-01T00:00:00Z'), false)
  assert.equal(coversRange(complete, null, '2026-01-01T00:00:00Z'), true)
})

test('coversRange: boundary days are inclusive', () => {
  const ivs = [iv('2025-07-17T00:00:00.000Z', '2025-07-24T23:59:59.999Z')]
  assert.equal(coversRange(ivs, '2025-07-17T00:00:00.000Z', '2025-07-24T23:59:59.999Z'), true)
  // one day earlier is outside
  assert.equal(coversRange(ivs, '2025-07-16T00:00:00.000Z', '2025-07-24T23:59:59.999Z'), false)
  // midnight boundary: a commit at 00:00:00 on the last covered day is in-range
  assert.equal(coversRange(ivs, '2025-07-24T00:00:00.000Z', '2025-07-24T23:59:59.999Z'), true)
})

// ---- aggregate range status --------------------------------------------------

test('rangeCoverageStatus: all repos covered → complete (genuine zero is shown)', () => {
  const perRepo = [
    [iv('2025-01-01T00:00:00Z', '2026-09-18T00:00:00Z', true)],
    [iv('2025-06-01T00:00:00Z', '2026-09-18T00:00:00Z', true)],
  ]
  const r = rangeCoverageStatus(perRepo, { from: '2025-07-17', to: '2025-07-24' })
  assert.equal(r.status, 'complete')
})

test('rangeCoverageStatus: partially covered → partial with availableFrom', () => {
  const perRepo = [
    [iv('2025-01-01T00:00:00Z', '2026-09-18T00:00:00Z', true)],
    [iv('2025-08-01T00:00:00Z', '2026-09-18T00:00:00Z')], // only synced from Aug
  ]
  const r = rangeCoverageStatus(perRepo, { from: '2025-07-17', to: '2025-07-24' })
  assert.equal(r.status, 'partial')
  assert.equal(r.availableFrom, '2025-08-01T00:00:00Z')
})

test('rangeCoverageStatus: no coverage → missing', () => {
  const perRepo = [[], []]
  const r = rangeCoverageStatus(perRepo, { from: '2025-07-17', to: '2025-07-24' })
  assert.equal(r.status, 'missing')
})

test('coversRange: range ending today is covered by a scan earlier today', () => {
  // covered_to is a scan timestamp (e.g. 09:14), while a "today" request ends
  // at 23:59:59.999 — in the future. Coverage cannot extend past now, so this
  // must not report uncovered.
  const now = new Date()
  const today = now.toISOString().slice(0, 10)
  const ivs = [iv('2025-01-01T00:00:00Z', now.toISOString(), true)]
  assert.equal(coversRange(ivs, '2025-07-17T00:00:00.000Z', `${today}T23:59:59.999Z`), true)
  assert.equal(
    rangeCoverageStatus([ivs], { from: '2025-07-17', to: today }).status,
    'complete'
  )
})

test('rangeCoverageStatus: syncing flag wins over partial', () => {
  const perRepo = [[iv('2025-08-01T00:00:00Z', '2026-09-18T00:00:00Z')]]
  assert.equal(rangeCoverageStatus(perRepo, { from: '2025-01-01', to: '2025-02-01' }, true).status, 'syncing')
})

test('targeted interval fills a gap → status becomes complete', () => {
  let ivs = [iv('2025-08-01T00:00:00Z', '2026-09-18T00:00:00Z')]
  assert.equal(coversRange(ivs, '2025-07-17T00:00:00.000Z', '2025-07-24T23:59:59.999Z'), false)
  ivs = addInterval(ivs, iv('2025-07-17T00:00:00.000Z', '2025-07-24T23:59:59.999Z', true))
  assert.equal(coversRange(ivs, '2025-07-17T00:00:00.000Z', '2025-07-24T23:59:59.999Z'), true)
})

// ---- progress model ----------------------------------------------------------

test('progress never reports 100% before all phases finish', () => {
  const p = computeSyncProgress({ reposTotal: 3, metaDone: 3, historyDone: 2, historyActive: 1, pullsDone: false })
  assert.ok(p < 1, `expected <1, got ${p}`)
  assert.ok(p > 0.5)
  const done = computeSyncProgress({ reposTotal: 3, metaDone: 3, historyDone: 3, historyActive: 0, pullsDone: true })
  assert.equal(done, 1)
})

// ---- history walker (pagination / resume / dedupe semantics) -----------------

const page = (nodes, hasNextPage, endCursor) => ({ nodes, pageInfo: { hasNextPage, endCursor } })
const node = (sha, date) => ({ oid: sha, committedDate: date })

test('walkHistory paginates beyond the first page', async () => {
  const pages = [
    page([node('a', '2026-01-03T00:00:00Z'), node('b', '2026-01-02T00:00:00Z')], true, 'c1'),
    page([node('c', '2026-01-01T00:00:00Z')], false, 'c2'),
  ]
  const calls = []
  const seen = []
  const w = await walkHistory({
    fetch: async (cursor) => { calls.push(cursor); return pages[calls.length - 1] },
    onPage: async (nodes) => seen.push(...nodes.map((n) => n.oid)),
    expired: () => false,
  })
  assert.deepEqual(seen, ['a', 'b', 'c'])
  assert.deepEqual(calls, [null, 'c1']) // second page used the cursor
  assert.equal(w.hasMore, false)
  assert.equal(w.oldest, '2026-01-01T00:00:00Z')
  assert.equal(w.newest, '2026-01-03T00:00:00Z')
})

test('walkHistory stops on budget and reports resume cursor', async () => {
  const pages = [page([node('a', '2026-01-03T00:00:00Z')], true, 'c1')]
  let expiredCalls = 0
  const w = await walkHistory({
    fetch: async () => pages[0],
    onPage: async () => {},
    expired: () => ++expiredCalls > 0, // expire after first page
  })
  assert.equal(w.hasMore, true)
  assert.equal(w.after, 'c1') // caller persists this as the resume cursor
})

test('walkHistory handles repos with no attributed history', async () => {
  const w = await walkHistory({
    fetch: async () => page([], false, null),
    onPage: async () => assert.fail('should not emit pages'),
    expired: () => false,
  })
  assert.equal(w.hasMore, false)
  assert.equal(w.total, 0)
  assert.equal(w.oldest, null)
})

test('incremental pass: since-filtered fetch returns only new commits', async () => {
  // Simulates GitHub honoring `since` — only commits newer than the watermark
  // are returned, so immutable stored SHAs are never re-fetched.
  const stored = new Set(['a', 'b'])
  const w = await walkHistory({
    fetch: async () => page([node('c', '2026-02-01T00:00:00Z')], false, null),
    onPage: async (nodes) => {
      for (const n of nodes) assert.ok(!stored.has(n.oid), 're-fetched an immutable commit')
    },
    expired: () => false,
  })
  assert.equal(w.total, 1)
})
