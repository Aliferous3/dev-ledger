import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = (f) => readFileSync(join(root, f), 'utf8')

const quiet = src('src/QuietOverview.jsx')
const overview = src('src/Overview.jsx')
const chapters = src('src/scrollChapters.js')
const pkg = JSON.parse(src('package.json'))

const { CHAPTERS, ARCHIVE_FIGURES, MEASURE_BANDS, INDEX_BANDS, MEASURE_BOOT, figureIndex, figureWindow, chapterAt } = await import(
  pathToFileURL(join(root, 'src/scrollChapters.js')).href
)

test('chapters exist in order measure → field → index → archive', () => {
  assert.deepEqual(CHAPTERS.map((c) => c.id), ['measure', 'field', 'index', 'archive'])
  assert.deepEqual(CHAPTERS.map((c) => c.n), ['01', '02', '03', '04'])
})

test('chapter DOM order + anchor ids in composition', () => {
  for (const id of ['measure', 'field', 'index', 'archive']) {
    assert.match(quiet, new RegExp(`id='ch-${id}'`), `missing ch-${id} anchor`)
  }
  const order = ['measure', 'field', 'index', 'archive'].map((id) =>
    quiet.indexOf(`id='ch-${id}'`)
  )
  assert.ok(order.every((v) => v >= 0))
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'chapters out of order')
})

test('archive figure ordering fingerprint → succession → lifecycle → migration → span', () => {
  assert.deepEqual(
    ARCHIVE_FIGURES.map((f) => f.id),
    ['fingerprint', 'succession', 'lifecycle', 'migration', 'span']
  )
  // contiguous F·01..F·05 numbering — no gaps, no stale F·06
  assert.deepEqual(ARCHIVE_FIGURES.map((f) => f.n), ['F · 01', 'F · 02', 'F · 03', 'F · 04', 'F · 05'])
})

test('figureIndex/figureWindow partition scroll progress evenly', () => {
  assert.equal(figureIndex(0), 0)
  assert.equal(figureIndex(0.99), ARCHIVE_FIGURES.length - 1)
  assert.equal(figureIndex(0.5), 2)
  const [a0, b0] = figureWindow(0)
  const [a4, b4] = figureWindow(4)
  assert.equal(a0, 0)
  assert.equal(b4, 1)
  assert.ok(Math.abs(b0 - a0 - 1 / 5) < 1e-9)
  assert.ok(Math.abs(a4 - 4 / 5) < 1e-9)
})

test('chapterAt picks the track containing the scroll position', () => {
  const rects = [
    { top: 0, height: 1000 },
    { top: 1000, height: 1000 },
    { top: 2000, height: 1000 },
    { top: 3000, height: 2000 },
  ]
  assert.equal(chapterAt(500, rects), 0)
  assert.equal(chapterAt(1500, rects), 1)
  assert.equal(chapterAt(2500, rects), 2)
  assert.equal(chapterAt(4999, rects), 3)
})

test('reduced-motion / narrow viewport → flat stacked document', () => {
  assert.match(quiet, /prefers-reduced-motion|useReducedMotion/)
  assert.match(quiet, /scrollMode = !reduced && wide/)
  // flat path renders plain sections (no pinned tracks)
  assert.match(quiet, /if \(flat\) return <section id='ch-field'/)
  assert.match(quiet, /if \(flat\) return <section id='ch-index'/)
})

test('existing Lenis is reused — no second scroll engine, no GSAP', () => {
  assert.match(quiet, /window\.__lenis\.scrollTo/)
  assert.equal(pkg.dependencies?.gsap, undefined)
  assert.equal(pkg.devDependencies?.gsap, undefined)
})

test('chapter rail renders jump navigation for all four chapters', () => {
  assert.match(quiet, /ChapterRail chapters=\{CHAPTERS\} active=\{active\} onJump=\{jumpTo\}/)
  assert.match(quiet, /aria-label='Overview chapters'/)
})

test('Overview delegates to the chapter composition', () => {
  assert.match(overview, /import QuietOverview from '\.\/QuietOverview'/)
  assert.match(overview, /<QuietOverview \{\.\.\.props\} \/>/)
})

test('scroll pacing: ~15 viewport heights total, archive longest', () => {
  const total = CHAPTERS.reduce((a, c) => a + c.vh, 0)
  assert.ok(total >= 1400 && total <= 1600, `total ${total}vh`)
  assert.ok(CHAPTERS[3].vh > CHAPTERS[0].vh, 'archive should be the longest chapter')
})

test('real analytics still wired: metrics, field, lanes, constellation, figures', () => {
  for (const label of ['NET SOURCE GROWTH', 'LINES ADDED', 'LINES DELETED', 'TOTAL CHURN', 'COMMITS']) {
    assert.ok(quiet.includes(`'${label}'`), `missing metric ${label}`)
  }
  for (const piece of ['ContributionField', 'LanguageBar', 'Constellation', 'Fingerprint', 'Strata', 'Lifecycle', 'Migration', 'WorkSpan']) {
    assert.ok(quiet.includes(piece), `missing ${piece}`)
  }
  // click-driven metric rail retained
  assert.match(quiet, /onClick=\{\(\) => setMetric\(i\)\}/)
  // scroll advances archive figure, click jumps scroll position
  assert.match(quiet, /onJumpFigure\?\.\(i\)/)
})

/* ─── refinement pass: bands, spans, scrub, masthead ─── */

const main = src('src/main.jsx')
const canvas = src('src/Canvas.jsx')
const langbar = src('src/LanguageBar.jsx')
const scrub = src('src/GraphScrub.jsx')

test('masthead reads Dev Ledger; bare work wordmark removed', () => {
  assert.match(main, />Dev Ledger</)
  assert.doesNotMatch(main, />work</)
})

test('every chapter carries a time-span indicator', () => {
  // measure / field / index show the selected-range dates via ChapterPeriod
  assert.equal((quiet.match(/span=\{spanLabel\(/g) || []).length, 3)
  // archive honestly labels the full archival record, not the selected range
  assert.match(quiet, /ARCHIVAL RECORD · /)
  assert.match(quiet, /monthName\(idxMonth\(d\.derived\.axis\.first\)\)/)
})

test('measure boots to a populated first viewport, then hands off to scroll', () => {
  assert.match(quiet, /animate\(boot, MEASURE_BOOT/)
  assert.match(quiet, /Math\.max\(a, b\)/) // eff = max(scroll, boot)
  assert.ok(MEASURE_BOOT > 0 && MEASURE_BOOT < MEASURE_BANDS.draw[1])
})

test('measure bands: both figures complete before hold; hold precedes exit', () => {
  assert.ok(MEASURE_BANDS.draw[1] <= MEASURE_BANDS.figB[0], 'FIG. A finishes before FIG. B enters')
  assert.equal(MEASURE_BANDS.drawB[1], MEASURE_BANDS.hold[0])
  assert.ok(MEASURE_BANDS.hold[1] <= MEASURE_BANDS.exit[0])
  // hold is a genuine contemplative interval (~0.6 viewport of scroll at 330vh)
  assert.ok(MEASURE_BANDS.hold[1] - MEASURE_BANDS.hold[0] >= 0.15)
})

test('index bands: lanes complete before hold; hold precedes exit', () => {
  assert.equal(INDEX_BANDS.draw[1], INDEX_BANDS.hold[0])
  assert.ok(INDEX_BANDS.hold[1] <= INDEX_BANDS.exit[0])
  assert.ok(INDEX_BANDS.hold[1] - INDEX_BANDS.hold[0] >= 0.25)
})

test('shared scrub primitive exists and drives the charts', () => {
  assert.match(scrub, /export function useScrubIndex/)
  assert.match(scrub, /export function ScrubReadout/)
  assert.match(scrub, /AnimatedNumber/) // smooth numeric transition
  // measure trace + index lanes consume it
  assert.match(canvas, /useScrubIndex/)
  assert.match(quiet, /useScrubIndex/)
  assert.match(quiet, /LaneChart/)
  // touch keeps vertical scroll, horizontal drags scrub
  assert.match(scrub, /pan-y/)
})

test('graph draw clips area + stroke together — no fill without line', () => {
  assert.match(canvas, /clipPath: clipInset/)
  assert.match(canvas, /inset\(0 \$\{\(1 - v\) \* 100\}% 0 0\)/)
})

test('readouts carry real bucket granularity — no fabricated day precision', () => {
  assert.match(quiet, /bucketLabel/) // YYYY-MM → month name, YYYY-MM-DD → date
  assert.match(quiet, /monthName\(k\)/)
  // lane readouts name the unit
  assert.match(quiet, /unit: 'COMMITS'/)
  assert.match(quiet, /unit: 'NET LINES'/)
})

test('language composition bar spans the field; proportions stay data-driven', () => {
  assert.match(quiet, /w-\[94%\]/) // was max-w-md (~50% of the column)
  assert.doesNotMatch(quiet, /max-w-md/)
  // segment widths remain real byte-share percentages
  assert.match(langbar, /width: `\$\{pct\}%`/)
})

test('flat/reduced-motion renders graphs fully drawn', () => {
  assert.match(quiet, /draw=\{flat \? null : draw\}/)
  assert.match(quiet, /draw=\{flat \? null : lanesDraw\}/)
})

test('selected-range span falls back to preset name for open ranges', () => {
  assert.match(quiet, /span \|\| rangeDisplay\(range\)\.toUpperCase\(\)/)
})

/* ─── refinement pass 2: chapter periods, scrub, eras, credit, sync ─── */

const shape = src('src/WorkShape.jsx')
const syncInst = src('src/SyncInstrument.jsx')

test('each chapter has an independent local period instrument', () => {
  for (const id of ['measure', 'field', 'index', 'archive']) {
    assert.match(quiet, new RegExp(`id='${id}'`), `missing period ctl for ${id}`)
  }
  assert.match(quiet, /function ChapterRangeCtl/)
  assert.match(quiet, /PRESET_MODES\.map/) // 7D 30D 90D YTD 1Y ALL — same vocabulary
  assert.match(quiet, /onRange\(makeRange\(m\)\)/)
})

test('chapter ranges default to global; global change resets locals', () => {
  assert.match(quiet, /localRanges\[id\] \|\| props\.range/)
  assert.match(quiet, /useEffect\(\(\) => setLocalRanges\(\{\}\), \[props\.range\]\)/)
})

test('local range fetches one dashboard payload per distinct range, cached', () => {
  assert.match(quiet, /dashCache\.get\(key\)/)
  assert.match(quiet, /fetch\(`\/api\/dashboard/)
  // same range as global → reuse the global payload, no request
  assert.match(quiet, /sameRange\(chRange, globalRange\)/)
  // pending keeps old data dimmed rather than blanking
  assert.match(quiet, /pendingDim\(d\.pending\)/)
})

test('chapters derive their own bundles — no shared stale data', () => {
  assert.equal((quiet.match(/const d = useChapterBundle\(\{ props, chRange/g) || []).length, 4)
  // field rebuilds its heatmap from its own series
  assert.match(quiet, /buildHeatmap\(d\.series/)
  // index lanes/constellation come from the chapter bundle
  assert.match(quiet, /useShapeDerived\(dash, chRange/)
})

test('graph scrub: continuous guide + snapped marker on the line', () => {
  assert.match(scrub, /const \[raw, setRaw\]/) // continuous pointer fraction
  assert.match(scrub, /snapFrac/) // nearest observation fraction
  assert.match(scrub, /guideX/) // guide follows pointer
  assert.match(canvas, /guideX=\{frac \* W\}/)
  assert.match(quiet, /guideX=\{frac \* LANE_W\}/)
  // readout rides the snapped point, marker uses the rendered series coords
  assert.match(canvas, /ScrubReadout frac=\{snapFrac\}/)
})

test('development eras is completely removed from the overview', () => {
  assert.doesNotMatch(quiet, /Eras|eras\b/)
  assert.doesNotMatch(shape, /ERA \d|Development Eras|buildEras/)
  assert.doesNotMatch(chapters, /eras/)
  const shapeSrc = src('src/shape.js')
  assert.doesNotMatch(shapeSrc, /buildEras/)
})

test('fingerprint: no center period text; metrics get breathing room', () => {
  assert.doesNotMatch(shape, /<text[^>]*>\{rangeLabel\}<\/text>/)
  assert.match(shape, /py-6 border-t border-zinc-900/) // taller cells
  assert.match(shape, /clamp\(24px,1\.9vw,30px\)/) // larger responsive metric values
  assert.match(shape, /leading-relaxed/) // annotations breathe
  // period context lives in the figure header, not the circle
  assert.match(quiet, /PERIOD · \$\{range\.mode\.toUpperCase\(\)\}/)
})

test('developer credit links to the author profile safely', () => {
  assert.match(main, /DEVELOPED BY NOAMAN ALI/)
  assert.match(main, /href='https:\/\/github\.com\/Aliferous3'/)
  assert.match(main, /target='_blank'/)
  assert.match(main, /rel='noopener noreferrer'/)
})

test('sync instrument renders real user_sync phases and persists on error', () => {
  assert.match(main, /import SyncInstrument from '\.\/SyncInstrument'/)
  assert.match(main, /<SyncInstrument sync=\{sync\} \/>/)
  assert.match(syncInst, /fixed bottom-4 right-4/)
  assert.match(syncInst, /z-\[90\]/) // above pinned chapters
  assert.match(syncInst, /SYNC COMPLETE/)
  for (const st of ['rate_limited', 'revoked', 'error']) {
    assert.ok(syncInst.includes(`'${st}'`), `missing ${st} state`)
  }
  assert.match(syncInst, /det\.repos|det\.history|det\.pulls/)
})

/* ─── refinement pass 3: boxed periods, FIG. B, pacing ─── */

test('chapter period controls are unmistakably interactive boxed options', () => {
  // hairline boxes with paper-white active state — not bare text
  assert.match(quiet, /border-\[#f2f2f0\] bg-\[#f2f2f0\] text-\[#131413\]/)
  assert.match(quiet, /border-zinc-800 text-zinc-500 hover:border-zinc-500 hover:text-zinc-200/)
  assert.match(quiet, /focus-visible:border-zinc-300/) // keyboard focus visible
  assert.match(quiet, /aria-pressed=\{range\.mode === m\}/) // real active state
})

test('FIG. B daily stems: net = added − deleted, signed values preserved', () => {
  assert.match(canvas, /export function DailyStems/)
  // non-cumulative: stems plot raw daily net around a zero baseline
  assert.match(canvas, /if \(r\.net > 0\) pos \+= seg/)
  // denseDaily rows carry the signed per-day net
  assert.match(quiet, /net: c\.added - c\.deleted/)
  // zero baseline maps through the positive/negative span
  assert.match(canvas, /up - dn/)
})

test('FIG. A and FIG. B share one temporal scrub state', () => {
  assert.match(quiet, /figScrub/)
  // either figure can be the scrub source; the sibling mirrors it
  assert.match(quiet, /src: 'a'/)
  assert.match(quiet, /src: 'b'/)
  assert.match(quiet, /mirror=\{figScrub\?\.src === 'b'/)
  assert.match(quiet, /mirror=\{figScrub\?\.src === 'a'/)
  // same i/(n-1) observation mapping on both figures
  assert.match(canvas, /\(i \/ Math\.max\(n - 1, 1\)\) \* W/)
  // scrub reports {frac, index} so siblings resolve the same day
  assert.match(scrub, /onChange\?\.\(\{ frac: f, index: i \}\)/)
})

test('FIG. B rides measure local period — same series as FIG. A', () => {
  assert.match(quiet, /FIG\. B — DAILY NET SOURCE CHANGE/)
  assert.match(quiet, /<DailyStems[\s\S]*?rows=\{d\.series\}/)
  // readout exposes added / deleted / net for the hovered day
  assert.match(canvas, /ADDED/)
  assert.match(canvas, /DELETED/)
  assert.match(canvas, /NET/)
})

test('measure holds both completed graphs before exit', () => {
  assert.ok(MEASURE_BANDS.drawB[1] <= MEASURE_BANDS.hold[0])
  assert.ok(MEASURE_BANDS.figB[0] >= MEASURE_BANDS.trace[0])
  // FIG. B is inside the chapter and scroll-drawn like FIG. A
  assert.match(quiet, /draw=\{flat \? null : drawB\}/)
})
