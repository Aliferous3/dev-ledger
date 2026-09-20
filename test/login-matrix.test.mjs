import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildMatrix, MATRIX_YEARS, MATRIX_COLS, MATRIX_ROWS, ROWS_PER_YEAR } from '../src/loginMatrix.js'

test('matrix is deterministic — same seed, same cells', () => {
  const a = buildMatrix()
  const b = buildMatrix()
  assert.deepEqual(a, b)
})

test('matrix dimensions: ROWS_PER_YEAR rows per year index label', () => {
  const cells = buildMatrix()
  assert.equal(cells.length, MATRIX_ROWS * MATRIX_COLS)
  assert.equal(MATRIX_ROWS, MATRIX_YEARS.length * ROWS_PER_YEAR)
  const rows = new Set(cells.map((c) => c.r))
  assert.equal(rows.size, MATRIX_ROWS)
  for (const c of cells) assert.equal(Math.floor(c.r / ROWS_PER_YEAR), c.year)
})

test('luminance is sparse — mostly dark, few bright cells', () => {
  const cells = buildMatrix()
  const dark = cells.filter((c) => c.level <= 1).length
  const bright = cells.filter((c) => c.level === 4).length
  assert.ok(dark / cells.length > 0.7, 'majority of cells should be dark')
  assert.ok(bright / cells.length < 0.08, 'bright cells should be sparse')
})

test('assembly sweep stays inside the master timeline grid phase', () => {
  const cells = buildMatrix()
  for (const c of cells) {
    assert.ok(c.assembleDelay >= 1.25 && c.assembleDelay <= 2.2, `assemble ${c.assembleDelay} outside P4`)
    assert.ok(c.breatheDelay > c.assembleDelay, 'breathing starts after assembly')
    assert.ok(c.breatheDur >= 3.5 && c.breatheDur <= 8, `breathe ${c.breatheDur}s outside 3.5–8s`)
  }
})

test('delays are not synchronized — distinct phases per cell', () => {
  const cells = buildMatrix()
  const delays = new Set(cells.map((c) => c.breatheDelay))
  assert.ok(delays.size > cells.length * 0.8, 'breathe phases should be well distributed')
})

test('login page wires the real auth route', () => {
  const src = readFileSync(new URL('../src/Login.jsx', import.meta.url), 'utf8')
  assert.match(src, /href='\/api\/auth\/login'/)
})

test('year index renders left of the matrix (DOM order)', () => {
  const src = readFileSync(new URL('../src/Login.jsx', import.meta.url), 'utf8')
  const field = src.slice(src.indexOf('function HistoryField'), src.indexOf('export default'))
  assert.ok(field.indexOf('auth-year-index') < field.indexOf("'auth-matrix grid'"), 'year index should precede the matrix')
  assert.ok(field.includes('items-end'), 'year labels should right-align in their gutter')
})

test('breathing rests dark and excursions rise — lo < hi for every cell', () => {
  const cells = buildMatrix()
  for (const c of cells) {
    assert.ok(c.lo < c.hi, `cell ${c.r}-${c.c} lo ${c.lo} !< hi ${c.hi}`)
    assert.ok(c.lo <= 0.55, 'resting opacity should stay dark')
    assert.ok(c.hi <= 1)
  }
  // peak intensity is seeded, not uniform — dark cells crest variably
  const his = new Set(cells.filter((c) => c.level < 3).map((c) => c.hi))
  assert.ok(his.size > 20, 'peak luminance should be seeded per cell')
})

test('structure unchanged — 24 continuous rows, 24 cols, same spacing vars', () => {
  assert.equal(MATRIX_ROWS, 24)
  assert.equal(MATRIX_COLS, 24)
  const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8')
  assert.ok(css.includes('--cell') && css.includes('--cgap'), 'spacing vars preserved')
})
