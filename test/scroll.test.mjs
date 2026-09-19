import { test } from 'node:test'
import assert from 'node:assert/strict'
import { smoothScrollEnabled, initSmoothScroll, destroySmoothScroll, scrollToTop } from '../src/scroll.js'

test('smooth scroll disabled under prefers-reduced-motion', () => {
  assert.equal(smoothScrollEnabled({ reduced: true, coarse: false }), false)
})

test('smooth scroll disabled on coarse-pointer (touch) devices', () => {
  assert.equal(smoothScrollEnabled({ reduced: false, coarse: true }), false)
})

test('smooth scroll enabled for fine-pointer full-motion clients', () => {
  assert.equal(smoothScrollEnabled({ reduced: false, coarse: false }), true)
})

test('init is a safe no-op without a DOM and cleanup is idempotent', () => {
  assert.equal(initSmoothScroll(), null) // no window in node:test
  destroySmoothScroll()
  destroySmoothScroll()
  assert.doesNotThrow(() => scrollToTop())
})
