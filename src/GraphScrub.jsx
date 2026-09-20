import React, { useState } from 'react'
import { AnimatedNumber } from './AnimatedNumber'

/* Shared precision-scrub interaction for time-series charts.

   Plot model: these charts stretch `viewBox="0 0 W H"` across the full element
   with preserveAspectRatio="none" and no internal margins, so the plot bounds
   are the element bounds. Pointer math is explicit:

     localX = clientX - rect.left
     frac   = clamp(localX / rect.width, 0, 1)
     index  = round(frac * (n - 1))

   The vertical guide follows the raw pointer continuously; the point marker
   and readout snap to the nearest observation, so the marker always sits on
   the actual rendered series point (same x/y mapping as the path). This fixes
   the previous all-snapped behaviour where monthly-bucket lanes only landed
   the guide on a handful of discrete positions.

   Touch: `touch-action: pan-y` keeps vertical page scroll; horizontal drags
   and taps inside the chart still scrub. */

export const SCRUB_TOUCH = { touchAction: 'pan-y' }

export function useScrubIndex(n, onChange) {
  const [raw, setRaw] = useState(null) // continuous pointer fraction 0–1
  const [hover, setHover] = useState(null) // nearest observation index
  const snapFrac = hover == null || n < 2 ? null : hover / (n - 1)

  const toFrac = (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    if (!r.width) return 0
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
  }
  const move = (e) => {
    const f = toFrac(e)
    setRaw(f)
    const i = n < 2 ? 0 : Math.round(f * (n - 1))
    if (i !== hover) {
      setHover(i)
    }
    // report every move — coupled graphs mirror the continuous fraction, not
    // just snap boundaries
    onChange?.({ frac: f, index: i })
  }
  const bind = {
    onPointerMove: move,
    onPointerDown: move,
    onPointerLeave: () => {
      setRaw(null)
      setHover(null)
      onChange?.(null)
    },
  }
  return { hover, frac: raw, snapFrac, bind }
}

// SVG guide + active point. `guideX` is the continuous pointer x; the point
// marker uses the snapped series coordinates so it stays exactly on the line.
export function ScrubMark({ guideX, x, y, height }) {
  return (
    <g pointerEvents='none'>
      <line x1={guideX} x2={guideX} y1={0} y2={height} stroke='rgba(250,250,250,0.22)' strokeWidth={1} vectorEffect='non-scaling-stroke' />
      {x != null && y != null && (
        <circle cx={x} cy={y} r={3.5} fill='#131413' stroke='rgba(250,250,250,0.85)' strokeWidth={1.5} vectorEffect='non-scaling-stroke' />
      )}
    </g>
  )
}

// Floating readout: hairline-bordered, translates with the snapped point,
// clamps at the plot edges. Stays mounted for the whole hover; content
// transitions via AnimatedNumber rather than remounting.
export function ScrubReadout({ frac, label, children }) {
  if (frac == null) return null
  const nearL = frac < 0.09
  const nearR = frac > 0.91
  return (
    <div
      className='pointer-events-none absolute top-0 transition-[left] duration-75 ease-out'
      style={{
        left: `${frac * 100}%`,
        transform: `translateX(${nearL ? '0%' : nearR ? '-100%' : '-50%'})`,
      }}
    >
      <div className='whitespace-nowrap border border-zinc-800 bg-[var(--app-bg)] px-2.5 py-1.5 text-center'>
        {label != null && (
          <div className='font-mono text-[9px] tracking-[0.16em] text-zinc-600'>{label}</div>
        )}
        <div className='mt-0.5 text-[11px] tabular-nums text-zinc-200'>{children}</div>
      </div>
    </div>
  )
}

export function ScrubValue({ v, prefix = '', suffix = '' }) {
  return (
    <span>
      {prefix}
      <AnimatedNumber value={Math.abs(v ?? 0)} />
      {suffix}
    </span>
  )
}
