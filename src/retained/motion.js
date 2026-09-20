import { useEffect, useState } from 'react'

export const ease = {
  out: [0.23, 1, 0.32, 1],
  outQuart: [0.165, 0.84, 0.44, 1],
  in: [0.55, 0.06, 0.68, 0.19],
}

export const dur = {
  fast: 0.18,
  normal: 0.28,
  slow: 0.65,
  hero: 0.85,
}

export const spring = {
  soft: { type: 'spring', stiffness: 170, damping: 22 },
  snappy: { type: 'spring', stiffness: 260, damping: 24 },
}

export const stagger = {
  tight: 0.03,
  sm: 0.06,
}

export const dist = {
  xs: 4,
  sm: 8,
  md: 14,
}

export const blur = {
  sm: 3,
}

export function useReducedMotion() {
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    const m = window.matchMedia('(prefers-reduced-motion: reduce)')
    const listener = (e) => setReduced(e.matches)
    m.addEventListener('change', listener)
    return () => m.removeEventListener('change', listener)
  }, [])
  return reduced
}
