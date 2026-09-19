import React, { useCallback, useEffect, useRef, useState } from 'react'
import { seedTopology, addCommit, nearestNode, edgePath, TOPO_W, TOPO_H } from './gitGraph'

/* Interactive Git-topology toy for the login page's left field.
   Decorative (aria-hidden) — pointer-only, never traps focus.
   React state updates only on discrete interactions (click/drag/dblclick);
   entrances and edge draws are pure CSS/SVG animation. */

let labelKey = 0

function MiniTopo() {
  // Static simplified motif for md–lg widths.
  return (
    <svg viewBox='0 0 210 74' className='block h-auto w-[210px]' aria-hidden='true'>
      <path d='M10 40 L62 40 L114 40 L166 40' stroke='#3f3f46' strokeWidth='1' fill='none' />
      <path d='M114 40 C 140 40, 138 60, 162 60 L186 60' stroke='#3f3f46' strokeWidth='1' fill='none' />
      <path d='M166 40 C 188 40, 186 20, 200 20' stroke='#3f3f46' strokeWidth='1' fill='none' />
      {[10, 62, 114, 166].map((x) => (
        <circle key={x} cx={x} cy={40} r={4.5} fill='var(--app-bg)' stroke='#a1a1aa' strokeWidth='1' />
      ))}
      <circle cx={186} cy={60} r={4.5} fill='var(--app-bg)' stroke='#71717a' strokeWidth='1' />
      <circle cx={200} cy={20} r={4.5} fill='var(--app-bg)' stroke='#71717a' strokeWidth='1' />
    </svg>
  )
}

export default function GitTopology({ className = '', mini = false, base = 2.0 }) {
  const [topo, setTopo] = useState(() => seedTopology({ base }))
  const [drag, setDrag] = useState(null)
  const [hoverId, setHoverId] = useState(null)
  const [labels, setLabels] = useState([])
  const svgRef = useRef(null)
  const pressRef = useRef(null)

  const flash = useCallback((text, x, y) => {
    const k = ++labelKey
    setLabels((ls) => [...ls, { k, text, x: Math.min(x + 10, TOPO_W - 62), y: Math.max(y - 14, 12) }])
    setTimeout(() => setLabels((ls) => ls.filter((l) => l.k !== k)), 1700)
  }, [])

  // Transient HEAD marker once the seed settles.
  useEffect(() => {
    const last = topo.nodes.find((n) => n.id === topo.lastMain)
    const t = setTimeout(() => last && flash('HEAD', last.x, last.y), (base + topo.nodes.length * 0.14 + 0.6) * 1000)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const toSvg = useCallback((e) => {
    const r = svgRef.current.getBoundingClientRect()
    return {
      x: (e.clientX - r.left) * (TOPO_W / r.width),
      y: (e.clientY - r.top) * (TOPO_H / r.height),
    }
  }, [])

  const commit = useCallback((parentId, at, text) => {
    setTopo((t) => {
      const next = addCommit(t, parentId, at)
      const n = next.nodes.find((m) => m.id === next.added)
      if (n) setTimeout(() => flash(text, n.x, n.y), 200)
      return next
    })
  }, [flash])

  const onNodeDown = (e, id) => {
    e.preventDefault()
    pressRef.current = { id, p: toSvg(e), moved: false }
    svgRef.current.setPointerCapture?.(e.pointerId)
  }

  const onMove = (e) => {
    const pr = pressRef.current
    if (!pr) return
    const p = toSvg(e)
    if (!pr.moved && Math.hypot(p.x - pr.p.x, p.y - pr.p.y) > 8) pr.moved = true
    if (pr.moved) setDrag({ from: pr.id, x: p.x, y: p.y })
  }

  const onUp = () => {
    const pr = pressRef.current
    pressRef.current = null
    if (!pr) return
    if (pr.moved && drag) commit(pr.id, { x: drag.x, y: drag.y }, 'BRANCH')
    else if (!pr.moved) commit(pr.id, null, 'COMMIT')
    setDrag(null)
  }

  const onDblClick = (e) => {
    const p = toSvg(e)
    const n = nearestNode(topo, p.x, p.y)
    if (n) commit(n.id, p, 'BRANCH')
  }

  if (mini) return <MiniTopo />

  const dragFrom = drag ? topo.nodes.find((n) => n.id === drag.from) : null

  return (
    <div className={className} aria-hidden='true'>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${TOPO_W} ${TOPO_H}`}
        className='block h-auto w-full select-none'
        style={{ touchAction: 'none' }}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => { pressRef.current = null; setDrag(null) }}
        onDoubleClick={onDblClick}
      >
        {topo.edges.map((e) => {
          const a = topo.nodes.find((n) => n.id === e.a)
          const b = topo.nodes.find((n) => n.id === e.b)
          if (!a || !b) return null
          const lit = hoverId && (e.a === hoverId || e.b === hoverId)
          return (
            <path
              key={e.id}
              d={edgePath(a, b)}
              pathLength={1}
              className={`topo-edge${lit ? ' topo-edge-lit' : ''}`}
              style={{ animationDelay: `${e.d}s` }}
            />
          )
        })}
        {drag && dragFrom && (
          <line
            x1={dragFrom.x} y1={dragFrom.y} x2={drag.x} y2={drag.y}
            className='topo-guide'
          />
        )}
        {topo.nodes.map((n) => (
          <g
            key={n.id}
            className='topo-node'
            style={{ animationDelay: `${n.d}s` }}
            onPointerDown={(e) => onNodeDown(e, n.id)}
            onPointerEnter={() => setHoverId(n.id)}
            onPointerLeave={() => setHoverId((h) => (h === n.id ? null : h))}
          >
            <circle cx={n.x} cy={n.y} r={11} fill='transparent' />
            <circle cx={n.x} cy={n.y} r={4.5} className='topo-node-core' />
          </g>
        ))}
        {drag && (
          <circle cx={drag.x} cy={drag.y} r={4.5} className='topo-node-ghost' />
        )}
        {labels.map((l) => (
          <text key={l.k} x={l.x} y={l.y} className='topo-label'>
            {l.text}
          </text>
        ))}
      </svg>

    </div>
  )
}
