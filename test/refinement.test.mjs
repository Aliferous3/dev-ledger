import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import {
  MON_PHASES,
  OPACITY_CLEAR,
  OPACITY_OVERLAP_COLLAPSED,
  OPACITY_OVERLAP_EXPANDED,
  collapsedFrac,
  collapsedLabel,
  monitorRows,
  monitorTag,
  occludedByContent,
} from '../src/ledger/syncMonitorModel.mjs'
import { PAGE_SECTIONS, PAGES } from '../src/pages.ts'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
// Source with comments stripped — doc comments describe intent and would
// false-positive on word-level assertions.
const bare = (p) => src(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

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

/* ── 1 · duplicate sync indicator removed ── */

test('utility bar carries no sync indicator', () => {
  const bar = bare('src/components/UtilityBar.tsx')
  assert.doesNotMatch(bar, /SYNCING|SYNC\.MON|syncLabel|syncing/i)
  assert.match(bar, /SYS\.TIME/)
  assert.match(bar, /CRT/)
})

test('SyncMonitor is the single sync surface', () => {
  const app = src('src/App.tsx')
  assert.match(app, /SyncMonitor/)
})

/* ── 2 · SYNC.MON truthful phase grammar ── */

test('no positional OK: DISCOVER waits for its own signal while discovery runs', () => {
  const rows = monitorRows({
    status: 'syncing',
    phase: 'discover',
    progress: 0.02,
    detail: {},
  })
  assert.equal(rows[0].st, 'run')
  assert.equal(rows[0].frac, null) // indeterminate — no done/total yet
  for (const r of rows.slice(1)) assert.equal(r.st, '--')
})

test('DISCOVER completes only via the backend phase pointer (0-repo safe)', () => {
  const rows = monitorRows({
    status: 'syncing',
    phase: 'commits',
    progress: 0.2,
    detail: { repos: { done: 0, total: 0 } },
  })
  assert.equal(rows[0].st, 'ok') // phase pointer passed discover
})

test('incomplete measured phase cannot render OK', () => {
  const rows = monitorRows(syncing())
  // METADATA 3/7 and COMMITS 2/7 are running, never ok
  assert.equal(rows[1].st, 'run')
  assert.equal(rows[1].frac, 3 / 7)
  assert.equal(rows[2].st, 'run')
  assert.equal(rows[2].frac, 2 / 7)
  // FINALIZING hasn't started — pending, not ok
  assert.equal(rows[5].st, '--')
})

test('indeterminate phases show no fabricated fill', () => {
  const rows = monitorRows(syncing())
  // PULLS in-flight without done flag → indeterminate meter (frac null)
  assert.equal(rows[3].st, 'run')
  assert.equal(rows[3].frac, null)
  const fin = monitorRows({ status: 'syncing', phase: 'finalizing', progress: 0.9, detail: { repos: { done: 7, total: 7 }, history: { done: 7, total: 7 }, pulls: { done: true } } })
  assert.equal(fin[5].st, 'run')
  assert.equal(fin[5].frac, null)
})

test('RANGE stays pending on a normal run; runs only on an explicit range sync', () => {
  assert.equal(monitorRows(syncing())[4].st, '--')
  const rs = monitorRows(syncing({ phase: 'range' }))
  assert.equal(rs[4].st, 'run')
})

test('100% only when the entire sync is complete', () => {
  assert.notEqual(monitorTag(syncing({ progress: 0.99 })), '100%')
  assert.equal(monitorTag(syncing({ status: 'complete', phase: 'done' })), '100%')
  assert.equal(collapsedLabel(syncing({ progress: 0.99 })), '99% SYNC')
  assert.equal(collapsedFrac(syncing({ progress: 0.99 })), 0.99)
})

test('rate limit is terse on in-flight rows', () => {
  const rows = monitorRows(syncing({ status: 'rate_limited' }))
  assert.equal(rows[1].st, 'rate')
  assert.equal(rows[2].st, 'rate')
  assert.equal(monitorTag(syncing({ status: 'rate_limited' })), 'RATE LIMITED')
})

/* ── 3 · NumberFlow wrapper + usage ── */

test('Num wrapper: real @number-flow/react, trend=0, tabular numerals, restrained timing', () => {
  const num = bare('src/ledger/Num.tsx')
  assert.match(num, /from '@number-flow\/react'/)
  assert.match(num, /trend:\s*0/)
  assert.match(num, /tabular-nums/)
  assert.match(num, /duration:\s*650/)
  assert.doesNotMatch(num, /spring|bounce/i)
})

test('major metric surfaces render through Num', () => {
  for (const f of [
    'src/components/Section01Measure.tsx',
    'src/components/Section02Field.tsx',
    'src/components/Section03Index.tsx',
    'src/activity/ActivityHeader.tsx',
    'src/activity/ActivityExtremes.tsx',
    'src/activity/ActivityMilestones.tsx',
    'src/code/CodeHeader.tsx',
    'src/code/CodeIntelligence.tsx',
    'src/code/ProjectTable.tsx',
    'src/code/ChurnTable.tsx',
    'src/components/SyncMonitor.tsx',
    'src/projects/ProjHtop.tsx',
  ]) {
    assert.match(src(f), /ledger\/Num|AnimatedNumber/, `${f} should use the shared Num wrapper`)
  }
})

test('retained AnimatedNumber delegates to the shared Num wrapper', () => {
  const an = src('src/retained/AnimatedNumber.jsx')
  assert.match(an, /from '\.\.\/ledger\/Num'/)
})

/* ── 4 · skeleton system ── */

test('shared skeleton primitives exist', () => {
  const sk = src('src/ledger/Skeleton.tsx')
  for (const name of ['SkBlock', 'SkText', 'SkNum', 'SkMetric', 'SkRows', 'SkChart', 'SkHeatmap', 'SkRegion']) {
    assert.match(sk, new RegExp(`export function ${name}`), `missing ${name}`)
  }
  // skeletons are aria-hidden placeholders, never fake words
  assert.doesNotMatch(sk, /Loading\.\.\./)
})

test('all three pages render skeletons while resolving', () => {
  for (const f of [
    'src/components/Section01Measure.tsx',
    'src/components/Section02Field.tsx',
    'src/components/Section03Index.tsx',
    'src/components/ActivityPage.tsx',
    'src/components/CodePage.tsx',
  ]) {
    const s = src(f)
    assert.match(s, /resolving/, `${f} should consume the resolving flag`)
    assert.match(s, /Sk(Num|Rows|Chart|Heatmap|Metric|Text|Region)/, `${f} should render skeleton primitives`)
  }
})

test('no metric renders a literal 0 as a loading placeholder', () => {
  for (const f of [
    'src/components/Section01Measure.tsx',
    'src/components/Section02Field.tsx',
    'src/components/CodePage.tsx',
    'src/components/ActivityPage.tsx',
  ]) {
    assert.doesNotMatch(src(f), /resolving\s*\?\s*0|loading\s*\?\s*0/, `${f} must not flash 0 while loading`)
  }
})

/* ── 5 · vapour title (login only) ── */

test('login DEV LEDGER uses the vapour title', () => {
  const login = src('src/ledger/LoginScreen.tsx')
  assert.match(login, /VapourTitle/)
  assert.match(login, /DEV LEDGER/)
})

test('vapour title: canvas lifecycle + reduced-motion bypass + accessible text', () => {
  const vt = src('src/ledger/VapourTitle.tsx')
  assert.match(vt, /getContext\('2d'\)/)
  assert.match(vt, /cancelAnimationFrame/)
  assert.match(vt, /prefers-reduced-motion/)
  assert.match(vt, /<h1/) // real accessible title stays in the DOM
})

test('vapour title: ~5–6s total, multi-phase, still resolves once', () => {
  const vt = src('src/ledger/VapourTitle.tsx')
  const ms = (name) => Number(vt.match(new RegExp(`const ${name} = (\\d+)`))?.[1])
  const total = ms('DISPERSE_MS') + ms('CONVERGE_MS') + ms('SETTLE_MS')
  assert.ok(total >= 5000 && total <= 6000, `total ${total}ms`)
  // the extra time is real particle motion in two phases, not a dead delay
  assert.ok(ms('DISPERSE_MS') > 0 && ms('CONVERGE_MS') > 0)
  assert.match(vt, /setResolved\(true\)/) // resolves once, canvas unmounts
})

test('login title clamps to 5.6rem desktop, sane on mobile', () => {
  const login = src('src/ledger/LoginScreen.tsx')
  assert.match(login, /clamp\(2\.4rem,\s*6\.2vw,\s*5\.6rem\)/)
})

test('vapour effect is login-only — authenticated pages never import it', () => {
  for (const f of [
    'src/App.tsx',
    'src/components/ActivityPage.tsx',
    'src/components/CodePage.tsx',
    'src/components/Section01Measure.tsx',
  ]) {
    assert.doesNotMatch(src(f), /VapourTitle/, `${f} must not use the vapour title`)
  }
})

/* ── 6 · overview section nav ── */

test('overview exposes exactly three in-page section anchors', () => {
  assert.deepEqual(PAGE_SECTIONS.overview.map((a) => a.name), ['MEASURE', 'CONTRIBUTIONS', 'REPOSITORIES'])
  assert.equal(PAGES.length, 3)
})

test('rail clicks smooth-scroll via jumpToAnchor — no instant jump, no remount', () => {
  const nav = src('src/components/RightSidebarNav.tsx')
  assert.match(nav, /jumpToAnchor/)
  assert.doesNotMatch(nav, /behavior:\s*'instant'/)
  const pages = src('src/pages.ts')
  assert.match(pages, /behavior:\s*reduced \? 'instant' : 'smooth'/)
  // hash entries let back/forward retrace section jumps
  assert.match(pages, /pushState\(\{ anchor: id \}/)
})

test('scroll-spy is rAF-throttled, not a raw per-event DOM scan', () => {
  const pages = src('src/pages.ts')
  assert.match(pages, /requestAnimationFrame/)
  assert.match(pages, /addEventListener\('scroll', schedule, \{ passive: true \}\)/)
})

test('rail marks the active section and exposes keyboard-accessible buttons', () => {
  const nav = src('src/components/RightSidebarNav.tsx')
  assert.match(nav, /aria-current={on \? 'location' : undefined}/)
  assert.match(nav, /<button/)
})

/* ── 7 · shared section-heading token ── */

test('Shape of Your Work section is removed — no heading, file, or rail entry', () => {
  assert.ok(!existsSync(path.join(ROOT, 'src/components/Section04Archive.tsx')), 'Section04Archive should be deleted')
  assert.ok(!existsSync(path.join(ROOT, 'src/retained/WorkShape.jsx')), 'WorkShape should be deleted')
  const app = src('src/App.tsx')
  assert.doesNotMatch(app, /Section04Archive|Shape of Your Work/)
  assert.ok(!PAGE_SECTIONS.overview.some((a) => a.id === 'section-04'), 'no ARCHIVE rail entry')
  const css = src('src/index.css')
  assert.doesNotMatch(css, /archive-view|#section-04/, 'orphaned archive CSS should be gone')
})

/* ── 8 · sync pill overlap translucency ── */

test('occlusion targets: collapsed dims more than expanded', () => {
  assert.equal(OPACITY_CLEAR, 1)
  assert.ok(OPACITY_OVERLAP_COLLAPSED >= 0.7 && OPACITY_OVERLAP_COLLAPSED <= 0.82)
  assert.ok(OPACITY_OVERLAP_EXPANDED > OPACITY_OVERLAP_COLLAPSED)
  assert.ok(OPACITY_OVERLAP_EXPANDED < 1)
})

test('occludedByContent: content landmark under the pill → occluded', () => {
  const monitor = { contains: () => false }
  const inSection = { tagName: 'DIV', closest: (sel) => (sel.includes('section') ? {} : null) }
  assert.equal(occludedByContent([monitor, inSection], monitor), true)
  // the bare main scaffold is background, not content
  const mainScaffold = { tagName: 'MAIN', closest: () => ({}) }
  const body = { tagName: 'BODY', closest: () => null }
  assert.equal(occludedByContent([monitor, mainScaffold, body], monitor), false)
  // a floating overlay with no landmark doesn't count either
  const overlay = { tagName: 'DIV', closest: () => null }
  assert.equal(occludedByContent([monitor, overlay, body], monitor), false)
  assert.equal(occludedByContent(null, monitor), false)
})

test('overlap probe is rAF-throttled elementsFromPoint, not a scrollY check', () => {
  const sm = src('src/components/SyncMonitor.tsx')
  assert.match(sm, /elementsFromPoint/)
  assert.match(sm, /requestAnimationFrame/)
  assert.doesNotMatch(sm, /scrollY\s*>/)
})

/* ── sync now — canonical action + busy/blocked grammar ── */

test('SYNC NOW calls the canonical store syncNow — no parallel path', () => {
  const sm = src('src/components/SyncMonitor.tsx')
  assert.match(sm, /const \{[^}]*syncNow[^}]*\} = useLedger\(\)/)
  assert.match(sm, /onClick=\{\(\) => syncNow\(\)\}/)
  // no ad-hoc fetch in the component
  assert.doesNotMatch(bare('src/components/SyncMonitor.tsx'), /fetch\(/)
})

test('fixture fallback still wires the real syncNow pump', () => {
  const live = bare('src/store/live.ts')
  assert.match(live, /fixtureStore\(period\), resolving, syncNow, pumping: pumpingState/)
})

test('while syncing the action is a disabled SYNCING… — no duplicate fire', () => {
  const sm = bare('src/components/SyncMonitor.tsx')
  assert.match(sm, /<Act disabled>SYNCING…<\/Act>/)
  // store-level guard too
  assert.match(bare('src/store/live.ts'), /if \(pumping\.current\) return/)
})

test('blocked states map to correct actions, never a dead SYNC NOW', () => {
  const sm = bare('src/components/SyncMonitor.tsx')
  assert.match(sm, /RECONNECT GITHUB/) // revoked
  assert.match(sm, /RETRY SYNC/)      // error
  assert.match(sm, /AWAITING RATE LIMIT/) // rate_limited — no active button
})

test('pumping folds into effective status → immediate expand + RUN rows', () => {
  const sm = bare('src/components/SyncMonitor.tsx')
  assert.match(sm, /pumping && \(!sync \|\| sync\.status === 'idle' \|\| sync\.status === 'complete'\)/)
  assert.match(sm, /monitorRows\(effSync\)/)
})

/* ── archive subsections removed — nothing may reference the dead views ── */

test('no archive figure names leak into the shipped UI', () => {
  for (const f of ['src/App.tsx', 'src/pages.ts', 'src/index.css']) {
    const s = bare(f)
    assert.doesNotMatch(s, /FINGERPRINT|SUCCESSION|LIFECYCLE|MIGRATION|archive-view/, `${f} leaked archive`)
  }
})

/* ── login M12 entrance ── */

test('login applies the shared M12 entrance to its blocks', () => {
  const login = src('src/ledger/LoginScreen.tsx')
  assert.match(login, /registerM12/)
  assert.match(login, /m12Delay/)
  // every structural block is registered — chrome, ticker, eyebrow, sub,
  // mission, topology, matrix, terminal, keep, cta = 10 registrations
  const n = (login.match(/ref=\{registerM12\}/g) || []).length
  assert.ok(n >= 9, `expected ≥9 m12 registrations, got ${n}`)
})

test('vapour title is NOT m12-gated — it is its own entrance', () => {
  const login = src('src/ledger/LoginScreen.tsx')
  const vtLine = login.split('\n').find((l) => l.includes('<VapourTitle')) || ''
  assert.doesNotMatch(vtLine, /registerM12|m12Delay/)
  assert.match(vtLine, /<VapourTitle/)
})

test('login CTA stays interactive during entrance (opacity-only wait)', () => {
  const css = src('src/index.css')
  const wait = css.match(/\.m12-wait\s*\{[^}]*\}/)?.[0] || ''
  assert.doesNotMatch(wait, /pointer-events|visibility|display/, 'm12-wait must only set opacity')
  const login = src('src/ledger/LoginScreen.tsx')
  assert.match(login, /KEEP ME SIGNED IN/)
})

/* ── 90D default range ── */

test('default period is 90D; explicit ?range= wins; clean URL = default', async () => {
  const { DEFAULT_PERIOD, periodFromQuery, rangeSearch } = await import('../src/pages.ts')
  assert.equal(DEFAULT_PERIOD, '90D')
  assert.equal(periodFromQuery(''), null)
  assert.equal(periodFromQuery('?range=30d'), '30D')
  assert.equal(periodFromQuery('?range=ALL'), 'ALL')
  assert.equal(periodFromQuery('?range=bogus'), null)
  assert.equal(rangeSearch('90D'), '')
  assert.equal(rangeSearch('30D'), '?range=30d')
  // App initializes from the URL and falls back to the default
  const app = src('src/App.tsx')
  assert.match(app, /periodFromQuery\(window\.location\.search\) \?\? DEFAULT_PERIOD/)
  assert.match(app, /rangeSearch\(p\)/)
})

/* ── security: tenant-bound installation linking + cron + heartbeat ── */

test('installation_id is never linked without GitHub-verified ownership', () => {
  const setup = bare('api/setup.mjs')
  assert.match(setup, /inst\?\.account\?\.id === session\.githubUserId/)
  assert.doesNotMatch(setup, /Still record|unverified/i)
  const cb = bare('api/auth/callback.mjs')
  // setup_action path: account-id check; oauth path: discovered-list check
  assert.match(cb, /inst\?\.account\?\.id === session\.githubUserId/)
  assert.match(cb, /installations\.find\(\(i\) => i\.id === Number\(installationId\)\)/)
})

test('cron fails closed without CRON_SECRET', () => {
  const cron = bare('api/cron/sync.mjs')
  assert.match(cron, /!secret \|\| req\.headers\.authorization/)
})

test('heartbeat is POST-only — a GET can never renew the lease', () => {
  const hb = bare('api/auth/heartbeat.mjs')
  assert.match(hb, /req\.method !== 'POST'/)
})

test('oauth state is random + freshness-checked at the callback', () => {
  const login = bare('api/auth/login.mjs')
  assert.match(login, /crypto\.randomBytes/)
  const cb = bare('api/auth/callback.mjs')
  assert.match(cb, /Date\.now\(\) - parsed\.at < 15 \* 60 \* 1000/)
})
