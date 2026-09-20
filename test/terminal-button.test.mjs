import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { TB_PROMPT, TB_BLINK_OK, tbtnClass, tbtnPrompt, tbtnCursor } from '../src/tbtnSpec.js'

const src = (f) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', f), 'utf8')

test('variant prompts: > for benign, ! for danger', () => {
  assert.equal(tbtnPrompt('primary'), '>')
  assert.equal(tbtnPrompt('secondary'), '>')
  assert.equal(tbtnPrompt('danger'), '!')
  assert.equal(tbtnPrompt('bogus'), '>') // falls back to secondary
})

test('class map carries variant + modifiers', () => {
  assert.equal(tbtnClass({ variant: 'primary' }), 'tbtn tbtn-primary')
  assert.equal(tbtnClass({ variant: 'danger', compact: true }), 'tbtn tbtn-danger tbtn-compact')
  assert.ok(tbtnClass({ variant: 'secondary', active: true }).includes('tbtn-active'))
})

test('solid + large modifiers produce the paper CTA classes', () => {
  const cls = tbtnClass({ variant: 'primary', solid: true, size: 'lg' })
  assert.ok(cls.includes('tbtn-primary'))
  assert.ok(cls.includes('tbtn-solid'))
  assert.ok(cls.includes('tbtn-lg'))
})

test('cursor policy: primary may blink, secondary/danger degrade to static', () => {
  assert.equal(tbtnCursor({ variant: 'primary' }), 'blink')
  assert.equal(tbtnCursor({ variant: 'secondary' }), 'none')
  assert.equal(tbtnCursor({ variant: 'secondary', cursor: 'blink' }), 'static')
  assert.equal(tbtnCursor({ variant: 'danger', cursor: 'blink' }), 'static')
  assert.equal(tbtnCursor({ variant: 'secondary', cursor: 'static' }), 'static')
  assert.equal(tbtnCursor({ variant: 'primary', cursor: 'none' }), 'none')
  assert.equal(tbtnCursor({ variant: 'secondary', loading: true }), 'blink') // loading communicates
  assert.equal(TB_BLINK_OK.primary, true)
  assert.equal(TB_PROMPT.danger, '!')
})

test('login renders the exact product description', () => {
  const login = src('Login.jsx')
  for (const line of [
    'FROM YOUR FIRST COMMIT TO YOUR LATEST.',
    'TRACE WHAT YOU BUILT, WHEN YOU BUILT IT,',
    'AND HOW YOUR WORK CHANGED ALONG THE WAY.',
  ]) {
    assert.ok(login.includes(`'${line}'`), `missing product line: ${line}`)
  }
  assert.ok(!login.includes('make something'), 'old prompt copy still present')
})

test('right terminal copy replaced', () => {
  const login = src('Login.jsx')
  assert.ok(login.includes('// commits become chronology'))
  assert.ok(login.includes('// chronology becomes a body of work'))
  assert.ok(login.includes('connect github'))
})

test('login CTA keeps the OAuth route through TerminalButton', () => {
  const login = src('Login.jsx')
  assert.ok(login.includes("href='/api/auth/login'"), 'CTA href changed')
  assert.ok(login.includes('continue with github'))
})

test('all eight year labels still render from MATRIX_YEARS', () => {
  const login = src('Login.jsx')
  assert.ok(login.includes('MATRIX_YEARS.map'), 'year index render removed')
  const matrix = src('loginMatrix.js')
  for (const y of [2026, 2025, 2024, 2023, 2022, 2021, 2020, 2019]) {
    assert.ok(matrix.includes(String(y)) || login.includes(String(y)), `year ${y} missing`)
  }
})

test('topology prompt line removed from GitTopology', () => {
  assert.ok(!src('GitTopology.jsx').includes('make something'))
})

test('folio masthead label removed entirely', () => {
  const login = src('Login.jsx')
  assert.ok(!login.includes('Folio'), 'folio label still present')
  assert.ok(!login.includes('VOL. I'), 'vol label still present')
  assert.ok(login.includes('GitHub / Auth'), 'right masthead label missing')
})

test('topology discoverability hint present', () => {
  assert.ok(src('GitTopology.jsx').includes('CLICK A NODE · DRAG TO BRANCH'))
})

test('login CTA uses the prominent solid primary variant', () => {
  const login = src('Login.jsx')
  const cta = login.slice(login.indexOf('<TerminalButton'), login.indexOf('</TerminalButton>'))
  assert.ok(cta.includes("variant='primary'"))
  assert.ok(cta.includes('solid'))
  assert.ok(cta.includes("size='lg'"))
})

test('background token still resolves to #131413', () => {
  const css = src('index.css')
  assert.ok(css.includes('--app-bg: #131413'))
})
