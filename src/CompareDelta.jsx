import React from 'react'
import { motion } from 'framer-motion'
import { compareMetric, compareDisplay } from './range'
import { useReducedMotion } from './motion'

const fmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 })
const sign = (v) => v > 0 ? '+' : v < 0 ? '−' : ''
const signed = (v) => `${sign(v)}${fmt.format(Math.abs(v))}`
const arrow = (s) => s === 'increase' ? '↑' : s === 'decrease' ? '↓' : s === 'new' ? '·' : '−'

export function CompareDelta({ current, previous, compare, label }) {
  const reduced = useReducedMotion()
  if (!compare) return null
  const cmp = compareMetric(current, previous)
  if (!cmp || cmp.state === 'unavailable' || (current == null && previous == null)) return null
  const tone = cmp.state === 'increase' ? 'text-zinc-200' : cmp.state === 'new' ? 'text-zinc-200' : cmp.state === 'decrease' ? 'text-zinc-600' : 'text-zinc-500'
  const lines = [
    `Current: ${fmt.format(cmp.current)}`,
    `Previous: ${fmt.format(cmp.previous)}`,
    cmp.state === 'new' ? 'New activity' : cmp.state === 'unchanged' ? 'No change' : `Change: ${signed(cmp.delta)}`,
  ]
  if (cmp.pct != null) lines.push(`Percent: ${signed(cmp.pct)}%`)
  const text = cmp.state === 'new' ? 'NEW' : `${arrow(cmp.state)} ${Math.abs(cmp.pct || 0).toFixed(1)}%`
  return (
    <motion.div
      initial={reduced ? {} : { opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduced ? {} : { opacity: 0, y: 4 }}
      transition={{ duration: reduced ? 0 : 0.18 }}
      title={lines.join(' · ')}
      className={`mt-1 flex items-baseline gap-1.5 text-[9px] uppercase tracking-[0.16em] ${tone}`}
    >
      <span className='figure'>{cmp.state === 'new' ? '+' : signed(cmp.delta)}</span>
      <span>{text}</span>
      {label && <span className='text-zinc-700'>{label}</span>}
    </motion.div>
  )
}
