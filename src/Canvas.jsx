import React, { useMemo, useState } from 'react'
import { motion, useTransform, useMotionValue } from 'framer-motion'
import { useReducedMotion } from './motion'
import { AnimatedNumber } from './AnimatedNumber'
import { useScrubIndex, ScrubMark, ScrubReadout, ScrubValue, SCRUB_TOUCH } from './GraphScrub'

// Data Canvas primitives adapted to Dev Ledger's production palette and
// reduced-motion contract. Rules draw (scaleX/scaleY), lines draw
// (pathLength), groups rise — all disabled under prefers-reduced-motion.

const EASE = [0.22, 1, 0.36, 1]
const fmt = new Intl.NumberFormat('en-US')
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

export function smoothPath(points) {
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

export function GrowthLine({ values, labels = null, prior = null, height = 280, empty = false, className, onScrub, scrub = null, mirror = null, draw = null }) {
  const reduced = useReducedMotion()
  const { hover, frac, snapFrac, bind } = useScrubIndex(values.length, onScrub)
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

  // When `draw` drives the reveal, clip the whole inked group (stroke + area +
  // prior) to the same progress so the fill can never outrun its line.
  const fallbackDraw = useMotionValue(1)
  const clipInset = useTransform(draw || fallbackDraw, (v) => `inset(0 ${(1 - v) * 100}% 0 0)`)

  return (
    <div
      className={`relative w-full select-none ${className || ''}`}
      style={SCRUB_TOUCH}
      {...bind}
    >
      <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio='none' className='w-full' style={{ height }}>
        {[0.25, 0.5, 0.75].map((p) => (
          <line key={p} x1={0} x2={W} y1={height * p} y2={height * p} stroke='rgba(250,250,250,0.05)' strokeWidth={1} vectorEffect='non-scaling-stroke' />
        ))}
        <line x1={0} x2={W} y1={height - 1} y2={height - 1} stroke='rgba(250,250,250,0.16)' strokeWidth={1} vectorEffect='non-scaling-stroke' />
        {draw ? (
          <motion.g style={{ clipPath: clipInset }}>
            {!empty && <path d={area} fill='rgba(250,250,250,0.04)' />}
            {pts.pri && !empty && (
              <path d={pline} fill='none' stroke='rgba(250,250,250,0.30)' strokeWidth={1} strokeDasharray='3 4' vectorEffect='non-scaling-stroke' />
            )}
            <path d={empty ? `M 0 ${height - 1} L ${W} ${height - 1}` : line} fill='none' stroke='rgba(250,250,250,0.9)' strokeWidth={1.25} vectorEffect='non-scaling-stroke' />
          </motion.g>
        ) : (
          <>
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
          </>
        )}
        {scrub != null && (
          <line x1={scrub * W} x2={scrub * W} y1={0} y2={height} stroke='rgba(250,250,250,0.16)' strokeWidth={1} vectorEffect='non-scaling-stroke' />
        )}
        {frac != null && (
          <ScrubMark guideX={frac * W} x={pts.cur[hover]?.x} y={pts.cur[hover]?.y} height={height} />
        )}
        {mirror != null && frac == null && (
          <ScrubMark guideX={mirror.frac * W} x={pts.cur[mirror.index]?.x} y={pts.cur[mirror.index]?.y} height={height} />
        )}
      </svg>
      {hover != null && values[hover] != null && (
        <ScrubReadout frac={snapFrac} label={labels?.[hover]}>
          <ScrubValue v={values[hover]} prefix={values[hover] >= 0 ? '+' : '−'} />
          {prior && prior[hover] != null && (
            <span className='text-zinc-600'> · prior {prior[hover] >= 0 ? '+' : '−'}{Math.abs(prior[hover]).toLocaleString('en-US')}</span>
          )}
        </ScrubReadout>
      )}
    </div>
  )
}

/* ------------------- daily net change stem field -------------------- */

/* FIG. B — per-day net source change around a zero baseline. Same temporal
   domain and i/(n-1) observation mapping as GrowthLine, so a shared scrub
   index resolves the same date in both figures. Stems are a single compound
   path per sign — cheap at ~1000+ daily observations; hover always resolves
   to one individual day. */
export function DailyStems({ rows, height = 110, draw = null, onScrub, mirror = null, className }) {
  const n = rows.length
  const { hover, frac, snapFrac, bind } = useScrubIndex(n, onScrub)

  const geo = useMemo(() => {
    const up = Math.max(0, ...rows.map((r) => r.net))
    const dn = Math.min(0, ...rows.map((r) => r.net))
    const span = Math.max(up - dn, 1)
    const y0 = 6 + (up / span) * (height - 12) // zero baseline
    const y = (v) => y0 - (v / span) * (height - 12)
    const x = (i) => (i / Math.max(n - 1, 1)) * W
    const bw = Math.min(Math.max((W / Math.max(n, 1)) * 0.62, 0.8), 5)
    let pos = ''
    let neg = ''
    rows.forEach((r, i) => {
      if (!r.net) return
      const xi = x(i)
      const seg = `M ${xi.toFixed(2)} ${y0.toFixed(2)} L ${xi.toFixed(2)} ${y(r.net).toFixed(2)}`
      if (r.net > 0) pos += seg
      else neg += seg
    })
    return { y0, y, x, bw, pos, neg, empty: up === 0 && dn === 0 }
  }, [rows, height, n])

  const fallbackDraw = useMotionValue(1)
  const clipInset = useTransform(draw || fallbackDraw, (v) => `inset(0 ${(1 - v) * 100}% 0 0)`)

  const day = hover != null ? rows[hover] : null
  const mir = mirror != null && frac == null ? mirror : null

  return (
    <div className={`relative w-full select-none ${className || ''}`} style={SCRUB_TOUCH} {...bind}>
      <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio='none' className='w-full' style={{ height }}>
        <line x1={0} x2={W} y1={geo.y0} y2={geo.y0} stroke='rgba(250,250,250,0.18)' strokeWidth={1} vectorEffect='non-scaling-stroke' />
        <motion.g style={draw ? { clipPath: clipInset } : undefined}>
          <path d={geo.pos} stroke='rgba(250,250,250,0.72)' strokeWidth={geo.bw} vectorEffect='non-scaling-stroke' />
          <path d={geo.neg} stroke='rgba(250,250,250,0.3)' strokeWidth={geo.bw} vectorEffect='non-scaling-stroke' />
        </motion.g>
        {frac != null && (
          <ScrubMark guideX={frac * W} x={geo.x(hover)} y={geo.y(rows[hover]?.net || 0)} height={height} />
        )}
        {mir != null && (
          <ScrubMark guideX={mir.frac * W} x={geo.x(mir.index)} y={geo.y(rows[mir.index]?.net || 0)} height={height} />
        )}
      </svg>
      {day && (
        <ScrubReadout frac={snapFrac} label={day.date}>
          <div className='flex flex-col gap-0.5 text-left'>
            <span className='text-zinc-300'>+{fmt.format(day.added)} ADDED</span>
            <span className='text-zinc-500'>−{fmt.format(day.deleted)} DELETED</span>
            <span className='text-zinc-100'>{day.net >= 0 ? '+' : '−'}<AnimatedNumber value={Math.abs(day.net)} /> NET</span>
          </div>
        </ScrubReadout>
      )}
    </div>
  )
}

/* --------------------------- generic series ----------------------- */

export function SeriesLine({ values, height = 96, dashed = false, className, scrub = null, onScrub, draw = null }) {
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
          {...(draw
            ? { style: { pathLength: draw } }
            : {
                initial: reduced ? false : { pathLength: 0 },
                whileInView: reduced ? undefined : { pathLength: 1 },
                viewport: { once: true, amount: 0.3 },
                transition: { duration: 1.3, ease: [0.33, 1, 0.4, 1] },
              })}
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
