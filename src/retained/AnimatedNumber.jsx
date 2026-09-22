import React from 'react'
import { Num } from '../ledger/Num'

// Retained-surface adapter — delegates to the shared Num wrapper so every
// animated number in the app shares the same timing/easing/trend=0 grammar.
export function AnimatedNumber({ value, compact = false, signed = false, className = '' }) {
  if (value == null || (typeof value === 'number' && isNaN(value))) {
    return <span className={className}>—</span>
  }
  const format = compact
    ? { notation: 'compact', signDisplay: signed ? 'exceptZero' : 'auto', maximumFractionDigits: 1 }
    : { useGrouping: true, signDisplay: signed ? 'exceptZero' : 'auto' }
  return <Num value={Number(value)} format={format} className={className} />
}
