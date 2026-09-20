import React, { useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { AnimatedNumber } from './AnimatedNumber'
import { useReducedMotion } from './motion'

const fmt = new Intl.NumberFormat('en-US')
const stringN = (v) => (v == null ? '—' : fmt.format(Number(v)))
const n = (v) => <AnimatedNumber value={v} />
const compact = (v) => <AnimatedNumber value={v} compact />

const monthShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function levelFor(day) {
  const c = day.data ? day.data.commits || 0 : 0
  if (c === 0) return 0
  if (c >= 50) return 5
  if (c >= 20) return 4
  if (c >= 8) return 3
  if (c >= 4) return 2
  return 1
}

const opacityByLevel = [0.06, 0.12, 0.28, 0.48, 0.72, 0.96]

function monthLabelsFor(weeks) {
  const labels = []
  let lastMonth = ''
  for (let w = 0; w < weeks.length; w++) {
    const first = weeks[w][0]
    const m = first && first.date ? monthShort[new Date(first.date + 'T00:00:00Z').getMonth()] : ''
    if (m && m !== lastMonth) {
      labels.push({ w, m })
      lastMonth = m
    } else {
      labels.push({ w, m: '' })
    }
  }
  return labels
}

export function buildHeatmap(daily, count = 365, end = new Date()) {
  const map = new Map()
  for (const d of daily || []) map.set(d.date, d)
  const days = []
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(end)
    d.setUTCDate(d.getUTCDate() - i)
    const iso = d.toISOString().slice(0, 10)
    days.push({ date: iso, data: map.get(iso) || { commits: 0, added: 0, deleted: 0, changed: 0 } })
  }
  const weeksNeeded = Math.ceil(count / 7)
  const weeks = []
  for (let w = 0; w < weeksNeeded; w++) {
    const col = []
    for (let r = 0; r < 7; r++) {
      const idx = w * 7 + r
      col.push(idx < days.length ? days[idx] : { date: '', data: { commits: 0 } })
    }
    weeks.push(col)
  }
  return weeks
}

export function ContributionField({ weeks, title, sub, gutter = false }) {
  const [hover, setHover] = useState(null)
  const labels = useMemo(() => monthLabelsFor(weeks), [weeks])
  const reduced = useReducedMotion()

  const onEnter = (day, e) => {
    setHover({
      day,
      x: e.clientX,
      y: e.clientY,
      w: window.innerWidth,
      h: window.innerHeight,
    })
  }
  const onMove = (e) => {
    setHover((h) => (h ? { ...h, x: e.clientX, y: e.clientY } : null))
  }
  const onLeave = () => setHover(null)

  const tooltipStyle = (() => {
    if (!hover) return {}
    const { x, y, w, h } = hover
    const tw = 220
    const th = 130
    let left = x + 12
    let top = y + 12
    if (left + tw > w) left = x - tw - 12
    if (top + th > h) top = y - th - 12
    return { left, top, position: 'fixed' }
  })()

  const hoveredDate = hover?.day?.date
  const hoveredData = hover?.day?.data || {}

  return (
    <section className={title || sub ? 'mt-14' : ''} onMouseLeave={onLeave}>
      {(title || sub) && (
        <div className='flex items-baseline justify-between'>
          <div className='label-s'>{title || 'Daily Contribution Field'}</div>
          <span className='text-[10px] uppercase tracking-[0.2em] text-zinc-700'>{sub}</span>
        </div>
      )}
      <div className='mt-6 flex gap-[2px] sm:gap-[3px] overflow-x-auto'>
        {gutter && (
          <div className='flex flex-col gap-[2px] sm:gap-[3px] pr-1 shrink-0'>
            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
              <span key={i} className='h-[13px] w-3 leading-[13px] text-[8px] uppercase tracking-[0.1em] text-zinc-800 text-right'>
                {d}
              </span>
            ))}
          </div>
        )}
        {weeks.map((col, w) => (
          <div key={w} className='flex flex-1 min-w-[3px] sm:min-w-[6px] flex-col gap-[2px] sm:gap-[3px]'>
            {col.map((day, d) => {
              const level = day.date ? levelFor(day) : 0
              const isActive = hoveredDate === day.date
              const idx = w * 7 + d
              return (
                <motion.div
                  key={day.date || `${w}-${d}`}
                  onMouseEnter={(e) => onEnter(day, e)}
                  onMouseMove={onMove}
                  onMouseLeave={onLeave}
                  className='h-[13px] w-full'
                  initial={{ opacity: 0, scale: 0.92 }}
                  animate={{
                    opacity: opacityByLevel[level],
                    scale: 1,
                    filter: isActive ? 'brightness(1.22)' : 'brightness(1)',
                  }}
                  whileHover={{ scale: 1.18, filter: 'brightness(1.18)' }}
                  transition={
                    reduced
                      ? { duration: 0 }
                      : { delay: Math.min(idx * 0.0015, 0.5), duration: 0.18, ease: [0.23, 1, 0.32, 1] }
                  }
                  style={{
                    background: '#fafafa',
                    boxShadow: isActive ? '0 0 0 1px rgba(255,255,255,0.45)' : 'none',
                    zIndex: isActive ? 10 : 1,
                  }}
                  role='button'
                  tabIndex={0}
                  aria-label={day.date ? `${day.date}: ${hoveredData.commits || 0} commits` : ''}
                />
              )
            })}
          </div>
        ))}
      </div>
      <div
        className={`mt-3 flex justify-between text-[8px] sm:text-[9.5px] uppercase tracking-[0.14em] sm:tracking-[0.24em] text-zinc-700 ${gutter ? 'pl-[18px] sm:pl-[19px]' : ''}`}
      >
        {labels.map((x, i) => (
          <span
            key={i}
            style={{ width: `${100 / weeks.length}%` }}
            className={x.w >= weeks.length - 2 ? 'text-right' : x.w <= 1 ? 'text-left' : 'text-center'}
          >
            {x.m}
          </span>
        ))}
      </div>

      <AnimatePresence>
        {hover && (
          <motion.div
            className='fixed z-50 border border-zinc-800 bg-[var(--app-bg)] p-3 shadow-sm pointer-events-none'
            style={tooltipStyle}
            initial={{ opacity: 0, y: 4, filter: 'blur(2px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            exit={{ opacity: 0, y: 4 }}
            transition={reduced ? { duration: 0 } : { duration: 0.14, ease: [0.23, 1, 0.32, 1] }}
          >
            <div className='text-[10px] uppercase tracking-[0.26em] text-zinc-500'>
              {hoveredDate
                ? new Date(hoveredDate + 'T00:00:00Z').toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })
                : '—'}
            </div>
            <div className='mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[12px] leading-tight'>
              <span className='text-zinc-600 uppercase tracking-[0.16em]'>Commits</span>
              <span className='text-right tabular-nums text-zinc-100 figure'>{n(hoveredData.commits)}</span>
              <span className='text-zinc-600 uppercase tracking-[0.16em]'>Added</span>
              <span className='text-right tabular-nums text-zinc-100 figure'>+{n(hoveredData.added)}</span>
              <span className='text-zinc-600 uppercase tracking-[0.16em]'>Deleted</span>
              <span className='text-right tabular-nums text-zinc-100 figure'>−{n(hoveredData.deleted)}</span>
              <span className='text-zinc-600 uppercase tracking-[0.16em]'>Churn</span>
              <span className='text-right tabular-nums text-zinc-100 figure'>{compact(hoveredData.changed)}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}
