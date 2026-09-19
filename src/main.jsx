import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Icon } from '@iconify/react'
import { motion, AnimatePresence } from 'framer-motion'
import { AreaChart } from './Charts'
import { Projects, Activity, Code } from './LegacyTabs'
import { CompareDelta } from './CompareDelta'
import { ContributionField, buildHeatmap } from './Heatmap'
import { LanguageBar, LanguageLegend } from './LanguageBar'
import { DateRange } from './DateRange'
import { Term } from './TermTooltip'
import { makeRange, rangeQuery, rangeDays, rangeDisplay, readInitialRange, rangeFromSearch, makeCompareRange, compareDisplay, DEFAULT_RANGE_MODE } from './range'
import { AnimatedNumber } from './AnimatedNumber'
import { useReducedMotion, ease, dur } from './motion'
import { Curtain, useCurtainTransition } from './CurtainTransition'
import './index.css'

const nav = ['overview', 'projects', 'activity', 'code']
const navLabels = { overview: 'Overview', projects: 'Projects', activity: 'Activity', code: 'Code' }

const fmt = new Intl.NumberFormat('en-US')
const stringN = (v) => v == null ? '—' : fmt.format(Number(v))
const n = (v) => <AnimatedNumber value={v} className='' />
const compact = (v) => <AnimatedNumber value={v} compact />
const c = (v) => compact(v)

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
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
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

function buildPrMonthly(prsDaily) {
  const buckets = new Map()
  for (const d of prsDaily || []) {
    const key = d.date.slice(0, 7)
    if (!buckets.has(key)) buckets.set(key, { key, label: monthShort[Number(d.date.slice(5, 7)) - 1], opened: 0, merged: 0 })
    const b = buckets.get(key)
    b.opened += d.opened || 0
    b.merged += d.merged || 0
  }
  return [...buckets.values()].sort((a, b) => a.key.localeCompare(b.key))
}

const SYNCING = new Set(['syncing'])

function App() {
  const [me, setMe] = useState(undefined) // undefined = loading, null = signed out
  const [dash, setDash] = useState(null)
  const [compareData, setCompareData] = useState(null)
  const [sync, setSync] = useState(null)
  const [compare, setCompare] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [loadingDash, setLoadingDash] = useState(true)
  const [range, setRange] = useState(() => readInitialRange())
  const rangeRef = useRef(range)
  const pumpTimer = useRef(null)
  const reduced = useReducedMotion()
  const headerRef = useRef(null)
  const [headerTop, setHeaderTop] = useState(112)
  const {
    view, target, requestView, transitioning, phase,
    direction: curtainDir, onCovered, onRevealed,
  } = useCurtainTransition({ views: nav, initial: 'overview' })

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
    try { window.localStorage.setItem('dev-dashboard-range', JSON.stringify(r)) } catch {}
  }, [])

  useEffect(() => {
    const onPop = () => {
      // Back/forward resolves canonically — a clean URL is the default range.
      const r = rangeFromSearch(window.location.search) ?? makeRange(DEFAULT_RANGE_MODE)
      setRange(r)
      persistRange(r)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [persistRange])

  const loadDashboard = useCallback(async (r = rangeRef.current) => {
    try {
      const q = new URLSearchParams()
      if (r.from) q.set('from', r.from)
      if (r.to) q.set('to', r.to)
      const res = await fetch(`/api/dashboard${q.size ? `?${q}` : ''}`)
      if (res.status === 401) { setMe(null); return }
      if (!res.ok) return
      const payload = await res.json()
      setDash(payload)
      if (payload.sync) setSync(payload.sync)
      setLoadingDash(false)
    } catch {}
  }, [])

  const loadCompare = useCallback(async () => {
    const cr = makeCompareRange(rangeRef.current)
    if (!cr || !compare) { setCompareData(null); return }
    try {
      const q = new URLSearchParams({ from: cr.from, to: cr.to })
      const res = await fetch(`/api/dashboard?${q}`)
      if (res.ok) setCompareData(await res.json())
    } catch {}
  }, [compare])

  // Serial sync slices: each POST runs a bounded chunk of ingestion in-request
  // and returns when it finishes or the slice expires. A parallel poll keeps
  // the UI progressive and re-kicks a POST if progress stalls (e.g. a
  // suspended continuation). Cron finishes anything abandoned.
  const pump = useCallback(async (force = false) => {
    let lastSig = ''
    let lastChange = Date.now()
    const poll = setInterval(async () => {
      try {
        const r = await fetch('/api/sync')
        if (!r.ok) return
        const s = await r.json()
        setSync(s)
        const sig = `${s.status}|${s.phase}|${JSON.stringify(s.detail)}`
        if (sig !== lastSig) { lastSig = sig; lastChange = Date.now(); loadDashboard() }
        if (SYNCING.has(s.status) && Date.now() - lastChange > 75_000) {
          lastChange = Date.now()
          fetch('/api/sync', { method: 'POST' }).then((x) => x.json()).then(setSync).catch(() => {})
        }
      } catch {}
    }, 1500)
    try {
      for (;;) {
        const res = await fetch(`/api/sync${force ? '?force=1' : ''}`, { method: 'POST' })
        force = false
        if (!res.ok) return
        const s = await res.json()
        setSync(s)
        if (SYNCING.has(s.status)) {
          await new Promise((r) => setTimeout(r, 1500))
          continue
        }
        if (s.status === 'rate_limited' && s.resumeAt) {
          const wait = Math.min(new Date(s.resumeAt).getTime() - Date.now() + 2000, 5 * 60_000)
          pumpTimer.current = setTimeout(() => pump(false), Math.max(5000, wait))
        }
        break
      }
      loadDashboard()
    } catch {} finally {
      clearInterval(poll)
    }
  }, [loadDashboard])

  useEffect(() => () => { if (pumpTimer.current) clearTimeout(pumpTimer.current) }, [])

  const [refreshing, setRefreshing] = useState(false)
  const [refreshOk, setRefreshOk] = useState(false)
  const refresh = useCallback(async () => {
    setRefreshing(true)
    setRefreshOk(false)
    await pump(true)
    await loadDashboard()
    setRefreshing(false)
    setRefreshOk(true)
  }, [pump, loadDashboard])

  // Targeted historical backfill for the selected custom range.
  const [rangeSyncing, setRangeSyncing] = useState(false)
  const [outsideInfo, setOutsideInfo] = useState(null)
  useEffect(() => { setOutsideInfo(null) }, [range.from, range.to])
  const syncThisRange = useCallback(async () => {
    if (!rangeRef.current.from || !rangeRef.current.to) {
      await pump(true) // open-ended range → resume the general sync
      await loadDashboard()
      return
    }
    const { from, to } = rangeRef.current
    setRangeSyncing(true)
    try {
      for (;;) {
        const res = await fetch(`/api/sync-range?from=${from}&to=${to}`, { method: 'POST' })
        if (!res.ok) break
        const r = await res.json()
        if (r.outsideCommits != null) setOutsideInfo(r.outsideCommits)
        if (r.done || r.ok === false) break
        await new Promise((s) => setTimeout(s, 1500))
      }
    } finally {
      setRangeSyncing(false)
      await loadDashboard()
    }
  }, [pump, loadDashboard])

  useEffect(() => {
    if (!refreshOk) return
    const t = setTimeout(() => setRefreshOk(false), 800)
    return () => clearTimeout(t)
  }, [refreshOk])

  const changeRange = useCallback((r) => {
    setRange(r)
    persistRange(r)
    // Only explicit user changes write the URL — presets get ?range=, custom
    // windows get ?from&to, and returning to the default clears the query.
    const q = rangeQuery(r)
    window.history.pushState({ range: r }, '', q ? `?${q}` : window.location.pathname)
  }, [persistRange])

  useEffect(() => {
    fetch('/api/user')
      .then(async (res) => {
        if (res.status === 401) { setMe(null); return }
        const m = await res.json()
        setMe(m)
        loadDashboard()
        const st = m.sync?.status
        const stale = m.sync?.lastSyncedAt && Date.now() - new Date(m.sync.lastSyncedAt).getTime() > 10 * 60_000
        if (!st || st === 'idle' || st === 'syncing' || !m.sync?.lastSyncedAt || stale) pump()
      })
      .catch(() => setMe(null))
  }, [loadDashboard, pump])

  useEffect(() => {
    if (me) loadDashboard()
    loadCompare()
  }, [range.from, range.to]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadCompare() }, [compare, loadCompare])
  useEffect(() => {
    persistRange(range)
    // Canonicalize only when the URL itself carried explicit range params —
    // a clean URL stays clean (localStorage/defaults never inject a query).
    if (rangeFromSearch(window.location.search)) {
      const q = rangeQuery(range)
      if (`?${q}` !== window.location.search) {
        window.history.replaceState({ range }, '', q ? `?${q}` : window.location.pathname)
      }
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const daily = dash?.daily || []
  const monthly = useMemo(() => buildMonthly(daily), [daily])
  const prMonthly = useMemo(() => buildPrMonthly(dash?.prsDaily), [dash?.prsDaily])
  const cumulative = useMemo(() => {
    let cur = 0
    return monthly.map((m) => { cur += m.net; return cur })
  }, [monthly])

  const heatmapEnd = useMemo(() => (range.to ? new Date(range.to + 'T00:00:00Z') : new Date()), [range.to])
  const heatmapCount = useMemo(() => {
    if (range.mode !== 'all') return rangeDays(range)
    if (!daily.length) return 365
    const first = new Date(daily[0].date + 'T00:00:00Z')
    return Math.max(1, Math.round((heatmapEnd - first) / 86400000) + 1)
  }, [range, daily, heatmapEnd])
  const heatmapWeeks = useMemo(() => buildHeatmap(daily, heatmapCount, heatmapEnd), [daily, heatmapCount, heatmapEnd])

  if (me === undefined) {
    return <div className='min-h-screen bg-[#0a0a0a]' />
  }
  if (me === null) {
    return <Landing onStart={() => (window.location.href = '/api/auth/login')} />
  }

  const syncing = sync && SYNCING.has(sync.status)
  const revoked = sync?.status === 'revoked' || dash?.github?.revoked
  const needsInstall = sync?.status === 'needs_install'
  const syncPct = Math.round((sync?.progress || 0) * 100)
  const building = (syncing || needsInstall) && !(dash?.repositories?.length)

  const phaseLabel = { discover: 'Discovering', metadata: 'Metadata', commits: 'History', pulls: 'PRs', range: 'Range', finalizing: 'Finalizing' }
  const syncDetail = sync?.detail
  const syncTooltip = syncDetail
    ? [
        `Repository metadata   ${syncDetail.repos?.done ?? '—'} / ${syncDetail.repos?.total ?? '—'}`,
        `Commit history        ${syncDetail.history?.done ?? '—'} / ${syncDetail.history?.total ?? '—'}${syncDetail.history?.commits ? ` · ${syncDetail.history.commits} commits` : ''}`,
        `Pull requests         ${syncDetail.pulls?.done ? 'done' : 'pending'}${syncDetail.pulls?.count ? ` · ${syncDetail.pulls.count}` : ''}`,
        sync?.lastSyncedAt ? `Last updated          ${timeAgo(sync.lastSyncedAt)}` : null,
      ]
        .filter(Boolean)
        .join('\n')
    : undefined

  const statusPills = [
    {
      key: 'github',
      label: 'GITHUB',
      glossaryKey: 'github',
      state: revoked ? 'error' : 'ready',
      text: revoked ? 'Revoked' : 'Connected',
    },
    {
      key: 'sync',
      label: 'SYNC',
      glossaryKey: 'sync',
      state: syncing ? 'loading' : sync?.status === 'error' ? 'error' : sync?.status === 'rate_limited' ? 'stale' : 'ready',
      title: syncTooltip,
      text: syncing
        ? `${phaseLabel[sync?.phase] || 'Working'} ${syncPct}%`
        : sync?.status === 'rate_limited'
          ? 'Paused'
          : sync?.status === 'complete'
            ? 'Up to date'
            : sync?.lastSyncedAt
              ? timeAgo(sync.lastSyncedAt)
              : 'Idle',
    },
  ]
  const statusColor = { ready: '#34d399', loading: '#60a5fa', error: '#f87171', stale: '#fbbf24' }

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
              {statusPills.map((s) => (
                <Term
                  key={s.key}
                  keyName={s.glossaryKey}
                  className='group flex items-center gap-1.5 text-[9.5px] uppercase tracking-[0.2em] text-zinc-700 transition-colors hover:text-zinc-400'
                  as='span'
                  tabIndex={-1}
                  title={s.title}
                >
                  <motion.span
                    className='h-[3px] w-[3px] rounded-full'
                    style={{ background: statusColor[s.state] }}
                    initial={false}
                    animate={
                      s.state === 'loading'
                        ? { scale: [1, 1.25, 1], opacity: [1, 0.65, 1] }
                        : s.state === 'error'
                          ? { x: [0, -2, 2, -2, 0] }
                          : { scale: 1, opacity: 1, x: 0 }
                    }
                    transition={
                      s.state === 'loading'
                        ? { repeat: Infinity, duration: 1.6, ease: 'easeInOut' }
                        : { duration: reduced ? 0 : 0.25, ease: [0.23, 1, 0.32, 1] }
                    }
                  />
                  {s.label}
                  <span className='text-zinc-800 normal-case tracking-[0.08em]'>{s.text}</span>
                </Term>
              ))}
              <button
                onClick={refresh}
                disabled={refreshing}
                className='group text-zinc-700 hover:text-zinc-400 transition-colors disabled:opacity-40'
                title='Sync with GitHub'
              >
                <AnimatePresence mode='wait'>
                  <motion.div
                    key={refreshing || syncing ? 'spinner' : refreshOk ? 'check' : 'refresh'}
                    className='origin-center'
                    initial={{ opacity: 0, scale: 0.6 }}
                    animate={
                      refreshing || syncing
                        ? { opacity: 1, scale: 1, rotate: 360 }
                        : refreshOk
                          ? { opacity: 1, scale: [0.7, 1.1, 1], rotate: 0 }
                          : { opacity: 1, scale: 1, rotate: 0 }
                    }
                    whileHover={refreshing || refreshOk ? {} : { rotate: 25 }}
                    exit={{ opacity: 0, scale: 0.7 }}
                    transition={
                      refreshing || syncing
                        ? { opacity: { duration: 0.15 }, scale: { duration: 0.15 }, rotate: { repeat: Infinity, duration: 1.2, ease: 'linear' } }
                        : refreshOk
                          ? { duration: 0.35, ease: [0.23, 1, 0.32, 1] }
                          : { duration: 0.18, ease: [0.23, 1, 0.32, 1] }
                    }
                  >
                    <Icon
                      icon={refreshing || syncing ? 'ph:spinner' : refreshOk ? 'ph:check' : 'ph:arrows-clockwise'}
                      className='h-3.5 w-3.5'
                    />
                  </motion.div>
                </AnimatePresence>
              </button>
              <AccountMenu me={me} onSettings={() => setSettingsOpen(true)} onRefresh={refresh} />
            </div>
          </div>
          <div className='mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-end gap-3'>
            <DateRange range={range} onChange={changeRange} compare={compare} onCompare={setCompare} />
          </div>
          <div className='mt-4 rule' />
          {(syncing || sync?.status === 'rate_limited') && (
            <motion.div className='mt-0.5 h-[1px] w-full bg-zinc-900' initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <motion.div
                className='h-full bg-zinc-300'
                initial={{ width: '0%' }}
                animate={{ width: `${Math.max(2, syncPct)}%` }}
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
          {revoked && <RevokedBanner />}
          {needsInstall && !revoked && <InstallBanner appSlug={me.appSlug} />}
          {building && !needsInstall && !revoked && <BuildingNotice pct={syncPct} />}
          {!building && !revoked && !needsInstall && !settingsOpen && (
            <CoverageNotice
              coverage={dash?.rangeCoverage}
              empty={!dash?.summary?.commits}
              onSync={syncThisRange}
              syncing={rangeSyncing}
              outside={outsideInfo}
            />
          )}
          {settingsOpen ? (
            <Settings me={me} dash={dash} onClose={() => setSettingsOpen(false)} />
          ) : (
            <>
              {view === 'overview' && <Overview data={dash} compare={compare} compareData={compareData} daily={daily} monthly={monthly} prMonthly={prMonthly} cumulative={cumulative} range={range} weeks={heatmapWeeks} loading={loadingDash} />}
              {view === 'projects' && <Projects data={dash} compare={compare} compareData={compareData} range={range} loading={loadingDash} />}
              {view === 'activity' && <Activity data={dash} compare={compare} compareData={compareData} daily={daily} range={range} loading={loadingDash} />}
              {view === 'code' && <Code data={dash} compare={compare} compareData={compareData} range={range} loading={loadingDash} />}
            </>
          )}
        </main>
      </div>
    </div>
  )
}

function AccountMenu({ me, onSettings, onRefresh }) {
  const [open, setOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const ref = useRef(null)
  const login = me?.user?.githubLogin
  const avatar = me?.user?.avatarUrl

  useEffect(() => {
    if (!open) return
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) { setOpen(false); setConfirmDelete(false) } }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])

  const deleteData = async () => {
    const res = await fetch('/api/user?confirm=1', { method: 'DELETE' })
    if (res.ok) window.location.href = '/'
  }

  const itemCls = 'block w-full text-left px-4 py-2.5 text-[10px] uppercase tracking-[0.2em] text-zinc-500 hover:text-zinc-200 hover:bg-zinc-900 transition-colors'

  return (
    <div ref={ref} className='relative'>
      <button onClick={() => setOpen((o) => !o)} className='flex items-center gap-2.5 group'>
        {avatar ? (
          <img src={avatar} alt='' className='h-6 w-6 rounded-full border border-zinc-800 group-hover:border-zinc-600 transition-colors' />
        ) : (
          <span className='h-6 w-6 rounded-full bg-zinc-800' />
        )}
        <span className='text-[10px] tracking-[0.14em] text-zinc-500 group-hover:text-zinc-300 transition-colors'>@{login}</span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className='absolute right-0 top-full mt-3 w-56 bg-[#0c0c0c] border border-zinc-800 shadow-2xl z-50'
          >
            <div className='px-4 py-3 border-b border-zinc-900 text-[9px] uppercase tracking-[0.22em] text-zinc-700'>Signed in as @{login}</div>
            <button className={itemCls} onClick={() => { setOpen(false); onSettings() }}>Manage repositories</button>
            <button className={itemCls} onClick={() => { setOpen(false); onRefresh() }}>Refresh GitHub</button>
            <a className={itemCls} href='/api/auth/logout'>Sign out</a>
            <div className='border-t border-zinc-900'>
              {confirmDelete ? (
                <div className='px-4 py-3'>
                  <div className='text-[9px] uppercase tracking-[0.18em] text-red-400/90'>Delete all Dev Ledger data?</div>
                  <div className='mt-2 flex gap-3'>
                    <button onClick={deleteData} className='text-[9px] uppercase tracking-[0.18em] text-red-300 hover:text-red-200'>Confirm</button>
                    <button onClick={() => setConfirmDelete(false)} className='text-[9px] uppercase tracking-[0.18em] text-zinc-600 hover:text-zinc-400'>Cancel</button>
                  </div>
                </div>
              ) : (
                <button className={`${itemCls} text-red-500/70 hover:text-red-400`} onClick={() => setConfirmDelete(true)}>Delete my data</button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function RevokedBanner() {
  return (
    <div className='mt-10 border border-zinc-800 px-6 py-8 flex flex-col sm:flex-row sm:items-center gap-6'>
      <div className='flex-1'>
        <div className='text-[10px] uppercase tracking-[0.24em] text-zinc-500'>GitHub access revoked</div>
        <div className='mt-2 text-[13px] text-zinc-400'>Dev Ledger can no longer reach your GitHub data. Historical analytics remain until you delete your account.</div>
      </div>
      <a href='/api/auth/login' className='inline-flex items-center gap-2 px-5 py-3 text-[10px] uppercase tracking-[0.2em] text-zinc-900 bg-zinc-100 hover:bg-white transition-colors self-start'>
        <Icon icon='octicon:mark-github-16' className='h-4 w-4' />
        Reconnect GitHub
      </a>
    </div>
  )
}

function InstallBanner({ appSlug }) {
  const href = appSlug ? `https://github.com/apps/${appSlug}/installations/new` : '/api/auth/login'
  return (
    <div className='mt-10 border border-zinc-800 px-6 py-8 flex flex-col sm:flex-row sm:items-center gap-6'>
      <div className='flex-1'>
        <div className='text-[10px] uppercase tracking-[0.24em] text-zinc-500'>Connect repositories</div>
        <div className='mt-2 text-[13px] text-zinc-400'>Authorize Dev Ledger on GitHub — all repositories or a selected set. Read-only.</div>
      </div>
      <a href={href} className='inline-flex items-center gap-2 px-5 py-3 text-[10px] uppercase tracking-[0.2em] text-zinc-900 bg-zinc-100 hover:bg-white transition-colors self-start'>
        <Icon icon='octicon:mark-github-16' className='h-4 w-4' />
        Authorize on GitHub
      </a>
    </div>
  )
}

function BuildingNotice({ pct }) {
  return (
    <div className='mt-10'>
      <div className='text-[10px] uppercase tracking-[0.24em] text-zinc-600'>Building your body of work</div>
      <div className='mt-2 text-[13px] text-zinc-500'>Importing your GitHub history — repositories, commits, pull requests, languages. {pct}%</div>
    </div>
  )
}

// Distinguishes "zero activity" from "history not yet synced" for the selected
// range, and offers targeted backfill instead of a lifetime re-import. When a
// synced range is genuinely empty it can still probe GitHub for commits in
// repositories outside the installation.
function CoverageNotice({ coverage, empty, onSync, syncing, outside }) {
  if (!coverage) return null
  const { status, availableFrom } = coverage
  const fmtDay = (iso) => (iso ? String(iso).slice(0, 10) : null)

  const showSyncButton = status === 'missing' || status === 'partial'
  const showCheckButton = status === 'complete' && empty && outside === null // probe GitHub for out-of-installation commits
  const showBox = showSyncButton || status === 'syncing' || (status === 'complete' && empty) || outside > 0
  if (!showBox) return null

  return (
    <div className='mt-8 border border-zinc-900 px-5 py-4 flex flex-wrap items-center gap-x-6 gap-y-3'>
      <div className='flex-1 min-w-48 text-[10px] uppercase tracking-[0.2em] leading-relaxed text-zinc-600'>
        {status === 'missing' && <span className='text-zinc-400'>History not yet synced for this range</span>}
        {status === 'partial' && (
          <span className='text-zinc-400'>
            Partial history{availableFrom ? ` — synced from ${fmtDay(availableFrom)} onward` : ''}
          </span>
        )}
        {status === 'syncing' && <span className='text-zinc-400'>Syncing this period</span>}
        {status === 'complete' && empty && (
          <span className='text-zinc-400'>Range fully synced — no activity in connected repositories</span>
        )}
        {outside > 0 && (
          <span className='block mt-1 text-zinc-500'>
            {outside} commit{outside === 1 ? '' : 's'} found in repositories outside your installation — connect them on GitHub to include them
          </span>
        )}
      </div>
      {(showSyncButton || showCheckButton) && (
        <button
          onClick={onSync}
          disabled={syncing}
          className='inline-flex items-center gap-2 border border-zinc-800 px-4 py-2 text-[10px] uppercase tracking-[0.2em] text-zinc-400 hover:border-zinc-600 hover:text-zinc-200 transition-colors disabled:opacity-40'
        >
          <Icon icon={syncing ? 'ph:spinner' : 'ph:arrows-clockwise'} className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
          {syncing ? 'Syncing' : showCheckButton ? 'Check outside repositories' : 'Sync this range'}
        </button>
      )}
    </div>
  )
}

function Settings({ me, dash, onClose }) {
  const repos = dash?.repositories || []
  const installs = me?.installations || []
  return (
    <div className='pt-14'>
      <div className='flex items-baseline justify-between border-b border-zinc-900 pb-10'>
        <div>
          <div className='label-s'>Repositories</div>
          <div className='mt-2 text-[11px] uppercase tracking-[0.22em] text-zinc-600'>GitHub-authorized access · managed on GitHub</div>
        </div>
        <button onClick={onClose} className='text-[10px] uppercase tracking-[0.2em] text-zinc-600 hover:text-zinc-300 transition-colors'>← Back</button>
      </div>

      <div className='mt-8 flex flex-wrap gap-3'>
        {installs.map((i) => (
          <a key={i.id} href={i.url} target='_blank' rel='noreferrer' className='inline-flex items-center gap-2 border border-zinc-800 px-4 py-2.5 text-[10px] uppercase tracking-[0.18em] text-zinc-400 hover:border-zinc-600 hover:text-zinc-200 transition-colors'>
            <Icon icon='octicon:gear-16' className='h-3.5 w-3.5' />
            {i.account ? `Edit access · ${i.account}` : 'Edit access on GitHub'}
          </a>
        ))}
        {!installs.length && me?.appSlug && (
          <a href={`https://github.com/apps/${me.appSlug}/installations/new`} target='_blank' rel='noreferrer' className='inline-flex items-center gap-2 border border-zinc-800 px-4 py-2.5 text-[10px] uppercase tracking-[0.18em] text-zinc-400 hover:border-zinc-600 hover:text-zinc-200 transition-colors'>
            Install on GitHub
          </a>
        )}
      </div>

      <div className='mt-10'>
        {repos.map((r) => (
          <div key={r.path} className='group flex items-baseline justify-between border-b border-zinc-900 py-4'>
            <div className='flex items-baseline gap-4 min-w-0'>
              <span className='text-[15px] text-zinc-200 truncate'>{r.path}</span>
              <span className='text-[9px] uppercase tracking-[0.18em] text-zinc-700'>{r.private ? 'private' : 'public'}{r.fork ? ' · fork' : ''}{r.archived ? ' · archived' : ''}</span>
            </div>
            <div className='text-[10px] uppercase tracking-[0.16em] text-zinc-600 whitespace-nowrap pl-6'>
              {r.primaryLanguage || '—'} · {fmtBytes(r.languageBytes)} · {timeAgo(r.lastActivityAt || r.lastCommitAt)}
            </div>
          </div>
        ))}
        {!repos.length && <div className='py-12 text-[10px] uppercase tracking-[0.2em] text-zinc-700'>No repositories authorized yet</div>}
      </div>

      <div className='mt-10 text-[10px] uppercase tracking-[0.18em] text-zinc-700 leading-relaxed max-w-xl'>
        Repository access is granted through the GitHub App installation and can be changed at any time on GitHub.
        Removing a repository there removes it here. To remove your Dev Ledger account data entirely, use the account menu → Delete my data.
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

function MiniBars({ values, labels }) {
  if (!values.length) {
    return <div className='mt-6 flex h-[110px] items-end border-b border-zinc-900'><span className='pb-2 text-[10px] uppercase tracking-[0.2em] text-zinc-700'>No data</span></div>
  }
  const max = Math.max(...values, 1)
  return (
    <>
      <div className='mt-6 flex h-[110px] items-end gap-1.5'>
        {values.map((v, i) => (
          <div key={i} className='group relative flex-1 bg-zinc-100/15 transition-all hover:bg-zinc-100/60' style={{ height: `${(v / max) * 100}%` }}>
            <span className='absolute -top-5 left-1/2 -translate-x-1/2 text-[9px] tabular-nums text-zinc-500 opacity-0 group-hover:opacity-100'>{v}</span>
          </div>
        ))}
      </div>
      <div className='mt-2 flex justify-between text-[9px] uppercase tracking-[0.2em] text-zinc-800'>
        {labels.map((m, i) => <span key={i}>{m}</span>)}
      </div>
    </>
  )
}

function Overview({ data, compare, compareData, daily, monthly, prMonthly, cumulative, range, weeks, loading }) {
  const reduced = useReducedMotion()
  const [hoveredLang, setHoveredLang] = useState(null)
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
  const prevCommits = cs.commits
  const prevActiveDays = cs.activeDays
  const prevLongestStreak = cs.longestStreak
  const prevPRs = cgh.pullRequests
  const prevMerged = cgh.mergedPrs
  const activeWindow = range.mode === 'all' && !daily.length ? 365 : rangeDays(range)
  const languages = data?.languages || []
  const rankedRepos = useMemo(() => {
    return [...(data?.repositories || [])].sort(
      (a, b) => (b.sourceAdded + b.sourceDeleted) - (a.sourceAdded + a.sourceDeleted)
    )
  }, [data?.repositories])
  const primaryLang = languages[0]?.language

  const monthLabels = monthly.map((m) => m.label[0])
  const commitValues = monthly.map((m) => m.commits)
  const prValues = prMonthly.map((m) => m.opened)
  const netValues = monthly.map((m) => m.net)

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
        <DevMetric label='Repositories' value={n(repos)} icon='octicon:repo-16' term='repositories' />
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
              className='group grid grid-cols-[auto_1fr_auto] lg:grid-cols-[1.4fr_repeat(4,minmax(0,0.55fr))] items-baseline gap-4 lg:gap-6 border-b border-zinc-900 py-6 transition-colors hover:border-zinc-700 hover:bg-zinc-900/20'
              whileHover={reduced ? {} : { x: 2 }}
              transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
            >
              <div className='flex items-baseline gap-4'>
                <span className='text-[10px] tabular-nums text-zinc-800 transition-colors group-hover:text-zinc-500'>{String(i + 1).padStart(2, '0')}</span>
                <div>
                  <div className='text-[20px] lg:text-[24px] font-light leading-none tracking-[-0.02em] text-zinc-100 transition-all group-hover:translate-x-1.5 group-hover:text-white'>
                    {p.name}
                    {p.private && <Icon icon='octicon:lock-16' className='inline h-3 w-3 ml-2 text-zinc-700' />}
                  </div>
                  <div className='mt-2 text-[9.5px] uppercase tracking-[0.24em] text-zinc-700 transition-colors group-hover:text-zinc-600'>
                    {p.primaryLanguage ? `${p.primaryLanguage} · ` : ''}
                    {timeAgo(p.lastCommit)}
                  </div>
                </div>
              </div>
              {[
                ['Churn', compact((p.sourceAdded || 0) + (p.sourceDeleted || 0))],
                ['Commits', n(p.commits || 0)],
                ['Days', n(p.activeDays || 0)],
                ['Language', p.primaryLanguage || '—'],
              ].map(([l, v]) => (
                <div key={l} className='text-right hidden lg:block'>
                  <div className='text-[9px] uppercase tracking-[0.24em] text-zinc-800'>{l}</div>
                  <div className='mt-1.5 text-[17px] lg:text-[19px] font-light tabular-nums text-zinc-300 figure transition-colors group-hover:text-zinc-100'>{v}</div>
                </div>
              ))}
            </motion.div>
          ))}
          {!rankedRepos.length && !loading && (
            <div className='py-14 text-center text-[10px] uppercase tracking-[0.2em] text-zinc-700'>No repositories imported yet</div>
          )}
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
          <MiniBars values={commitValues} labels={monthLabels} />
        </div>
        <div>
          <div className='label-s'>Pull requests by month</div>
          <MiniBars values={prValues} labels={prMonthly.map((m) => m.label[0])} />
        </div>
        <div>
          <div className='label-s'>Net lines by month</div>
          <MiniBars values={netValues.map((v) => Math.max(0, v))} labels={monthLabels} />
        </div>
      </section>
    </div>
  )
}

function Landing({ onStart }) {
  return (
    <div className='min-h-screen bg-[#0a0a0a] text-zinc-400 antialiased selection:bg-zinc-100 selection:text-black flex items-center justify-center px-6'>
      <div className='max-w-md text-center'>
        <div className='text-[12px] uppercase tracking-[0.3em] text-zinc-600 mb-6'>work</div>
        <h1 className='text-[38px] lg:text-[48px] font-light leading-[0.95] tracking-[-0.03em] text-zinc-100 figure'>BODY OF WORK</h1>
        <p className='mt-6 text-[13px] leading-relaxed tracking-[-0.01em] text-zinc-500'>
          Your GitHub history, made legible.
        </p>
        <div className='mt-10'>
          <button
            onClick={onStart}
            className='inline-flex items-center gap-2.5 px-5 py-3 text-[11px] uppercase tracking-[0.2em] text-zinc-900 bg-zinc-100 hover:bg-white transition-colors'
          >
            <Icon icon='octicon:mark-github-16' className='h-4 w-4' />
            Continue with GitHub
          </button>
        </div>
        <div className='mt-12 text-[10px] uppercase tracking-[0.26em] text-zinc-700 leading-loose'>
          Commits. Projects. Languages. Momentum.<br />One continuous record.
        </div>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')).render(<App />)
