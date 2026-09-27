import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

// Right-rail jump nav — the registry is exactly the listed sections, every
// entry resolves to a real anchor in the page source, and the GROWTH/
// PROJECTS side-by-side pair uses a deterministic spy sentinel so GROWTH
// can actually activate.

const { PAGE_SECTIONS } = await import('../src/pages.ts')

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const src = (p) => readFileSync(path.join(root, p), 'utf8')
const pagesSrc = src('src/pages.ts')
const activitySrc = src('src/components/ActivityPage.tsx')
const codeSrc = src('src/components/CodePage.tsx')

/* ── registries are exactly the requested sets ──────────────────────── */

test('activity rail is exactly EXTREMES / CIRCADIAN / RHYTHM', () => {
  assert.deepEqual(
    PAGE_SECTIONS.activity.map((a) => a.name),
    ['EXTREMES', 'CIRCADIAN', 'RHYTHM'],
  )
})

test('code rail is exactly COMPOSITION / LANGUAGES / GROWTH / PROJECTS', () => {
  assert.deepEqual(
    PAGE_SECTIONS.code.map((a) => a.name),
    ['COMPOSITION', 'LANGUAGES', 'GROWTH', 'PROJECTS'],
  )
})

test('overview rail is unchanged', () => {
  assert.deepEqual(
    PAGE_SECTIONS.overview.map((a) => a.name),
    ['MEASURE', 'FIELD', 'INDEX', 'LONGITUDINAL'],
  )
})

/* ── every rail entry resolves to a real anchor in the page source ──── */

test('activity rail anchors exist in ActivityPage', () => {
  for (const a of PAGE_SECTIONS.activity) {
    assert.ok(activitySrc.includes(`id="${a.id}"`), `missing #${a.id}`)
  }
})

test('code rail anchors exist in CodePage', () => {
  for (const a of PAGE_SECTIONS.code) {
    assert.ok(codeSrc.includes(`id="${a.id}"`), `missing #${a.id}`)
  }
})

/* ── GROWTH/PROJECTS deterministic spy sentinel ─────────────────────── */

test('code-projects carries a spy sentinel for side-by-side detection', () => {
  const projects = PAGE_SECTIONS.code.find((a) => a.id === 'code-projects')
  assert.equal(projects.spy, 'code-projects-spy')
  // The sentinel must exist in the growth column — after GrowthCurve and
  // before the projects column, so it marks where the chart region ends.
  const chartIdx = codeSrc.indexOf('<GrowthCurve points={growth} />')
  const spyIdx = codeSrc.indexOf('id="code-projects-spy"', chartIdx)
  const projectsIdx = codeSrc.indexOf('id="code-projects"', spyIdx)
  assert.ok(chartIdx > -1 && spyIdx > chartIdx && projectsIdx > spyIdx)
})

test('useActiveAnchor resolves the spy element for active detection', () => {
  const spyFn = pagesSrc.slice(pagesSrc.indexOf('export function useActiveAnchor'))
  // spy overrides the measured element; `id` remains the logical anchor
  // that jumpToAnchor scrolls to.
  assert.match(spyFn, /return \{ id, el: spy \|\| id \}/)
  assert.match(spyFn, /document\.getElementById\(el\)/)
})

test('jumpToAnchor still scrolls to the anchor id, not the spy', () => {
  const jumpFn = pagesSrc.slice(pagesSrc.indexOf('export function jumpToAnchor'))
  assert.match(jumpFn, /document\.getElementById\(id\)/)
})
