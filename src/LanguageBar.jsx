import React from 'react'
import { motion } from 'framer-motion'
import { AnimatedNumber } from './AnimatedNumber'
import { useReducedMotion } from './motion'

const fmt = new Intl.NumberFormat('en-US')
const stringN = (v) => (v == null ? '—' : fmt.format(Number(v)))
const n = (v) => <AnimatedNumber value={v} />

function labelVisible(pct, language) {
  const len = language.length
  const threshold = len > 8 ? 14 : len > 5 ? 9 : 6
  return pct >= threshold
}

export function LanguageBar({ languages, onHover, activeLang }) {
  const reduced = useReducedMotion()
  const total = languages.reduce((a, l) => a + (l.code || 0), 0) || 1
  const anyActive = !!activeLang
  return (
    <div className='mt-6 flex h-[68px] w-full overflow-hidden'>
      {languages.map((l, i) => {
        const pct = total ? ((l.code || 0) / total) * 100 : 0
        const opacity = 0.03 + pct / 90
        const show = labelVisible(pct, l.language)
        const isActive = activeLang === l.language
        const isDimmed = anyActive && !isActive
        const textColor = opacity > 0.45 ? 'text-zinc-950' : 'text-zinc-50'
        return (
          <motion.div
            key={l.language}
            className='group relative flex items-end overflow-hidden border-r border-[#0a0a0a] last:border-r-0'
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            onMouseEnter={() => onHover?.(l.language)}
            onMouseLeave={() => onHover?.(null)}
            transition={
              reduced
                ? { duration: 0 }
                : { duration: 0.7, delay: i * 0.04, ease: [0.23, 1, 0.32, 1] }
            }
            style={{
              background: '#fafafa',
              opacity: isDimmed ? 0.35 : 1,
              filter: isActive ? 'brightness(1.25)' : isDimmed ? 'brightness(0.75)' : 'brightness(1)',
              boxShadow: isActive ? 'inset 0 0 0 1px rgba(0,0,0,0.35)' : undefined,
            }}
            title={`${l.language}\n${stringN(l.code)} LOC · ${pct.toFixed(1)}%\n${l.files || 0} files`}
          >
            {show && (
              <span
                className={`absolute bottom-2 left-2 whitespace-nowrap text-[9px] uppercase tracking-[0.16em] ${textColor} transition-all duration-150 ${isActive ? 'opacity-100 font-medium' : 'opacity-90 group-hover:opacity-100'}`}
              >
                {l.language}
              </span>
            )}
          </motion.div>
        )
      })}
    </div>
  )
}

export function LanguageLegend({ languages, onHover, activeLang }) {
  const total = languages.reduce((a, l) => a + (l.code || 0), 0) || 1
  return (
    <div className='mt-5 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-4'>
      {languages.map((l, i) => {
        const pct = total ? ((l.code || 0) / total) * 100 : 0
        const isActive = activeLang === l.language
        return (
          <motion.div
            key={l.language}
            className={`relative transition-colors duration-150 cursor-default ${isActive ? 'text-zinc-100' : 'text-zinc-500'}`}
            onMouseEnter={() => onHover?.(l.language)}
            onMouseLeave={() => onHover?.(null)}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, delay: i * 0.04, ease: [0.23, 1, 0.32, 1] }}
          >
            <div className={`absolute -left-2 top-0 bottom-0 w-px transition-opacity duration-150 ${isActive ? 'bg-zinc-500 opacity-100' : 'bg-zinc-700 opacity-0'}`} />
            <div className={`text-[9px] uppercase tracking-[0.22em] ${isActive ? 'text-zinc-100' : 'text-zinc-700'}`}>{l.language}</div>
            <div className='mt-1 text-[17px] font-light tabular-nums figure'>
              {stringN(l.code)} <span className={`text-[10px] ${isActive ? 'text-zinc-400' : 'text-zinc-700'}`}>LOC</span>
            </div>
            <div className={`text-[10px] tabular-nums ${isActive ? 'text-zinc-400' : 'text-zinc-600'}`}>
              {pct.toFixed(1)}% · {l.files || 0} files
            </div>
          </motion.div>
        )
      })}
    </div>
  )
}
