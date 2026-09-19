import { test } from 'node:test'
import assert from 'node:assert/strict'

// Range-URL contract: explicit params win, the default range is a clean URL,
// storage never injects a query string, custom windows use ?from&to.

const store = {}
globalThis.window = {
  location: { search: '', pathname: '/' },
  localStorage: {
    getItem: (k) => store[k] ?? null,
    setItem: (k, v) => { store[k] = String(v) },
    removeItem: (k) => { delete store[k] },
  },
}

const { makeRange, rangeQuery, rangeFromSearch, readStoredRange, readInitialRange, DEFAULT_RANGE_MODE } =
  await import('../src/range.js')

const reset = () => { for (const k of Object.keys(store)) delete store[k]; window.location.search = '' }

test('rangeQuery: default mode produces a clean URL', () => {
  assert.equal(rangeQuery(makeRange(DEFAULT_RANGE_MODE)), '')
  assert.equal(DEFAULT_RANGE_MODE, '1y')
})

test('rangeQuery: non-default presets get ?range=', () => {
  for (const m of ['7d', '30d', '90d', 'ytd', 'all']) {
    assert.equal(rangeQuery(makeRange(m)), `range=${m}`)
  }
})

test('rangeQuery: custom windows use ?from&to', () => {
  assert.equal(rangeQuery({ mode: 'custom', from: '2026-01-01', to: '2026-02-01' }), 'from=2026-01-01&to=2026-02-01')
  assert.equal(rangeQuery({ mode: 'custom', from: '2026-01-01', to: null }), 'from=2026-01-01')
})

test('rangeFromSearch: explicit params win, from/to beats preset', () => {
  assert.equal(rangeFromSearch('?range=ytd').mode, 'ytd')
  const c = rangeFromSearch('?range=7d&from=2026-01-01&to=2026-01-31')
  assert.deepEqual(c, { mode: 'custom', from: '2026-01-01', to: '2026-01-31' })
  assert.equal(rangeFromSearch('?range=bogus'), null)
  assert.equal(rangeFromSearch(''), null)
  assert.equal(rangeFromSearch('?unrelated=1'), null)
})

test('readInitialRange: clean URL resolves stored then default — never writes URL', () => {
  reset()
  assert.equal(readInitialRange().mode, DEFAULT_RANGE_MODE)
  store['dev-dashboard-range'] = JSON.stringify({ mode: '30d' })
  const r = readInitialRange()
  assert.equal(r.mode, '30d')
  assert.equal(window.location.search, '', 'storage must not inject a query string')
})

test('readInitialRange: URL params beat localStorage', () => {
  reset()
  store['dev-dashboard-range'] = JSON.stringify({ mode: '7d' })
  window.location.search = '?range=ytd'
  assert.equal(readInitialRange().mode, 'ytd')
  window.location.search = '?from=2026-01-01&to=2026-01-31'
  assert.equal(readInitialRange().mode, 'custom')
})

test('stored default still round-trips to a clean URL', () => {
  reset()
  store['dev-dashboard-range'] = JSON.stringify({ mode: '1y' })
  const r = readInitialRange()
  assert.equal(r.mode, '1y')
  assert.equal(rangeQuery(r), '')
})
