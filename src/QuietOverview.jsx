import React, { useEffect, useMemo, useRef, useState } from 'react'
import { motion, animate, useScroll, useTransform, useMotionValueEvent, useMotionValue, AnimatePresence } from 'framer-motion'
import { Icon } from '@iconify/react'
import { AnimatedNumber } from './AnimatedNumber'
import { CompareDelta } from './CompareDelta'
import { ContributionField, buildHeatmap } from './Heatmap'
import { LanguageBar } from './LanguageBar'
import { Term } from './TermTooltip'
import { makeRange, rangeDays, rangeDisplay, compareDisplay, PRESET_MODES } from './range'
import { useReducedMotion } from './motion'
import { GrowthLine, DailyStems, smoothPath } from './Canvas'
import { computeMomentum } from './LegacyTabs'
import {
  useShapeDerived,
  Constellation,
  Strata,
  Lifecycle,
  Migration,
  Fingerprint,
  WorkSpan,
} from './WorkShape'
import { idxMonth, monthName } from './shape'
import { useScrubIndex, ScrubMark, ScrubReadout, ScrubValue, SCRUB_TOUCH } from './GraphScrub'
import { CHAPTERS, ARCHIVE_FIGURES, MEASURE_BANDS, INDEX_BANDS, MEASURE_BOOT, figureIndex, figureWindow, chapterAt } from './scrollChapters'

const fmt = new Intl.NumberFormat('en-US')
const stringN = (v) => (v == null ? '—' : fmt.format(Number(v)))
const n = (v) => <AnimatedNumber value={v} />
const compact = (v) => <AnimatedNumber value={v} compact />
const EASE = [0.19, 1, 0.22, 1]

function fmtBytes(v) {
  const b = Number(v) || 0
  if (b >= 1048576) return `${(b / 1048576).toFixed(1)} MB`
  if (b >= 1024) return `${(b / 1024).toFixed(1)} KB`
  return `${b} B`
}

/* Time-span marginalia: exact dates for the selected range; falls back to the
   preset name when the range is open-ended ('all' has no `from`). */
const MONTHS_L = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
const dateLabel = (iso) => {
  const d = new Date(`${iso}T00:00:00Z`)
  return `${MONTHS_L[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`
}
const spanLabel = (range) =>
  range?.from && range?.to ? `${dateLabel(range.from)} — ${dateLabel(range.to)}` : null

/* Bucket key → readout label at the bucket's own granularity: 'YYYY-MM' for
   monthly lanes, 'YYYY-MM-DD' week-start for weekly lanes. */
const bucketLabel = (k) => (k.length === 7 ? monthName(k) : dateLabel(k))

function useMediaQuery(q) {
  const [m, setM] = useState(() => globalThis.matchMedia?.(q).matches ?? false)
  useEffect(() => {
    const mq = window.matchMedia(q)
    const f = (e) => setM(e.matches)
    mq.addEventListener('change', f)
    return () => mq.removeEventListener('change', f)
  }, [q])
  return m
}

/* ─── chapter-local periods ─── */

export const sameRange = (a, b) =>
  a?.mode === b?.mode && (a?.from || null) === (b?.from || null) && (a?.to || null) === (b?.to || null)

/* Response cache keyed by chapter range — one /api/dashboard request per
   distinct range; the global payload is reused whenever a chapter's range
   matches the global one (zero extra requests). */
const dashCache = new Map()

function useChapterDash(globalDash, globalRange, chRange) {
  const isGlobal = !chRange || sameRange(chRange, globalRange)
  const [local, setLocal] = useState(null)
  const [pending, setPending] = useState(false)
  useEffect(() => {
    if (isGlobal) { setLocal(null); setPending(false); return }
    const key = `${chRange.mode}|${chRange.from}|${chRange.to}`
    const hit = dashCache.get(key)
    if (hit) { setLocal(hit); setPending(false); return }
    let alive = true
    setPending(true)
    const q = new URLSearchParams()
    if (chRange.from) q.set('from', chRange.from)
    if (chRange.to) q.set('to', chRange.to)
    fetch(`/api/dashboard${q.size ? `?${q}` : ''}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive) return
        if (d) { dashCache.set(key, d); setLocal(d) }
        setPending(false)
      })
      .catch(() => alive && setPending(false))
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chRange?.mode, chRange?.from, chRange?.to, isGlobal])
  // While a local fetch resolves, keep rendering the previous data dimmed —
  // a quiet analytical transition, not a blank swap.
  return { dash: isGlobal ? globalDash : local || globalDash, pending }
}

/* One chapter's complete derived bundle: its own payload, its own range. */
function useChapterBundle({ props, chRange, compare = false }) {
  const { dash, pending } = useChapterDash(props.data, props.range, chRange)
  const same = !chRange || sameRange(chRange, props.range)
  const d = useOverviewData({
    data: dash,
    compare: compare && same ? props.compare : false,
    compareData: props.compareData,
    daily: dash?.daily,
    prsDaily: dash?.prsDaily,
    range: chRange || props.range,
  })
  d.derived = useShapeDerived(dash, chRange || props.range)
  d.range = chRange || props.range
  d.pending = pending
  d.loading = pending || props.loading
  d.compareActive = compare && same ? props.compare : false
  return d
}

// While a chapter-local fetch resolves, its analytical content dims rather
// than blanking — the pending state itself is the quiet transition.
const pendingDim = (pending) => ({ opacity: pending ? 0.3 : 1, transition: 'opacity 450ms ease' })

/* Compact chapter-local period instrument — hairline-boxed mono options in
   the same vocabulary as the global rail: paper-white fill for the active
   period, hairline ghost boxes for the rest. Unmistakably interactive, still
   editorial. No pills, no dropdown chrome. */
function ChapterRangeCtl({ id, range, onRange }) {
  return (
    <span className='inline-flex flex-wrap items-baseline justify-end gap-x-1.5 gap-y-1.5' data-chapter-range={id}>
      <span className='label-s mr-1 text-zinc-700'>PERIOD</span>
      {PRESET_MODES.map((m) => (
        <button
          key={m}
          onClick={() => onRange(makeRange(m))}
          aria-pressed={range.mode === m}
          className={`border px-1.5 py-[3px] font-mono text-[9px] tracking-[0.16em] transition-colors duration-150 focus-visible:outline-none focus-visible:border-zinc-300 focus-visible:text-zinc-100 ${
            range.mode === m
              ? 'border-[#f2f2f0] bg-[#f2f2f0] text-[#131413]'
              : 'border-zinc-800 text-zinc-500 hover:border-zinc-500 hover:text-zinc-200'
          }`}
        >
          {m.toUpperCase()}
        </button>
      ))}
    </span>
  )
}

// Right-hand chapter marginalia: exact span on top, period instrument beneath.
function ChapterPeriod({ id, range, onRange, span }) {
  return (
    <span className='flex flex-col items-end gap-1.5'>
      <span className='label-s text-zinc-800'>{span || rangeDisplay(range).toUpperCase()}</span>
      <ChapterRangeCtl id={id} range={range} onRange={onRange} />
    </span>
  )
}

/* ─── shared derived state ─── */

const LANE_W = 1000

function useOverviewData({ data, compare, compareData, daily, prsDaily, range }) {
  const s = data?.summary || {}
  const gh = data?.github || {}
  const cs = compareData?.summary || {}
  const cgh = compareData?.github || {}

  const series = useMemo(() => denseDaily(range, daily, prsDaily), [range, daily, prsDaily])
  const priorSeries = useMemo(
    () =>
      compare && compareData
        ? denseDaily({ mode: 'custom', from: compareData.range?.from, to: compareData.range?.to }, compareData.daily, compareData.prsDaily)
        : null,
    [compare, compareData]
  )
  const cumulate = (rows, pick) => {
    if (!rows) return null
    let cur = 0
    return rows.map((d) => (cur += pick(d)))
  }
  const metrics = useMemo(() => {
    const added = s.sourceAdded || 0
    const deleted = s.sourceDeleted || 0
    const net = added - deleted
    return [
      { label: 'NET SOURCE GROWTH', id: 'A · 01', pick: (d) => d.net, total: net, prev: (cs.sourceAdded || 0) - (cs.sourceDeleted || 0), prefix: net >= 0 ? '+' : '−' },
      { label: 'LINES ADDED', id: 'A · 08', pick: (d) => d.added, total: added, prev: cs.sourceAdded, prefix: '+' },
      { label: 'LINES DELETED', id: 'A · 09', pick: (d) => d.deleted, total: deleted, prev: cs.sourceDeleted, prefix: '−' },
      { label: 'TOTAL CHURN', id: 'A · 11', pick: (d) => d.added + d.deleted, total: added + deleted, prev: (cs.sourceAdded || 0) + (cs.sourceDeleted || 0), prefix: '' },
      { label: 'COMMITS', id: 'B · 02', pick: (d) => d.commits, total: s.commits || 0, prev: cs.commits, prefix: '' },
    ].map((m) => ({ ...m, values: cumulate(series, m.pick) || [], prior: cumulate(priorSeries, m.pick) }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, priorSeries, s.sourceAdded, s.sourceDeleted, s.commits, cs.sourceAdded, cs.sourceDeleted, cs.commits])

  const lanes = useMemo(() => {
    const pick = rangeDays(range) <= 49 ? weeklyBuckets : monthlyBuckets
    return [
      { label: 'COMMITS', unit: 'COMMITS', prefix: '', buckets: pick(series, (d) => d.commits) },
      { label: 'PULL REQUESTS', unit: 'PRS', prefix: '', buckets: pick(series, (d) => d.opened) },
      { label: 'NET LINES', unit: 'NET LINES', prefix: '+', buckets: pick(series, (d) => Math.max(0, d.net)) },
    ]
  }, [series, range])

  const rankedRepos = useMemo(
    () => computeMomentum([...(data?.repositories || [])].sort((a, b) => (b.sourceAdded + b.sourceDeleted) - (a.sourceAdded + a.sourceDeleted)), range),
    [data?.repositories, range]
  )

  return {
    s, gh, cs, cgh, series, priorSeries, metrics, lanes, rankedRepos,
    languages: data?.languages || [],
    coverage: data?.rangeCoverage,
    derived: null, // set by caller hook (useShapeDerived needs hooks order safety)
  }
}

function denseDaily(range, daily = [], prsDaily = []) {
  const byDate = new Map()
  for (const d of daily) byDate.set(d.date, { commits: d.commits || 0, added: d.added || 0, deleted: d.deleted || 0 })
  const prs = new Map()
  for (const p of prsDaily) prs.set(p.date, { opened: p.opened || 0, merged: p.merged || 0 })
  const days = rangeDays(range)
  const end = new Date((range.to || new Date().toISOString().slice(0, 10)) + 'T00:00:00Z')
  const out = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end)
    d.setUTCDate(d.getUTCDate() - i)
    const iso = d.toISOString().slice(0, 10)
    const c = byDate.get(iso) || { commits: 0, added: 0, deleted: 0 }
    const p = prs.get(iso) || { opened: 0, merged: 0 }
    out.push({ date: iso, ...c, opened: p.opened, merged: p.merged, net: c.added - c.deleted })
  }
  return out
}

function weeklyBuckets(series, pick) {
  const out = []
  for (let i = 0; i < series.length; i += 7) {
    out.push({ k: series[i].date, v: series.slice(i, i + 7).reduce((a, d) => a + pick(d), 0) })
  }
  return out
}

function monthlyBuckets(series, pick) {
  const buckets = new Map()
  for (const d of series) buckets.set(d.date.slice(0, 7), (buckets.get(d.date.slice(0, 7)) || 0) + pick(d))
  return [...buckets.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => ({ k, v }))
}

/* ─── scroll plumbing ─── */

// Reveal: opacity + rise inside a progress window [a,b], optional exit fade
// [e0,e1]. When p is null (flat mode) the content renders statically visible —
// a progress of 1 would fall inside the exit window and hide it.
function Reveal({ p, at, out, children, className, y = 16 }) {
  const fallback = useMotionValue(1)
  const pp = p || fallback
  const [a, b] = at
  const o = useTransform(pp, out ? [a, b, out[0], out[1]] : [a, b], out ? [0, 1, 1, 0] : [0, 1])
  const yy = useTransform(pp, [a, b], [y, 0])
  if (!p) return <div className={className}>{children}</div>
  return <motion.div className={className} style={{ opacity: o, y: yy }}>{children}</motion.div>
}

// A chapter track: `vh` tall; the stage pins full-viewport inside it.
function Track({ id, vh, trackRef, children }) {
  return (
    <section id={`ch-${id}`} data-chapter={id} ref={trackRef} className='relative' style={{ height: `${vh}vh` }}>
      <div className='sticky top-0 flex h-screen flex-col justify-center overflow-hidden'>{children}</div>
    </section>
  )
}

const ChapterTag = ({ n, label, right, className = '' }) => (
  <div className={`flex items-baseline justify-between ${className}`}>
    <span className='label-s text-zinc-600'>{n} — {label}</span>
    {right && <span className='label-s text-zinc-800'>{right}</span>}
  </div>
)

/* ─── 01 · MEASURE ─── */

function MeasureChapter({ props, chRange, onRange, flat, trackRef }) {
  const d = useChapterBundle({ props, chRange, compare: true })
  const range = d.range
  const compare = d.compareActive
  const { scrollYProgress: p } = useScroll({ target: trackRef, offset: ['start start', 'end end'] })
  // Boot: on load the chapter self-drives to MEASURE_BOOT so the first
  // viewport already holds the full composition (trace partially drawn).
  // eff = max(scroll, boot) — a clean handoff, never double-driven.
  const boot = useMotionValue(0)
  useEffect(() => {
    if (flat) return
    const c = animate(boot, MEASURE_BOOT, { duration: 1.6, ease: EASE, delay: 0.15 })
    return () => c.stop()
  }, [flat, boot])
  const eff = useTransform([p, boot], ([a, b]) => Math.max(a, b))
  const fp = flat ? null : eff
  const [metric, setMetric] = useState(0)
  // Shared temporal scrub between FIG. A and FIG. B — one {frac, index, src}
  // state; the source figure shows the readout, the sibling mirrors the
  // guide + snapped marker on the same date.
  const [figScrub, setFigScrub] = useState(null)
  const m = d.metrics[metric]
  const { s } = d
  const B = MEASURE_BANDS

  // ENTER → BUILD (FIG. A ends 0.52, FIG. B ends 0.70) → HOLD (0.70–0.88,
  // fully composed) → EXIT
  const draw = useTransform(eff, B.draw, [0, 1])
  const drawB = useTransform(eff, B.drawB, [0, 1])
  const exitO = useTransform(eff, B.exit, [1, 0])
  const numY = useTransform(eff, [B.exit[0], 1], [0, -90])
  const numO = useTransform(eff, [B.exit[0] - 0.02, 0.95], [1, 0])
  const metaO = useTransform(eff, [B.exit[0], B.exit[0] + 0.1], [1, 0])
  const traceY = useTransform(eff, [B.exit[0] + 0.02, 1], [0, 40])
  const hintO = useTransform(p, [0, 0.03, 0.08], [0, 0.6, 0])
  const stageO = flat ? undefined : exitO

  const coverage = d.coverage?.status
  const empty = !d.s.commits

  const body = (
    <>
      <Reveal p={fp} at={B.label} className='mx-auto w-full max-w-4xl'>
        <ChapterTag n='01' label='MEASURE' right={<ChapterPeriod id='measure' range={range} onRange={onRange} span={spanLabel(range)} />} />
      </Reveal>

      <div style={pendingDim(d.pending)}>
      <motion.div className='mx-auto w-full max-w-4xl' style={flat ? undefined : { opacity: metaO }}>
        <Reveal p={fp} at={B.metricId} className='mt-7 text-center'>
          <div className='label-s text-zinc-700'>
            {m.id} · <Term keyName='netSourceGrowth' showIcon={metric === 0}>{m.label}</Term> · {rangeDisplay(range)}
          </div>
        </Reveal>
        <Reveal p={fp} at={B.number} y={22}>
          <motion.div
            className='mt-4 flex items-baseline justify-center text-[clamp(58px,10vw,148px)] font-light leading-[0.84] tracking-[-0.055em] tabular-nums text-zinc-50 figure'
            style={flat ? undefined : { y: numY, opacity: numO }}
          >
            <span>{m.prefix}</span>
            <AnimatedNumber value={Math.abs(m.total)} />
          </motion.div>
          <div className='mt-3 text-center'>
            <CompareDelta current={m.total} previous={m.prev} compare={compare} label={compare ? `vs ${compareDisplay(range).toLowerCase()}` : ''} />
          </div>
        </Reveal>
        <Reveal p={fp} at={B.meta} className='mt-6'>
          <div className='flex flex-wrap justify-center gap-x-6 gap-y-2 text-[11px] uppercase tracking-[0.2em] text-zinc-600'>
            <span className='text-zinc-500'>{range.from || 'FIRST OBSERVED'} — {range.to || 'PRESENT'}</span>
            <span className='text-zinc-800'>·</span>
            <span>Source bytes <span className='text-zinc-400'>{fmtBytes(s.languageBytes)}</span></span>
            <span className='text-zinc-800'>·</span>
            <span>{stringN(s.repos || 0)} repositories</span>
            {d.languages[0] && (
              <>
                <span className='text-zinc-800'>·</span>
                <span className='text-zinc-400'>{d.languages[0].language}</span>
              </>
            )}
          </div>
          {coverage === 'missing' && <div className='label-s mt-6 text-center text-zinc-500'>History not yet synced for this interval</div>}
          {coverage === 'partial' && <div className='label-s mt-6 text-center text-zinc-500'>Partial history{d.coverage?.availableFrom ? ` — synced from ${String(d.coverage.availableFrom).slice(0, 10)} onward` : ''}</div>}
          {coverage === 'syncing' && <div className='label-s mt-6 text-center text-zinc-500'>Syncing this interval — measurements are filling in</div>}
          {coverage === 'complete' && empty && !d.loading && <p className='mt-6 text-center italic text-[15px] text-zinc-600 figure'>No survey data for this interval.</p>}
        </Reveal>
      </motion.div>

      <Reveal p={fp} at={B.rail} out={[B.exit[0], 0.95]} className='mx-auto mt-6 flex flex-wrap justify-center gap-1'>
        {d.metrics.map((met, i) => (
          <button
            key={met.label}
            onClick={() => setMetric(i)}
            className={`px-3 py-2 transition-colors duration-200 ${metric === i ? 'border-b border-zinc-200' : 'border-b border-transparent'}`}
            aria-pressed={metric === i}
          >
            <span className={`label-s ${metric === i ? 'text-zinc-300' : 'text-zinc-700 hover:text-zinc-500'}`}>
              {met.label.split(' ').pop()}
            </span>
          </button>
        ))}
      </Reveal>

      <Reveal p={fp} at={B.trace} className='mx-auto mt-5 w-full max-w-3xl'>
        <motion.div style={flat ? undefined : { y: traceY, opacity: exitO }}>
          <div className='mb-3 flex items-baseline justify-between'>
            <span className='label-s text-zinc-700'>FIG. A — CUMULATIVE {m.label}</span>
            <span className='label-s text-zinc-800'>{m.values.length} OBS.</span>
          </div>
          <GrowthLine
            key={m.label}
            values={m.values}
            labels={d.series.map((r) => r.date)}
            prior={compare ? m.prior : null}
            height={140}
            empty={empty}
            draw={flat ? null : draw}
            onScrub={(v) => setFigScrub(v && { ...v, src: 'a' })}
            mirror={figScrub?.src === 'b' ? figScrub : null}
          />
        </motion.div>
      </Reveal>

      <Reveal p={fp} at={B.figB} className='mx-auto mt-7 w-full max-w-3xl'>
        <motion.div style={flat ? undefined : { y: traceY, opacity: exitO }}>
          <div className='mb-3 flex items-baseline justify-between'>
            <span className='label-s text-zinc-700'>FIG. B — DAILY NET SOURCE CHANGE</span>
            <span className='label-s text-zinc-800'>{d.series.length} DAYS</span>
          </div>
          <DailyStems
            rows={d.series}
            height={104}
            draw={flat ? null : drawB}
            onScrub={(v) => setFigScrub(v && { ...v, src: 'b' })}
            mirror={figScrub?.src === 'a' ? figScrub : null}
          />
        </motion.div>
      </Reveal>
      </div>

      {!flat && (
        <motion.div className='pointer-events-none absolute bottom-8 left-1/2 -translate-x-1/2 label-s text-zinc-700' style={{ opacity: hintO }}>
          SCROLL
        </motion.div>
      )}
    </>
  )

  if (flat) {
    return <section id='ch-measure' data-chapter='measure' className='relative pt-14'>{body}</section>
  }
  return (
    <Track id='measure' vh={CHAPTERS[0].vh} trackRef={trackRef}>
      <motion.div className='flex h-full flex-col justify-center px-6 lg:px-12' style={{ opacity: stageO }}>
        {body}
      </motion.div>
    </Track>
  )
}

/* ─── 02 · FIELD ─── */

function FieldChapter({ props, chRange, onRange, flat, trackRef }) {
  const d = useChapterBundle({ props, chRange })
  const { scrollYProgress: p } = useScroll({ target: trackRef, offset: ['start start', 'end end'] })
  // entry: 0→1 as the track's top slides from viewport bottom to top — lets
  // the chapter label materialize while the stage is still arriving, closing
  // the dead band between pinned chapters.
  const { scrollYProgress: entry } = useScroll({ target: trackRef, offset: ['start end', 'start start'] })
  const fp = flat ? null : p
  const fe = flat ? null : entry
  const wipe = useTransform(p, [0.06, 0.36], [1, 0]) // scaleX of the covering veil, origin right
  const langWipe = useTransform(p, [0.54, 0.68], [1, 0])
  const heatO = useTransform(p, [0.9, 1], [1, 0.18])
  const exitO = useTransform(p, [0.9, 0.99], [1, 0])
  const activeWindow = d.range.mode === 'all' && !d.series.length ? 365 : rangeDays(d.range)
  // The field is rebuilt from the chapter's own daily series — a local range
  // change re-tiles the map rather than reusing the global one.
  const weeks = useMemo(() => {
    const end = d.range.to ? new Date(`${d.range.to}T00:00:00Z`) : new Date()
    return buildHeatmap(d.series, Math.max(d.series.length, 1), end)
  }, [d.series, d.range.to])

  const primary = [
    { label: 'COMMITS', v: d.s.commits, coord: 'B · 02' },
    { label: 'PULL REQUESTS', v: d.gh.pullRequests, coord: 'B · 04' },
    { label: 'ACTIVE DAYS', v: d.s.activeDays, coord: 'B · 06' },
  ]
  const secondary = [
    { label: 'MERGED PRS', v: d.gh.mergedPrs },
    { label: 'LONGEST STREAK', v: d.s.longestStreak },
    { label: 'REPOSITORIES', v: d.s.repos },
  ]

  const body = (
    <div className='mx-auto w-full max-w-4xl'>
      <Reveal p={fe} at={[0.3, 0.9]}>
        <ChapterTag n='02' label='FIELD' right={<ChapterPeriod id='field' range={d.range} onRange={onRange} span={spanLabel(d.range)} />} />
      </Reveal>

      <div style={pendingDim(d.pending)}>
      <Reveal p={fp} at={[0.05, 0.16]} className='mt-8'>
        <div className='flex items-baseline justify-between'>
          <span className='label-s text-zinc-500'><Term keyName='dailyContribution' showIcon>DAILY CONTRIBUTION FIELD</Term></span>
          <span className='label-s text-zinc-700'>{stringN(d.s.activeDays || 0)} / {stringN(activeWindow)} DAYS ACTIVE</span>
        </div>
      </Reveal>

      <Reveal p={fp} at={[0.08, 0.18]} className='relative mt-5'>
        <motion.div style={flat ? undefined : { opacity: heatO }}>
          <ContributionField weeks={weeks} gutter />
          {!flat && (
            <motion.div
              aria-hidden
              className='pointer-events-none absolute inset-0 bg-[var(--app-bg)]'
              style={{ scaleX: wipe, originX: 1 }}
            />
          )}
        </motion.div>
      </Reveal>

      <div className='mt-8 grid grid-cols-3 gap-8'>
        {primary.map((a, i) => (
          <Reveal key={a.label} p={fp} at={[0.3 + i * 0.04, 0.42 + i * 0.04]} out={[0.9, 0.99]}>
            <div className='text-center'>
              <div className='figure text-4xl font-light tabular-nums text-zinc-100 lg:text-5xl'>
                {a.v == null ? '—' : n(a.v)}
              </div>
              <div className='label-s mt-2 text-zinc-600'>{a.label}</div>
            </div>
          </Reveal>
        ))}
      </div>

      <div className='mt-6 flex justify-center gap-10'>
        {secondary.map((a, i) => (
          <Reveal key={a.label} p={fp} at={[0.46 + i * 0.03, 0.54 + i * 0.03]} out={[0.9, 0.99]} y={10}>
            <div className='text-center'>
              <div className='figure text-xl tabular-nums text-zinc-400'>{a.v == null ? '—' : a.v}</div>
              <div className='label-s mt-1 text-zinc-700'>{a.label}</div>
            </div>
          </Reveal>
        ))}
      </div>

      <Reveal p={fp} at={[0.5, 0.62]} out={[0.9, 0.99]} className='mx-auto mt-8 w-[94%]'>
        <div className='mb-4 flex items-baseline justify-between'>
          <span className='label-s text-zinc-600'>LANGUAGE COMPOSITION</span>
          <span className='label-s text-zinc-800'>C · 01</span>
        </div>
        <div className='relative'>
          <LanguageBar languages={d.languages} onHover={() => {}} activeLang={null} />
          {!flat && (
            <motion.div
              aria-hidden
              className='pointer-events-none absolute inset-0 bg-[var(--app-bg)]'
              style={{ scaleX: langWipe, originX: 1 }}
            />
          )}
        </div>
        {d.languages[0] && (
          <div className='mt-3 flex justify-between font-mono text-[10px] text-zinc-600'>
            <span>{d.languages[0].language} <span className='text-zinc-400'>{fmtBytes(d.languages[0].code)}</span></span>
            {d.languages[1] && <span>{d.languages[1].language} <span className='text-zinc-400'>{fmtBytes(d.languages[1].code)}</span></span>}
          </div>
        )}
      </Reveal>
      </div>
    </div>
  )

  if (flat) return <section id='ch-field' data-chapter='field' className='py-14'>{body}</section>
  return (
    <Track id='field' vh={CHAPTERS[1].vh} trackRef={trackRef}>
      <motion.div className='flex h-full flex-col justify-center px-6 lg:px-12' style={{ opacity: exitO }}>
        {body}
      </motion.div>
    </Track>
  )
}

/* ─── 03 · INDEX ─── */

function IndexChapter({ props, chRange, onRange, flat, trackRef }) {
  const d = useChapterBundle({ props, chRange })
  const { scrollYProgress: p } = useScroll({ target: trackRef, offset: ['start start', 'end end'] })
  const { scrollYProgress: entry } = useScroll({ target: trackRef, offset: ['start end', 'start start'] })
  const fp = flat ? null : p
  const fe = flat ? null : entry
  const [repoFocus, setRepoFocus] = useState(null)
  const [langFocus, setLangFocus] = useState(null)
  const B = INDEX_BANDS
  // draw ends 0.58 → HOLD 0.58–0.86 (fully assembled) → EXIT
  const exitO = useTransform(p, B.exit, [1, 0])
  const lanesDraw = useTransform(p, B.draw, [0, 1])
  const laneH = 44
  const rows = d.rankedRepos.slice(0, 7)

  const body = (
    <div className='mx-auto w-full max-w-4xl'>
      <Reveal p={fe} at={[0.3, 0.9]}>
        <ChapterTag n='03' label='INDEX' right={<ChapterPeriod id='index' range={d.range} onRange={onRange} span={spanLabel(d.range)} />} />
      </Reveal>

      <div style={pendingDim(d.pending)}>
      {d.derived && (
        <Reveal p={fp} at={B.constellation} className='mt-4'>
          <Constellation
            spans={d.derived.spans}
            axis={d.derived.axis}
            repoFocus={repoFocus}
            setRepoFocus={setRepoFocus}
            langFocus={langFocus}
            onHoverLang={setLangFocus}
            compact
          />
        </Reveal>
      )}

      <div className='mt-4 border-t border-zinc-900'>
        {rows.map((r, i) => (
          <Reveal key={r.path || r.id} p={fp} at={[B.rows[0] + i * 0.028, B.rows[0] + 0.06 + i * 0.028]} y={8}>
            <div
              className={`flex items-center gap-4 border-b border-zinc-900 py-2 transition-opacity duration-300 ${
                repoFocus && repoFocus !== r.id ? 'opacity-25' : ''
              }`}
              onMouseEnter={() => { setRepoFocus(r.id); r.primaryLanguage && setLangFocus(r.primaryLanguage) }}
              onMouseLeave={() => { setRepoFocus(null); setLangFocus(null) }}
            >
              <span className='w-10 font-mono text-[10px] text-zinc-700'>D.{String(i + 1).padStart(2, '0')}</span>
              <div className='flex min-w-0 flex-1 items-center gap-2'>
                <span className='figure truncate text-base text-zinc-200'>{r.name}</span>
                {r.private && <Icon icon='octicon:lock-16' className='h-2.5 w-2.5 text-zinc-700' />}
              </div>
              <span className='hidden font-mono text-[10px] text-zinc-700 sm:inline'>{(r.primaryLanguage || '—').toUpperCase()}</span>
              <span className='font-mono text-[10px] text-zinc-600'>{r.momentumState}</span>
              <span className='w-14 text-right figure text-sm text-zinc-400 tabular-nums'>{compact((r.sourceAdded || 0) + (r.sourceDeleted || 0))}</span>
              <span className='w-10 text-right figure text-sm text-zinc-500 tabular-nums'>{r.commits || 0}</span>
            </div>
          </Reveal>
        ))}
        {d.rankedRepos.length > rows.length && (
          <div className='label-s py-2.5 text-zinc-800'>+{d.rankedRepos.length - rows.length} FURTHER REPOSITORIES — SEE PROJECTS</div>
        )}
      </div>

      <Reveal p={fp} at={B.lanes} className='mt-5'>
        <div className='mb-3 flex items-baseline justify-between'>
          <span className='label-s text-zinc-600'>HISTORICAL LANES</span>
          <span className='label-s text-zinc-800'>SHARED AXIS</span>
        </div>
        <div className='flex'>
          <div className='w-24 shrink-0 border-r border-zinc-900'>
            {d.lanes.map((l) => (
              <div key={l.label} className='flex items-center font-mono text-[9px] tracking-wider text-zinc-600' style={{ height: laneH }}>
                {l.label}
              </div>
            ))}
          </div>
          <div className='relative flex-1'>
            {d.lanes.map((l, i) => (
              <LaneChart key={l.label} lane={l} height={laneH} sep={i > 0} draw={flat ? null : lanesDraw} />
            ))}
          </div>
        </div>
        <div className='mt-2 flex justify-between border-t border-zinc-900 pt-2 font-mono text-[9px] text-zinc-700'>
          <span>{d.range.from || 'FIRST OBSERVED'}</span>
          <span>OBSERVATIONS SHARE ONE BASELINE</span>
          <span>{d.range.to || 'PRESENT'}</span>
        </div>
      </Reveal>
      </div>
    </div>
  )

  if (flat) return <section id='ch-index' data-chapter='index' className='py-14'>{body}</section>
  return (
    <Track id='index' vh={CHAPTERS[2].vh} trackRef={trackRef}>
      <motion.div className='flex h-full flex-col justify-center px-6 lg:px-12' style={{ opacity: exitO }}>
        {body}
      </motion.div>
    </Track>
  )
}

// One historical lane: scroll-drawn path + shared scrub interaction. Each lane
// is its own row so the pointer target, guide, and readout stay colocated.
function LaneChart({ lane, height, sep, draw }) {
  const reduced = useReducedMotion()
  const vals = lane.buckets.map((b) => b.v)
  const { hover, frac, snapFrac, bind } = useScrubIndex(vals.length)
  const max = Math.max(...vals, 1) * 1.12
  const pts = useMemo(
    () =>
      vals.map((v, i) => ({
        x: (i / Math.max(vals.length - 1, 1)) * LANE_W,
        y: height - (v / max) * (height - 12) - 5,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [vals.join(','), height]
  )
  const path = smoothPath(pts)
  return (
    <div className={`relative ${sep ? 'border-t border-zinc-900' : ''}`} style={{ height, ...SCRUB_TOUCH }} {...bind}>
      <svg viewBox={`0 0 ${LANE_W} ${height}`} className='block h-full w-full' preserveAspectRatio='none'>
        {draw ? (
          <motion.path key={path} d={path} fill='none' stroke='rgba(250,250,250,0.82)' strokeWidth={1.1} vectorEffect='non-scaling-stroke' style={{ pathLength: draw }} />
        ) : (
          <motion.path
            key={path}
            d={path}
            fill='none'
            stroke='rgba(250,250,250,0.82)'
            strokeWidth={1.1}
            vectorEffect='non-scaling-stroke'
            initial={reduced ? false : { pathLength: 0 }}
            whileInView={reduced ? undefined : { pathLength: 1 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 1.3, ease: [0.33, 1, 0.4, 1] }}
          />
        )}
        {frac != null && (
          <ScrubMark guideX={frac * LANE_W} x={pts[hover]?.x} y={pts[hover]?.y} height={height} />
        )}
      </svg>
      {hover != null && lane.buckets[hover] && (
        <ScrubReadout frac={snapFrac} label={bucketLabel(lane.buckets[hover].k)}>
          <ScrubValue v={vals[hover]} prefix={lane.prefix} suffix={` ${lane.unit}`} />
        </ScrubReadout>
      )}
    </div>
  )
}

/* ─── 04 · ARCHIVE ─── */

function ArchiveFigure({ id, d, rangeLabel }) {
  const der = d.derived
  if (!der) return null
  const { s } = d
  switch (id) {
    case 'fingerprint':
      return <Fingerprint dims={der.dims} rangeLabel={rangeLabel} />
    case 'succession':
      return <Strata strata={der.strata} axis={der.axis} langFocus={null} onHoverLang={() => {}} hoverM={null} setHoverM={() => {}} />
    case 'lifecycle':
      return <Lifecycle spans={der.spans} axis={der.axis} hoverM={null} repoFocus={null} setRepoFocus={() => {}} />
    case 'migration':
      return <Migration runs={der.runs} />
    case 'span':
      return <WorkSpan span={der.span} spans={der.spans} languages={der.langCount} />
    default:
      return null
  }
}

function ArchiveChapter({ props, chRange, onRange, flat, trackRef, onJumpFigure }) {
  const d = useChapterBundle({ props, chRange })
  const range = d.range
  const { scrollYProgress: p } = useScroll({ target: trackRef, offset: ['start start', 'end end'] })
  const { scrollYProgress: entry } = useScroll({ target: trackRef, offset: ['start end', 'start start'] })
  const fp = flat ? null : p
  const fe = flat ? null : entry
  const [figIdx, setFigIdx] = useState(0)
  const [flatFig, setFlatFig] = useState(0)
  useMotionValueEvent(p, 'change', (v) => {
    const i = figureIndex(v)
    if (i !== figIdx) setFigIdx(i)
  })
  const rangeLabel = `PERIOD · ${range.mode.toUpperCase()}`
  const activeId = ARCHIVE_FIGURES[flat ? flatFig : figIdx].id
  // Archive figures are computed over the full stored history, not the
  // selected range — label the span honestly.
  const archivalSpan = d.derived
    ? `ARCHIVAL RECORD · ${monthName(idxMonth(d.derived.axis.first))} — ${monthName(idxMonth(d.derived.axis.last))}`
    : 'ARCHIVAL RECORD'

  const heading = (
    <div className='mx-auto w-full max-w-4xl'>
      <Reveal p={fe} at={[0.3, 0.9]}>
        <div className='label-s flex items-baseline justify-between text-zinc-700'>
          <span>04 — ARCHIVE · F · 00 — LONGITUDINAL RECORD</span>
          <span className='flex flex-col items-end gap-1.5'>
            <span className='text-zinc-800'>{archivalSpan}</span>
            <ChapterRangeCtl id='archive' range={range} onRange={onRange} />
          </span>
        </div>
        <h2 className='figure mt-3 text-[clamp(30px,3.8vw,50px)] font-light leading-none tracking-[-0.03em] text-zinc-50'>
          The Shape of Your Work
        </h2>
      </Reveal>
    </div>
  )

  const selector = (
    <div className='flex flex-wrap gap-1 border-t border-zinc-900 pt-3'>
      {ARCHIVE_FIGURES.map((f, i) => {
        const active = i === (flat ? flatFig : figIdx)
        return (
          <button
            key={f.id}
            onClick={() => (flat ? setFlatFig(i) : onJumpFigure?.(i))}
            className={`label-s px-2.5 py-1.5 transition-colors duration-300 ${active ? 'bg-zinc-900/60 text-zinc-100' : 'text-zinc-700 hover:text-zinc-400'}`}
            aria-pressed={active}
          >
            {f.n} {f.label}
          </button>
        )
      })}
    </div>
  )

  const reduced = useReducedMotion()
  const stage = (
    // Grid-stacked single cell: exiting + entering figures overlap while the
    // stage keeps the tallest figure's height — no layout jump, no clipping.
    <div className='mt-6 grid'>
      <AnimatePresence mode='sync' initial={false}>
        <motion.div
          key={activeId}
          initial={reduced ? false : { opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduced ? { opacity: 0 } : { opacity: 0, y: -10 }}
          transition={{ duration: reduced ? 0 : 0.55, ease: EASE }}
          className='col-start-1 row-start-1 min-h-[38vh]'
        >
          <div style={pendingDim(d.pending)}>
            <ArchiveFigure id={activeId} d={d} rangeLabel={rangeLabel} />
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  )

  const empty = (
    <div className='mx-auto w-full max-w-4xl'>
      {heading}
      <p className='label-s mt-8 text-zinc-700'>INSUFFICIENT STORED HISTORY — THE ARCHIVE RESOLVES ONCE COMMIT DATA EXISTS</p>
    </div>
  )
  if (!d.derived) {
    // Keep the Track mounted so the chapter's scroll target exists from first
    // render — remounting it later leaves useScroll bound to a stale target.
    if (flat) return <section id='ch-archive' data-chapter='archive' ref={trackRef} className='py-14'>{empty}</section>
    return (
      <Track id='archive' vh={CHAPTERS[3].vh} trackRef={trackRef}>
        <div className='flex h-full flex-col justify-center px-6 lg:px-12'>{empty}</div>
      </Track>
    )
  }

  if (flat) {
    return (
      <section id='ch-archive' data-chapter='archive' className='py-14'>
        <div className='mx-auto max-w-4xl'>
          {heading}
          <div className='mt-6'>{selector}</div>
          {stage}
        </div>
      </section>
    )
  }

  return (
    <Track id='archive' vh={CHAPTERS[3].vh} trackRef={trackRef}>
      <div className='flex h-full flex-col justify-center px-6 lg:px-12'>
        {heading}
        <div className='mx-auto mt-2 w-full max-w-4xl'>{selector}</div>
        <div className='mx-auto w-full max-w-4xl'>{stage}</div>
      </div>
    </Track>
  )
}

/* ─── chapter rail ─── */

function ChapterRail({ chapters, active, onJump }) {
  return (
    <nav aria-label='Overview chapters' className='fixed right-5 top-1/2 z-40 hidden -translate-y-1/2 flex-col items-end gap-3 lg:flex'>
      {chapters.map((c, i) => (
        <button
          key={c.id}
          onClick={() => onJump(i)}
          aria-current={i === active}
          className={`group flex items-baseline gap-2 transition-colors duration-300 ${i === active ? 'text-zinc-200' : 'text-zinc-700 hover:text-zinc-500'}`}
        >
          <span className='font-mono text-[9px] tracking-[0.2em]'>{c.n}</span>
          <span className='font-mono text-[9px] tracking-[0.2em]'>{c.label}</span>
          <span className={`inline-block h-px transition-all duration-300 ${i === active ? 'w-5 bg-zinc-300' : 'w-2.5 bg-zinc-800 group-hover:bg-zinc-600'}`} />
        </button>
      ))}
    </nav>
  )
}

/* ─── composition ─── */

export default function QuietOverview(props) {
  const reduced = useReducedMotion()
  const wide = useMediaQuery('(min-width: 1024px)')
  const scrollMode = !reduced && wide

  // Chapter-local periods: each chapter inherits the global range until it is
  // overridden through its own PERIOD instrument. A global range change resets
  // all four chapters back to the new global period.
  const [localRanges, setLocalRanges] = useState({})
  useEffect(() => setLocalRanges({}), [props.range])
  const chRange = (id) => localRanges[id] || props.range
  const setChRange = (id, r) => setLocalRanges((o) => ({ ...o, [id]: r }))

  const trackRefs = [useRef(null), useRef(null), useRef(null), useRef(null)]
  const [active, setActive] = useState(0)

  // useScroll measures track geometry on mount + resize only. Banners/notices
  // above the tracks (sync states, coverage) shift chapter positions whenever
  // data or range changes — force a re-measure once things settle.
  useEffect(() => {
    const t = setTimeout(() => window.dispatchEvent(new Event('resize')), 80)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.loading, props.data, props.range?.mode, props.range?.from, props.range?.to])

  useEffect(() => {
    if (!scrollMode) return
    const update = () => {
      const rects = trackRefs.map((r) => {
        const el = r.current
        if (!el) return { top: Infinity }
        const b = el.getBoundingClientRect()
        return { top: b.top + window.scrollY, height: b.height }
      })
      setActive(chapterAt(window.scrollY + window.innerHeight * 0.5, rects))
    }
    update()
    window.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollMode])

  const jumpTo = (i) => {
    const el = trackRefs[i]?.current
    if (!el) return
    const top = el.getBoundingClientRect().top + window.scrollY + 2
    if (window.__lenis) window.__lenis.scrollTo(top)
    else window.scrollTo({ top, behavior: reduced ? 'auto' : 'smooth' })
  }

  const jumpFigure = (i) => {
    const el = trackRefs[3]?.current
    if (!el) return
    const [a] = figureWindow(i)
    const trackTop = el.getBoundingClientRect().top + window.scrollY
    const trackLen = el.offsetHeight - window.innerHeight
    const top = trackTop + (a + 0.5 / ARCHIVE_FIGURES.length) * trackLen
    if (window.__lenis) window.__lenis.scrollTo(top)
    else window.scrollTo({ top, behavior: 'smooth' })
  }

  return (
    <div className='quiet-overview'>
      {scrollMode && <ChapterRail chapters={CHAPTERS} active={active} onJump={jumpTo} />}
      <MeasureChapter props={props} chRange={chRange('measure')} onRange={(r) => setChRange('measure', r)} flat={!scrollMode} trackRef={trackRefs[0]} />
      <FieldChapter props={props} chRange={chRange('field')} onRange={(r) => setChRange('field', r)} flat={!scrollMode} trackRef={trackRefs[1]} />
      <IndexChapter props={props} chRange={chRange('index')} onRange={(r) => setChRange('index', r)} flat={!scrollMode} trackRef={trackRefs[2]} />
      <ArchiveChapter props={props} chRange={chRange('archive')} onRange={(r) => setChRange('archive', r)} flat={!scrollMode} trackRef={trackRefs[3]} onJumpFigure={jumpFigure} />
      <div className='flex items-baseline justify-between border-t border-zinc-900 py-8'>
        <span className='label-s text-zinc-800'>END OF RECORD</span>
        <span className='label-s text-zinc-800'>DEV LEDGER</span>
      </div>
    </div>
  )
}
