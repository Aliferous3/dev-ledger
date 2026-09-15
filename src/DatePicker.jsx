import React, { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isAfter,
  isBefore,
  isEqual,
  isSameDay,
  isSameMonth,
  isToday,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subMonths,
} from 'date-fns'
import { useReducedMotion } from './motion'

const today = () => startOfDay(new Date())

function monthGrid(monthStart) {
  return eachDayOfInterval({
    start: startOfWeek(startOfMonth(monthStart), { weekStartsOn: 0 }),
    end: endOfWeek(endOfMonth(monthStart), { weekStartsOn: 0 }),
  })
}

function toInput(d) {
  return d ? format(d, 'yyyy-MM-dd') : ''
}

export function DatePicker({ from, to, open, onClose, onApply, onClear }) {
  const reduced = useReducedMotion()
  const panelRef = useRef(null)
  const [base, setBase] = useState(() => startOfMonth(from ? new Date(from + 'T00:00:00Z') : today()))
  const [start, setStart] = useState(from ? new Date(from + 'T00:00:00Z') : null)
  const [end, setEnd] = useState(to ? new Date(to + 'T00:00:00Z') : null)
  const [hover, setHover] = useState(null)

  useEffect(() => {
    setStart(from ? new Date(from + 'T00:00:00Z') : null)
    setEnd(to ? new Date(to + 'T00:00:00Z') : null)
    if (from) setBase(startOfMonth(new Date(from + 'T00:00:00Z')))
  }, [from, to, open])

  useEffect(() => {
    if (!open) return
    const handler = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) onClose()
    }
    const keyHandler = (e) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handler)
    document.addEventListener('keydown', keyHandler)
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('keydown', keyHandler)
    }
  }, [open, onClose])

  const leftMonth = base
  const rightMonth = addMonths(base, 1)

  const handleDay = (d) => {
    if (!start || (start && end)) {
      setStart(d)
      setEnd(null)
      return
    }
    if (isEqual(d, start) || isAfter(d, start)) {
      setEnd(d)
    } else {
      setStart(d)
      setEnd(null)
    }
  }

  const apply = () => {
    if (start && end) onApply(toInput(start), toInput(end))
    onClose()
  }

  const clear = () => {
    setStart(null)
    setEnd(null)
    onClear?.()
    onClose()
  }

  const inRange = (d) => {
    if (start && end) return (isAfter(d, start) || isSameDay(d, start)) && (isBefore(d, end) || isSameDay(d, end))
    if (start && hover) {
      const a = start
      const b = hover
      const lo = isBefore(a, b) ? a : b
      const hi = isBefore(a, b) ? b : a
      return (isAfter(d, lo) || isSameDay(d, lo)) && (isBefore(d, hi) || isSameDay(d, hi))
    }
    return false
  }

  const weekdayLabels = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

  const Month = ({ month }) => {
    const days = monthGrid(month)
    return (
      <div className='min-w-0'>
        <div className='mb-3 text-[16px] font-light tracking-[-0.01em] text-zinc-100 figure'>
          {format(month, 'MMMM yyyy')}
        </div>
        <div className='grid grid-cols-7'>
          {weekdayLabels.map((w) => (
            <div key={w} className='py-2 text-center text-[9px] uppercase tracking-[0.22em] text-zinc-600'>
              {w}
            </div>
          ))}
        </div>
        <div className='grid grid-cols-7 gap-px'>
          {days.map((d) => {
            const future = isAfter(d, today())
            const selected = (start && isSameDay(d, start)) || (end && isSameDay(d, end))
            const rangeInterior = !selected && inRange(d)
            const isTodayDate = isToday(d)
            const muted = !isSameMonth(d, month)
            return (
              <button
                key={d.toISOString()}
                disabled={future}
                onClick={() => !future && handleDay(d)}
                onMouseEnter={() => setHover(d)}
                onMouseLeave={() => setHover(null)}
                className={`
                  relative h-9 w-full flex items-center justify-center text-[12px] font-light tabular-nums
                  transition-colors duration-150
                  ${muted ? 'text-zinc-800' : future ? 'text-zinc-800 cursor-not-allowed' : 'text-zinc-300 hover:text-zinc-100 hover:bg-zinc-900/60'}
                  ${selected ? 'bg-[#f2f2f0] text-[#080808] hover:text-[#080808] hover:bg-[#f2f2f0]' : ''}
                  ${rangeInterior ? 'bg-zinc-900/50' : ''}
                  ${isTodayDate && !selected ? 'border border-zinc-700' : ''}
                `}
              >
                {d.getDate()}
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={panelRef}
          className='absolute right-0 top-full z-50 mt-2 border border-zinc-900 bg-[#0a0a0a] p-5 shadow-sm'
          style={{ width: 'min(640px, calc(100vw - 32px))' }}
          initial={{ opacity: 0, y: -4, filter: 'blur(2px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          exit={{ opacity: 0, y: -4, filter: 'blur(2px)' }}
          transition={reduced ? { duration: 0 } : { duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
        >
          <div className='flex items-center justify-between pb-4 border-b border-zinc-900'>
            <div className='flex items-center gap-4'>
              <button
                onClick={() => setBase((b) => subMonths(b, 1))}
                className='text-zinc-600 hover:text-zinc-300 transition-colors text-[10px] uppercase tracking-[0.2em]'
              >
                ← prev
              </button>
              <button
                onClick={() => setBase((b) => addMonths(b, 1))}
                className='text-zinc-600 hover:text-zinc-300 transition-colors text-[10px] uppercase tracking-[0.2em]'
              >
                next →
              </button>
            </div>
            <button onClick={onClose} className='text-zinc-600 hover:text-zinc-300 transition-colors text-[10px] uppercase tracking-[0.2em]'>
              close
            </button>
          </div>

          <div className='mt-5 grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-10'>
            <Month month={leftMonth} />
            <div className='hidden md:block'>
              <Month month={rightMonth} />
            </div>
          </div>

          <div className='mt-5 pt-4 border-t border-zinc-900 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4'>
            <div className='text-[10px] uppercase tracking-[0.2em] text-zinc-600'>
              {start ? format(start, 'MM / dd / yyyy') : '—'} → {end ? format(end, 'MM / dd / yyyy') : '—'}
            </div>
            <div className='flex items-center gap-2'>
              <button
                onClick={clear}
                className='px-3 py-1.5 text-[9.5px] uppercase tracking-[0.2em] text-zinc-500 border border-zinc-900 hover:border-zinc-700 hover:text-zinc-300 transition-colors'
              >
                Clear
              </button>
              <button
                onClick={apply}
                disabled={!start || !end}
                className='px-3 py-1.5 text-[9.5px] uppercase tracking-[0.2em] bg-[#f2f2f0] text-[#080808] hover:bg-white disabled:opacity-40 disabled:hover:bg-[#f2f2f0] transition-colors'
              >
                Apply
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
