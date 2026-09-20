import React from 'react'
import { motion } from 'framer-motion'
import { useReducedMotion } from './motion'

// Data Canvas primitives adapted to Dev Ledger's production palette and
// reduced-motion contract. Rules draw (scaleX/scaleY), lines draw
// (pathLength), groups rise — all disabled under prefers-reduced-motion.

const EASE = [0.22, 1, 0.36, 1]
const RULE = '#18181b'
const RULE_STRONG = 'rgba(250,250,250,0.28)'

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

/* --------------------------- chart geometry ----------------------- */

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
