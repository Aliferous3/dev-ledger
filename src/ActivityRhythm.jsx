import React, { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { useReducedMotion } from './motion'
import { Term } from './TermTooltip'

const HOURS = 24
const DAYS = 7
const labels = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']
const wdMap = (w) => w === 0 ? 6 : w - 1

function buildMatrix(rows) {
  const m = Array.from({ length: DAYS }, () => Array.from({ length: HOURS }, () => ({ commits: 0, days: 0 })))
  for (const r of rows || []) {
    const row = wdMap(r.weekday)
    if (row >= 0 && row < DAYS && r.hour >= 0 && r.hour < HOURS) {
      m[row][r.hour].commits = r.commits || 0
      m[row][r.hour].days = r.days || 0
    }
  }
  return m
}

export function ActivityRhythm({ rhythm, totalCommits, range }) {
  const reduced = useReducedMotion()
  const [hover, setHover] = useState(null)
  const matrix = useMemo(() => buildMatrix(rhythm), [rhythm])
  const { max, peakHour, peakWindow, peakWeekdayIndex, dayparts, weekdayPct, weekendPct } = useMemo(() => {
    let max = 1
    let peakHour = 0
    let peakWeekdayIndex = 0
    let peakWeekdaySum = 0
    let hourSums = Array(HOURS).fill(0)
    let weekday = 0, weekend = 0
    let parts = { night: 0, morning: 0, afternoon: 0, evening: 0 }
    for (let d = 0; d < DAYS; d++) {
      let daySum = 0
      for (let h = 0; h < HOURS; h++) {
        const c = matrix[d][h].commits
        daySum += c
        hourSums[h] += c
        if (c > max) max = c
        if (d < 5) weekday += c; else weekend += c
        if (h < 6) parts.night += c
        else if (h < 12) parts.morning += c
        else if (h < 18) parts.afternoon += c
        else parts.evening += c
      }
      if (d === 0 || daySum > peakWeekdaySum) { peakWeekdaySum = daySum; peakWeekdayIndex = d }
    }
    peakHour = hourSums.indexOf(Math.max(...hourSums))
    let best = -1, bestH = 0
    for (let h = 0; h < HOURS; h++) {
      let sum = 0
      for (let i = 0; i < 3; i++) sum += hourSums[(h + i) % HOURS]
      if (sum > best) { best = sum; bestH = h }
    }
    const total = Math.max(1, weekday + weekend)
    return { max, peakHour, peakWindow: `${String(bestH).padStart(2,'0')}:00–${String((bestH + 3) % HOURS).padStart(2,'0')}:00`, peakWeekdayIndex, dayparts: parts, weekdayPct: (weekday / total) * 100, weekendPct: (weekend / total) * 100 }
  }, [matrix])
  const total = Math.max(1, matrix.flat().reduce((a, c) => a + c.commits, 0))
  const peakRow = labels[peakWeekdayIndex]

  return (
    <section className='mt-14'>
      <div className='label-s'><Term keyName='activityRhythm' showIcon>Activity Rhythm</Term></div>
      <div className='mt-6 overflow-x-auto pb-4'>
        <div className='min-w-[720px]'>
          <div className='grid grid-cols-[2.5rem_repeat(24,minmax(0,1fr))_2.5rem] gap-0.5'>
            <div></div>
            {Array.from({ length: HOURS }, (_, h) => (
              <div key={h} className={`text-[8px] text-center tracking-[0.1em] text-zinc-700 ${[0,4,8,12,16,20].includes(h) ? '' : 'opacity-0'}`}>{String(h).padStart(2,'0')}</div>
            ))}
            <div></div>
            {matrix.map((row, d) => (
              <React.Fragment key={d}>
                <div className={`text-[9px] uppercase tracking-[0.12em] text-zinc-600 pr-2 text-right ${hover && hover[0] === d ? 'text-zinc-300' : ''}`}>{labels[d]}</div>
                {row.map((cell, h) => {
                  const active = hover && hover[0] === d && hover[1] === h
                  const dim = hover && (hover[0] !== d || hover[1] !== h)
                  const alpha = max > 0 ? Math.max(0.05, cell.commits / max) : 0
                  return (
                    <motion.div
                      key={h}
                      onMouseEnter={() => setHover([d, h])}
                      onMouseLeave={() => setHover(null)}
                      className={`h-6 w-full border border-zinc-900/20 transition-all ${active ? 'bg-zinc-100 scale-[1.08] z-10' : dim ? 'opacity-40' : ''}`}
                      style={{ backgroundColor: `rgba(245,245,245,${alpha})` }}
                      whileHover={reduced ? {} : { scale: 1.05 }}
                      title={`${labels[d]} · ${String(h).padStart(2,'0')}:00–${String((h+1)%HOURS).padStart(2,'0')}:00 · ${cell.commits} commits`}
                    />
                  )
                })}
                <div className='text-[8px] text-zinc-700 pl-2 text-right'>{row.reduce((a,c)=>a+c.commits,0)}</div>
              </React.Fragment>
            ))}
          </div>
        </div>
      </div>
      {hover && (
        <div className='mt-3 text-[11px] uppercase tracking-[0.2em] text-zinc-400'>
          {labels[hover[0]]} · {String(hover[1]).padStart(2,'0')}:00–{String((hover[1]+1)%HOURS).padStart(2,'0')}:00 · {matrix[hover[0]][hover[1]].commits} commits · {((matrix[hover[0]][hover[1]].commits / total) * 100).toFixed(1)}%
        </div>
      )}
      <div className='mt-6 grid grid-cols-2 md:grid-cols-4 gap-x-8 gap-y-4 text-[10px] uppercase tracking-[0.2em] text-zinc-500'>
        <div><Term keyName='peakWeekday' showIcon>Peak weekday</Term> <span className='text-zinc-300'>{peakRow}</span></div>
        <div><Term keyName='peakHour' showIcon>Peak hour</Term> <span className='text-zinc-300'>{String(peakHour).padStart(2,'0')}:00</span></div>
        <div><Term keyName='peakWindow' showIcon>Peak window</Term> <span className='text-zinc-300'>{peakWindow}</span></div>
        <div>Weekday / Weekend <span className='text-zinc-300'>{weekdayPct.toFixed(1)}% / {weekendPct.toFixed(1)}%</span></div>
        <div>Night <span className='text-zinc-300'>{((dayparts.night/total)*100).toFixed(1)}%</span></div>
        <div>Morning <span className='text-zinc-300'>{((dayparts.morning/total)*100).toFixed(1)}%</span></div>
        <div>Afternoon <span className='text-zinc-300'>{((dayparts.afternoon/total)*100).toFixed(1)}%</span></div>
        <div>Evening <span className='text-zinc-300'>{((dayparts.evening/total)*100).toFixed(1)}%</span></div>
      </div>
    </section>
  )
}
