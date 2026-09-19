import React, { useState } from 'react'
import { Icon } from '@iconify/react'
import { motion } from 'framer-motion'
import { makeRange, rangeDisplay } from './range'
import { useReducedMotion } from './motion'
import { DatePicker } from './DatePicker'
import { Term } from './TermTooltip'
import { TerminalButton } from './TerminalButton'

const presets = ['7d', '30d', '90d', 'ytd', '1y', 'all']
const rangeTerm = { '7d': 'range7d', '30d': 'range30d', '90d': 'range90d', ytd: 'rangeYtd', '1y': 'range1y', all: 'rangeAll' }

export function DateRange({ range, onChange, compare, onCompare }) {
  const reduced = useReducedMotion()
  const [open, setOpen] = useState(false)
  const setPreset = (mode) => {
    if (open) setOpen(false)
    onChange(makeRange(mode))
  }

  const setCustom = (from, to) => {
    onChange(makeRange('custom', from, to))
  }

  const step = (dir) => {
    if (range.mode === 'all' || range.mode === 'ytd') return
    if (!range.from || !range.to) return
    const s = new Date(range.from + 'T00:00:00Z')
    const e = new Date(range.to + 'T00:00:00Z')
    const days = Math.round((e - s) / 86400000)
    if (dir === 'next') {
      const n = new Date()
      n.setUTCHours(0, 0, 0, 0)
      const nextE = new Date(e.getTime() + (days + 1) * 86400000)
      if (nextE > n) return
      s.setUTCDate(s.getUTCDate() + days + 1)
      e.setUTCDate(e.getUTCDate() + days + 1)
    } else {
      s.setUTCDate(s.getUTCDate() - (days + 1))
      e.setUTCDate(e.getUTCDate() - (days + 1))
    }
    const pad = (d) => d.toISOString().slice(0, 10)
    // A stepped window is no longer the preset — it is an explicit custom
    // window so the URL records real dates (?from&to) and refresh round-trips.
    onChange({ mode: 'custom', from: pad(s), to: pad(e) })
  }

  const customActive = range.mode === 'custom'
  const label = customActive ? `${range.from} — ${range.to}` : 'custom'

  return (
    <div className='flex flex-wrap items-center gap-3'>
      <div className='flex items-center border border-zinc-900 divide-x divide-zinc-900 overflow-x-auto max-w-full [&>button]:shrink-0'>
        <button
          onClick={() => step('prev')}
          className='px-2 py-1.5 text-zinc-700 hover:text-zinc-300 transition-colors'
          title='Previous period'
        >
          <Icon icon='ph:caret-left' className='h-3 w-3' />
        </button>
        {presets.map((m) => (
          <button
            key={m}
            onClick={() => setPreset(m)}
            className={`relative px-2.5 py-1.5 text-[9.5px] uppercase tracking-[0.2em] transition-colors ${
              range.mode === m ? 'text-[#080808]' : 'text-zinc-500 hover:text-zinc-200 hover:bg-zinc-900/40'
            }`}
          >
            {range.mode === m && (
              <motion.div
                layoutId='range-pill'
                className='absolute inset-0 bg-[#f2f2f0] -z-10'
                transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 260, damping: 26 }}
              />
            )}
            <Term keyName={rangeTerm[m]} as='span' tabIndex={-1} showIcon>{m}</Term>
          </button>
        ))}
        <button
          onClick={() => step('next')}
          className='px-2 py-1.5 text-zinc-700 hover:text-zinc-300 transition-colors'
          title='Next period'
        >
          <Icon icon='ph:caret-right' className='h-3 w-3' />
        </button>
      </div>

      <div className='relative'>
        <TerminalButton
          variant='secondary'
          compact
          cursor='none'
          active={customActive}
          onClick={() => setOpen((o) => !o)}
        >
          <Term keyName='rangeCustom' as='span' tabIndex={-1} showIcon={customActive}>
            {label}
          </Term>
        </TerminalButton>
        <DatePicker
          from={range.from}
          to={range.to}
          open={open}
          onClose={() => setOpen(false)}
          onApply={(from, to) => {
            setCustom(from, to)
            setOpen(false)
          }}
          onClear={() => setOpen(false)}
        />
      </div>

      <div className='text-[9.5px] uppercase tracking-[0.2em] text-zinc-600' title={rangeDisplay(range)}>
        {rangeDisplay(range)}
      </div>
      <TerminalButton
        variant='secondary'
        compact
        cursor='none'
        active={compare}
        onClick={() => onCompare?.(!compare)}
        disabled={range.mode === 'all'}
      >
        <Term keyName='compare' as='span' tabIndex={-1} showIcon={compare}>compare</Term>
      </TerminalButton>
    </div>
  )
}
