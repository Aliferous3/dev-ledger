import React, { useCallback, useState } from 'react'
import { Icon } from '@iconify/react'
import { buildMatrix, MATRIX_YEARS, MATRIX_COLS, ROWS_PER_YEAR } from './loginMatrix'
import GitTopology from './GitTopology'
import { TerminalButton } from './TerminalButton'

/* Production login — the supplied FINAL composition with the right field
   transformed into an archival coding-history matrix (deterministic,
   decorative — not the visitor's data).
   One master timeline assembles the folio:
     P1 0.00–0.80  structure: rules, ticks, masthead
     P2 0.45–1.35  identity: eyebrow, DEV LEDGER char sweep
     P3 1.05–1.75  subtitle + right field + year index
     P4 1.25–2.20  cell assembly sweep
     P5 1.75–2.40  terminal copy, cursor last
     P6 1.90–2.70  foot index + CTA rise
   Ambient afterwards: cell breathing + cursor blink only. */

const T = {
  mastL: 0.35, mastR: 0.45,
  ruleH1: 0.15, ruleH2: 0.25, ruleV1: 0.3, ruleV2: 0.4,
  ticks: [0.55, 0.62, 0.7],
  eyebrow: 0.55, title: 0.68, titleStagger: 0.05, titleDur: 1.1,
  subtitle: 1.15,
  gridFade: 1.2, yearBase: 1.25, yearStep: 0.05,
  terminal: [1.85, 2.0, 2.15], prompt: 2.3, cursorBlink: 2.45,
  topo: 2.0,
  desc: [3.0, 3.16, 3.32],
  footIdx: 1.95, footLabel: 2.03, cta: 2.2,
}

const PRODUCT_DESC = [
  'FROM YOUR FIRST COMMIT TO YOUR LATEST.',
  'TRACE WHAT YOU BUILT, WHEN YOU BUILT IT,',
  'AND HOW YOUR WORK CHANGED ALONG THE WAY.',
]

const CELLS = buildMatrix()
const EASE = 'cubic-bezier(0.19, 1, 0.22, 1)'

function RevealChars({ text, className = '', delay = 0, stagger = 0.05, duration = 1.2 }) {
  return (
    <span className={className} aria-label={text} role='text'>
      {text.split('').map((ch, i) => (
        <span key={i} className='reveal-mask' aria-hidden='true'>
          <span
            className='reveal-inner'
            style={{ animationDelay: `${delay + i * stagger}s`, animationDuration: `${duration}s` }}
          >
            {ch === ' ' ? ' ' : ch}
          </span>
        </span>
      ))}
    </span>
  )
}

function RevealWords({ text, className = '', delay = 0, stagger = 0.06, duration = 1 }) {
  const words = text.split(' ')
  return (
    <span className={className} aria-label={text} role='text'>
      {words.map((w, i) => (
        <span key={i} aria-hidden='true'>
          <span className='reveal-mask'>
            <span
              className='reveal-inner'
              style={{ animationDelay: `${delay + i * stagger}s`, animationDuration: `${duration}s` }}
            >
              {w}
            </span>
          </span>
          {i < words.length - 1 && ' '}
        </span>
      ))}
    </span>
  )
}

function RevealLine({ children, className = '', delay = 0, duration = 1 }) {
  return (
    <span className={`reveal-mask ${className}`}>
      <span className='reveal-inner' style={{ animationDelay: `${delay}s`, animationDuration: `${duration}s` }}>
        {children}
      </span>
    </span>
  )
}

function Label({ children, className = '', delay }) {
  return (
    <span
      style={delay ? { animationDelay: delay } : undefined}
      className={`text-[10px] font-normal uppercase tracking-[0.32em] ${className}`}
    >
      {children}
    </span>
  )
}

function Tick({ className, delay }) {
  return (
    <span
      className={`anim-fade pointer-events-none absolute z-10 h-[9px] w-[9px] -translate-x-1/2 -translate-y-1/2 text-zinc-100/20 ${className}`}
      style={{ animationDelay: delay }}
      aria-hidden='true'
    >
      <svg viewBox='0 0 9 9' className='h-full w-full'>
        <path d='M4.5 0v9M0 4.5h9' stroke='currentColor' strokeWidth='1' fill='none' />
      </svg>
    </span>
  )
}

/* The history matrix — each year owns ROWS_PER_YEAR rows; cells assemble
   in a left→right sweep during P4, then settle into independent phosphor
   breathing. Cell/gap sizes come from CSS vars per context (compact vs
   right field) so the geometry stays crisp at every breakpoint. */
function HistoryField({ withYears = true, tight = false }) {
  return (
    <div className='anim-fade' style={{ animationDelay: `${T.gridFade}s` }} aria-hidden='true'>
      <div className='auth-matrix-wrap flex items-start gap-3 lg:gap-3.5 xl:gap-4'>
        {withYears && (
          <div className='auth-year-index hidden flex-col items-end min-[360px]:flex'>
            {MATRIX_YEARS.map((y, i) => (
              <span
                key={y}
                className='anim-fade mono flex items-center leading-none tracking-[0.14em] text-zinc-500'
                style={{
                  animationDelay: `${T.yearBase + i * T.yearStep}s`,
                  height: `calc(var(--cell) * ${ROWS_PER_YEAR} + var(--cgap) * ${ROWS_PER_YEAR - 1})`,
                }}
              >
                {y}
              </span>
            ))}
          </div>
        )}
        <div
          className='auth-matrix grid'
          style={{ gridTemplateColumns: `repeat(${MATRIX_COLS}, var(--cell))` }}
        >
          {CELLS.map((cell) => (
            <span
              key={`${cell.r}-${cell.c}`}
              className='auth-cell'
              style={{
                background: cell.bg,
                '--lo': cell.lo,
                '--hi': cell.hi,
                '--g': cell.glow,
                animationDelay: `${cell.assembleDelay}s, ${cell.breatheDelay}s`,
                animationDuration: `0.45s, ${cell.breatheDur}s`,
                animationTimingFunction: `${EASE}, ease-in-out`,
              }}
            />
          ))}
        </div>
      </div>
      <div className={`auth-term mono ${tight ? 'mt-6' : 'mt-9'} text-zinc-500`}>
        <div><RevealLine delay={T.terminal[0]}>// commits become chronology</RevealLine></div>
        <div><RevealLine delay={T.terminal[1]}>// chronology becomes a body of work</RevealLine></div>
        <div>
          <RevealLine delay={T.terminal[2]}>
            <span className='text-zinc-400'>&gt;</span>{' '}
            <span className='text-zinc-300'>connect github</span>
            <span
              className='auth-cursor text-zinc-200'
              style={{ animationDelay: `${T.prompt}s, ${T.cursorBlink}s` }}
            >
              _
            </span>
          </RevealLine>
        </div>
      </div>
    </div>
  )
}

export default function Login() {
  const [exiting, setExiting] = useState(false)

  // Short exit treatment (~200ms), then straight into the OAuth route.
  const beginAuth = useCallback((e) => {
    e.preventDefault()
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      window.location.href = '/api/auth/login'
      return
    }
    setExiting(true)
    setTimeout(() => { window.location.href = '/api/auth/login' }, 200)
  }, [])

  return (
    <section
      className={`relative h-screen min-h-[720px] w-full overflow-hidden bg-[var(--app-bg)] text-zinc-100 antialiased selection:bg-zinc-100 selection:text-black ${exiting ? 'login-exit' : ''}`}
    >
      <div className='relative h-full min-h-[720px]'>
        {/* masthead, above the upper datum */}
        <div className='absolute left-[6vw] right-[6vw] top-9 flex items-baseline justify-end'>
          <Label delay={`${T.mastR}s`} className='anim-fade text-zinc-600'>
            GitHub / Auth
          </Label>
        </div>

        {/* structural geometry */}
        <span
          className='anim-rule-x absolute left-[6vw] right-[6vw] top-[16%] block h-px bg-zinc-100/[0.12]'
          style={{ animationDelay: `${T.ruleH1}s` }}
          aria-hidden='true'
        />
        <span
          className='anim-rule-x absolute bottom-[104px] left-[6vw] right-[6vw] block h-px bg-zinc-100/[0.12]'
          style={{ animationDelay: `${T.ruleH2}s` }}
          aria-hidden='true'
        />
        <span
          className='anim-rule-y absolute bottom-[104px] left-[6vw] top-[16%] block w-px bg-zinc-100/[0.07]'
          style={{ animationDelay: `${T.ruleV1}s` }}
          aria-hidden='true'
        />
        <span
          className='anim-rule-y absolute bottom-[104px] left-[62%] top-[16%] hidden w-px bg-zinc-100/[0.07] lg:block'
          style={{ animationDelay: `${T.ruleV2}s` }}
          aria-hidden='true'
        />
        <Tick className='left-[6vw] top-[16%]' delay={`${T.ticks[0]}s`} />
        <Tick className='hidden left-[62%] top-[16%] lg:block' delay={`${T.ticks[1]}s`} />
        <Tick className='bottom-[104px] left-[6vw] translate-y-1/2' delay={`${T.ticks[2]}s`} />

        {/* identity zone — the title hangs from V1 */}
        <div className='absolute left-[6vw] right-[6vw] top-[16%] pl-8 pt-10 md:pl-12 md:pt-14 lg:right-[41%]'>
          <Label className='block text-zinc-600'>
            <RevealLine delay={T.eyebrow}>Body of Work — The Developer’s Record</RevealLine>
          </Label>
          <h1 className='figure mt-7 text-[clamp(2.75rem,7.4vw,7.25rem)] font-light leading-[1.02] tracking-[0.01em] text-zinc-100 md:mt-9'>
            <RevealChars text='DEV LEDGER' delay={T.title} stagger={T.titleStagger} duration={T.titleDur} />
          </h1>
          <p className='figure mt-6 text-[19px] italic leading-relaxed tracking-normal text-zinc-400 md:mt-8'>
            <RevealWords text='Your GitHub history, made legible.' delay={T.subtitle} stagger={0.06} />
          </p>
          {/* interactive git topology — left field manipulates history,
              right field observes it. Interactive at lg+, static motif
              at md–lg, hidden below md. */}
          <div className='hidden lg:mt-8 lg:block lg:max-w-[320px] xl:mt-10 xl:max-w-[460px]'>
            <GitTopology base={T.topo} />
            {/* product annotation — printed into the folio, revealed line by
                line once the topology begins resolving */}
            <div className='mono mt-4 text-[10px] leading-[2] tracking-[0.18em] text-zinc-500 xl:mt-5 xl:text-[10.5px]'>
              {PRODUCT_DESC.map((line, i) => (
                <div key={line}>
                  <RevealLine delay={T.desc[i]}>{line}</RevealLine>
                </div>
              ))}
            </div>
          </div>
          {/* compact history field below lg — the right column takes over at lg+.
              Mini topology sits beside the product annotation on md, stacked
              below sm where vertical room runs out. */}
          <div className='mt-9 max-w-[460px] md:mt-10 lg:hidden'>
            <HistoryField tight />
          </div>
          {/* mini topology beside the annotation on md; stacked below sm */}
          <div className='mt-7 flex flex-wrap items-end gap-x-8 gap-y-5 lg:hidden'>
            <div className='anim-fade hidden md:block' style={{ animationDelay: '2.4s' }}>
              <GitTopology mini />
            </div>
            <div className='mono hidden text-[9.5px] leading-[1.95] tracking-[0.18em] text-zinc-500 sm:block md:text-[10px]'>
              {PRODUCT_DESC.map((line, i) => (
                <div key={line}>
                  <RevealLine delay={T.desc[i]}>{line}</RevealLine>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* record field — hangs from V2 at lg+ */}
        <div className='absolute right-[6vw] top-[16%] hidden w-[32%] pl-2 pt-14 lg:block'>
          <HistoryField />
        </div>

        {/* entrance row — anchored below H2 */}
        <div className='absolute bottom-0 left-[6vw] right-[6vw] flex min-h-[104px] flex-wrap items-center justify-between gap-x-6 gap-y-4 py-5'>
          <div className='flex items-baseline gap-6'>
            <RevealLine delay={T.footIdx}>
              <span className='text-[10px] tracking-[0.2em] text-zinc-600'>00</span>
            </RevealLine>
            <RevealLine delay={T.footLabel}>
              <span className='text-[11px] uppercase tracking-[0.28em] text-zinc-400'>Open the ledger</span>
            </RevealLine>
          </div>
          <div className='anim-rise max-[560px]:w-full' style={{ animationDelay: `${T.cta}s` }}>
            <TerminalButton
              variant='primary'
              solid
              size='lg'
              href='/api/auth/login'
              onClick={beginAuth}
              icon='octicon:mark-github-16'
              className='max-[560px]:w-full max-[560px]:justify-center'
            >
              continue with github
            </TerminalButton>
          </div>
        </div>
      </div>
    </section>
  )
}
