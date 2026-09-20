import React, { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { AnimatedNumber } from './AnimatedNumber'
import { useReducedMotion } from './motion'

/* Persistent bottom-right sync instrument. Renders real user_sync state —
   phase, per-stage counts, overall fraction — while a sync runs; flashes a
   brief complete state, and stays put on error/rate-limit/revoked. Fixed
   above the pinned scroll chapters; never a toast. */

const PHASE = {
  discover: 'DISCOVERING',
  metadata: 'METADATA',
  commits: 'HISTORY',
  pulls: 'PULL REQUESTS',
  range: 'RANGE',
  finalizing: 'FINALIZING',
}

const fmt = new Intl.NumberFormat('en-US')
const pair = (d) => (d ? `${fmt.format(d.done ?? 0)} / ${fmt.format(d.total ?? '—')}` : '—')

export default function SyncInstrument({ sync }) {
  const reduced = useReducedMotion()
  const [justDone, setJustDone] = useState(false)
  const prev = useRef(null)

  const status = sync?.status
  const blocked = status === 'rate_limited' || status === 'error' || status === 'revoked'
  const active = status === 'syncing'

  useEffect(() => {
    const was = prev.current
    prev.current = status
    if (was === 'syncing' && status && status !== 'syncing' && !blocked) {
      setJustDone(true)
      const t = setTimeout(() => setJustDone(false), 1800)
      return () => clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])

  const show = active || blocked || justDone
  const det = sync?.detail || {}
  const pct = Math.round((sync?.progress || 0) * 100)

  const title = justDone
    ? 'SYNC COMPLETE'
    : blocked
      ? status === 'rate_limited'
        ? 'SYNC · RATE LIMITED'
        : status === 'revoked'
          ? 'SYNC · ACCESS REVOKED'
          : 'SYNC · ERROR'
      : `SYNC · ${PHASE[sync?.phase] || 'WORKING'}`

  return (
    <AnimatePresence>
      {show && (
        <motion.aside
          aria-live='polite'
          className='fixed bottom-4 right-4 left-4 z-[90] sm:left-auto sm:w-[308px] border border-zinc-800 bg-[var(--app-bg)] px-4 py-3.5'
          initial={reduced ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduced ? { opacity: 0 } : { opacity: 0, y: 12 }}
          transition={{ duration: reduced ? 0 : 0.45, ease: [0.19, 1, 0.22, 1] }}
        >
          <div className='flex items-baseline justify-between'>
            <span className='label-s text-zinc-500'>{title}</span>
            <span className='label-s text-zinc-700 tabular-nums'>
              {justDone ? '100%' : blocked ? '—' : <><AnimatedNumber value={pct} />%</>}
            </span>
          </div>

          {!blocked && (
            <div className='mt-3 space-y-1.5'>
              <Row k='REPOSITORIES' v={pair(det.repos)} />
              <Row k='COMMIT HISTORY' v={`${pair(det.history)}${det.history?.commits ? ` · ${fmt.format(det.history.commits)}` : ''}`} />
              <Row k='PULL REQUESTS' v={det.pulls?.done ? `DONE${det.pulls?.count ? ` · ${fmt.format(det.pulls.count)}` : ''}` : 'PENDING'} />
            </div>
          )}
          {blocked && (
            <p className='label-s mt-3 leading-relaxed text-zinc-600'>
              {status === 'rate_limited'
                ? 'GitHub quota exhausted — sync resumes automatically when the limit resets.'
                : status === 'revoked'
                  ? 'Reconnect GitHub from the header to resume synchronization.'
                  : 'Synchronization failed — use the header sync control to retry.'}
            </p>
          )}

          <div className='mt-3.5 flex items-center gap-3'>
            <div className='h-px flex-1 bg-zinc-900'>
              <motion.div
                className='h-px bg-zinc-300 origin-left'
                animate={{ scaleX: justDone ? 1 : Math.max(sync?.progress || 0, 0.02) }}
                transition={{ duration: reduced ? 0 : 0.5, ease: 'easeOut' }}
              />
            </div>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  )
}

const Row = ({ k, v }) => (
  <div className='flex items-baseline justify-between font-mono text-[9.5px] tracking-[0.18em]'>
    <span className='text-zinc-700'>{k}</span>
    <span className='text-zinc-400 tabular-nums'>{v}</span>
  </div>
)
