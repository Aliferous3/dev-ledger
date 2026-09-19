import React, { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { useReducedMotion } from './motion'

// Data Canvas primitives adapted to Dev Ledger's production palette and
// reduced-motion contract. Rules draw (scaleX/scaleY), lines draw
// (pathLength), groups rise — all disabled under prefers-reduced-motion.

const EASE = [0.22, 1, 0.36, 1]
const RULE = '#18181b'
const RULE_STRONG = 'rgba(250,250,250,0.28)'
const INK = 'rgba(250,250,250,'

/* ------------------------- reveal motion ------------------------- */

export function Rise({ children, delay = 0, y = 16, amount = 0.4, className }) {
  const reduced = useReducedMotion()
  return (
    <motion.div
      className={className}
      initial={reduced ? false : { opacity: 0, y }}
      whileInView={reduced ? undefined : { opacity: 1, y: 0 }}
      viewport={{ once: true, amount }}
      transition={{ duration: 0.85, ease: EASE, delay }}
    >
      {children}
    </motion.div>
  )
}

export function Fade({ children, delay = 0, duration = 0.8, className }) {
  const reduced = useReducedMotion()
  return (
    <motion.div
      className={className}
      initial={reduced ? false : { opacity: 0 }}
      whileInView={reduced ? undefined : { opacity: 1 }}
      viewport={{ once: true, amount: 0.3 }}
      transition={{ duration, ease: 'easeOut', delay }}
    >
      {children}
    </motion.div>
  )
}

export function ClipText({ children, delay = 0, amount = 0.9, className }) {
  const reduced = useReducedMotion()
  return (
    <span className={`inline-block overflow-hidden align-bottom ${className || ''}`}>
      <motion.span
        className='inline-block will-change-transform'
        initial={reduced ? false : { y: '115%' }}
        whileInView={reduced ? undefined : { y: 0 }}
        viewport={{ once: true, amount }}
        transition={{ duration: 0.9, ease: EASE, delay }}
      >
        {children}
      </motion.span>
    </span>
  )
}

/* --------------------- drawing structural rules ------------------- */

export function DrawHR({ className, delay = 0, strong = false, origin = 'left' }) {
  const reduced = useReducedMotion()
  return (
    <motion.div
      aria-hidden
      className={`h-px w-full ${className || ''}`}
      style={{ originX: origin === 'center' ? 0.5 : 0, background: strong ? RULE_STRONG : RULE }}
      initial={reduced ? false : { scaleX: 0 }}
      whileInView={reduced ? undefined : { scaleX: 1 }}
      viewport={{ once: true, amount: 0.3 }}
      transition={{ duration: 1.1, ease: EASE, delay }}
    />
  )
}

export function DrawVR({ className, delay = 0, strong = false }) {
  const reduced = useReducedMotion()
  return (
    <motion.div
      aria-hidden
      className={`w-px self-stretch ${className || ''}`}
      style={{ originY: 0, background: strong ? RULE_STRONG : RULE }}
      initial={reduced ? false : { scaleY: 0 }}
      whileInView={reduced ? undefined : { scaleY: 1 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 1.15, ease: EASE, delay }}
    />
  )
}

/* --------------------------- chart geometry ----------------------- */

const W = 1000

function smoothPath(points) {
  if (points.length < 2) return ''
  let d = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] || points[i]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = points[i + 2] || p2
    const c1x = p1.x + (p2.x - p0.x) / 6
    const c1y = p1.y + (p2.y - p0.y) / 6
    const c2x = p2.x - (p3.x - p1.x) / 6
    const c2y = p2.y - (p3.y - p1.y) / 6
    d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`
  }
  return d
}

/* ---------------------- cumulative growth line -------------------- */

export function GrowthLine({ values, prior = null, height = 280, empty = false, className, onScrub, scrub = null }) {
  const reduced = useReducedMotion()
  const [hover, setHover] = useState(null)
  const pts = useMemo(() => {
    const end = Math.max(values[values.length - 1] || 0, prior?.[prior.length - 1] || 0, 1)
    const max = empty ? 1 : end * 1.06
    const to = (vals) =>
      vals.map((v, i) => ({
        x: (i / Math.max(vals.length - 1, 1)) * W,
        y: height - (v / max) * (height - 14) - 4,
      }))
    return { cur: to(values), pri: prior ? to(prior) : null }
  }, [values, prior, height, empty])

  const line = smoothPath(pts.cur)
  const pline = pts.pri ? smoothPath(pts.pri) : ''
  const area = `${line} L ${W} ${height} L 0 ${height} Z`
  const n = values.length

  return (
    <div
      className={`relative w-full select-none ${className || ''}`}
      onMouseLeave={() => { setHover(null); onScrub?.(null) }}
    >
      <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio='none' className='w-full' style={{ height }}>
        {[0.25, 0.5, 0.75].map((p) => (
          <line key={p} x1={0} x2={W} y1={height * p} y2={height * p} stroke='rgba(250,250,250,0.05)' strokeWidth={1} vectorEffect='non-scaling-stroke' />
        ))}
        <line x1={0} x2={W} y1={height - 1} y2={height - 1} stroke='rgba(250,250,250,0.16)' strokeWidth={1} vectorEffect='non-scaling-stroke' />
        {!empty && (
          <motion.path
            d={area}
            fill='rgba(250,250,250,0.04)'
            initial={reduced ? false : { opacity: 0 }}
            whileInView={reduced ? undefined : { opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 1.1, delay: 0.5 }}
          />
        )}
        {pts.pri && !empty && (
          <motion.path
            key={`p-${pline.length}-${pts.pri[pts.pri.length - 1]?.y}`}
            d={pline}
            fill='none'
            stroke='rgba(250,250,250,0.30)'
            strokeWidth={1}
            strokeDasharray='3 4'
            vectorEffect='non-scaling-stroke'
            initial={reduced ? false : { pathLength: 0 }}
            whileInView={reduced ? undefined : { pathLength: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 1.5, ease: 'easeInOut' }}
          />
        )}
        <motion.path
          key={line}
          d={empty ? `M 0 ${height - 1} L ${W} ${height - 1}` : line}
          fill='none'
          stroke='rgba(250,250,250,0.9)'
          strokeWidth={1.25}
          vectorEffect='non-scaling-stroke'
          initial={reduced ? false : { pathLength: 0 }}
          whileInView={reduced ? undefined : { pathLength: 1 }}
          viewport={{ once: true, amount: 0.2 }}
          transition={{ duration: 1.6, ease: [0.33, 1, 0.4, 1] }}
        />
        {scrub != null && (
          <line x1={scrub * W} x2={scrub * W} y1={0} y2={height} stroke='rgba(250,250,250,0.16)' strokeWidth={1} vectorEffect='non-scaling-stroke' />
        )}
        {hover != null && pts.cur[hover] && (
          <g>
            <line x1={pts.cur[hover].x} x2={pts.cur[hover].x} y1={0} y2={height} stroke='rgba(250,250,250,0.22)' strokeWidth={1} vectorEffect='non-scaling-stroke' />
            <circle cx={pts.cur[hover].x} cy={pts.cur[hover].y} r={3.5} fill='#131413' stroke='rgba(250,250,250,0.85)' strokeWidth={1.5} vectorEffect='non-scaling-stroke' />
          </g>
        )}
      </svg>
      {n > 1 && (
        <div className='absolute inset-0 flex' style={{ height }}>
          {values.map((_, i) => (
            <div key={i} className='flex-1' onMouseEnter={() => { setHover(i); onScrub?.(i) }} />
          ))}
        </div>
      )}
      {hover != null && values[hover] != null && (
        <div className='pointer-events-none absolute left-0 right-0 top-0 flex justify-center'>
          <div className='border border-zinc-800 bg-[var(--app-bg)] px-2 py-1 text-[10px] tracking-[0.14em] text-zinc-300 tabular-nums'>
            {values[hover] >= 0 ? '+' : '−'}{Math.abs(values[hover]).toLocaleString('en-US')}
            {prior && prior[hover] != null && (
              <span className='text-zinc-600'> · prior {prior[hover] >= 0 ? '+' : '−'}{Math.abs(prior[hover]).toLocaleString('en-US')}</span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/* --------------------------- generic series ----------------------- */

export function SeriesLine({ values, height = 96, dashed = false, className, scrub = null, onScrub }) {
  const reduced = useReducedMotion()
  const empty = Math.max(...values, 0) === 0
  const max = Math.max(...values, 1) * 1.12
  const pts = values.map((v, i) => ({
    x: (i / Math.max(values.length - 1, 1)) * W,
    y: height - (v / max) * (height - 12) - 5,
  }))
  const d = smoothPath(pts)
  return (
    <div
      className={className}
      onMouseMove={onScrub ? (e) => {
        const r = e.currentTarget.getBoundingClientRect()
        onScrub(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)))
      } : undefined}
      onMouseLeave={onScrub ? () => onScrub(null) : undefined}
    >
      <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio='none' className='w-full' style={{ height }}>
        {[0.33, 0.66].map((p) => (
          <line key={p} x1={0} x2={W} y1={height * p} y2={height * p} stroke='rgba(250,250,250,0.05)' strokeWidth={1} vectorEffect='non-scaling-stroke' />
        ))}
        <line x1={0} x2={W} y1={height - 1} y2={height - 1} stroke='rgba(250,250,250,0.16)' strokeWidth={1} vectorEffect='non-scaling-stroke' />
        <motion.path
          key={d}
          d={empty ? `M 0 ${height - 1} L ${W} ${height - 1}` : d}
          fill='none'
          stroke={`${INK}0.82)`}
          strokeWidth={1.1}
          strokeDasharray={dashed ? '2 4' : undefined}
          vectorEffect='non-scaling-stroke'
          initial={reduced ? false : { pathLength: 0 }}
          whileInView={reduced ? undefined : { pathLength: 1 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 1.3, ease: [0.33, 1, 0.4, 1] }}
        />
        {scrub != null && (
          <line x1={scrub * W} x2={scrub * W} y1={0} y2={height} stroke='rgba(250,250,250,0.20)' strokeWidth={1} vectorEffect='non-scaling-stroke' />
        )}
      </svg>
    </div>
  )
}

/* --------------------- momentum measure bar ------------------------ */

export function MomentumBar({ score, width = 130 }) {
  const reduced = useReducedMotion()
  return (
    <div className='h-px bg-zinc-900 relative' style={{ width }}>
      <motion.div
        className='absolute left-0 top-0 h-px bg-zinc-400 origin-left'
        style={{ width: '100%' }}
        initial={{ scaleX: 0 }}
        animate={{ scaleX: Math.min(Math.max(score, 0), 100) / 100 }}
        transition={reduced ? { duration: 0 } : { duration: 0.9, ease: EASE }}
      />
    </div>
  )
}
