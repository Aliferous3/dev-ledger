import React, { useState, useCallback } from 'react'
import { motion, useReducedMotion } from 'framer-motion'

const easeCurtain = [0.76, 0, 0.24, 1]

export function Curtain({ phase, direction, onCovered, onRevealed, top, label }) {
  if (phase === 'idle') return null
  const from = direction > 0 ? '100%' : '-100%'
  const to = direction > 0 ? '-100%' : '100%'
  return (
    <motion.div
      className='fixed left-0 right-0 bottom-0 z-[90] will-change-transform'
      style={{
        top,
        background: '#f2f2f0',
        borderLeft: direction > 0 ? '1.5px solid rgba(0,0,0,0.16)' : 'none',
        borderRight: direction < 0 ? '1.5px solid rgba(0,0,0,0.16)' : 'none',
      }}
      initial={{ x: from }}
      animate={{ x: phase === 'cover' ? '0%' : to }}
      transition={{
        duration: phase === 'cover' ? 0.36 : 0.43,
        ease: easeCurtain,
      }}
      onAnimationComplete={() => {
        if (phase === 'cover') onCovered()
        if (phase === 'reveal') onRevealed()
      }}
    >
      <motion.div
        className='absolute inset-0 flex items-center justify-center'
        initial={{ opacity: 0, y: 6 }}
        animate={{
          opacity: phase === 'cover' ? 1 : 0,
          y: phase === 'cover' ? 0 : -4,
        }}
        transition={{
          duration: 0.18,
          delay: phase === 'cover' ? 0.22 : 0,
          ease: [0.23, 1, 0.32, 1],
        }}
      >
        <span
          className='text-[#080808] text-[12px] uppercase tracking-[0.45em] font-medium'
          style={{ fontFamily: "'Iowan Old Style','Palatino Linotype','Georgia',serif" }}
        >
          {label}
        </span>
      </motion.div>
    </motion.div>
  )
}

export function useCurtainTransition({ views, initial = views[0] }) {
  const reduced = useReducedMotion()
  const [view, setView] = useState(initial)
  const [phase, setPhase] = useState('idle')
  const [target, setTarget] = useState(null)
  const [pending, setPending] = useState(null)
  const [dir, setDir] = useState(1)

  const transitioning = phase !== 'idle'

  const start = useCallback((next, fromView) => {
    if (next === fromView) return
    const d = views.indexOf(next) - views.indexOf(fromView)
    setTarget(next)
    setDir(d >= 0 ? 1 : -1)
    setPhase('cover')
  }, [views])

  const requestView = useCallback((next) => {
    if (next === view || transitioning) {
      if (transitioning) setPending(next)
      return
    }
    if (reduced) {
      setView(next)
      window.scrollTo({ top: 0, behavior: 'instant' })
      return
    }
    start(next, view)
  }, [view, transitioning, reduced, start])

  const onCovered = useCallback(() => {
    setView(target)
    window.scrollTo({ top: 0, behavior: 'instant' })
    setPhase('reveal')
  }, [target])

  const onRevealed = useCallback(() => {
    setPhase('idle')
    setTarget(null)
    const p = pending
    setPending(null)
    if (p && p !== view) {
      requestAnimationFrame(() => {
        start(p, view)
      })
    }
  }, [pending, view, start])

  return {
    view,
    target,
    requestView,
    transitioning,
    phase,
    direction: dir,
    onCovered,
    onRevealed,
  }
}
