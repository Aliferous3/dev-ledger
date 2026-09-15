import React, { useId, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useReducedMotion } from './motion'

const path = (vals, w, h, pad = 0, smooth = true) => {
  const max = Math.max(...vals, 1)
  const min = Math.min(...vals, 0)
  const x = (i) => (i / (vals.length - 1)) * w
  const y = (v) => pad + (1 - (v - min) / (max - min || 1)) * (h - pad * 2)
  if (!smooth) return vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(' ')
  let d = `M${x(0)},${y(vals[0])}`
  for (let i = 1; i < vals.length; i++) {
    const x0 = x(i - 1), x1 = x(i)
    const cx = (x0 + x1) / 2
    d += ` C${cx},${y(vals[i - 1])} ${cx},${y(vals[i])} ${x1},${y(vals[i])}`
  }
  return d
}

export function Spark({ data, color = '#e2e8f0', w = 120, h = 28, fill = false, width = 1.5 }) {
  const id = useId()
  const d = path(data, w, h, 2)
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-full overflow-visible" preserveAspectRatio="none">
      {fill && (
        <>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.28" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={`${d} L${w},${h} L0,${h} Z`} fill={`url(#${id})`} />
        </>
      )}
      <path d={d} fill="none" stroke={color} strokeWidth={width} vectorEffect="non-scaling-stroke" strokeLinecap="round" />
    </svg>
  )
}

export function AreaChart({
  series,
  labels,
  height = 200,
  grid = true,
  gridColor = 'rgba(148,163,184,0.12)',
  axisColor = '#64748b',
  showAxis = true,
  dashedBaseline = false,
}) {
  const reduced = useReducedMotion()
  const W = 600, H = height
  const [hover, setHover] = useState(null)
  const n = labels.length
  const all = series.flatMap((s) => s.data)
  const max = Math.max(...all, 1)
  const uid = useId()
  const y = (v) => (1 - v / max) * (H - 24) + 6
  const x = (i) => (i / (n - 1)) * W
  return (
    <div className="relative w-full select-none" onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height }} preserveAspectRatio="none">
        {grid && [0, 0.25, 0.5, 0.75, 1].map((g) => (
          <line key={g} x1={0} x2={W} y1={y(max * g)} y2={y(max * g)} stroke={gridColor} strokeWidth={1} vectorEffect="non-scaling-stroke" strokeDasharray={dashedBaseline && g > 0 ? '2 4' : undefined} />
        ))}
        {series.map((s, si) => {
          const d = path(s.data, W, H - 18, 6)
          return (
            <g key={si}>
              {s.fill && (
                <>
                  <defs>
                    <linearGradient id={`${uid}-${si}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={s.color} stopOpacity="0.32" />
                      <stop offset="100%" stopColor={s.color} stopOpacity="0.01" />
                    </linearGradient>
                  </defs>
                  <motion.path
                    d={`${d} L${W},${H - 18} L0,${H - 18} Z`}
                    fill={`url(#${uid}-${si})`}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={reduced ? { duration: 0 } : { duration: 0.75, delay: 0.3, ease: [0.23, 1, 0.32, 1] }}
                  />
                </>
              )}
              <motion.path
                d={d}
                key={d}
                fill="none"
                stroke={s.color}
                strokeWidth={1.75}
                vectorEffect="non-scaling-stroke"
                strokeDasharray={s.dashed ? '4 4' : undefined}
                strokeLinecap="round"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={reduced ? { duration: 0 } : { duration: 0.9, ease: [0.23, 1, 0.32, 1] }}
              />
            </g>
          )
        })}
        {hover !== null && (
          <line x1={x(hover)} x2={x(hover)} y1={0} y2={H - 18} stroke="rgba(226,232,240,0.35)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        )}
        {series.map((s, si) =>
          hover !== null ? (
            <circle key={si} cx={x(hover)} cy={(1 - s.data[hover] / max) * (H - 18 - 12) + 6} r={3.5} fill="#0b0d10" stroke={s.color} strokeWidth={2} vectorEffect="non-scaling-stroke" />
          ) : null
        )}
      </svg>
      <div className="absolute inset-0 flex" style={{ height }}>
        {labels.map((_, i) => (
          <div key={i} className="flex-1" onMouseEnter={() => setHover(i)} />
        ))}
      </div>
      {showAxis && (
        <div className="flex justify-between pt-1.5 text-[10px] tracking-[0.14em] uppercase" style={{ color: axisColor }}>
          {labels.map((l, i) => (
            <motion.span
              key={i}
              className={hover === i ? 'text-slate-200' : ''}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={reduced ? { duration: 0 } : { duration: 0.25, delay: i * 0.02 }}
            >
              {l}
            </motion.span>
          ))}
        </div>
      )}
      <AnimatePresence>
        {hover !== null && (
          <motion.div
            className="pointer-events-none absolute -top-1 left-0 right-0 flex justify-center"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.14, ease: [0.23, 1, 0.32, 1] }}
          >
            <div className="rounded-sm border border-white/10 bg-black/80 px-2 py-1 text-[10px] font-medium text-slate-200 backdrop-blur flex gap-3">
              <span className="text-slate-500">{labels[hover]}</span>
              {series.map((s) => (
                <span key={s.label} style={{ color: s.color }} className="tabular-nums">
                  {s.label} {s.data[hover].toLocaleString()}
                </span>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export function Bars({
  data,
  labels,
  color = '#e2e8f0',
  height = 120,
  rounded = 1,
  gap = 3,
  negative,
  negColor = '#64748b',
  showLabels = true,
  labelColor = '#475569',
}) {
  const reduced = useReducedMotion()
  const [hover, setHover] = useState(null)
  const max = Math.max(...data, ...(negative ?? [0]), 1)
  const hasNeg = !!negative
  return (
    <div>
      <div className="flex items-end w-full" style={{ height, gap }} onMouseLeave={() => setHover(null)}>
        {data.map((v, i) => (
          <div key={i} className="flex-1 flex flex-col justify-end h-full group" onMouseEnter={() => setHover(i)} style={{ justifyContent: hasNeg ? 'center' : 'flex-end' }}>
            <div className="relative flex flex-col justify-end" style={{ height: hasNeg ? '50%' : '100%' }}>
              <motion.div
                className="transition-all duration-300"
                style={{
                  height: `${(v / max) * 100}%`,
                  background: color,
                  borderRadius: `${rounded}px ${rounded}px 0 0`,
                  originY: 1,
                }}
                initial={{ scaleY: 0 }}
                animate={{ scaleY: 1 }}
                whileHover={{ scaleX: 1.06 }}
                transition={
                  reduced
                    ? { duration: 0 }
                    : { duration: 0.55, delay: i * 0.03, ease: [0.23, 1, 0.32, 1] }
                }
              />
            </div>
            {hasNeg && (
              <div style={{ height: '50%' }}>
                <motion.div
                  className="transition-all duration-300"
                  style={{
                    height: `${(negative[i] / max) * 100}%`,
                    background: negColor,
                    borderRadius: `0 0 ${rounded}px ${rounded}px`,
                    originY: 0,
                  }}
                  initial={{ scaleY: 0 }}
                  animate={{ scaleY: 1 }}
                  whileHover={{ scaleX: 1.06 }}
                  transition={
                    reduced
                      ? { duration: 0 }
                      : { duration: 0.55, delay: i * 0.03, ease: [0.23, 1, 0.32, 1] }
                  }
                />
              </div>
            )}
          </div>
        ))}
      </div>
      {showLabels && labels && (
        <div className="flex w-full pt-2 text-[10px] uppercase tracking-[0.12em]" style={{ gap }}>
          {labels.map((l, i) => (
            <span key={i} className="flex-1 text-center tabular-nums" style={{ color: hover === i ? '#e2e8f0' : labelColor }}>
              {l}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
