import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import {
  SHARE_CARD,
  buildShareRecord,
  contributionLayout,
  contributionWeeks,
  fmtCompact,
  fmtHumanDate,
  fmtHumanRange,
  gitLogCommand,
  shareFileName,
} from '../src/share/shareModel.ts'

const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const root = fileURLToPath(new URL('..', import.meta.url))

/* ── data mapping — real selected-range values only ── */

const dash = (over = {}) => ({
  generatedAt: '2026-09-24T12:00:00.000Z',
  range: { from: '2026-06-27', to: '2026-09-24' },
  summary: {
    repos: 9,
    commits: 321,
    sourceAdded: 5200,
    sourceDeleted: 1400,
    allAdded: 5200,
    allDeleted: 1400,
    allChurn: 6600,
    activeDays: 41,
    longestStreak: 9,
    peakDayCommits: 20,
    languageBytes: 123456,
  },
  github: { connected: true, pullRequests: 17, mergedPrs: 15, revoked: false },
  sync: { status: 'idle', progress: 0 },
  rangeCoverage: { status: 'ok' },
  repositories: [],
  languages: [],
  daily: [
    { date: '2026-06-27', commits: 3, added: 400, deleted: 50 },
    { date: '2026-08-10', commits: 0, added: 0, deleted: 0 },
    { date: '2026-09-24', commits: 40, added: 900, deleted: 100 },
  ],
  prsDaily: [],
  ...over,
})

test('share record maps selected-range fields verbatim', () => {
  const r = buildShareRecord({
    period: '90D',
    dash: dash(),
    username: 'someone',
  })
  assert.equal(r.period, '90D')
  assert.equal(r.startDate, '2026-06-27')
  assert.equal(r.endDate, '2026-09-24')
  // headline = net growth, not churn, not all-time
  assert.equal(r.netSourceGrowth, 3800)
  assert.equal(r.sourceAdded, 5200)
  assert.equal(r.sourceDeleted, 1400)
  assert.equal(r.activeDays, 41)
  assert.equal(r.pullRequests, 17)
  assert.equal(r.commits, 321)
  assert.equal(r.username, 'someone')
  assert.equal(r.daily.length, 3)
})

test('negative net growth is preserved, not clamped', () => {
  const r = buildShareRecord({
    period: '30D',
    dash: dash({ summary: { ...dash().summary, sourceAdded: 100, sourceDeleted: 900 } }),
    username: 'someone',
  })
  assert.equal(r.netSourceGrowth, -800)
})

test('ALL range falls back to real ledger bounds when range is null', () => {
  const r = buildShareRecord({
    period: 'ALL',
    dash: dash({ range: { from: null, to: null } }),
    username: 'someone',
    allFromIso: '2024-03-02',
    endIso: '2026-09-24',
  })
  assert.equal(r.startDate, '2024-03-02')
  assert.equal(r.endDate, '2026-09-24')
})

test('local period range is the secondary fallback', () => {
  const r = buildShareRecord({
    period: '7D',
    dash: dash({ range: { from: null, to: null }, daily: [] }),
    username: 'someone',
    range: { from: '2026-09-18', to: '2026-09-24' },
  })
  assert.equal(r.startDate, '2026-09-18')
  assert.equal(r.endDate, '2026-09-24')
})

test('every supported period produces a share model', () => {
  for (const period of ['7D', '30D', '90D', 'YTD', '1Y', 'ALL']) {
    const r = buildShareRecord({
      period,
      dash: dash(),
      username: 'someone',
    })
    assert.ok(r, period)
    assert.equal(r.period, period)
  }
})

test('missing identity yields no record — never a fallback username', () => {
  assert.equal(buildShareRecord({ period: '90D', dash: dash(), username: null }), null)
  assert.equal(buildShareRecord({ period: '90D', dash: dash(), username: '  ' }), null)
  assert.equal(buildShareRecord({ period: '90D', dash: dash(), username: undefined }), null)
})

test('missing or malformed bounds yield no record', () => {
  assert.equal(
    buildShareRecord({
      period: '90D',
      dash: dash({ range: { from: null, to: null }, daily: [] }),
      username: 'someone',
    }),
    null,
  )
  assert.equal(
    buildShareRecord({
      period: '90D',
      dash: dash({ range: { from: '2026-09-24', to: '2026-06-27' } }),
      username: 'someone',
    }),
    null,
  )
})

test('daily is clipped to the selected bounds', () => {
  const r = buildShareRecord({
    period: '7D',
    dash: dash({
      range: { from: '2026-09-18', to: '2026-09-24' },
      daily: [
        { date: '2026-06-27', commits: 3, added: 1, deleted: 0 },
        { date: '2026-09-24', commits: 2, added: 1, deleted: 0 },
      ],
    }),
    username: 'someone',
  })
  assert.deepEqual(r.daily.map((d) => d.date), ['2026-09-24'])
})

/* ── formatting ── */

test('human range + git log command render the selected dates', () => {
  assert.equal(fmtHumanDate('2025-09-20'), 'SEP 20, 2025')
  assert.equal(fmtHumanRange('2025-09-20', '2026-09-19'), 'SEP 20, 2025 - SEP 19, 2026')
  assert.equal(
    gitLogCommand('2025-09-20', '2026-09-19'),
    '$ git log --since="2025-09-20" --until="2026-09-19"',
  )
})

test('compact counts keep at most one useful decimal', () => {
  assert.equal(fmtCompact(1_700_000), '1.7M')
  assert.equal(fmtCompact(1_000_000), '1.0M')
  assert.equal(fmtCompact(425_000), '425K')
  assert.equal(fmtCompact(9_876), '9.9K')
  assert.equal(fmtCompact(57), '57')
  assert.equal(fmtCompact(0), '0')
})

test('export file name is deterministic and sanitized', () => {
  const r = buildShareRecord({ period: '90D', dash: dash(), username: 'Some User!' })
  assert.equal(shareFileName(r), 'dev-ledger-some-user-90d-2026-06-27-2026-09-24.png')
})

/* ── contribution record ── */

test('contribution weeks cover only the selected range', () => {
  const weeks = contributionWeeks('2026-09-21', '2026-09-24', [
    { date: '2026-09-22', commits: 5 },
  ])
  const cells = weeks.flatMap((w) => w.days).filter(Boolean)
  assert.equal(cells.length, 4)
  assert.equal(cells[0].date, '2026-09-21')
  assert.equal(cells[3].date, '2026-09-24')
  // zero-activity days stay intensity 0 (near-black cell)
  assert.equal(cells.find((c) => c.date === '2026-09-21').intensity, 0)
  assert.ok(cells.find((c) => c.date === '2026-09-22').intensity > 0)
})

test('contribution weeks align Monday-first and label months', () => {
  // 2026-09-01 is a Tuesday — column 0 must pad Monday (null), not invent a day
  const weeks = contributionWeeks('2026-09-01', '2026-09-30', [])
  assert.equal(weeks[0].days[0], null)
  assert.equal(weeks[0].days[1].date, '2026-09-01')
  assert.equal(weeks[0].month, 'SEP')
  // crossing into October introduces the next month label (2026-09-27 is a
  // Sunday, so Oct 1 lands in the second week column)
  const w2 = contributionWeeks('2026-09-27', '2026-10-04', [])
  assert.equal(w2[0].month, 'SEP')
  assert.equal(w2[1].month, 'OCT')
  assert.equal(w2[1].days[3].date, '2026-10-01')
})

test('long history is not truncated — all days present', () => {
  const weeks = contributionWeeks('2024-01-01', '2026-09-24', [])
  const cells = weeks.flatMap((w) => w.days).filter(Boolean)
  const days = (new Date('2026-09-24') - new Date('2024-01-01')) / 86400000 + 1
  assert.equal(cells.length, days)
})

/* ── contribution grid layout ── */

const GRID_W = 800 // ShareCard available width for the week columns

test('contributionLayout keeps integer cells for ordinary ranges', () => {
  // ~14 week columns (90D) → the largest integer cell that fits
  const l = contributionLayout(14, GRID_W)
  assert.ok(Number.isInteger(l.cell) && Number.isInteger(l.gap))
  assert.ok(l.cell >= 3)
  assert.ok(l.width <= GRID_W)
  assert.equal(l.width, 14 * l.cell + 13 * l.gap)
})

test('contributionLayout is bounded for absurd column counts', () => {
  for (const cols of [200, 500, 1000, 2000, 5000]) {
    const l = contributionLayout(cols, GRID_W)
    assert.ok(l.cell > 0, `cols=${cols} cell`)
    assert.ok(l.gap >= 0, `cols=${cols} gap`)
    assert.ok(
      cols * l.cell + (cols - 1) * l.gap <= GRID_W + 0.0001,
      `cols=${cols} width ${cols * l.cell + (cols - 1) * l.gap}`,
    )
  }
})

for (const [label, start, end] of [
  ['5 years', '2020-01-01', '2024-12-31'],
  ['10 years', '2015-01-01', '2024-12-31'],
  ['15 years', '2010-01-01', '2024-12-31'],
]) {
  test(`${label} history: every day present, grid fits ${GRID_W}px`, () => {
    const weeks = contributionWeeks(start, end, [])
    const cells = weeks.flatMap((w) => w.days).filter(Boolean)
    // real inclusive day count — leap years included, no 365×n shortcut
    const expectedDays =
      Math.round((new Date(`${end}T00:00:00`) - new Date(`${start}T00:00:00`)) / 86400000) + 1
    assert.equal(cells.length, expectedDays)
    assert.equal(cells[0].date, start)
    assert.equal(cells[cells.length - 1].date, end)
    const l = contributionLayout(weeks.length, GRID_W)
    assert.ok(l.cell > 0 && l.gap >= 0)
    assert.ok(l.width <= GRID_W + 0.0001, `width ${l.width}`)
  })
}

/* ── export contract ── */

test('card contract is exactly 1080x1920 (9:16)', () => {
  assert.equal(SHARE_CARD.width, 1080)
  assert.equal(SHARE_CARD.height, 1920)
  assert.equal(SHARE_CARD.width / SHARE_CARD.height, 9 / 16)
})

/* ── architecture guards ── */

test('no new serverless function — api/ surface stays at 12', () => {
  const apiDir = path.join(root, 'api')
  const walk = (dir) =>
    readdirSync(dir).flatMap((n) => {
      const p = path.join(dir, n)
      return statSync(p).isDirectory() ? walk(p) : p.endsWith('.mjs') ? [p] : []
    })
  const fns = walk(apiDir).map((p) => path.relative(apiDir, p))
  assert.equal(fns.length, 12)
  for (const banned of ['share', 'export', 'card', 'image']) {
    assert.ok(
      !fns.some((f) => f.includes(banned)),
      `api/${banned} must not exist`,
    )
  }
})

test('share feature ships no fake data and no author username', () => {
  for (const f of [
    'src/share/shareModel.ts',
    'src/share/ShareCard.tsx',
    'src/share/ShareModal.tsx',
    'src/share/shareExport.ts',
    'src/share/ShareButton.tsx',
    'src/share/ShareIcons.tsx',
  ]) {
    const text = src(f)
    assert.ok(!text.includes('Aliferous3'), `${f} must not hardcode the author login`)
    assert.ok(!text.includes('../fixtures'), `${f} must not import fixtures`)
    // Arena design placeholders must not leak into runtime
    for (const fake of ['1747415', '1_747_415', '1,747,415', 'contribGrid', 'SHARE_DEFAULTS']) {
      assert.ok(!text.includes(fake), `${f} contains fixture value ${fake}`)
    }
  }
})

test('share is client-side only — no network upload paths', () => {
  const exp = src('src/share/shareExport.ts')
  const modal = src('src/share/ShareModal.tsx')
  for (const text of [exp, modal]) {
    assert.ok(!/fetch\(\s*['"`]https?:/.test(text), 'no external fetch')
    assert.ok(!text.includes('/api/'), 'share never calls the API')
    assert.ok(!/cloudinary|minimax|imgur|screenshot/i.test(text))
  }
})

test('three-page registry is unchanged — share is not a page', () => {
  const pages = src('src/pages.ts')
  assert.ok(pages.includes("'overview'"))
  const matches = pages.match(/id: '[a-z]+'/g) || []
  assert.equal(matches.length, 3)
})

test('modal implements the required dialog contract', () => {
  const m = src('src/share/ShareModal.tsx')
  assert.ok(m.includes('role="dialog"'))
  assert.ok(m.includes('aria-modal="true"'))
  assert.ok(m.includes('aria-labelledby'))
  assert.ok(m.includes("'Escape'"))
  assert.ok(m.includes('aria-live'))
  // scroll lock + focus restore
  assert.ok(m.includes("document.body.style.overflow"))
  assert.ok(m.includes('prev?.focus'))
})

test('share button uses the selected terminal-command styling', () => {
  const b = src('src/share/ShareButton.tsx')
  assert.ok(b.includes('#3a3a3a'), 'charcoal border')
  assert.ok(b.includes('#d6ff3e'), 'lime hover/focus/active')
  assert.ok(b.includes('aria-label="Share current Dev Ledger record"'))
})
