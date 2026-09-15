import React from 'react'
import NumberFlow from '@number-flow/react'

export function AnimatedNumber({ value, compact = false, signed = false, className = '' }) {
  if (value == null || (typeof value === 'number' && isNaN(value))) {
    return <span className={className}>—</span>
  }
  const format = compact
    ? { notation: 'compact', signDisplay: signed ? 'exceptZero' : 'auto' }
    : { useGrouping: true, signDisplay: signed ? 'exceptZero' : 'auto' }
  return (
    <NumberFlow
      value={Number(value)}
      format={format}
      className={className}
      transformTiming={{ duration: 500, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' }}
      spinTiming={{ duration: 400, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' }}
      opacityTiming={{ duration: 280, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' }}
      respectMotionPreference
    />
  )
}
