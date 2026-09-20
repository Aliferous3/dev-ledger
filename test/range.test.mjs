import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseRange, expandRange, validateRange } from '../lib/range.mjs'

test('parseRange defaults to all time', () => {
  assert.deepEqual(parseRange({}), { from: null, to: null })
})

test('parseRange accepts named ranges', () => {
  const r = parseRange({ range: '30d' })
  assert.ok(r.from && r.to)
  const days = (new Date(r.to) - new Date(r.from)) / 86400000 + 1
  assert.equal(days, 30)
})

test('parseRange rejects bad input', () => {
  assert.throws(() => parseRange({ range: 'bogus' }))
  assert.throws(() => parseRange({ from: '16-09-2026' }))
  assert.throws(() => parseRange({ from: '2026-09-20', to: '2026-09-01' }))
  assert.throws(() => parseRange({ from: '2999-01-01' }))
})

test('expandRange ytd starts Jan 1', () => {
  const r = expandRange('ytd')
  assert.equal(r.from.slice(5), '01-01')
  assert.equal(r.to, new Date().toISOString().slice(0, 10))
})

test('validateRange allows open-ended ranges', () => {
  assert.deepEqual(validateRange('2026-01-01', null), { from: '2026-01-01', to: null })
})
