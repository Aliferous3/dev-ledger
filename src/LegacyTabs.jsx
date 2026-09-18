import React, { useMemo, useState } from 'react'
import { AreaChart, Bars } from './Charts'
import { ContributionField, buildHeatmap } from './Heatmap'
import { ActivityRhythm } from './ActivityRhythm'
import { LanguageBar, LanguageLegend } from './LanguageBar'
import { rangeDays, rangeDisplay } from './range'
import { CompareDelta } from './CompareDelta'
import { AnimatedNumber } from './AnimatedNumber'
import { Term } from './TermTooltip'
import { Icon } from '@iconify/react'

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

const RECENCY_K = 31.36

function momentumState(score) {
  if (score >= 80) return 'SURGING'
  if (score >= 60) return 'ACTIVE'
  if (score >= 35) return 'STEADY'
  if (score >= 10) return 'QUIET'
  return 'DORMANT'
}

export function computeMomentum(repos, range) {
  const periodDays = Math.max(1, rangeDays(range))
  const today = range.to || new Date().toISOString().slice(0, 10)
  const todayTime = new Date(today + 'T00:00:00Z').getTime()
  const withLog = repos.map((r) => {
    const commits = r.commits || 0
    const churn = (r.sourceAdded || 0) + (r.sourceDeleted || 0)
    const activeDays = r.activeDays || 0
    const last = r.lastCommitAt ? new Date(r.lastCommitAt).getTime() : 0
    const sinceLast = last ? Math.max(0, Math.round((todayTime - last) / 86400000)) : 999
    const recency = Math.exp(-sinceLast / RECENCY_K)
    return { ...r, commitLog: Math.log1p(commits), churnLog: Math.log1p(churn), activeDensity: Math.min(1, activeDays / periodDays), recency }
  })
  const maxCommit = Math.max(1, ...withLog.map((r) => r.commitLog))
  const maxChurn = Math.max(1, ...withLog.map((r) => r.churnLog))
  return withLog.map((r) => {
    const commitScore = r.commitLog / maxCommit
    const churnScore = r.churnLog / maxChurn
    const raw = commitScore * 0.30 + r.activeDensity * 0.25 + churnScore * 0.25 + r.recency * 0.20
    const score = Math.round(raw * 100)
    return { ...r, momentum: score, momentumState: momentumState(score) }
  })
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

function MilestoneList({ data }) {
  const s = data?.summary || {}
  const days = data?.daily || []
  const out = []
  const totalCommits = s.commits || 0
  const thresholds = [100, 500, 1000, 1500]
  let cumulative = 0
  for (const d of days) {
    cumulative += d.commits || 0
    for (const t of thresholds) {
      if (cumulative >= t && !out.some((x) => x.label === `${t.toLocaleString()}th commit`)) {
        out.push({ date: d.date, label: `${t.toLocaleString()}th commit` })
      }
    }
  }
  const churnDay = [...days].sort((a, b) => ((b.added + b.deleted) || 0) - ((a.added + a.deleted) || 0))[0]
  if (churnDay && (churnDay.added || churnDay.deleted)) out.push({ date: churnDay.date, label: 'Largest source churn day' })
  if (!out.length) return <div className='text-[10px] uppercase tracking-[0.2em] text-zinc-700'>No milestones in selected range</div>
  return (
    <div className='space-y-4'>
      {out.slice(0, 12).map((m, i) => (
        <div key={i} className='grid grid-cols-[120px_1fr] gap-4 items-baseline'>
          <div className='text-[10px] uppercase tracking-[0.18em] text-zinc-600'>{m.date}</div>
          <div className='relative pl-4 border-l border-zinc-800 text-[12px] uppercase tracking-[0.16em] text-zinc-300'>{m.label}</div>
        </div>
      ))}
    </div>
  )
}

function SectionLabel({ children, term }) {
  return <div className='label-s'>{term ? <Term keyName={term} showIcon>{children}</Term> : children}</div>
}

function HeroMetric({ label, value, sub, term, current, previous, compare }) {
  return (
    <div className='group'>
      <div className='label-s'>{term ? <Term keyName={term} showIcon>{label}</Term> : label}</div>
      <div className='mt-3 text-[38px] lg:text-[46px] font-light leading-none tracking-[-0.04em] tabular-nums text-zinc-100 figure transition-colors group-hover:text-white'>
        {value}
      </div>
      {sub && <div className='mt-2 text-[10px] uppercase tracking-[0.18em] text-zinc-700'>{sub}</div>}
      <CompareDelta current={current} previous={previous} compare={compare} />
    </div>
  )
}

function MiniBar({ data, labels, height = 110, color = '#e4e4e7' }) {
  return (
    <div className='mt-4'>
      {data.length ? (
        <Bars data={data} labels={labels} color={color} height={height} showLabels={true} labelColor='#52525b' />
      ) : (
        <div className='h-[110px] w-full border-b border-zinc-900 flex items-end pb-3'>
          <span className='text-[10px] uppercase tracking-[0.2em] text-zinc-700'>No data</span>
        </div>
      )}
    </div>
  )
}

export function Projects({ data, compare, compareData, range, loading }) {
  const s = data?.summary || {}
  const [sort, setSort] = useState('momentum')
  const all = useMemo(() => computeMomentum(data?.repositories || [], range), [data?.repositories, range])
  const cdata = compareData ? computeMomentum(compareData.repositories || [], range) : []
  const prevByPath = new Map(cdata.map((r) => [r.path, r]))
  const repos = useMemo(() => {
    const r = [...all]
    if (sort === 'momentum') r.sort((a, b) => b.momentum - a.momentum || (b.sourceAdded + b.sourceDeleted) - (a.sourceAdded + a.sourceDeleted))
    else if (sort === 'churn') r.sort((a, b) => (b.sourceAdded + b.sourceDeleted) - (a.sourceAdded + a.sourceDeleted))
    else if (sort === 'commits') r.sort((a, b) => b.commits - a.commits)
    else if (sort === 'recent') r.sort((a, b) => (b.lastCommitAt || '').localeCompare(a.lastCommitAt || ''))
    return r
  }, [all, sort])
  const sorts = [
    { key: 'momentum', label: 'Momentum' },
    { key: 'churn', label: 'Churn' },
    { key: 'commits', label: 'Commits' },
    { key: 'recent', label: 'Recent' },
  ]

  return (
    <div>
      <section className='pt-14 pb-10 border-b border-zinc-900'>
        <div className='flex flex-col lg:flex-row lg:items-end justify-between gap-6'>
          <div>
            <SectionLabel>Projects</SectionLabel>
            <div className='mt-2 text-[11px] uppercase tracking-[0.22em] text-zinc-600'>Authorized GitHub repositories · ranked by <Term keyName='projectMomentum' showIcon>momentum</Term> · {rangeDisplay(range)}</div>
          </div>
          <div className='grid grid-cols-2 sm:grid-cols-4 gap-x-8 gap-y-8 lg:gap-x-12'>
            <HeroMetric label='Repositories' value={loading ? '—' : n(s.repos || 0)} term='repositories' />
            <HeroMetric label='Total Churn' value={loading ? '—' : compact((s.sourceAdded || 0) + (s.sourceDeleted || 0))} term='totalChurn' />
            <HeroMetric label='Commits' value={loading ? '—' : n(s.commits || 0)} term='commits' />
            <HeroMetric label='Active Days' value={loading ? '—' : n(s.activeDays || 0)} term='activeDays' />
          </div>
        </div>
      </section>

      <section className='mt-10'>
        <div className='flex flex-wrap gap-2 pb-4 border-b border-zinc-900'>
          {sorts.map((srt) => (
            <button
              key={srt.key}
              onClick={() => setSort(srt.key)}
              className={`text-[9.5px] uppercase tracking-[0.18em] transition-colors ${
                sort === srt.key ? 'text-zinc-100' : 'text-zinc-700 hover:text-zinc-400'
              }`}
            >
              {srt.label}
            </button>
          ))}
        </div>
        <div className='hidden lg:grid grid-cols-[1.6fr_repeat(6,minmax(0,0.55fr))] gap-6 pb-3 border-b border-zinc-900 text-[9px] uppercase tracking-[0.24em] text-zinc-700'>
          <span>Project</span>
          <span className='text-right'><Term keyName='momentumScore' showIcon>Momentum</Term></span>
          <span className='text-right'><Term keyName='churn' showIcon>Churn</Term></span>
          <span className='text-right'><Term keyName='commits' showIcon>Commits</Term></span>
          <span className='text-right'><Term keyName='days' showIcon>Days</Term></span>
          <span className='text-right'><Term keyName='primaryLanguage' showIcon>Language</Term></span>
          <span className='text-right'><Term keyName='projectState' showIcon>State</Term></span>
        </div>
        {loading ? (
          <div className='py-16 text-center text-[10px] uppercase tracking-[0.2em] text-zinc-700'>Loading repositories…</div>
        ) : (
          repos.map((r, i) => {
            const churn = (r.sourceAdded || 0) + (r.sourceDeleted || 0)
            const prev = prevByPath.get(r.path)
            const prevChurn = prev ? (prev.sourceAdded || 0) + (prev.sourceDeleted || 0) : null
            const stateTone = r.momentum >= 80 ? 'text-zinc-100' : r.momentum >= 60 ? 'text-zinc-200' : r.momentum >= 35 ? 'text-zinc-400' : r.momentum >= 10 ? 'text-zinc-500' : 'text-zinc-700'
            return (
              <div
                key={r.path}
                className='group grid grid-cols-1 lg:grid-cols-[1.6fr_repeat(6,minmax(0,0.55fr))] gap-4 lg:gap-6 items-baseline border-b border-zinc-900 py-6 transition-colors hover:border-zinc-700'
              >
                <div className='flex items-baseline gap-4'>
                  <span className='text-[10px] tabular-nums text-zinc-800'>{String(i + 1).padStart(2, '0')}</span>
                  <div>
                    <div className='text-[20px] lg:text-[24px] font-light leading-none tracking-[-0.02em] text-zinc-100 transition-colors group-hover:text-white'>
                      {r.name}
                      {r.private && <Icon icon='octicon:lock-16' className='inline h-3 w-3 ml-2 text-zinc-700' />}
                      {r.fork && <span className='ml-2 text-[9px] uppercase tracking-[0.18em] text-zinc-700'>fork</span>}
                    </div>
                    <div className='mt-2 text-[9.5px] uppercase tracking-[0.24em] text-zinc-700'>
                      {timeAgo(r.lastCommit)}
                    </div>
                  </div>
                </div>
                <div className='text-right'>
                  <div className={`text-[17px] lg:text-[19px] font-light tabular-nums figure ${stateTone}`}>
                    {r.momentum}<span className='text-[10px] ml-0.5 tracking-[0.12em] text-zinc-700'>{r.momentumState}</span>
                  </div>
                  <CompareDelta current={r.momentum} previous={prev ? prev.momentum : null} compare={compare} />
                </div>
                <div className='text-right'>
                  <div className='text-[17px] lg:text-[19px] font-light tabular-nums text-zinc-300 figure'>{compact(churn)}</div>
                  <CompareDelta current={churn} previous={prevChurn} compare={compare} />
                </div>
                <div className='text-right'>
                  <div className='text-[17px] lg:text-[19px] font-light tabular-nums text-zinc-300 figure'>{n(r.commits || 0)}</div>
                  <CompareDelta current={r.commits} previous={prev ? prev.commits : null} compare={compare} />
                </div>
                <div className='text-right'>
                  <div className='text-[17px] lg:text-[19px] font-light tabular-nums text-zinc-300 figure'>{n(r.activeDays || 0)}</div>
                  <CompareDelta current={r.activeDays} previous={prev ? prev.activeDays : null} compare={compare} />
                </div>
                <div className='text-right text-[15px] text-zinc-400'>
                  {r.primaryLanguage || '—'}
                </div>
                <div className='text-right text-[9.5px] uppercase tracking-[0.2em] text-zinc-500'>
                  {r.momentumState}
                </div>
              </div>
            )
          })
        )}
        {!loading && !repos.length && (
          <div className='py-16 text-center text-[10px] uppercase tracking-[0.2em] text-zinc-700'>No repositories imported yet</div>
        )}
      </section>
    </div>
  )
}

export function Activity({ data, compare, compareData, daily, range, loading }) {
  const s = data?.summary || {}
  const cs = compareData?.summary || {}
  const days = daily || []
  const cdays = compareData?.daily || []
  const activeWindow = range.mode === 'all' && !days.length ? 365 : rangeDays(range)
  const prevPeak = cdays.reduce((a, b) => (!a || (b.commits || 0) > (a.commits || 0) ? b : a), null)

  const monthly = useMemo(() => {
    const m = new Map()
    for (const d of days) {
      const key = d.date.slice(0, 7)
      if (!m.has(key)) m.set(key, { key, label: monthShort[Number(d.date.slice(5, 7)) - 1], commits: 0, added: 0, deleted: 0 })
      const b = m.get(key)
      b.commits += d.commits || 0
      b.added += d.added || 0
      b.deleted += d.deleted || 0
    }
    return [...m.values()].sort((a, b) => a.key.localeCompare(b.key))
  }, [days])

  const weekday = useMemo(() => {
    const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    const counts = Array(7).fill(0)
    for (const d of days) {
      const n = new Date(d.date + 'T00:00:00Z').getUTCDay()
      counts[n] += d.commits || 0
    }
    return names.map((name, i) => ({ name, commits: counts[i] }))
  }, [days])

  const peak = days.reduce((a, b) => (!a || (b.commits || 0) > (a.commits || 0) ? b : a), null)
  const extremes = useMemo(() => {
    if (!days.length) return {}
    const byCommits = [...days].sort((a, b) => (b.commits || 0) - (a.commits || 0))[0]
    const byChurn = [...days].sort((a, b) => ((b.added + b.deleted) || 0) - ((a.added + a.deleted) || 0))[0]
    const byAdded = [...days].sort((a, b) => (b.added || 0) - (a.added || 0))[0]
    const byDeleted = [...days].sort((a, b) => (b.deleted || 0) - (a.deleted || 0))[0]
    return { byCommits, byChurn, byAdded, byDeleted }
  }, [days])
  const avgPerActiveDay = s.activeDays ? (s.commits || 0) / s.activeDays : 0

  const heatmapEnd = useMemo(() => (range.to ? new Date(range.to + 'T00:00:00Z') : new Date()), [range.to])
  const heatmapCount = useMemo(() => {
    if (range.mode !== 'all') return rangeDays(range)
    if (!days.length) return 365
    const first = new Date(days[0].date + 'T00:00:00Z')
    return Math.max(1, Math.round((heatmapEnd - first) / 86400000) + 1)
  }, [range, days, heatmapEnd])
  const heatmapWeeks = useMemo(() => buildHeatmap(days, heatmapCount, heatmapEnd), [days, heatmapCount, heatmapEnd])

  const monthLabels = monthly.map((m) => m.label[0])
  const commitValues = monthly.map((m) => m.commits)
  const addedValues = monthly.map((m) => m.added)
  const deletedValues = monthly.map((m) => m.deleted)

  return (
    <div>
      <section className='pt-14 pb-10 border-b border-zinc-900'>
        <div className='flex flex-col lg:flex-row lg:items-end justify-between gap-6'>
          <div>
            <SectionLabel>Activity</SectionLabel>
            <div className='mt-2 text-[11px] uppercase tracking-[0.22em] text-zinc-600'>Temporal view of GitHub-attributed commits · {rangeDisplay(range)} · UTC</div>
          </div>
          <div className='grid grid-cols-2 sm:grid-cols-4 gap-x-8 gap-y-8 lg:gap-x-12'>
            <HeroMetric label='Active Days' value={loading ? '—' : n(s.activeDays || 0)} term='activeDays' current={s.activeDays} previous={cs.activeDays} compare={compare} />
            <HeroMetric label='Longest Streak' value={loading ? '—' : n(s.longestStreak || 0)} term='longestStreak' current={s.longestStreak} previous={cs.longestStreak} compare={compare} />
            <HeroMetric label='Peak Day' value={loading ? '—' : n(peak?.commits || 0)} sub={peak ? peak.date : ''} current={peak?.commits} previous={prevPeak?.commits} compare={compare} />
            <HeroMetric label='Avg / Active Day' value={loading ? '—' : avgPerActiveDay.toFixed(1)} />
          </div>
        </div>
      </section>

      <ContributionField weeks={heatmapWeeks} sub={`${stringN(s.activeDays || 0)} of ${activeWindow} days active`} />

      <ActivityRhythm rhythm={data?.rhythm} totalCommits={s.commits || 0} range={range} />

      {extremes.byCommits && (
        <section className='mt-16'>
          <div className='label-s'><Term keyName='extremes' showIcon>Extremes</Term></div>
          <div className='mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-8 gap-y-10'>
            <div>
              <div className='text-[9.5px] uppercase tracking-[0.2em] text-zinc-600'>Most commits in a day</div>
              <div className='mt-2 text-[32px] font-light tabular-nums text-zinc-200 figure'>{n(extremes.byCommits.commits || 0)}</div>
              <div className='mt-1 text-[10px] uppercase tracking-[0.16em] text-zinc-700'>{extremes.byCommits.date}</div>
            </div>
            <div>
              <div className='text-[9.5px] uppercase tracking-[0.2em] text-zinc-600'>Highest churn day</div>
              <div className='mt-2 text-[32px] font-light tabular-nums text-zinc-200 figure'>{compact((extremes.byChurn.added || 0) + (extremes.byChurn.deleted || 0))}</div>
              <div className='mt-1 text-[10px] uppercase tracking-[0.16em] text-zinc-700'>{extremes.byChurn.date}</div>
            </div>
            <div>
              <div className='text-[9.5px] uppercase tracking-[0.2em] text-zinc-600'>Most lines added</div>
              <div className='mt-2 text-[32px] font-light tabular-nums text-zinc-200 figure'>{compact(extremes.byAdded.added || 0)}</div>
              <div className='mt-1 text-[10px] uppercase tracking-[0.16em] text-zinc-700'>{extremes.byAdded.date}</div>
            </div>
            <div>
              <div className='text-[9.5px] uppercase tracking-[0.2em] text-zinc-600'>Most lines deleted</div>
              <div className='mt-2 text-[32px] font-light tabular-nums text-zinc-200 figure'>{compact(extremes.byDeleted.deleted || 0)}</div>
              <div className='mt-1 text-[10px] uppercase tracking-[0.16em] text-zinc-700'>{extremes.byDeleted.date}</div>
            </div>
          </div>
        </section>
      )}

      <section className='mt-16'>
        <div className='label-s'><Term keyName='milestones' showIcon>Milestones</Term></div>
        <div className='mt-6 space-y-8'>
          <MilestoneList data={data} />
        </div>
      </section>

      <section className='mt-16 grid grid-cols-1 lg:grid-cols-3 gap-16'>
        <div>
          <SectionLabel>Commits by month</SectionLabel>
          <MiniBar data={commitValues} labels={monthLabels} />
        </div>
        <div>
          <SectionLabel>Additions vs deletions</SectionLabel>
          {monthly.length > 1 ? (
            <div className='mt-4 h-[110px]'>
              <AreaChart
                height={110}
                labels={monthLabels}
                series={[
                  { data: addedValues, color: '#e4e4e7', label: 'added', fill: false },
                  { data: deletedValues, color: '#71717a', label: 'deleted', fill: false, dashed: true },
                ]}
                grid={false}
                axisColor='#3f3f46'
              />
            </div>
          ) : (
            <div className='h-[110px] border-b border-zinc-900 text-[10px] uppercase tracking-[0.2em] text-zinc-700 flex items-end pb-3 mt-4'>No data</div>
          )}
        </div>
        <div>
          <SectionLabel>Weekday distribution</SectionLabel>
          {weekday.some((d) => d.commits) ? (
            <div className='mt-5 flex items-end justify-between h-[110px] border-b border-zinc-900 pb-1'>
              {weekday.map((d) => (
                <div key={d.name} className='flex flex-col items-center gap-2 flex-1 group'>
                  <div
                    className='w-full bg-zinc-100/15 transition-all group-hover:bg-zinc-100/60'
                    style={{ height: `${(d.commits / Math.max(...weekday.map((x) => x.commits), 1)) * 100}%` }}
                  />
                  <span className='text-[9px] uppercase tracking-[0.14em] text-zinc-700'>{d.name}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className='h-[110px] border-b border-zinc-900 text-[10px] uppercase tracking-[0.2em] text-zinc-700 flex items-end pb-3 mt-4'>No data</div>
          )}
        </div>
      </section>

      <section className='mt-16'>
        <SectionLabel>Most active months</SectionLabel>
        <div className='mt-6 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-8'>
          {[...monthly].sort((a, b) => b.commits - a.commits).slice(0, 6).map((m) => (
            <div key={m.key}>
              <div className='text-[22px] font-light tabular-nums text-zinc-100 figure'>{n(m.commits)}</div>
              <div className='mt-1 text-[9.5px] uppercase tracking-[0.22em] text-zinc-700'>{m.key}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

export function Code({ data, compare, compareData, range, loading }) {
  const s = data?.summary || {}
  const cs = compareData?.summary || {}
  const [hoveredLang, setHoveredLang] = useState(null)
  const languages = data?.languages || []
  const sortedLangs = useMemo(() => [...languages].sort((a, b) => b.code - a.code), [languages])
  const repos = useMemo(() => [...(data?.repositories || [])], [data?.repositories])
  const byBytes = useMemo(() => [...repos].sort((a, b) => (b.languageBytes || 0) - (a.languageBytes || 0)), [repos])
  const byChurn = useMemo(() => [...repos].sort((a, b) => ((b.sourceAdded + b.sourceDeleted) - (a.sourceAdded + a.sourceDeleted))), [repos])

  const monthly = useMemo(() => {
    const m = new Map()
    for (const d of data?.daily || []) {
      const key = d.date.slice(0, 7)
      if (!m.has(key)) m.set(key, { key, label: monthShort[Number(d.date.slice(5, 7)) - 1], net: 0 })
      m.get(key).net += (d.added || 0) - (d.deleted || 0)
    }
    return [...m.values()].sort((a, b) => a.key.localeCompare(b.key))
  }, [data?.daily])
  const cumulative = useMemo(() => {
    let cur = 0
    return monthly.map((m) => { cur += m.net; return cur })
  }, [monthly])

  return (
    <div>
      <section className='pt-14 pb-10 border-b border-zinc-900'>
        <div className='flex flex-col lg:flex-row lg:items-end justify-between gap-6'>
          <div>
            <SectionLabel>Code</SectionLabel>
            <div className='mt-2 text-[11px] uppercase tracking-[0.22em] text-zinc-600'>Source composition and change · {rangeDisplay(range)}</div>
          </div>
          <div className='grid grid-cols-2 sm:grid-cols-5 gap-x-8 gap-y-8 lg:gap-x-12'>
            <HeroMetric label='Source Bytes' value={loading ? '—' : fmtBytes(s.languageBytes)} term='languageBytes' />
            <HeroMetric label='Lines Added' value={loading ? '—' : n(s.sourceAdded || 0)} term='linesAdded' current={s.sourceAdded} previous={cs.sourceAdded} compare={compare} />
            <HeroMetric label='Lines Deleted' value={loading ? '—' : n(s.sourceDeleted || 0)} term='linesDeleted' current={s.sourceDeleted} previous={cs.sourceDeleted} compare={compare} />
            <HeroMetric label='Net Lines' value={loading ? '—' : n((s.sourceAdded || 0) - (s.sourceDeleted || 0))} term='netLines' current={(s.sourceAdded || 0) - (s.sourceDeleted || 0)} previous={(cs.sourceAdded || 0) - (cs.sourceDeleted || 0)} compare={compare} />
            <HeroMetric label='Total Churn' value={loading ? '—' : compact((s.sourceAdded || 0) + (s.sourceDeleted || 0))} term='totalChurn' current={(s.sourceAdded || 0) + (s.sourceDeleted || 0)} previous={(cs.sourceAdded || 0) + (cs.sourceDeleted || 0)} compare={compare} />
          </div>
        </div>
      </section>

      <section className='mt-16'>
        <SectionLabel>Language composition</SectionLabel>
        <LanguageBar languages={sortedLangs} onHover={setHoveredLang} activeLang={hoveredLang} />
        <LanguageLegend languages={sortedLangs} onHover={setHoveredLang} activeLang={hoveredLang} />
      </section>

      <section className='mt-16 grid grid-cols-1 lg:grid-cols-2 gap-16'>
        <div>
          <SectionLabel>Code growth · {rangeDisplay(range)}</SectionLabel>
          <div className='mt-6 h-[150px]'>
            {monthly.length > 1 ? (
              <AreaChart
                height={150}
                labels={monthly.map((m) => m.label[0])}
                series={[{ data: cumulative, color: '#e4e4e7', label: 'loc', fill: true }]}
                grid={false}
                axisColor='#3f3f46'
              />
            ) : (
              <div className='h-full border-b border-zinc-900 text-[10px] uppercase tracking-[0.2em] text-zinc-700 flex items-end pb-3'>No historical data</div>
            )}
          </div>
          <div className='mt-3 text-[9.5px] uppercase tracking-[0.2em] text-zinc-700'>Cumulative net source additions</div>
        </div>
        <div>
          <SectionLabel>Source bytes by project</SectionLabel>
          <div className='mt-6 space-y-4'>
            {byBytes.slice(0, 8).map((r, i) => (
              <div key={r.path} className='flex items-baseline justify-between border-b border-zinc-900 pb-3'>
                <div className='flex items-baseline gap-3'>
                  <span className='text-[10px] tabular-nums text-zinc-800'>{String(i + 1).padStart(2, '0')}</span>
                  <span className='text-[15px] text-zinc-200'>{r.name}</span>
                </div>
                <span className='text-[17px] font-light tabular-nums text-zinc-300 figure'>{fmtBytes(r.languageBytes)}</span>
              </div>
            ))}
            {!byBytes.length && <div className='text-[10px] uppercase tracking-[0.2em] text-zinc-700'>No data</div>}
          </div>
        </div>
      </section>

      <section className='mt-16'>
        <SectionLabel>Code intelligence</SectionLabel>
        <div className='mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-8 gap-y-10'>
          <div>
            <div className='text-[9.5px] uppercase tracking-[0.2em] text-zinc-600'><Term keyName='refactorRatio' showIcon>Refactor ratio</Term></div>
            <div className='mt-2 text-[32px] font-light tabular-nums text-zinc-200 figure'>{s.sourceAdded ? ((s.sourceDeleted / s.sourceAdded) * 100).toFixed(1) + '%' : '—'}</div>
          </div>
          <div>
            <div className='text-[9.5px] uppercase tracking-[0.2em] text-zinc-600'><Term keyName='retentionRatio' showIcon>Retention ratio</Term></div>
            <div className='mt-2 text-[32px] font-light tabular-nums text-zinc-200 figure'>{(s.sourceAdded + s.sourceDeleted) ? (((s.sourceAdded - s.sourceDeleted) / (s.sourceAdded + s.sourceDeleted)) * 100).toFixed(1) + '%' : '—'}</div>
          </div>
          <div>
            <div className='text-[9.5px] uppercase tracking-[0.2em] text-zinc-600'><Term keyName='churnPerDay' showIcon>Churn / active day</Term></div>
            <div className='mt-2 text-[32px] font-light tabular-nums text-zinc-200 figure'>{s.activeDays ? compact((s.sourceAdded + s.sourceDeleted) / s.activeDays) : '—'}</div>
          </div>
          <div>
            <div className='text-[9.5px] uppercase tracking-[0.2em] text-zinc-600'><Term keyName='churnConcentration' showIcon>Churn concentration</Term></div>
            <div className='mt-2 text-[32px] font-light tabular-nums text-zinc-200 figure'>
              {(() => {
                const total = (s.sourceAdded || 0) + (s.sourceDeleted || 0)
                if (!total || !byChurn.length) return '—'
                const top = (byChurn[0].sourceAdded || 0) + (byChurn[0].sourceDeleted || 0)
                return `${(top / total * 100).toFixed(1)}%`
              })()}
            </div>
            <div className='mt-1 text-[10px] uppercase tracking-[0.16em] text-zinc-700'>{byChurn.length ? byChurn[0].name : ''}</div>
          </div>
        </div>
      </section>

      <section className='mt-16'>
        <SectionLabel>Source churn by project</SectionLabel>
        <div className='mt-6 space-y-4'>
          {byChurn.slice(0, 10).map((r, i) => (
            <div key={r.path} className='flex items-baseline justify-between border-b border-zinc-900 pb-3'>
              <div className='flex items-baseline gap-3'>
                <span className='text-[10px] tabular-nums text-zinc-800'>{String(i + 1).padStart(2, '0')}</span>
                <span className='text-[15px] text-zinc-200'>{r.name}</span>
              </div>
              <span className='text-[17px] font-light tabular-nums text-zinc-300 figure'>{compact((r.sourceAdded || 0) + (r.sourceDeleted || 0))}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
