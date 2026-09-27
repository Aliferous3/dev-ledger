import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  COLLAPSE_HOLD_MS,
  MON_PHASES,
  collapsedFrac,
  collapsedLabel,
  monitorCounts,
  monitorRows,
  monitorTag,
  shouldAutoExpand,
} from '../src/ledger/syncMonitorModel.mjs'
import { PAGES, PAGE_SECTIONS, pageFromPath, pathForPage } from '../src/pages.ts'

const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

/* ── SYNC.04 row mapping — real phase/detail only ── */

const syncing = (over = {}) => ({
  status: 'syncing',
  phase: 'commits',
  progress: 0.5,
  detail: {
    repos: { done: 3, total: 7 },
    history: { done: 2, total: 7, active: 1, commits: 400 },
    pulls: { done: false, count: 12 },
  },
  ...over,
})

test('six monitor rows in canonical phase order', () => {
  assert.deepEqual(MON_PHASES, [
    'DISCOVER', 'METADATA', 'COMMITS', 'PULLS', 'RANGE', 'FINALIZING',
  ])
})

test('mid-run rows: real counts drive meters, phase order drives states', () => {
  const rows = monitorRows(syncing())
  assert.equal(rows[0].st, 'ok')                       // DISCOVER finished
  assert.equal(rows[1].st, 'run')                      // METADATA 3/7 real
  assert.ok(Math.abs(rows[1].frac - 3 / 7) < 1e-9)     // real done/total
  assert.equal(rows[2].st, 'run')                      // COMMITS 2/7 real
  assert.ok(Math.abs(rows[2].frac - 2 / 7) < 1e-9)
  assert.equal(rows[3].st, 'run')                      // PULLS in-flight
  assert.equal(rows[4].st, '--')                       // RANGE not started
  assert.equal(rows[5].st, '--')                       // FINALIZING pending
})

test('metadata is never marked ok while its real count is partial', () => {
  const rows = monitorRows(
    syncing({ phase: 'finalizing', detail: { repos: { done: 5, total: 7 }, history: { done: 7, total: 7 }, pulls: { done: true } } }),
  )
  assert.equal(rows[1].st, 'run')
  assert.ok(Math.abs(rows[1].frac - 5 / 7) < 1e-9)
  assert.equal(rows[2].st, 'ok')
  assert.equal(rows[5].st, 'run')
})

test('discover phase: only DISCOVER runs, rest pending', () => {
  const rows = monitorRows(syncing({ phase: 'discover', detail: { repos: { done: 0, total: 0 }, history: { done: 0, total: 0 }, pulls: { done: false } } }))
  assert.equal(rows[0].st, 'run')
  assert.equal(rows[1].st, '--')
  assert.equal(rows[2].st, '--')
  assert.equal(rows[3].st, '--')
})

test('complete run: every row ok with full meter', () => {
  const rows = monitorRows({ status: 'complete', phase: 'done', progress: 1 })
  for (const r of rows) {
    assert.equal(r.st, 'ok')
    assert.equal(r.frac, 1)
  }
})

test('error: rows before failure ok, failing row exit1, rest pending', () => {
  const rows = monitorRows({ status: 'error', phase: 'commits', progress: 0.4, detail: syncing().detail })
  assert.equal(rows[0].st, 'ok')
  assert.equal(rows[1].st, 'ok')
  assert.equal(rows[2].st, 'exit1')
  assert.equal(rows[2].state, 'fail')
  assert.equal(rows[3].st, '--')
  assert.equal(rows[4].st, '--')
  assert.equal(rows[5].st, '--')
})

test('revoked: every row denied EACCES', () => {
  const rows = monitorRows({ status: 'revoked', phase: 'commits', progress: 0.4 })
  for (const r of rows) {
    assert.equal(r.st, 'EACCES')
    assert.equal(r.frac, 0)
  }
})

test('rate_limited marks in-flight rows RATE (resumes automatically)', () => {
  const rows = monitorRows(syncing({ status: 'rate_limited' }))
  assert.equal(rows[0].st, 'ok')
  assert.equal(rows[1].st, 'rate')
  assert.equal(rows[2].st, 'rate')
})

test('range sync drives the RANGE row', () => {
  const rows = monitorRows(
    syncing({ phase: 'range', detail: { repos: { done: 7, total: 7 }, history: { done: 7, total: 7 }, pulls: { done: true }, rangeSync: { from: '2025-01-01', to: '2025-02-01' } } }),
  )
  assert.equal(rows[4].st, 'run')
})

test('idle: nothing claims progress', () => {
  const rows = monitorRows({ status: 'idle' })
  for (const r of rows) assert.equal(r.st, '--')
})

/* ── collapsed grammar ── */

test('collapsed label + meter per status', () => {
  assert.equal(collapsedLabel({ status: 'syncing', progress: 0.72 }), '72% SYNC')
  assert.ok(Math.abs(collapsedFrac({ status: 'syncing', progress: 0.72 }) - 0.72) < 1e-9)
  assert.equal(collapsedLabel({ status: 'complete' }), 'DONE')
  assert.equal(collapsedFrac({ status: 'complete' }), 1)
  assert.equal(collapsedLabel({ status: 'error' }), 'EXIT 1')
  assert.equal(collapsedLabel({ status: 'revoked' }), 'EACCES')
  assert.equal(collapsedFrac({ status: 'revoked' }), 0)
  assert.equal(collapsedLabel({ status: 'rate_limited' }), 'RATE LIM')
  assert.equal(collapsedLabel({ status: 'idle' }), 'IDLE')
  assert.equal(collapsedLabel({ status: 'syncing' }, true), 'DONE')
})

test('monitor tag + footer counts come from real detail', () => {
  assert.equal(monitorTag(syncing()), '50%')
  assert.equal(monitorTag({ status: 'rate_limited' }), 'RATE LIMITED')
  const c = monitorCounts(syncing())
  assert.deepEqual(c, { commits: 400, pulls: 12, repos: 7 })
})

/* ── expansion policy ── */

test('auto-expand on syncing and every blocked state; never on idle/complete', () => {
  assert.equal(shouldAutoExpand('syncing'), true)
  assert.equal(shouldAutoExpand('rate_limited'), true)
  assert.equal(shouldAutoExpand('error'), true)
  assert.equal(shouldAutoExpand('revoked'), true)
  assert.equal(shouldAutoExpand('idle'), false)
  assert.equal(shouldAutoExpand('complete'), false)
})

test('post-success hold is ~1.8s, not instant', () => {
  assert.ok(COLLAPSE_HOLD_MS >= 1500 && COLLAPSE_HOLD_MS <= 2500)
})

/* ── three-page registry + routing ── */

test('exactly three pages: OVERVIEW / ACTIVITY / CODE', () => {
  assert.equal(PAGES.length, 3)
  assert.deepEqual(PAGES.map((p) => p.name), ['OVERVIEW', 'ACTIVITY', 'CODE'])
  assert.deepEqual(PAGES.map((p) => p.path), ['/', '/activity', '/code'])
})

test('pageFromPath resolves routes + alias + fallback', () => {
  assert.equal(pageFromPath('/'), 'overview')
  assert.equal(pageFromPath('/overview'), 'overview')
  assert.equal(pageFromPath('/activity'), 'activity')
  assert.equal(pageFromPath('/code'), 'code')
  assert.equal(pageFromPath('/activity/'), 'activity')
  assert.equal(pageFromPath('/nonexistent'), 'overview')
  assert.equal(pathForPage('activity'), '/activity')
  assert.equal(pathForPage('code'), '/code')
  assert.equal(pathForPage('overview'), '/')
})

test('every page has a rail anchor index whose ids exist in page source', () => {
  const act = src('src/components/ActivityPage.tsx')
  const code = src('src/components/CodePage.tsx')
  for (const a of PAGE_SECTIONS.activity) assert.ok(act.includes(`id="${a.id}"`), a.id)
  for (const a of PAGE_SECTIONS.code) assert.ok(code.includes(`id="${a.id}"`), a.id)
})

/* ── source guards ── */

test('App mounts exactly one page at a time and the app-level SyncMonitor', () => {
  const app = src('src/App.tsx')
  assert.ok(app.includes("page === 'overview'"))
  assert.ok(app.includes("page === 'activity'"))
  assert.ok(app.includes("page === 'code'"))
  assert.ok(app.includes('<SyncMonitor />'))
  assert.ok(!app.includes('SyncInstrument'))
  // page remount drives the M12 re-apply on navigation
  assert.ok(app.includes('key={page}'))
})

test('header nav exposes only the three pages', () => {
  const h = src('src/components/TerminalTickerHeader.tsx')
  assert.ok(h.includes('PAGES.map'))
  for (const banned of ['PROJECTS', 'FIELD', 'INDEX', 'ARCHIVE', 'SECTIONS']) {
    assert.ok(!h.includes(`name: '${banned}'`), banned)
  }
  assert.ok(h.includes("aria-current={on ? 'page' : undefined}"))
})

test('vercel rewrites make direct loads + refresh work on all pages', () => {
  const v = JSON.parse(src('vercel.json'))
  const dests = v.rewrites.map((r) => r.source)
  for (const p of ['/overview', '/activity', '/code']) assert.ok(dests.includes(p), p)
  for (const r of v.rewrites.filter((r) => r.source !== '/api/feedback'))
    assert.equal(r.destination, '/index.html')
})

test('M12 primitive: diff-apply grammar, 34ms stagger, transient glyph', () => {
  const css = src('src/index.css')
  assert.ok(css.includes('@keyframes diff-apply'))
  assert.ok(css.includes('rgba(214, 255, 62, 0.16)'))
  assert.ok(css.includes('inset 2px 0 0 #d6ff3e'))
  assert.ok(css.includes('content: "+"'))
  const m = src('src/ledger/m12.tsx')
  assert.ok(m.includes('M12_STAGGER_MS = 34'))
  assert.ok(m.includes('IntersectionObserver'))
  // fires once — element unobserved after apply
  assert.ok(m.includes('unobserve'))
})

test('SyncMonitor is a view of the shared store — no parallel sync state', () => {
  const c = src('src/components/SyncMonitor.tsx')
  assert.ok(c.includes('useLedger'))
  assert.ok(c.includes('monitorRows'))
  assert.ok(!c.includes('setInterval'))
  assert.ok(c.includes('aria-expanded'))
  assert.ok(c.includes('Escape'))
})
