import React, { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Icon } from '@iconify/react'
import { glossary } from './glossary'
import { useReducedMotion } from './motion'

const MAX_W = 320

function Tooltip({ id, term, definition, formula, note, style }) {
  const reduced = useReducedMotion()
  return (
    <motion.div
      id={id}
      role='tooltip'
      className='fixed z-[9999] border border-zinc-800 bg-[#0a0a0a] px-4 py-3 shadow-sm text-left'
      style={{ ...style, maxWidth: MAX_W, width: 'max-content' }}
      initial={{ opacity: 0, y: 4, filter: 'blur(2px)' }}
      animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      exit={{ opacity: 0, y: 2, filter: 'blur(2px)' }}
      transition={reduced ? { duration: 0 } : { duration: 0.16, ease: [0.23, 1, 0.32, 1] }}
    >
      <div className='text-[10px] uppercase tracking-[0.2em] text-zinc-200'>{term}</div>
      <div className='mt-2 text-[11px] leading-[1.45] text-zinc-500'>{definition}</div>
      {formula && (
        <div className='mt-2 text-[11px] leading-[1.45] text-zinc-400' style={{ fontFamily: "'Iowan Old Style','Palatino Linotype','Georgia',serif'" }}>
          {formula}
        </div>
      )}
      {note && <div className='mt-2 text-[10px] leading-[1.4] text-zinc-600'>{note}</div>}
    </motion.div>
  )
}

export function Term({ keyName, children, className = '', showIcon = false, as: Tag = 'span', ...rest }) {
  const reduced = useReducedMotion()
  const entry = glossary[keyName]
  if (!entry) return <Tag className={className} {...rest}>{children}</Tag>
  const triggerId = useId()
  const tooltipId = `${triggerId}-tooltip`
  const [open, setOpen] = useState(false)
  const [coords, setCoords] = useState(null)
  const showTimer = useRef(null)

  const place = useCallback((el) => {
    const rect = el?.getBoundingClientRect()
    if (!rect) return
    const vw = window.innerWidth
    const vh = window.innerHeight
    const below = vh - rect.bottom > 120
    const left = Math.max(12, Math.min(rect.left + rect.width / 2 - MAX_W / 2, vw - MAX_W - 12))
    if (below) {
      setCoords({ top: rect.bottom + 8, left })
    } else {
      setCoords({ bottom: vh - rect.top + 8, left })
    }
  }, [])

  const show = useCallback((e) => {
    const el = e.currentTarget
    clearTimeout(showTimer.current)
    showTimer.current = setTimeout(() => { place(el); setOpen(true) }, reduced ? 0 : 120)
  }, [place, reduced])

  const hide = useCallback(() => {
    clearTimeout(showTimer.current)
    setOpen(false)
  }, [])

  const onFocus = useCallback((e) => { place(e.currentTarget); setOpen(true) }, [place])

  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') hide() }
    const onScroll = () => { hide() }
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [open, hide])

  useEffect(() => () => clearTimeout(showTimer.current), [])

  return (
    <>
      <Tag
        className={`inline-flex items-center gap-1 outline-none ${className}`}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={onFocus}
        onBlur={hide}
        aria-describedby={open ? tooltipId : undefined}
        tabIndex={0}
        {...rest}
      >
        {children}
        {showIcon && (
          <Icon icon='ph:info' className='h-3 w-3 text-zinc-700' />
        )}
      </Tag>
      {open && createPortal(
        <Tooltip id={tooltipId} {...entry} style={coords} />,
        document.body
      )}
    </>
  )
}
