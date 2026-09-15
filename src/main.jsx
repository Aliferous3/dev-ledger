import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Icon } from '@iconify/react'
import { motion, AnimatePresence } from 'framer-motion'
import { AreaChart } from './Charts'
import { Projects, Activity, Code, Shipping } from './LegacyTabs'
import { CompareDelta } from './CompareDelta'
import { ContributionField, buildHeatmap } from './Heatmap'
import { LanguageBar, LanguageLegend } from './LanguageBar'
import { DateRange } from './DateRange'
import { Term } from './TermTooltip'
import { makeRange, rangeQuery, rangeDays, rangeDisplay, readInitialRange, makeCompareRange, compareDisplay } from './range'
import { AnimatedNumber } from './AnimatedNumber'
import { useReducedMotion, ease, dur } from './motion'
import { Curtain, useCurtainTransition } from './CurtainTransition'
import './index.css'

const nav = ['overview', 'projects', 'activity', 'code', 'shipping']
const navLabels = { overview: 'Overview', projects: 'Projects', activity: 'Activity', code: 'Code', shipping: 'Shipping' }

const fmt = new Intl.NumberFormat('en-US')
const stringN = (v) => v == null ? '—' : fmt.format(Number(v))
const n = (v) => <AnimatedNumber value={v} className='' />
const compact = (v) => <AnimatedNumber value={v} compact />
const c = (v) => compact(v)

const monthShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function timeAgo(dateStr) {
  if (!dateStr) return '—'
  const d = new Date(dateStr + 'T00:00:00Z')
  const diff = Date.now() - d.getTime()
  const days = Math.floor(diff / 86400000)
  if (days < 1) return 'today'
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`
  return `${Math.floor(days / 365)}y ago`
}

function buildMonthly(daily) {
  const buckets = new Map()
  for (const d of daily || []) {
    const key = d.date.slice(0, 7)
    if (!buckets.has(key)) {
      buckets.set(key, {
        key,
        label: monthShort[Number(d.date.slice(5, 7)) - 1],
        commits: 0,
        net: 0,
        added: 0,
        deleted: 0,
      })
    }
    const b = buckets.get(key)
    b.commits += d.commits || 0
    b.added += d.added || 0
    b.deleted += d.deleted || 0
    b.net += (d.added || 0) - (d.deleted || 0)
  }
  return [...buckets.values()].sort((a, b) => a.key.localeCompare(b.key))
}

function rangeText(daily) {
  if (!daily?.length) return 'All time'
  const sd = new Date(daily[0].date + 'T00:00:00Z')
  const ed = new Date(daily[daily.length - 1].date + 'T00:00:00Z')
  const sf = sd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const ef = ed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  return `${sf} — ${ef}`
}

const statusColor = {
  ready: '#34d399',
  loading: '#60a5fa',
  error: '#f87171',
  unavailable: '#64748b',
  stale: '#fbbf24',
}
const statusNote = {
  ready: 'Ready',
  loading: 'Loading',
  error: 'Error',
  unavailable: 'Not connected',
  stale: 'Stale',
}

function App() {
  const emptyLocal = {
    generatedAt: new Date().toISOString(),
    tools: { git: true, cloc: false },
    summary: {
      repos: null,
      currentLoc: null,
      commits: null,
      sourceAdded: null,
      sourceDeleted: null,
      allAdded: null,
      allDeleted: null,
      allChurn: null,
      activeDays: null,
      longestStreak: null,
      peakDayCommits: null,
    },
    repositories: [],
    languages: [],
    daily: [],
  }
  const [local, setLocal] = useState(emptyLocal)
  const [github, setGithub] = useState({ connected: false })
  const [vercel, setVercel] = useState({ connected: false, projects: 0, deployments: 0, projectList: [] })
  const [localCompare, setLocalCompare] = useState(null)
  const [githubCompare, setGithubCompare] = useState(null)
  const [vercelCompare, setVercelCompare] = useState(null)
  const [compare, setCompare] = useState(false)
  const [status, setStatus] = useState({
    local: 'loading',
    github: 'loading',
    vercel: 'loading',
    wakatime: 'unavailable',
    ai: 'unavailable',
  })
  const {
    view,
    target,
    requestView,
    transitioning,
    phase,
    direction: curtainDir,
    onCovered,
    onRevealed,
  } = useCurtainTransition({ views: nav, initial: 'overview' })
  const [refreshing, setRefreshing] = useState(false)
  const [refreshOk, setRefreshOk] = useState(false)
  const [range, setRange] = useState(() => readInitialRange())
  const rangeRef = useRef(range)
  const reduced = useReducedMotion()
  const headerRef = useRef(null)
  const [headerTop, setHeaderTop] = useState(112)
  useEffect(() => { rangeRef.current = range }, [range])
  useEffect(() => {
    const measure = () => {
      if (headerRef.current) setHeaderTop(headerRef.current.getBoundingClientRect().bottom)
    }
    measure()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    if (ro && headerRef.current) ro.observe(headerRef.current)
    window.addEventListener('resize', measure)
    return () => {
      if (ro && headerRef.current) ro.unobserve(headerRef.current)
      window.removeEventListener('resize', measure)
    }
  }, [])

  const persistRange = useCallback((r) => {
    const q = rangeQuery(r)
    const url = q ? `?${q}` : window.location.pathname
    window.history.replaceState({ range: r }, '', url)
    try { window.localStorage.setItem('dev-dashboard-range', JSON.stringify(r)) } catch {}
  }, [])

  useEffect(() => {
    const onPop = (e) => {
      const q = new URLSearchParams(window.location.search)
      if (q.has('from') || q.has('to')) {
        setRange({ mode: 'custom', from: q.get('from') || null, to: q.get('to') || null })
      } else if (q.get('range')) {
        setRange(makeRange(q.get('range')))
      }
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const fetchSource = async (name, r, setter, withStatus = true, force = false) => {
    if (withStatus) setStatus((x) => ({ ...x, [name]: 'loading' }))
    try {
      const query = new URLSearchParams()
      if (force) query.set('refresh', '1')
      if (r.from) query.set('from', r.from)
      if (r.to) query.set('to', r.to)
      const q = query.toString()
      const res = await fetch(`/api/${name}${q ? `?${q}` : ''}`)
      if (!res.ok) throw new Error(`${name} failed`)
      const payload = await res.json()
      setter(payload)
      if (withStatus) setStatus((x) => ({ ...x, [name]: payload.error ? 'error' : 'ready' }))
    } catch {
      if (withStatus) setStatus((x) => ({ ...x, [name]: 'error' }))
    }
  }

  const loadPrimary = useCallback(async (force = false) => {
    const setters = { local: setLocal, github: setGithub, vercel: setVercel }
    if (force) { setRefreshing(true); setRefreshOk(false) }
    await Promise.allSettled(['local', 'github', 'vercel'].map((x) => fetchSource(x, rangeRef.current, setters[x], true, force)))
    setRefreshing(false)
    if (force) setRefreshOk(true)
  }, [])

  const loadCompare = useCallback(async () => {
    const cr = makeCompareRange(rangeRef.current)
    if (cr && compare) {
      const setters = { local: setLocalCompare, github: setGithubCompare, vercel: setVercelCompare }
      await Promise.allSettled(['local', 'github', 'vercel'].map((x) => fetchSource(x, cr, setters[x], false)))
    } else {
      setLocalCompare(null); setGithubCompare(null); setVercelCompare(null)
    }
  }, [compare])

  useEffect(() => {
    if (!refreshOk) return
    const t = setTimeout(() => setRefreshOk(false), 800)
    return () => clearTimeout(t)
  }, [refreshOk])

  const changeRange = useCallback((r) => {
    setRange(r)
    persistRange(r)
  }, [persistRange])

  useEffect(() => {
    loadPrimary(false)
    loadCompare()
  }, [range.from, range.to, loadPrimary, loadCompare])

  useEffect(() => {
    loadCompare()
  }, [compare, loadCompare])

  useEffect(() => {
    persistRange(range)
  }, [])

  const data = { ...local, github, vercel }
  const compareData = useMemo(() => (localCompare ? { ...localCompare, github: githubCompare, vercel: vercelCompare } : null), [localCompare, githubCompare, vercelCompare])
  const daily = local.daily || []
  const monthly = useMemo(() => buildMonthly(daily), [daily])
  const cumulative = useMemo(() => {
    let cur = 0
    return monthly.map((m) => {
      cur += m.net
      return cur
    })
  }, [monthly])

  const heatmapEnd = useMemo(() => {
    return range.to ? new Date(range.to + 'T00:00:00Z') : new Date()
  }, [range.to])
  const heatmapCount = useMemo(() => {
    if (range.mode !== 'all') return rangeDays(range)
    if (!daily.length) return 365
    const first = new Date(daily[0].date + 'T00:00:00Z')
    return Math.max(1, Math.round((heatmapEnd - first) / 86400000) + 1)
  }, [range, daily, heatmapEnd])
  const heatmapWeeks = useMemo(() => buildHeatmap(daily, heatmapCount, heatmapEnd), [daily, heatmapCount, heatmapEnd])

  const sourceMeta = [
    { key: 'local', label: 'LOCAL GIT', glossaryKey: 'localGit' },
    { key: 'github', label: 'GITHUB', glossaryKey: 'github' },
    { key: 'vercel', label: 'VERCEL', glossaryKey: 'vercel' },
    { key: 'wakatime', label: 'WAKATIME', glossaryKey: 'wakatime' },
    { key: 'ai', label: 'AI TOOLS', glossaryKey: 'aiTools' },
  ]

  const statusError = { local: local.error, github: github.error, vercel: vercel.error || vercel.warning }
  const sourceKeys = sourceMeta.map((s) => s.key)
  const loadingCount = sourceKeys.filter((k) => status[k] === 'loading').length
  const progress = loadingCount > 0 ? (sourceKeys.length - loadingCount) / sourceKeys.length : 0

  return (
    <div className='min-h-screen bg-[#0a0a0a] text-zinc-400 antialiased selection:bg-zinc-100 selection:text-black'>
      <div className='mx-auto max-w-[1480px] px-6 lg:px-12 xl:px-16'>
        <header ref={headerRef} className='relative z-[100] bg-[#0a0a0a] pt-10 lg:pt-12'>
          <div className='flex flex-col lg:flex-row lg:items-baseline gap-6 lg:gap-10'>
            <div className='text-[28px] lg:text-[34px] font-light leading-none tracking-[-0.02em] text-zinc-100 figure' style={{ fontFamily: "'Iowan Old Style','Palatino Linotype','Georgia',serif" }}>work</div>
            <nav className='flex flex-wrap gap-7'>
              {nav.map((id) => (
                <button
                  key={id}
                  onClick={() => requestView(id)}
                  disabled={transitioning}
                  className={`relative text-[10px] uppercase tracking-[0.26em] transition-colors ${
                    view === id ? 'text-zinc-200' : 'text-zinc-700 hover:text-zinc-500'
                  }`}
                >
                  {id}
                  {view === id && (
                    <motion.div
                      layoutId='nav-underline'
                      className='absolute -bottom-1 left-0 right-0 h-[1px] bg-zinc-400'
                      transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 260, damping: 26 }}
                    />
                  )}
                </button>
              ))}
            </nav>
            <div className='lg:ml-auto flex flex-wrap items-center gap-5'>
              {sourceMeta.map((s) => {
                const st = status[s.key]
                return (
                  <Term
                    key={s.key}
                    keyName={s.glossaryKey}
                    className='group flex items-center gap-1.5 text-[9.5px] uppercase tracking-[0.2em] text-zinc-700 transition-colors hover:text-zinc-400'
                    as='span'
                    tabIndex={-1}
                  >
                    <motion.span
                      className='h-[3px] w-[3px] rounded-full'
                      style={{ background: statusColor[st] }}
                      initial={false}
                      animate={
                        st === 'loading'
                          ? { scale: [1, 1.25, 1], opacity: [1, 0.65, 1] }
                          : st === 'error'
                            ? { x: [0, -2, 2, -2, 0] }
                            : { scale: 1, opacity: 1, x: 0 }
                      }
                      transition={
                        st === 'loading'
                          ? { repeat: Infinity, duration: 1.6, ease: 'easeInOut' }
                          : { duration: reduced ? 0 : 0.25, ease: [0.23, 1, 0.32, 1] }
                      }
                    />
                    {s.label}
                  </Term>
                )
              })}
              <button
                onClick={() => loadPrimary(true)}
                disabled={refreshing}
                className='group text-zinc-700 hover:text-zinc-400 transition-colors disabled:opacity-40'
                title='Refresh data'
              >
                <AnimatePresence mode='wait'>
                  <motion.div
                    key={refreshing ? 'spinner' : refreshOk ? 'check' : 'refresh'}
                    className='origin-center'
                    initial={{ opacity: 0, scale: 0.6 }}
                    animate={
                      refreshing
                        ? { opacity: 1, scale: 1, rotate: 360 }
                        : refreshOk
                          ? { opacity: 1, scale: [0.7, 1.1, 1], rotate: 0 }
                          : { opacity: 1, scale: 1, rotate: 0 }
                    }
                    whileHover={refreshing || refreshOk ? {} : { rotate: 25 }}
                    exit={{ opacity: 0, scale: 0.7 }}
                    transition={
                      refreshing
                        ? { opacity: { duration: 0.15 }, scale: { duration: 0.15 }, rotate: { repeat: Infinity, duration: 1.2, ease: 'linear' } }
                        : refreshOk
                          ? { duration: 0.35, ease: [0.23, 1, 0.32, 1] }
                          : { duration: 0.18, ease: [0.23, 1, 0.32, 1] }
                    }
                  >
                    <Icon
                      icon={refreshing ? 'ph:spinner' : refreshOk ? 'ph:check' : 'ph:arrows-clockwise'}
                      className='h-3.5 w-3.5'
                    />
                  </motion.div>
                </AnimatePresence>
              </button>
            </div>
          </div>
          <div className='mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-end gap-3'>
            <DateRange range={range} onChange={changeRange} compare={compare} onCompare={setCompare} />
          </div>
          <div className='mt-4 rule' />
          {progress > 0 && (
            <motion.div
              className='mt-0.5 h-[1px] w-full bg-zinc-900'
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <motion.div
                className='h-full bg-zinc-300'
                initial={{ width: '0%' }}
                animate={{ width: `${progress * 100}%` }}
                transition={reduced ? { duration: 0 } : { duration: 0.45, ease: [0.23, 1, 0.32, 1] }}
              />
            </motion.div>
          )}
        </header>

        <Curtain
          phase={phase}
          direction={curtainDir}
          onCovered={onCovered}
          onRevealed={onRevealed}
          top={headerTop}
          label={navLabels[target] || target}
        />
        <main className='pb-24'>
          {view === 'overview' && <Overview data={data} compare={compare} compareData={compareData} daily={daily} monthly={monthly} cumulative={cumulative} status={status} range={range} weeks={heatmapWeeks} />}
          {view === 'projects' && <Projects data={data} compare={compare} compareData={compareData} status={status} range={range} />}
          {view === 'activity' && <Activity data={data} compare={compare} compareData={compareData} daily={daily} status={status} range={range} />}
          {view === 'code' && <Code data={data} compare={compare} compareData={compareData} status={status} range={range} />}
          {view === 'shipping' && <Shipping data={data} compare={compare} compareData={compareData} status={status} range={range} />}
        </main>
      </div>
    </div>
  )
}

function DevMetric({ label, value, icon, term, current, previous, compare }) {
  return (
    <div className='group'>
      <div className='flex items-center gap-1.5'>
        <Icon icon={icon} className='h-3 w-3 text-zinc-800 transition-colors group-hover:text-zinc-500' />
        <div className='label-s'>{term ? <Term keyName={term} showIcon>{label}</Term> : label}</div>
      </div>
      <div className='mt-2.5 text-[26px] lg:text-[30px] font-light leading-none tracking-[-0.03em] tabular-nums text-zinc-200 transition-colors group-hover:text-white figure'>
        {value}
      </div>
      <CompareDelta current={current} previous={previous} compare={compare} />
    </div>
  )
}

function Overview({ data, compare, compareData, daily, monthly, cumulative, range, weeks }) {
  const reduced = useReducedMotion()
  const [hoveredLang, setHoveredLang] = useState(null)
  const s = data.summary || {}
  const gh = data.github || {}
  const vc = data.vercel || {}
  const c = compareData || {}
  const cs = c.summary || {}
  const cgh = c.github || {}
  const cvc = c.vercel || {}
  const totalLoc = s.currentLoc
  const added = s.sourceAdded || 0
  const deleted = s.sourceDeleted || 0
  const net = added - deleted
  const churn = added + deleted
  const commits = s.commits || 0
  const repos = s.repos || 0
  const activeDays = s.activeDays || 0
  const longestStreak = s.longestStreak || 0
  const pullRequests = gh.connected ? gh.pullRequests : null
  const merged = gh.connected ? gh.mergedPrs : null
  const prod = vc.connected ? vc.productionDeployments : null
  const preview = vc.connected ? vc.previewDeployments : null
  const succeeded = vc.connected ? vc.readyDeployments : null
  const failed = vc.connected ? vc.errorDeployments : null
  const prevAdded = (cs.sourceAdded || 0)
  const prevDeleted = (cs.sourceDeleted || 0)
  const prevNet = prevAdded - prevDeleted
  const prevChurn = prevAdded + prevDeleted
  const prevCommits = cs.commits
  const prevActiveDays = cs.activeDays
  const prevLongestStreak = cs.longestStreak
  const prevPRs = cgh.connected ? cgh.pullRequests : null
  const prevMerged = cgh.connected ? cgh.mergedPrs : null
  const prevProd = cvc.connected ? cvc.productionDeployments : null
  const prevPreview = cvc.connected ? cvc.previewDeployments : null
  const prevSucceeded = cvc.connected ? cvc.readyDeployments : null
  const prevFailed = cvc.connected ? cvc.errorDeployments : null
  const activeWindow = range.mode === 'all' && !daily.length ? 365 : rangeDays(range)
  const languages = data.languages || []
  const langTotal = totalLoc || languages.reduce((a, l) => a + (l.code || 0), 0) || 1
  const rankedRepos = useMemo(() => {
    return [...(data.repositories || [])].sort(
      (a, b) => b.sourceAdded + b.sourceDeleted - (a.sourceAdded + a.sourceDeleted)
    )
  }, [data.repositories])

  const monthLabels = monthly.map((m) => m.label[0])
  const commitValues = monthly.map((m) => m.commits)

  return (
    <div>
      <section className='grid grid-cols-1 lg:grid-cols-[1fr_auto] items-end gap-12 lg:gap-16 pt-14 lg:pt-16'>
        <div className='min-w-0'>
          <div className='label-s'><Term keyName='netSourceGrowth' showIcon>Net Source Growth</Term> · {rangeDisplay(range)}</div>
          <motion.div
            className='mt-5 flex items-baseline text-[64px] sm:text-[80px] lg:text-[112px] xl:text-[132px] font-light leading-[0.82] tracking-[-0.055em] tabular-nums text-zinc-50 figure'
            initial={{ opacity: 0, y: 14, filter: 'blur(3px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            transition={reduced ? { duration: 0 } : { duration: dur.hero, ease: ease.out, delay: 0.12 }}
          >
            <span className={net >= 0 ? 'text-zinc-50' : 'text-zinc-200'}>
              {net >= 0 ? '+' : '−'}
            </span>
            {stringN(Math.abs(net))}
          </motion.div>
          <CompareDelta current={net} previous={prevNet} compare={compare} label={compare ? `vs ${compareDisplay(range).toLowerCase()}` : ''} />
          <div className='mt-6 space-y-1 text-[11px] uppercase tracking-[0.2em] text-zinc-600'>
            <div className='text-zinc-500'>{range.from || ''} — {range.to || ''}</div>
            <div className='flex items-center gap-4 pt-2'>
              <span><Term keyName='currentSourceLoc' showIcon>Current Source Loc</Term> <span className='text-zinc-400'>{stringN(totalLoc)}</span></span>
              <span className='text-zinc-800'>·</span>
              <span>{stringN(repos)} <Term keyName='repositories' showIcon>repositories</Term></span>
            </div>
          </div>
        </div>
        <div className='w-full lg:w-[420px] pb-3'>
          <div className='label-s'><Term keyName='cumulativeGrowth' showIcon>Cumulative growth</Term></div>
          <div className='mt-4'>
            {cumulative.length > 1 ? (
              <AreaChart
                height={150}
                labels={monthLabels}
                series={[{ data: cumulative, color: '#e4e4e7', label: 'loc', fill: true }]}
                grid={false}
                axisColor='#3f3f46'
              />
            ) : (
              <div className='h-[150px] flex items-end border-b border-zinc-900'>
                <span className='text-[10px] uppercase tracking-[0.2em] text-zinc-700'>No historical data</span>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className='mt-16 lg:mt-20'>
        <div className='label-s'>{rangeDisplay(range)}</div>
        <div className='mt-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-6 lg:gap-x-14'>
        {[
          { l: 'Lines Added', v: n(added), t: 'linesAdded', c: added, p: prevAdded },
          { l: 'Lines Deleted', v: n(deleted), t: 'linesDeleted', c: deleted, p: prevDeleted },
          { l: 'Net Lines', v: n(net), t: 'netLines', c: net, p: prevNet },
          { l: 'Total Churn', v: n(churn), t: 'totalChurn', c: churn, p: prevChurn },
        ].map((x, i) => (
          <div
            key={x.l}
            className={`group ${i ? 'border-t sm:border-t-0 sm:border-l border-zinc-900 pt-6 sm:pt-0 sm:pl-6 lg:pl-14' : ''}`}
          >
            <div className='label-s'>{x.t ? <Term keyName={x.t} showIcon>{x.l}</Term> : x.l}</div>
            <div className='mt-3 text-[32px] lg:text-[40px] font-light leading-none tracking-[-0.035em] tabular-nums text-zinc-100 transition-colors group-hover:text-white figure'>
              {x.v}
            </div>
            <CompareDelta current={x.c} previous={x.p} compare={compare} label={compare ? `vs previous ${range.mode === 'ytd' ? 'ytd' : range.mode}` : ''} />
          </div>
        ))}
        </div>
      </section>

      <div className='mt-16 rule' />

      <section className='mt-16'>
        <div className='label-s'>{rangeDisplay(range)}</div>
        <div className='mt-5 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-x-8 lg:gap-x-10 gap-y-14'>
        <DevMetric label='Commits' value={n(commits)} icon='octicon:git-commit-16' term='commits' current={commits} previous={prevCommits} compare={compare} />
        <DevMetric label='Pull Requests' value={pullRequests === null ? '—' : n(pullRequests)} icon='octicon:git-pull-request-16' term='pullRequests' current={pullRequests} previous={prevPRs} compare={compare} />
        <DevMetric label='Merged' value={merged === null ? '—' : n(merged)} icon='octicon:git-merge-16' term='merged' current={merged} previous={prevMerged} compare={compare} />
        <DevMetric label='Active Days' value={n(activeDays)} icon='ph:calendar-check-bold' term='activeDays' current={activeDays} previous={prevActiveDays} compare={compare} />
        <DevMetric label='Longest Streak' value={n(longestStreak)} icon='ph:flame-bold' term='longestStreak' current={longestStreak} previous={prevLongestStreak} compare={compare} />
        <DevMetric label='Coding Hours' value='—' icon='ph:clock-bold' term='codingHours' />
        <DevMetric label='Avg Hours / Day' value='—' icon='ph:gauge-bold' term='avgHours' />
        <DevMetric label='Repositories' value={n(repos)} icon='octicon:repo-16' term='repositories' />
        <DevMetric label='Production Deploys' value={prod === null ? '—' : n(prod)} icon='ph:rocket-launch-bold' term='productionDeploys' current={prod} previous={prevProd} compare={compare} />
        <DevMetric label='Preview Deploys' value={preview === null ? '—' : n(preview)} icon='ph:eye-bold' term='previewDeploys' current={preview} previous={prevPreview} compare={compare} />
        <DevMetric label='Succeeded' value={succeeded === null ? '—' : n(succeeded)} icon='ph:check-bold' term='succeeded' current={succeeded} previous={prevSucceeded} compare={compare} />
        <DevMetric label='Failed' value={failed === null ? '—' : n(failed)} icon='ph:x-bold' term='failed' current={failed} previous={prevFailed} compare={compare} />
        </div>
      </section>

      <div className='mt-16 rule' />

      <ContributionField weeks={weeks} sub={`${stringN(activeDays)} of ${activeWindow} days active`} title={<Term keyName='dailyContribution' showIcon>Daily Contribution Field</Term>} />

      <div className='mt-16 rule' />

      <section className='mt-14'>
        <div className='label-s'>Projects · ranked by <Term keyName='sourceChurn' showIcon>churn</Term> · {rangeDisplay(range)}</div>
        <div className='mt-8'>
          {rankedRepos.map((p, i) => (
            <motion.div
              key={p.path}
              className='group grid grid-cols-[auto_1fr_auto] lg:grid-cols-[1.4fr_repeat(5,minmax(0,0.55fr))_0.6fr] items-baseline gap-4 lg:gap-6 border-b border-zinc-900 py-6 transition-colors hover:border-zinc-700 hover:bg-zinc-900/20'
              whileHover={reduced ? {} : { x: 2 }}
              transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
            >
              <div className='flex items-baseline gap-4'>
                <span className='text-[10px] tabular-nums text-zinc-800 transition-colors group-hover:text-zinc-500'>{String(i + 1).padStart(2, '0')}</span>
                <div>
                  <div className='text-[20px] lg:text-[24px] font-light leading-none tracking-[-0.02em] text-zinc-100 transition-all group-hover:translate-x-1.5 group-hover:text-white'>
                    {p.name}
                  </div>
                  <div className='mt-2 text-[9.5px] uppercase tracking-[0.24em] text-zinc-700 transition-colors group-hover:text-zinc-600'>
                    {p.primaryLanguage ? `${p.primaryLanguage} · ` : ''}
                    {timeAgo(p.lastCommit)}
                  </div>
                </div>
              </div>
              {[
                ['LOC', n(p.currentLoc)],
                ['Churn', compact((p.sourceAdded || 0) + (p.sourceDeleted || 0))],
                ['Commits', n(p.commits || 0)],
                ['Days', n(p.activeDays || 0)],
                ['Hours', '—'],
              ].map(([l, v]) => (
                <div key={l} className='text-right hidden lg:block'>
                  <div className='text-[9px] uppercase tracking-[0.24em] text-zinc-800'>{l}</div>
                  <div className='mt-1.5 text-[17px] lg:text-[19px] font-light tabular-nums text-zinc-300 figure transition-colors group-hover:text-zinc-100'>{v}</div>
                </div>
              ))}
              <div className='text-right text-[9.5px] uppercase tracking-[0.24em]' style={{ color: '#3f3f46' }}>
                —
              </div>
            </motion.div>
          ))}
        </div>
      </section>

      <section className='mt-16'>
        <div className='label-s'><Term keyName='languageComposition' showIcon>Language composition</Term></div>
        <LanguageBar languages={languages} onHover={setHoveredLang} activeLang={hoveredLang} />
        <LanguageLegend languages={languages} onHover={setHoveredLang} activeLang={hoveredLang} />
      </section>

      <section className='mt-20 grid grid-cols-1 lg:grid-cols-3 gap-16'>
        <div>
          <div className='label-s'>Commits by month</div>
          <div className='mt-6 flex h-[110px] items-end gap-1.5'>
            {commitValues.length ? (
              commitValues.map((v, i) => (
                <div
                  key={i}
                  className='group relative flex-1 bg-zinc-100/15 transition-all hover:bg-zinc-100/60'
                  style={{ height: `${(v / Math.max(...commitValues, 1)) * 100}%` }}
                >
                  <span className='absolute -top-5 left-1/2 -translate-x-1/2 text-[9px] tabular-nums text-zinc-500 opacity-0 group-hover:opacity-100'>
                    {v}
                  </span>
                </div>
              ))
            ) : (
              <div className='w-full h-full border-b border-zinc-900 text-[10px] uppercase tracking-[0.2em] text-zinc-700 flex items-end pb-2'>
                No data
              </div>
            )}
          </div>
          <div className='mt-2 flex justify-between text-[9px] uppercase tracking-[0.2em] text-zinc-800'>
            {monthLabels.map((m, i) => (
              <span key={i}>{m}</span>
            ))}
          </div>
        </div>

        <div>
          <div className='label-s'>Coding hours by month</div>
          <div className='mt-6 h-[110px] flex items-center justify-center border-b border-zinc-900'>
            <span className='text-[10px] uppercase tracking-[0.2em] text-zinc-700'>Not connected</span>
          </div>
          <div className='mt-2 flex justify-between text-[9px] uppercase tracking-[0.2em] text-zinc-800 opacity-0'>
            {monthLabels.map((m, i) => (
              <span key={i}>{m}</span>
            ))}
          </div>
        </div>

        <div>
          <div className='label-s'>Deployments by month</div>
          <div className='mt-6 h-[110px] flex items-center justify-center border-b border-zinc-900'>
            <span className='text-[10px] uppercase tracking-[0.2em] text-zinc-700'>No monthly data</span>
          </div>
          <div className='mt-2 flex justify-between text-[9px] uppercase tracking-[0.2em] text-zinc-800 opacity-0'>
            {monthLabels.map((m, i) => (
              <span key={i}>{m}</span>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}

createRoot(document.getElementById('root')).render(<App />)
