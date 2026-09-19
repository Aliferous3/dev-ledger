import React from 'react'
import { Icon } from '@iconify/react'

/* Production login — the supplied FINAL authentication composition.
   Structure: upper datum (H1), lower datum (H2), left margin rule (V1)
   the title hangs from, and a column rule (V2) the contents index
   hangs from. Entrance row anchored at the foot of the viewport.
   Motion: masked baseline reveals + rule draws, decelerating ease. */

const CONTENTS = [
  { index: '01', term: 'Commits' },
  { index: '02', term: 'Repos' },
  { index: '03', term: 'Stack' },
  { index: '04', term: 'Pace' },
]

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

export default function Login() {
  return (
    <section className='relative h-screen min-h-[720px] w-full overflow-hidden bg-[#0a0a0a] text-zinc-100 antialiased selection:bg-zinc-100 selection:text-black'>
      <div className='relative h-full min-h-[720px]'>
        {/* masthead, above the upper datum */}
        <div className='absolute left-[6vw] right-[6vw] top-9 flex items-baseline justify-between'>
          <Label delay='0.15s' className='anim-fade text-zinc-400'>
            Vol. I — Folio 001
          </Label>
          <Label delay='0.25s' className='anim-fade text-zinc-600'>
            GitHub / Auth
          </Label>
        </div>

        {/* structural geometry */}
        <span
          className='anim-rule-x absolute left-[6vw] right-[6vw] top-[16%] block h-px bg-zinc-100/[0.12]'
          style={{ animationDelay: '0.2s' }}
          aria-hidden='true'
        />
        <span
          className='anim-rule-x absolute bottom-[104px] left-[6vw] right-[6vw] block h-px bg-zinc-100/[0.12]'
          style={{ animationDelay: '0.3s' }}
          aria-hidden='true'
        />
        <span
          className='anim-rule-y absolute bottom-[104px] left-[6vw] top-[16%] block w-px bg-zinc-100/[0.07]'
          style={{ animationDelay: '0.4s' }}
          aria-hidden='true'
        />
        <span
          className='anim-rule-y absolute bottom-[104px] left-[62%] top-[16%] hidden w-px bg-zinc-100/[0.07] lg:block'
          style={{ animationDelay: '0.5s' }}
          aria-hidden='true'
        />
        <Tick className='left-[6vw] top-[16%]' delay='1.9s' />
        <Tick className='hidden left-[62%] top-[16%] lg:block' delay='2s' />
        <Tick className='bottom-[104px] left-[6vw] translate-y-1/2' delay='2.1s' />

        {/* identity zone — the title hangs from V1 */}
        <div className='absolute left-[6vw] right-[6vw] top-[16%] pl-8 pt-14 md:pl-12 lg:right-[41%]'>
          <Label className='block text-zinc-600'>
            <RevealLine delay={0.55}>Body of Work — The Developer’s Record</RevealLine>
          </Label>
          <h1
            className='figure mt-9 text-[clamp(2.75rem,11vw,7.25rem)] font-light leading-[1.02] tracking-[0.01em] text-zinc-100'
          >
            <RevealChars text='DEV LEDGER' delay={0.65} stagger={0.05} duration={1.2} />
          </h1>
          <p className='figure mt-8 text-[19px] italic leading-relaxed tracking-normal text-zinc-400'>
            <RevealWords text='Your GitHub history, made legible.' delay={1.25} stagger={0.06} />
          </p>
        </div>

        {/* record index — hangs from V2, collapsed below lg */}
        <div className='absolute right-[6vw] top-[16%] hidden w-[27%] pt-14 lg:block'>
          <Label className='block text-zinc-600'>
            <RevealLine delay={1.35}>Contents</RevealLine>
          </Label>
          <ul className='mt-7'>
            {CONTENTS.map((e, i) => (
              <li key={e.index} className='border-t border-zinc-100/[0.07] py-[17px] first:border-t-0 first:pt-0'>
                <RevealLine delay={1.45 + i * 0.12} className='w-full'>
                  <span className='flex w-full items-baseline gap-5'>
                    <span className='text-[10px] tracking-[0.2em] text-zinc-600'>{e.index}</span>
                    <span className='text-[11px] uppercase tracking-[0.28em] text-zinc-100/85'>{e.term}</span>
                    <span className='mx-1 flex-1 border-b border-dotted border-zinc-100/[0.14] pb-1' aria-hidden='true' />
                    <span className='figure text-[13px] italic tracking-normal text-zinc-600'>recorded</span>
                  </span>
                </RevealLine>
              </li>
            ))}
          </ul>
          <span className='anim-rule-x mt-1 block h-px w-full bg-zinc-100/[0.07]' style={{ animationDelay: '1.9s' }} aria-hidden='true' />
          <Label className='mt-6 block text-zinc-400/70'>
            <RevealLine delay={2}>One continuous record.</RevealLine>
          </Label>
        </div>

        {/* entrance row — anchored below H2 */}
        <div className='absolute bottom-0 left-[6vw] right-[6vw] flex min-h-[104px] flex-wrap items-center justify-between gap-x-6 gap-y-4 py-5'>
          <div className='flex items-baseline gap-6'>
            <RevealLine delay={1.7}>
              <span className='text-[10px] tracking-[0.2em] text-zinc-600'>00</span>
            </RevealLine>
            <RevealLine delay={1.78}>
              <span className='text-[11px] uppercase tracking-[0.28em] text-zinc-400'>Open the ledger</span>
            </RevealLine>
          </div>
          <a
            href='/api/auth/login'
            className='anim-rise group inline-flex items-center gap-3 border border-zinc-100 bg-zinc-100 px-7 py-[14px] text-[11px] font-medium uppercase tracking-[0.24em] text-zinc-950 transition-all duration-500 ease-out hover:bg-transparent hover:text-zinc-100 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-4 focus-visible:outline-zinc-100/60 sm:px-8'
            style={{ animationDelay: '1.85s' }}
          >
            <Icon
              icon='octicon:mark-github-16'
              className='h-[15px] w-[15px] transition-transform duration-500 ease-out group-hover:-translate-y-[1px]'
            />
            Continue with GitHub
          </a>
        </div>
      </div>
    </section>
  )
}
