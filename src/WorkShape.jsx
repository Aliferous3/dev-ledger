import React, { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Icon } from '@iconify/react'
import { AnimatedNumber } from './AnimatedNumber'
import { useReducedMotion, ease } from './motion'
import { DrawHR, Rise, Fade } from './Canvas'
import {
  monthIdx,
  idxMonth,
  monthName,
  buildRepoSpans,
  buildLangStrata,
  buildMigration,
  buildFingerprint,
  LIFECYCLE_DEFS,
} from './shape'

const fmt = new Intl.NumberFormat('en-US')
const n0 = (v) => fmt.format(Math.round(Number(v) || 0))
const W = 1000
const INK = 'rgba(250,250,250,'
const Lbl = ({ children, className = '' }) => <span className={`label-s inline-flex items-center gap-1.5 ${className}`}>{children}</span>
const Coord = ({ children }) => <span className='label-s text-zinc-800 whitespace-nowrap shrink-0'>{children}</span>

const Head = ({ label, coord, right }) => (
  <div className='flex items-center justify-between gap-4'>
    <Lbl>{label}</Lbl>
    <div className='flex items-center gap-5'>
      {right}
      {coord && <Coord>{coord}</Coord>}
    </div>
  </div>
)

const StateTag = ({ children }) => <span className='label-s text-zinc-600'>{children}</span>

// Arc helper for the fingerprint rings — sweeps clockwise from 12 o'clock.
function arc(cx, cy, r, sweep) {
  const a0 = -Math.PI / 2
  const a1 = a0 + (Math.min(sweep, 359.9) / 360) * Math.PI * 2
  return `M ${cx + r * Math.cos(a0)} ${cy + r * Math.sin(a0)} A ${r} ${r} 0 ${sweep > 180 ? 1 : 0} 1 ${cx + r * Math.cos(a1)} ${cy + r * Math.sin(a1)}`
}


/* ----------------------- F · 02 LANGUAGE SUCCESSION ----------------------- */

export function Strata({ strata, axis, langFocus, onHoverLang, hoverM, setHoverM }) {
  const langs = strata.order.slice(0, 8)
  const total = Math.max(axis.last - axis.first + 1, 1)
  const monthList = useMemo(() => {
    const out = []
    for (let i = axis.first; i <= axis.last; i++) out.push(idxMonth(i))
    return out
  }, [axis])
  const at = hoverM != null ? strata.at(idxMonth(hoverM)) : null
  return (
    <div>
      <Head
        label='Language Succession — byte presence of repositories active each month'
        coord='F · 02'
        right={<span className='label-s text-zinc-800 hidden md:inline'>{monthList.length} MONTHS · {langs.length} STRATA</span>}
      />
      <div className='mt-8 border-t border-zinc-900'>
        {langs.map((lang, ri) => {
          const cells = monthList.map((m) => strata.at(m).find((x) => x.language === lang)?.share || 0)
          const dim = langFocus && langFocus !== lang
          return (
            <div key={lang} className={`grid grid-cols-12 items-center border-b border-zinc-900 transition-opacity duration-300 ${dim ? 'opacity-25' : ''}`}>
              <div
                className='col-span-3 lg:col-span-2 py-3 pr-3 cursor-default'
                onMouseEnter={() => onHoverLang?.(lang)}
                onMouseLeave={() => onHoverLang?.(null)}
              >
                <span className='label-s text-zinc-500 truncate block'>{lang}</span>
              </div>
              <div
                className='col-span-9 lg:col-span-10 border-l border-zinc-900 pl-2 py-2 flex gap-px'
                onMouseMove={(e) => {
                  const r = e.currentTarget.getBoundingClientRect()
                  const f = Math.min(0.999, Math.max(0, (e.clientX - r.left) / r.width))
                  setHoverM(axis.first + Math.floor(f * total))
                }}
                onMouseLeave={() => setHoverM(null)}
              >
                {cells.map((share, i) => (
                  <div key={i} className='flex-1 h-7' style={{ background: `${INK}${(share * 0.85).toFixed(3)})` }} />
                ))}
              </div>
            </div>
          )
        })}
        {strata.order.length > 8 && (
          <div className='label-s py-3 text-zinc-800'>+{strata.order.length - 8} MINOR STRATA ELIDED</div>
        )}
      </div>
      <div className='mt-3 flex justify-between label-s text-zinc-800'>
        <span>{monthName(monthList[0])}</span>
        <span className='tabular-nums'>
          {at ? `${monthName(idxMonth(hoverM))} — ${at.filter((x) => x.share > 0.005).slice(0, 4).map((x) => `${x.language} ${(x.share * 100).toFixed(0)}%`).join(' · ')}` : 'HOVER FOR COMPOSITION'}
        </span>
        <span>{monthName(monthList[monthList.length - 1])}</span>
      </div>
    </div>
  )
}

/* -------------- F · 03 REPOSITORY LIFECYCLE + RETURN MAP ----------------- */

export function Lifecycle({ spans, axis, hoverM, repoFocus, setRepoFocus }) {
  const total = Math.max(axis.last - axis.first + 1, 1)
  const rows = spans.slice(0, 12)
  const H = 34
  const mx = (i) => ((i - axis.first) / total) * W
  const mw = W / total
  return (
    <div>
      <Head
        label='Repository Lifecycle — activity, silence, returns'
        coord='F · 03'
        right={<span className='label-s text-zinc-800 hidden lg:inline'>{LIFECYCLE_DEFS.map(([k]) => k).join(' / ')}</span>}
      />
      <div className='mt-8 border-t border-zinc-900'>
        {rows.map((s) => {
          const dim = repoFocus && repoFocus !== s.id
          return (
            <div
              key={s.id}
              className={`grid grid-cols-12 items-center border-b border-zinc-900 transition-opacity duration-300 ${dim ? 'opacity-25' : ''}`}
              onMouseEnter={() => setRepoFocus?.(s.id)}
              onMouseLeave={() => setRepoFocus?.(null)}
            >
              <div className='col-span-4 lg:col-span-3 py-2 pr-3 min-w-0'>
                <span className='figure block truncate text-[15px] text-zinc-300'>
                  {s.name}
                  {s.private && <Icon icon='octicon:lock-16' className='inline h-2.5 w-2.5 ml-1.5 text-zinc-700 align-baseline' />}
                </span>
                <span className='label-s mt-0.5 block text-zinc-800'>{monthName(s.first)} — {monthName(s.last)}</span>
              </div>
              <div className='col-span-6 lg:col-span-7 py-1'>
                <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio='none' className='w-full' style={{ height: H }}>
                  <line x1={mx(monthIdx(s.first))} x2={mx(monthIdx(s.last)) + mw} y1={H - 8} y2={H - 8} stroke='rgba(250,250,250,0.14)' strokeWidth={1} vectorEffect='non-scaling-stroke' />
                  {s.months.map((i) => (
                    <rect key={i} x={mx(i)} y={H - 18} width={Math.max(mw - 1, 1)} height={10} fill='rgba(250,250,250,0.72)' />
                  ))}
                  {s.returns.map((r, i) => {
                    const x1 = mx(monthIdx(r.left)) + mw
                    const x2 = mx(monthIdx(r.back))
                    const mid = (x1 + x2) / 2
                    const lift = Math.min(14, (x2 - x1) / 3)
                    return (
                      <path
                        key={i}
                        d={`M ${x1} ${H - 18} Q ${mid} ${H - 18 - lift} ${x2} ${H - 18}`}
                        fill='none'
                        stroke='rgba(250,250,250,0.45)'
                        strokeWidth={1}
                        strokeDasharray='2 3'
                        vectorEffect='non-scaling-stroke'
                      />
                    )
                  })}
                  {hoverM != null && (
                    <line x1={mx(hoverM)} x2={mx(hoverM)} y1={0} y2={H} stroke='rgba(250,250,250,0.20)' strokeWidth={1} vectorEffect='non-scaling-stroke' />
                  )}
                </svg>
              </div>
              <div className='col-span-2 py-2 text-right'>
                <StateTag>{s.state}</StateTag>
                <span className='label-s mt-0.5 block text-zinc-800'>{s.returns.length ? `${s.returns.length} RETURN${s.returns.length > 1 ? 'S' : ''}` : '—'}</span>
              </div>
            </div>
          )
        })}
        {spans.length > 12 && <div className='label-s py-3 text-zinc-800'>+{spans.length - 12} FURTHER REPOSITORIES ELIDED — ORDERED BY CHURN</div>}
      </div>
      <div className='mt-3 flex flex-wrap gap-x-6 gap-y-1 label-s text-zinc-800'>
        {LIFECYCLE_DEFS.map(([k, d]) => (
          <span key={k}>{k} — {d}</span>
        ))}
      </div>
    </div>
  )
}

/* --------------------- PROJECT CONSTELLATION (INDEX) --------------------- */

export function Constellation({ spans, axis, repoFocus, setRepoFocus, langFocus, onHoverLang, compact = false }) {
  const [tip, setTip] = useState(null)
  const nodes = useMemo(() => {
    const top = spans.slice(0, 24)
    const langOrder = [...new Set(top.map((s) => s.lang || '—'))]
    const maxBytes = Math.max(...top.map((s) => s.bytes), 1)
    const total = Math.max(axis.last - axis.first + 1, 1)
    const byMonth = new Map(top.map((s) => [s.id, new Set(s.months)]))
    const pts = top.map((s, i) => {
      const mid = (s.months[0] + s.months[s.months.length - 1]) / 2
      const hash = [...s.id].reduce((a, c) => a + c.charCodeAt(0), 0)
      const band = langOrder.indexOf(s.lang || '—')
      return {
        ...s,
        x: 40 + ((mid - axis.first) / total) * (W - 80),
        y: 30 + band * 46 + (hash % 3) * 14,
        r: 3 + Math.sqrt(s.bytes / maxBytes) * 13,
      }
    })
    const links = []
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        let shared = 0
        for (const m of byMonth.get(pts[i].id)) if (byMonth.get(pts[j].id).has(m)) shared++
        if (shared >= 2) links.push([pts[i], pts[j], shared])
      }
    }
    return { pts, links }
  }, [spans, axis])
  const H = 300
  return (
    <div>
      <Head
        label='Project Constellation — position by temporal center, banded by language'
        coord={compact ? 'C · 02' : null}
        right={<span className='label-s text-zinc-800 hidden md:inline'>{nodes.pts.length} NODES · {nodes.links.length} TRACES</span>}
      />
      <Fade className='mt-8'>
        <div className='relative border-t border-b border-zinc-900'>
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio='xMidYMid meet' className='w-full' style={{ height: 'auto', maxHeight: compact ? 190 : 340 }}>
            {nodes.links.map(([a, b, shared], i) => (
              <line
                key={i}
                x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                stroke={`${INK}${Math.min(0.05 + shared * 0.012, 0.16).toFixed(3)})`}
                strokeWidth={1}
              />
            ))}
            {nodes.pts.map((p) => {
              const dim = (repoFocus && repoFocus !== p.id) || (langFocus && p.lang !== langFocus)
              return (
                <g
                  key={p.id}
                  className={`transition-opacity duration-300 ${dim ? 'opacity-20' : ''}`}
                  onMouseEnter={() => { setTip(p); setRepoFocus?.(p.id); p.lang && onHoverLang?.(p.lang) }}
                  onMouseLeave={() => { setTip(null); setRepoFocus?.(null); onHoverLang?.(null) }}
                >
                  <circle cx={p.x} cy={p.y} r={p.r} fill='none' stroke={`${INK}0.55)`} strokeWidth={1} />
                  <circle cx={p.x} cy={p.y} r={Math.max(p.r * 0.35, 1.5)} fill={`${INK}${p.state === 'DORMANT' ? '0.18' : '0.55'})`} />
                </g>
              )
            })}
          </svg>
          {tip && (
            <div className='pointer-events-none absolute left-0 top-0 w-full'>
              <div className='mx-auto w-max border border-zinc-800 bg-[var(--app-bg)] px-3 py-2 text-[10px] tracking-[0.12em] text-zinc-400'>
                <span className='text-zinc-200'>{tip.name}</span>
                {tip.lang ? ` · ${tip.lang}` : ''} · {monthName(tip.first)} — {monthName(tip.last)} · {n0(tip.commits)} COMMITS · {n0(tip.churn)} CHURN · {n0(tip.activeDays)} DAYS
              </div>
            </div>
          )}
        </div>
        {!compact && (
          <p className='label-s mt-3 text-zinc-800'>
            Node area ∝ language bytes · brightness = recency · trace = ≥2 months of concurrent activity · rows = primary-language bands
          </p>
        )}
      </Fade>
    </div>
  )
}

/* --------------------------- F · 04 WORK MIGRATION ------------------------ */

export function Migration({ runs }) {
  const shown = runs.slice(-18)
  return (
    <div>
      <Head
        label='Work Migration — dominant repository per month, in sequence'
        coord='F · 04'
        right={<span className='label-s text-zinc-800 hidden md:inline'>{runs.length} TRANSITIONS</span>}
      />
      <div className='mt-8 flex border-t border-b border-zinc-900 overflow-x-auto'>
        {shown.map((r, i) => (
          <div
            key={i}
            className={`min-w-[76px] py-3 ${i ? 'border-l border-zinc-900 pl-3' : 'pr-3'}`}
            style={{ flex: `${Math.max(r.months, 1)} 1 0` }}
            title={`${r.name} · ${monthName(r.from)} — ${monthName(r.to)} · ${r.months}mo${r.concurrentMonths ? ` · ${r.concurrentMonths} concurrent` : ''}`}
          >
            <span className='figure block truncate text-[14px] text-zinc-300'>{r.name}</span>
            <span className='label-s mt-0.5 block text-zinc-800'>
              {r.months}MO{r.concurrentMonths ? ` · ${r.concurrentMonths} SHARED` : ''}
            </span>
          </div>
        ))}
      </div>
      <p className='label-s mt-3 text-zinc-800'>
        {runs.length > 18 ? `Showing latest 18 of ${runs.length} runs · ` : ''}SHARED = second repository ≥30% of the month's commits
      </p>
    </div>
  )
}

/* ---------------- CREATION ↔ REVISION + CHANGE DENSITY ------------------- */

export function Continuum({ added, deleted, prevAdded, prevDeleted, compare, commits, activeDays }) {
  const churn = added + deleted
  const pos = churn ? added / churn : 0.5
  const prevChurn = prevAdded + prevDeleted
  const prevPos = prevChurn ? prevAdded / prevChurn : null
  return (
    <div>
      <Head label='Creation ↔ Revision — share of churn that is additive' coord={null} />
      <div className='mt-10 relative'>
        <div className='flex justify-between label-s text-zinc-600'>
          <span>CREATION</span>
          <span>REVISION</span>
        </div>
        <div className='relative mt-4 h-px bg-zinc-800'>
          {[0.25, 0.5, 0.75].map((p) => (
            <span key={p} className='absolute top-1/2 -translate-y-1/2 w-px h-2 bg-zinc-800' style={{ left: `${p * 100}%` }} />
          ))}
          {prevPos != null && compare && (
            <span className='absolute -top-3 w-px h-4 border-l border-dashed border-zinc-600' style={{ left: `${prevPos * 100}%` }} />
          )}
          <motion.span
            className='absolute -top-2 w-px h-5 bg-zinc-100'
            animate={{ left: `${pos * 100}%` }}
            transition={{ duration: 0.9, ease: ease.out }}
          />
        </div>
        <div className='mt-3 flex justify-between items-baseline'>
          <span className='label-s text-zinc-800'>{Math.round(pos * 100)}% ADDITIVE{compare && prevPos != null ? ` · PRIOR ${Math.round(prevPos * 100)}%` : ''}</span>
          <span className='label-s text-zinc-800 tabular-nums'>
            CHANGE DENSITY — {activeDays ? n0(churn / activeDays) : '—'} LINES/ACTIVE-DAY · {commits ? n0(churn / commits) : '—'} LINES/COMMIT
          </span>
        </div>
      </div>
    </div>
  )
}

/* ------------------------ F · 01 DEVELOPMENT FINGERPRINT ------------------ */

export function Fingerprint({ dims, rangeLabel }) {
  const reduced = useReducedMotion()
  const cx = 170, cy = 170
  return (
    <div>
      <Head
        label='Development Fingerprint — structural signature of the selected period'
        coord='F · 01'
        right={<span className='label-s text-zinc-800'>{rangeLabel}</span>}
      />
      <div className='mt-8 grid grid-cols-12 gap-x-8 gap-y-8 items-center'>
        <Fade className='col-span-12 md:col-span-5'>
          <svg viewBox='0 0 340 340' className='w-full max-w-[340px] mx-auto' role='img' aria-label={`Development fingerprint: ${dims.map((d) => `${d.label} ${(d.value * 100).toFixed(0)}%`).join(', ')}`}>
            {dims.map((d, i) => {
              const r = 34 + i * 14.5
              return (
                <g key={d.key}>
                  <circle cx={cx} cy={cy} r={r} fill='none' stroke='rgba(250,250,250,0.05)' strokeWidth={5} />
                  <motion.path
                    key={`${d.key}-${d.value.toFixed(3)}`}
                    d={arc(cx, cy, r, d.value * 360)}
                    fill='none'
                    stroke={`${INK}${(0.4 + d.value * 0.5).toFixed(2)})`}
                    strokeWidth={5}
                    initial={reduced ? false : { pathLength: 0 }}
                    whileInView={reduced ? undefined : { pathLength: 1 }}
                    viewport={{ once: true, amount: 0.4 }}
                    transition={{ duration: 1.1, delay: i * 0.07, ease: [0.33, 1, 0.4, 1] }}
                  />
                </g>
              )
            })}
          </svg>
        </Fade>
        <div className='col-span-12 md:col-span-7 grid grid-cols-1 sm:grid-cols-3 gap-x-12 lg:gap-x-14 min-w-0'>
          {dims.map((d, i) => (
            <div key={d.key} className={`py-6 border-t border-zinc-900 min-w-0 ${i % 3 ? 'sm:border-l sm:border-zinc-900 sm:pl-7' : ''}`}>
              <span className='label-s text-zinc-700'>{String(i + 1).padStart(2, '0')} · {d.label}</span>
              <div className='mt-3 figure text-[clamp(24px,1.9vw,30px)] font-light leading-none text-zinc-100 tabular-nums'>{(d.value * 100).toFixed(0)}</div>
              <div className='mt-2 label-s leading-relaxed text-zinc-600'>{d.raw}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/* --------------------------- F · 05 BODY OF WORK SPAN --------------------- */

export function WorkSpan({ span, spans, languages }) {
  if (!span) return null
  const months = span.firstActive && span.lastActive
    ? Math.max(monthIdx(span.lastActive.slice(0, 7)) - monthIdx(span.firstActive.slice(0, 7)) + 1, 1)
    : 0
  const yrs = Math.floor(months / 12)
  const spanTxt = yrs >= 1 ? `${yrs}Y ${months - yrs * 12}M` : `${months}M`
  const states = { ACTIVE: 0, REVIVED: 0, QUIESCENT: 0, DORMANT: 0 }
  for (const s of spans) states[s.state] = (states[s.state] || 0) + 1
  const rows = [
    ['FIRST OBSERVED', span.firstActive || '—'],
    ['LATEST OBSERVED', span.lastActive || '—'],
    ['OBSERVED SPAN', spanTxt],
    ['TOTAL COMMITS', n0(span.totalCommits)],
    ['ACTIVE DAYS', n0(span.activeDays)],
    ['REPOSITORIES', n0(spans.length)],
    ['ACTIVE / REVIVED', `${states.ACTIVE} / ${states.REVIVED}`],
    ['LANGUAGES OBSERVED', n0(languages)],
  ]
  return (
    <div>
      <Head label='Body of Work Span — archival record' coord='F · 05' />
      <div className='mt-8 grid grid-cols-2 lg:grid-cols-4 border-t border-zinc-900'>
        {rows.map(([k, v], i) => (
          <div key={k} className={`py-5 border-b border-zinc-900 ${i % 2 ? 'border-l border-zinc-900 pl-5' : 'pr-5'} ${i % 4 ? 'lg:border-l lg:pl-5' : 'lg:border-l-0 lg:pl-0 lg:pr-5'}`}>
            <span className='label-s text-zinc-700'>{k}</span>
            <span className='figure mt-1.5 block text-[22px] font-light text-zinc-100 tabular-nums'>{v}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/* --------------------------------- REGION -------------------------------- */

/* Shared derivation — the scroll Overview's archive/index chapters consume
   the same stored-history model as the stacked Shape layout. */
export function useShapeDerived(data, range) {
  const s = data?.summary || {}
  const gh = data?.github || {}
  return useMemo(() => {
    const ws = data?.workShape
    if (!ws?.repoMonthly?.length) return null
    const repos = data?.repositories || []
    const repoById = new Map(repos.map((r) => [r.id, r]))
    const repoLangs = new Map(Object.entries(ws.repoLangs || {}))
    const idxs = ws.repoMonthly.map((m) => monthIdx(m.month))
    const axis = { first: Math.min(...idxs), last: Math.max(...idxs) }
    const spanIdxs = []
    for (let i = axis.first; i <= axis.last; i++) spanIdxs.push(i)
    const nowIdx = monthIdx(new Date().toISOString().slice(0, 7))
    const spans = buildRepoSpans(ws.repoMonthly, repos, nowIdx)
    const activeRepos = repos.filter((r) => r.commits > 0)
    const topShare = commitsShare(activeRepos)
    const langTotal = (data.languages || []).reduce((a, l) => a + (l.code || 0), 0) || 1
    return {
      axis,
      spans,

      strata: buildLangStrata(ws.repoMonthly, repoLangs),
      runs: buildMigration(ws.repoMonthly, repoById, spanIdxs),
      dims: buildFingerprint({
        commits: s.commits || 0,
        added: s.sourceAdded || 0,
        deleted: s.sourceDeleted || 0,
        activeDays: s.activeDays || 0,
        rangeDays: Math.max(rangeDayCount(range), 1),
        reposWithActivity: { count: activeRepos.length, topShare },
        totalRepos: repos.length,
        prs: gh.pullRequests || 0,
        langShares: (data.languages || []).map((l) => (l.code || 0) / langTotal),
      }),
      span: ws.span,
      langCount: (data.languages || []).length,
    }
    function commitsShare(rs) {
      const total = rs.reduce((a, r) => a + r.commits, 0) || 1
      return Math.max(...rs.map((r) => r.commits), 0) / total
    }
    function rangeDayCount(r) {
      if (r.mode === 'all') return Math.round(Math.max(axis.last - axis.first + 1, 1) * 30.4)
      const f = r.from ? new Date(r.from + 'T00:00:00Z') : null
      const t = r.to ? new Date(r.to + 'T00:00:00Z') : new Date()
      return f ? Math.max(Math.round((t - f) / 86400000) + 1, 1) : 365
    }
  }, [data, range, s.commits, s.sourceAdded, s.sourceDeleted, s.activeDays, gh.pullRequests])
}

export default function Shape({ data, range, compare, compareData, rangeLabel, langFocus, onHoverLang, repoFocus, setRepoFocus }) {
  const [hoverM, setHoverM] = useState(null)
  const s = data?.summary || {}
  const derived = useShapeDerived(data, range)

  if (!derived) {
    return (
      <section className='py-14'>
        <Head label='The Shape of Your Work' coord='F · 00' />
        <p className='label-s mt-8 text-zinc-700'>INSUFFICIENT STORED HISTORY — THE FIELD RESOLVES ONCE COMMIT DATA EXISTS</p>
      </section>
    )
  }

  return (
    <section className='pt-16'>
      <div className='flex items-end justify-between gap-4 pb-10'>
        <div>
          <span className='label-s text-zinc-700'>F · 00 — LONGITUDINAL RECORD</span>
          <h2 className='figure mt-3 text-[clamp(34px,4.5vw,58px)] font-light leading-none text-zinc-50 tracking-[-0.03em]'>
            The Shape of Your Work
          </h2>
          <p className='mt-4 max-w-xl text-[13px] leading-relaxed text-zinc-600'>
            Not how much — how. These fields read the entire stored history: where focus concentrated,
            when repositories went quiet and returned, and which languages carried each period.
          </p>
        </div>
        <Coord>{monthName(idxMonth(derived.axis.first))} — {monthName(idxMonth(derived.axis.last))}</Coord>
      </div>

      <Rise><Strata strata={derived.strata} axis={derived.axis} langFocus={langFocus} onHoverLang={onHoverLang} hoverM={hoverM} setHoverM={setHoverM} /></Rise>
      <DrawHR className='my-12' />
      <Rise><Lifecycle spans={derived.spans} axis={derived.axis} hoverM={hoverM} repoFocus={repoFocus} setRepoFocus={setRepoFocus} /></Rise>
      <DrawHR className='my-12' />
      <Rise><Constellation spans={derived.spans} axis={derived.axis} repoFocus={repoFocus} setRepoFocus={setRepoFocus} langFocus={langFocus} onHoverLang={onHoverLang} /></Rise>
      <DrawHR className='my-12' />
      <Rise><Migration runs={derived.runs} /></Rise>
      <DrawHR className='my-12' />
      <div className='grid grid-cols-12 gap-x-8 gap-y-12'>
        <Rise className='col-span-12 lg:col-span-5'>
          <Continuum
            added={s.sourceAdded || 0}
            deleted={s.sourceDeleted || 0}
            prevAdded={compareData?.summary?.sourceAdded || 0}
            prevDeleted={compareData?.summary?.sourceDeleted || 0}
            compare={compare}
            commits={s.commits || 0}
            activeDays={s.activeDays || 0}
          />
        </Rise>
        <Rise className='col-span-12 lg:col-span-7 lg:border-l lg:border-zinc-900 lg:pl-10'>
          <Fingerprint dims={derived.dims} rangeLabel={rangeLabel} />
        </Rise>
      </div>
      <DrawHR className='my-12' />
      <Rise><WorkSpan span={derived.span} spans={derived.spans} languages={derived.langCount} /></Rise>
    </section>
  )
}
