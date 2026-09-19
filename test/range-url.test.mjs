import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rangeFromSearch, rangeQuery, makeRange } from '../src/range.js'

// Canonical URL ↔ range-state contract. Explicit from/to params always resolve
// to CUSTOM and take precedence over any preset param; only the six named
// presets resolve via ?range=.

test('from+to resolves to custom with exact dates', () => {
  const r = rangeFromSearch('?from=2025-07-17&to=2025-07-24')
  assert.deepEqual(r, { mode: 'custom', from: '2025-07-17', to: '2025-07-24' })
})

test('explicit dates beat a preset param', () => {
  const r = rangeFromSearch('?range=7d&from=2025-07-17&to=2025-07-24')
  assert.equal(r.mode, 'custom')
  assert.equal(r.from, '2025-07-17')
})

test('named presets resolve', () => {
  for (const m of ['7d', '30d', '90d', 'ytd', '1y', 'all']) {
    const r = rangeFromSearch(`?range=${m}`)
    assert.equal(r.mode, m, m)
  }
})

test('partial custom params still resolve to custom', () => {
  assert.deepEqual(rangeFromSearch('?from=2025-07-17'), { mode: 'custom', from: '2025-07-17', to: null })
  assert.deepEqual(rangeFromSearch('?to=2025-07-24'), { mode: 'custom', from: null, to: '2025-07-24' })
})

test('unknown or bare custom range param yields null (caller falls back)', () => {
  assert.equal(rangeFromSearch('?range=bogus'), null)
  assert.equal(rangeFromSearch('?range=custom'), null)
  assert.equal(rangeFromSearch(''), null)
  assert.equal(rangeFromSearch('?unrelated=1'), null)
})

test('rangeQuery writes from/to for custom, range for presets', () => {
  const q = rangeQuery({ mode: 'custom', from: '2025-07-17', to: '2025-07-24' })
  const params = new URLSearchParams(q)
  assert.equal(params.get('from'), '2025-07-17')
  assert.equal(params.get('to'), '2025-07-24')
  assert.equal(params.get('range'), null)
  assert.equal(rangeQuery({ mode: '7d' }), 'range=7d')
})

test('round-trip: rangeQuery output re-resolves to the same range', () => {
  const custom = { mode: 'custom', from: '2025-07-17', to: '2025-07-24' }
  assert.deepEqual(rangeFromSearch(rangeQuery(custom)), custom)
  for (const m of ['7d', '30d', '90d', 'ytd', '1y']) {
    const r = rangeFromSearch(rangeQuery({ mode: m }))
    assert.equal(r.mode, m)
  }
  assert.equal(rangeFromSearch(rangeQuery({ mode: 'all' })).mode, 'all')
})

test('makeRange custom preserves exact dates', () => {
  const r = makeRange('custom', '2025-07-17', '2025-07-24')
  assert.deepEqual(r, { mode: 'custom', from: '2025-07-17', to: '2025-07-24' })
})
