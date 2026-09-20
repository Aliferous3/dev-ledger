import React, { useMemo } from 'react'
import { motion } from 'framer-motion'
import { useReducedMotion } from './motion'
import { useScrubIndex, ScrubMark, ScrubReadout, ScrubValue, SCRUB_TOUCH } from './GraphScrub'
import { smoothPath } from './primitives'
import { monthName } from './shape'

// Retained verbatim from the Quiet Instrument overview — the Historical Lanes
// block: COMMITS / PULL REQUESTS / NET LINES sharing one scrubbed axis.

const LANE_W = 1000

const today = () => {
  const d = new Date()
  d.setUTCHours(0, 0, 0, 0)
  return d.toISOString().slice(0, 10)
}

function rangeDays(range) {
  if (range.mode === 'all') return 365
  const s = new Date((range.from || today()) + 'T00:00:00Z')
  const e = new Date((range.to || today()) + 'T00:00:00Z')
  return Math.max(1, Math.round((e - s) / 86400000) + 1)
}

const MONTHS_L = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
const dateLabel = (iso) => {
  const d = new Date(`${iso}T00:00:00Z`)
  return `${MONTHS_L[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`
}

/* Bucket key → readout label at the bucket's own granularity: 'YYYY-MM' for
   monthly lanes, 'YYYY-MM-DD' week-start for weekly lanes. */
const bucketLabel = (k) => (k.length === 7 ? monthName(k) : dateLabel(k))

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

export function HistoricalLanes({ daily, prsDaily, range, draw = null }) {
  const series = useMemo(() => denseDaily(range, daily, prsDaily), [range, daily, prsDaily])
  const lanes = useMemo(() => {
    const pick = rangeDays(range) <= 49 ? weeklyBuckets : monthlyBuckets
    return [
      { label: 'COMMITS', unit: 'COMMITS', prefix: '', buckets: pick(series, (d) => d.commits) },
      { label: 'PULL REQUESTS', unit: 'PRS', prefix: '', buckets: pick(series, (d) => d.opened) },
      { label: 'NET LINES', unit: 'NET LINES', prefix: '+', buckets: pick(series, (d) => Math.max(0, d.net)) },
    ]
  }, [series, range])
  const laneH = 44
  return (
    <div>
      <div className='mb-3 flex items-baseline justify-between'>
        <span className='label-s text-zinc-600'>HISTORICAL LANES</span>
        <span className='label-s text-zinc-800'>SHARED AXIS</span>
      </div>
      <div className='flex'>
        <div className='w-24 shrink-0 border-r border-zinc-900'>
          {lanes.map((l) => (
            <div key={l.label} className='flex items-center font-mono text-[9px] tracking-wider text-zinc-600' style={{ height: laneH }}>
              {l.label}
            </div>
          ))}
        </div>
        <div className='relative flex-1'>
          {lanes.map((l, i) => (
            <LaneChart key={l.label} lane={l} height={laneH} sep={i > 0} draw={draw} />
          ))}
        </div>
      </div>
      <div className='mt-2 flex justify-between border-t border-zinc-900 pt-2 font-mono text-[9px] text-zinc-700'>
        <span>{range.from || 'FIRST OBSERVED'}</span>
        <span>OBSERVATIONS SHARE ONE BASELINE</span>
        <span>{range.to || 'PRESENT'}</span>
      </div>
    </div>
  )
}
