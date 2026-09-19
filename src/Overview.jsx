import React, { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Icon } from '@iconify/react'
import { AnimatedNumber } from './AnimatedNumber'
import { CompareDelta } from './CompareDelta'
import { ContributionField } from './Heatmap'
import { LanguageBar } from './LanguageBar'
import { Term } from './TermTooltip'
import { rangeDays, rangeDisplay, compareDisplay } from './range'
import { useReducedMotion, ease } from './motion'
import { DrawHR, GrowthLine, SeriesLine, MomentumBar } from './Canvas'
import { computeMomentum } from './LegacyTabs'

const fmt = new Intl.NumberFormat('en-US')
const stringN = (v) => (v == null ? '—' : fmt.format(Number(v)))
const n = (v) => <AnimatedNumber value={v} />
const compact = (v) => <AnimatedNumber value={v} compact />
const monthShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function fmtBytes(v) {
  const b = Number(v) || 0
  if (b >= 1048576) return `${(b / 1048576).toFixed(1)} MB`
  if (b >= 1024) return `${(b / 1024).toFixed(1)} KB`
  return `${b} B`
}

function timeAgo(dateStr) {
  if (!dateStr) return '—'
  const d = new Date(String(dateStr).length === 10 ? dateStr + 'T00:00:00Z' : dateStr)
  const diff = Date.now() - d.getTime()
  const days = Math.floor(diff / 86400000)
  if (days < 1) return 'today'
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`
  return `${Math.floor(days / 365)}y ago`
}

const Lbl = ({ children, className = '' }) => (
  <span className={`label-s inline-flex items-center gap-1.5 ${className}`}>{children}</span>
)
const Coord = ({ children }) => (
  <span className='label-s text-zinc-800 whitespace-nowrap shrink-0'>{children}</span>
)
const ZeroNote = ({ children, className = '' }) => (
  <p className={`italic text-[15px] leading-relaxed text-zinc-600 figure ${className}`}>{children}</p>
)

// Dense per-day series over the selected range — the dashboard returns sparse
// rows (only days with activity), but the shared time axis needs every day.
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

function weekly(series, pick) {
  const out = []
  for (let i = 0; i < series.length; i += 7) out.push(series.slice(i, i + 7).reduce((s, d) => s + pick(d), 0))
  return out
}

function monthlyBuckets(series, pick) {
  const buckets = new Map()
  for (const d of series) {
    const key = d.date.slice(0, 7)
    buckets.set(key, (buckets.get(key) || 0) + pick(d))
  }
  return [...buckets.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([, v]) => v)
}

export default function Overview({ data, compare, compareData, daily, prsDaily, range, weeks, loading }) {
  const reduced = useReducedMotion()
  const [focus, setFocus] = useState(null)
  const s = data?.summary || {}
  const gh = data?.github || {}
  const cs = compareData?.summary || {}
  const cgh = compareData?.github || {}

  const added = s.sourceAdded || 0
  const deleted = s.sourceDeleted || 0
  const net = added - deleted
  const churn = added + deleted
  const commits = s.commits || 0
  const repos = s.repos || 0
  const activeDays = s.activeDays || 0
  const longestStreak = s.longestStreak || 0
  const pullRequests = gh.pullRequests ?? null
  const merged = gh.mergedPrs ?? null
  const prevAdded = cs.sourceAdded || 0
  const prevDeleted = cs.sourceDeleted || 0
  const prevNet = prevAdded - prevDeleted
  const prevChurn = prevAdded + prevDeleted
  const activeWindow = range.mode === 'all' && !daily.length ? 365 : rangeDays(range)
  const languages = data?.languages || []
  const coverage = data?.rangeCoverage
  const empty = !commits
  const primaryLang = languages[0]?.language

  const series = useMemo(() => denseDaily(range, daily, prsDaily), [range, daily, prsDaily])
  const priorSeries = useMemo(
    () => (compare && compareData ? denseDaily({ mode: 'custom', from: compareData.range?.from, to: compareData.range?.to }, compareData.daily, compareData.prsDaily) : null),
    [compare, compareData]
  )
  const cumulative = useMemo(() => {
    let cur = 0
    return series.map((d) => (cur += d.net))
  }, [series])
  const priorCumulative = useMemo(() => {
    if (!priorSeries) return null
    let cur = 0
    return priorSeries.map((d) => (cur += d.net))
  }, [priorSeries])

  const lanes = useMemo(() => {
    const useWeek = rangeDays(range) <= 49
    const pick = useWeek ? weekly : monthlyBuckets
    return [
      { label: 'COMMITS', values: pick(series, (d) => d.commits) },
      { label: 'PULL REQUESTS', values: pick(series, (d) => d.opened) },
      { label: 'NET LINES', values: pick(series, (d) => Math.max(0, d.net)) },
    ]
  }, [series, range])

  const rankedRepos = useMemo(
    () => computeMomentum([...(data?.repositories || [])].sort((a, b) => (b.sourceAdded + b.sourceDeleted) - (a.sourceAdded + a.sourceDeleted)), range),
    [data?.repositories, range]
  )

  const langTotal = languages.reduce((a, l) => a + (l.code || 0), 0) || 1
  let cum = 0
  const langTicks = languages.map((l, i) => {
    const pct = (l.code || 0) / langTotal
    const start = cum * 100
    cum += pct
    return { ...l, pct, x: start, up: i % 2 === 0 }
  })
  const langFocus = focus?.startsWith('lang:') ? focus.slice(5) : null
  const dimFor = (key) => `transition-opacity duration-300 ${focus && focus !== key ? 'opacity-25' : ''}`

  const quadrants = [
    { k: 'added', label: 'Lines Added', v: added, prefix: '+', coord: 'A · 08', term: 'linesAdded', cur: added, prev: prevAdded },
    { k: 'deleted', label: 'Lines Deleted', v: deleted, prefix: '−', coord: 'A · 09', term: 'linesDeleted', cur: deleted, prev: prevDeleted },
    { k: 'net', label: 'Net Lines', v: net, prefix: net >= 0 ? '+' : '−', coord: 'A · 10', term: 'netLines', cur: net, prev: prevNet },
    { k: 'churn', label: 'Total Churn', v: churn, prefix: '', coord: 'A · 11', term: 'totalChurn', cur: churn, prev: prevChurn },
  ]

  const activity = [
    { key: 'commits', label: 'Commits', value: commits, coord: 'B · 02', icon: 'octicon:git-commit-16', term: 'commits', cur: commits, prev: cs.commits },
    { key: 'prs', label: 'Pull Requests', value: pullRequests, coord: 'B · 04', icon: 'octicon:git-pull-request-16', term: 'pullRequests', cur: pullRequests, prev: cgh.pullRequests },
    { key: 'merged', label: 'Merged PRs', value: merged, coord: 'B · 06', icon: 'octicon:git-merge-16', term: 'merged', cur: merged, prev: cgh.mergedPrs },
    { key: 'activeDays', label: 'Active Days', value: activeDays, coord: 'B · 02', icon: 'ph:calendar-check-bold', term: 'activeDays', cur: activeDays, prev: cs.activeDays },
    { key: 'streak', label: 'Longest Streak', value: longestStreak, coord: 'B · 04', icon: 'ph:flame-bold', term: 'longestStreak', cur: longestStreak, prev: cs.longestStreak },
    { key: 'repositories', label: 'Repositories', value: repos, coord: 'B · 06', icon: 'octicon:repo-16', term: 'repositories' },
  ]

  const covStatus = coverage?.status

  return (
    <div>
      {/* ============ FIELD A — NET SOURCE GROWTH + QUADRANTS + CUMULATIVE ============ */}
      <section className='grid grid-cols-12 gap-x-6 lg:gap-x-8 pt-10 lg:pt-14'>
        <div className='col-span-12 lg:col-span-7 pb-10'>
          <div className='flex items-center justify-between gap-4'>
            <Lbl><Term keyName='netSourceGrowth' showIcon>Net Source Growth</Term> · {rangeDisplay(range)}</Lbl>
            <Coord>A · 01</Coord>
          </div>
          <motion.div
            className='mt-5 flex items-baseline text-[clamp(76px,9.5vw,150px)] font-light leading-[0.84] tracking-[-0.055em] tabular-nums text-zinc-50 figure'
            initial={reduced ? false : { opacity: 0, y: 14, filter: 'blur(3px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            transition={{ duration: 0.7, ease: ease.out, delay: 0.12 }}
          >
            <span>{net >= 0 ? '+' : '−'}</span>
            <AnimatedNumber value={Math.abs(net)} />
          </motion.div>
          <CompareDelta current={net} previous={prevNet} compare={compare} label={compare ? `vs ${compareDisplay(range).toLowerCase()}` : ''} />
          <div className='mt-7 flex flex-wrap gap-x-6 gap-y-2 text-[11px] uppercase tracking-[0.2em] text-zinc-600'>
            <span className='text-zinc-500'>{range.from || '—'} — {range.to || '—'}</span>
            <span className='text-zinc-800'>·</span>
            <span><Term keyName='languageBytes' showIcon>Source bytes</Term> <span className='text-zinc-400'>{fmtBytes(s.languageBytes)}</span></span>
            <span className='text-zinc-800'>·</span>
            <span>{stringN(repos)} <Term keyName='repositories' showIcon>repositories</Term></span>
            {primaryLang && (
              <>
                <span className='text-zinc-800'>·</span>
                <span><Term keyName='primaryLanguage' showIcon>{primaryLang}</Term></span>
              </>
            )}
          </div>
          {covStatus === 'missing' && (
            <div className='label-s mt-6 text-zinc-500'>History not yet synced for this interval — the matrix holds stored coverage only</div>
          )}
          {covStatus === 'partial' && (
            <div className='label-s mt-6 text-zinc-500'>
              Partial history{coverage?.availableFrom ? ` — synced from ${String(coverage.availableFrom).slice(0, 10)} onward` : ''}
            </div>
          )}
          {covStatus === 'syncing' && (
            <div className='label-s mt-6 text-zinc-500'>Syncing this interval — measurements are filling in</div>
          )}
          {covStatus === 'complete' && empty && !loading && (
            <ZeroNote className='mt-6 max-w-sm'>No survey data for this interval — the field is drawn but holds no measurements.</ZeroNote>
          )}
        </div>

        {/* suspended quadrant stats — bounded cells sharing one vertical datum */}
        <div className='col-span-12 lg:col-span-5 grid grid-cols-2 gap-x-6 lg:gap-x-8 gap-y-9 content-end pb-10 mt-2 lg:mt-0 lg:border-l lg:border-zinc-900 lg:pl-10'>
          {quadrants.map((q, i) => (
            <motion.div
              key={q.k}
              onMouseEnter={() => setFocus(q.k)}
              onMouseLeave={() => setFocus(null)}
              initial={reduced ? false : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 + i * 0.07, duration: 0.7, ease: ease.out }}
              className={`border-t border-zinc-900 pt-3 ${i % 2 ? 'border-l border-zinc-900 pl-5' : ''} ${dimFor(q.k)}`}
            >
              <div className='flex justify-between gap-2'>
                <span className='label-s'><Term keyName={q.term} showIcon>{q.label}</Term></span>
                <Coord>{q.coord}</Coord>
              </div>
              <div className='mt-2 text-[clamp(26px,2.4vw,38px)] font-light text-zinc-100 figure tabular-nums leading-none'>
                {q.prefix}{n(Math.abs(q.v))}
              </div>
              <CompareDelta current={q.cur} previous={q.prev} compare={compare} label={compare ? `vs previous ${range.mode === 'ytd' ? 'ytd' : range.mode}` : ''} />
            </motion.div>
          ))}
        </div>

        {/* cumulative chart — a bounded cell sharing the matrix rules */}
        <div className='col-span-12 border-t border-zinc-900 pt-6'>
          <GrowthLine values={cumulative} prior={compare ? priorCumulative : null} height={260} empty={empty} />
          <div className='mt-2 flex justify-between label-s text-zinc-800'>
            <span>{empty ? 'NO HISTORICAL DATA — BASELINE HOLDS AT ZERO' : 'FIG. FIELD A — CUMULATIVE NET SOURCE'}</span>
            <span>{cumulative.length} OBSERVATIONS</span>
          </div>
        </div>
      </section>

      <DrawHR className='mt-10' />

      {/* ============ FIELD B — DAILY CONTRIBUTION FIELD ============ */}
      <section className='py-12'>
        <div className='flex items-center justify-between gap-4 mb-8'>
          <Lbl><Term keyName='dailyContribution' showIcon>Daily Contribution Field</Term></Lbl>
          <Coord>{stringN(activeDays)} / {stringN(activeWindow)} DAYS ACTIVE · B · 07</Coord>
        </div>
        <ContributionField weeks={weeks} gutter />
      </section>

      <DrawHR />

      {/* ============ FIELD C — ACTIVITY INTERSECTIONS + LANGUAGE SCALE ============ */}
      <section className='grid grid-cols-12 gap-x-6 lg:gap-x-8 py-14'>
        <div className='col-span-12 lg:col-span-7'>
          <Lbl className='mb-10'>Development Activity — values at grid intersections</Lbl>
          <div className='grid grid-cols-2 lg:grid-cols-3'>
            {activity.map((a, i) => (
              <motion.div
                key={a.label}
                initial={reduced ? false : { opacity: 0, y: 14 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.5 }}
                transition={{ delay: i * 0.06, duration: 0.7, ease: ease.out }}
                className={[
                  'border-t border-zinc-900 py-6',
                  i % 2 ? 'border-l border-zinc-900 pl-4' : 'pr-4',
                  i % 3 !== 0 ? 'lg:border-l lg:pl-5' : 'lg:border-l-0 lg:pl-0 lg:pr-5',
                ].join(' ')}
              >
                <div className='flex items-center gap-2 label-s text-zinc-800'>
                  <Icon icon={a.icon} className='h-3 w-3' />
                  <span>{a.coord}</span>
                </div>
                <div className='mt-4 text-[40px] font-light leading-none text-zinc-100 figure tabular-nums'>
                  {a.value === null ? '—' : n(a.value)}
                </div>
                <span className='label-s mt-2 block text-zinc-600'>
                  <Term keyName={a.term} showIcon>{a.label}</Term>
                </span>
                <CompareDelta current={a.cur} previous={a.prev} compare={compare} />
              </motion.div>
            ))}
          </div>
        </div>

        <div className='col-span-12 lg:col-span-4 lg:col-start-9 mt-14 lg:mt-0 lg:border-l lg:border-zinc-900 lg:pl-10'>
          <Lbl><Term keyName='languageComposition' showIcon>Language Composition — scale bar</Term></Lbl>
          <div className='mt-6'>
            <LanguageBar
              languages={languages}
              onHover={(l) => setFocus(l ? `lang:${l}` : null)}
              activeLang={langFocus}
            />
          </div>
          <div className='relative h-28 mt-0'>
            <div className='absolute left-0 right-0 top-10 h-px bg-zinc-800' />
            {langTicks.map((l) => {
              const labeled = l.pct >= 0.04
              return (
                <div
                  key={l.language}
                  onMouseEnter={() => setFocus(`lang:${l.language}`)}
                  onMouseLeave={() => setFocus(null)}
                  className={`absolute top-0 w-px transition-opacity duration-300 ${focus && focus !== `lang:${l.language}` && focus.startsWith('lang:') ? 'opacity-30' : ''}`}
                  style={{ left: `${Math.min(l.x, 97)}%` }}
                >
                  <span className={`block w-px bg-zinc-500 ${l.up ? 'h-10' : 'h-6 mt-4'}`} />
                  {labeled && (
                    <div className={`absolute mt-1 whitespace-nowrap max-w-[130px] ${l.x > 78 ? 'right-0 text-right' : l.x < 12 ? 'left-0' : 'left-1/2 -translate-x-1/2'}`}>
                      <span className='label-s block'>{l.language}</span>
                      <span className='block text-[15px] text-zinc-500 figure tabular-nums'>
                        {fmtBytes(l.code)}
                      </span>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          <span className='label-s mt-4 block text-zinc-800'>
            Ticks at cumulative byte share{primaryLang ? ` · ${(langTicks[0].pct * 100).toFixed(1)}% ${primaryLang}` : ''}
          </span>
        </div>
      </section>

      <DrawHR />

      {/* ============ FIELD D — PROJECT COORDINATES ============ */}
      <section className='py-14'>
        <div className='flex items-center justify-between gap-4 mb-6'>
          <Lbl>Projects — positioned by <Term keyName='sourceChurn' showIcon>churn</Term> · {rangeDisplay(range)}</Lbl>
          <Coord>D · 01—{String(rankedRepos.length).padStart(2, '0')}</Coord>
        </div>
        <div className='border-t border-zinc-900'>
          {rankedRepos.map((p, i) => (
            <motion.div
              key={p.path}
              layout
              initial={reduced ? false : { opacity: 0, x: -10 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true, amount: 0.3 }}
              transition={{ duration: 0.6, delay: i * 0.04, ease: ease.out }}
              onMouseEnter={() => p.primaryLanguage && setFocus(`lang:${p.primaryLanguage}`)}
              onMouseLeave={() => setFocus(null)}
              className={`grid grid-cols-12 items-center gap-4 border-b border-zinc-900 py-5 transition-all hover:bg-zinc-100/[0.02] ${
                langFocus && p.primaryLanguage !== langFocus ? 'opacity-25' : ''
              }`}
            >
              <span className='label-s text-zinc-800 col-span-2 lg:col-span-1'>D.{String(i + 1).padStart(2, '0')}</span>
              <div className='col-span-10 lg:col-span-5 min-w-0'>
                <span className={`figure block truncate text-[21px] leading-none ${p.commits ? 'text-zinc-100' : 'text-zinc-600'}`}>
                  {p.name}
                  {p.private && <Icon icon='octicon:lock-16' className='inline h-3 w-3 ml-2 text-zinc-700 align-baseline' />}
                </span>
                <span className='label-s mt-1.5 block text-zinc-800'>
                  {p.primaryLanguage ? `${p.primaryLanguage} · ` : ''}{timeAgo(p.lastCommit)}
                </span>
              </div>
              <div className='col-span-3 hidden md:block'>
                <MomentumBar score={p.momentum} />
                <span className='label-s mt-2 block text-zinc-800'>{p.momentumState} · {p.momentum}</span>
              </div>
              <span className='figure col-span-2 lg:col-span-1 text-right text-[20px] text-zinc-300 tabular-nums'>{compact((p.sourceAdded || 0) + (p.sourceDeleted || 0))}</span>
              <span className='figure col-span-2 lg:col-span-1 text-right text-[20px] text-zinc-300 tabular-nums'>{n(p.commits || 0)}</span>
              <span className='figure col-span-1 lg:col-span-1 text-right text-[20px] text-zinc-300 tabular-nums hidden lg:block'>{n(p.activeDays || 0)}</span>
            </motion.div>
          ))}
          {!rankedRepos.length && !loading && (
            <div className='border-b border-zinc-900 py-14 text-center label-s text-zinc-700'>No repositories imported yet</div>
          )}
        </div>
      </section>

      <DrawHR />

      {/* ============ FIELD E — SHARED-AXIS TEMPORAL LANES ============ */}
      <section className='py-14'>
        <div className='flex items-center justify-between gap-4 mb-8'>
          <Lbl>Historical Lanes — shared time axis</Lbl>
          <Coord>{rangeDays(range) <= 49 ? 'BUCKETED BY WEEK' : 'BUCKETED BY MONTH'}</Coord>
        </div>
        <div className='border-t border-zinc-900'>
          {lanes.map((lane) => {
            const emptyLane = lane.values.every((v) => v === 0)
            return (
              <div key={lane.label} className='grid grid-cols-12 items-center border-b border-zinc-900'>
                <div className='col-span-3 lg:col-span-2 py-6'>
                  <span className='label-s text-zinc-500'>{lane.label}</span>
                  {emptyLane && <span className='label-s mt-2 block text-zinc-800'>NO DATA</span>}
                </div>
                <div className='col-span-9 lg:col-span-10 py-3 border-l border-zinc-900 pl-6'>
                  <SeriesLine values={lane.values} height={96} />
                </div>
              </div>
            )
          })}
        </div>
        <div className='mt-3 flex justify-between gap-3 label-s text-zinc-800'>
          <span className='whitespace-nowrap'>{range.from || '—'}</span>
          <span className='hidden sm:inline'>OBSERVATIONS SHARE ONE BASELINE</span>
          <span className='whitespace-nowrap'>{range.to || '—'}</span>
        </div>
      </section>
    </div>
  )
}
