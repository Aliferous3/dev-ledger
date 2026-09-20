import { useState } from 'react';
import { BRANCH_NODES } from './data';
import { usePrefersReducedMotion } from './shared';

/* Retained branch: click a node → branch expands with detail.
   orientation h = left-panel horizontal (original), v = vertical rail. */

export function BranchGraph({ layout = 'h', idPrefix = 'b' }: { layout?: 'h' | 'v'; idPrefix?: string }) {
  const [selected, setSelected] = useState<string>('n2');
  const [expanded, setExpanded] = useState(true);

  if (layout === 'v') return <VerticalBranch selected={selected} setSelected={setSelected} expanded={expanded} setExpanded={setExpanded} idPrefix={idPrefix} />;
  return <HorizontalBranch selected={selected} setSelected={setSelected} expanded={expanded} setExpanded={setExpanded} idPrefix={idPrefix} />;
}

function HorizontalBranch({ selected, setSelected, expanded, setExpanded, idPrefix }: any) {
  const reduced = usePrefersReducedMotion();
  const sel = BRANCH_NODES.find((n) => n.id === selected)!;
  const W = 1000, H = 260;

  const mainPath = expanded
    ? 'M 20 130 C 180 128, 300 132, 400 130 S 640 128, 740 130 S 860 120, 945 60'
    : 'M 20 130 C 220 128, 480 132, 740 130 S 860 122, 900 70';
  const forkPath = expanded
    ? 'M 400 130 C 420 160, 440 190, 470 208 L 640 208'
    : 'M 400 130 C 425 165, 445 190, 470 205 L 560 206';

  return (
    <div>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto overflow-visible">
          <defs>
            <filter id={`${idPrefix}-glow`} x="-60%" y="-60%" width="220%" height="220%">
              <feGaussianBlur stdDeviation="5" result="b" />
              <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>
          {/* ghost grid */}
          {[40, 90, 140, 190, 240].map((y) => (
            <line key={y} x1="0" y1={y} x2={W} y2={y} stroke="#161616" strokeWidth="1" />
          ))}
          {/* main + fork lines */}
          <path d={mainPath} fill="none" stroke="#3a3a3a" strokeWidth="1.5" />
          <path d={mainPath} fill="none" stroke="#d6ff3e" strokeWidth="1.5" strokeDasharray="6 10" className="dash-flow" opacity="0.85" />
          <path d={forkPath} fill="none" stroke="#3a3a3a" strokeWidth="1.25" />
          <path d={forkPath} fill="none" stroke="#8a8a8a" strokeWidth="1.25" strokeDasharray="4 8" className="dash-flow-slow" opacity="0.8" />
          {/* traveling packet — SMIL motion suppressed under prefers-reduced-motion */}
          {!reduced && (
            <>
              <circle r="4" fill="#d6ff3e" filter={`url(#${idPrefix}-glow)`}>
                <animateMotion dur="5s" repeatCount="indefinite" path={mainPath} />
              </circle>
              <circle r="2.5" fill="#fff" opacity="0.9">
                <animateMotion dur="7s" repeatCount="indefinite" path={forkPath} />
              </circle>
            </>
          )}

          {BRANCH_NODES.filter((n) => expanded || n.kind === 'main').map((n) => {
            const isSel = selected === n.id;
            return (
              <g key={n.id} className="branch-node" onClick={() => { setSelected(n.id); setExpanded(true); }}>
                {isSel && (
                  <>
                    <circle cx={n.x} cy={n.y} r="16" fill="none" stroke="#d6ff3e" strokeWidth="1" opacity="0.7" className="ping-ring" style={{ transformOrigin: `${n.x}px ${n.y}px` }} />
                    <circle cx={n.x} cy={n.y} r="13" fill="rgba(214,255,62,.12)" stroke="#d6ff3e" strokeWidth="1" strokeDasharray="3 3" className="spin-slow" style={{ transformOrigin: `${n.x}px ${n.y}px` }} />
                  </>
                )}
                <circle className="node-ring" cx={n.x} cy={n.y} r={isSel ? 8 : 6} fill="#0a0a0a" stroke={isSel ? '#d6ff3e' : '#9a9a9a'} strokeWidth="1.5" />
                <circle className="node-core" cx={n.x} cy={n.y} r={isSel ? 3 : 2} fill={isSel ? '#d6ff3e' : '#e8e8e8'} />
                <text x={n.x} y={n.y - 14} textAnchor="middle" fill={isSel ? '#d6ff3e' : '#737373'} fontSize="10" fontFamily="JetBrains Mono" letterSpacing="1">{n.label}</text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* expanding detail — the "branch expands when clicked" */}
      <div className="mt-3">
        <button onClick={() => setExpanded(!expanded)} className="mono-tag text-[9px] text-neutral-500 hover:text-[#d6ff3e] transition-colors">
          {expanded ? '[-] COLLAPSE TRACE' : '[+] EXPAND TRACE'} · CLICK A NODE · DRAG TO BRANCH
        </button>
        <div className={`grid transition-all duration-500 ease-[cubic-bezier(.2,.7,.2,1)] ${expanded ? 'grid-rows-[1fr] opacity-100 mt-2' : 'grid-rows-[0fr] opacity-0'}`}>
          <div className="overflow-hidden">
            <div className="border border-neutral-800 bg-black/60 p-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="mono-tag text-[10px] text-[#d6ff3e] truncate">{sel.hash} · {sel.msg}</div>
                <div className="mono-tag text-[9px] text-neutral-500 mt-1">{sel.date} · {sel.lines} · {sel.label}</div>
              </div>
              <div className="flex gap-1 shrink-0">
                {[0, 1, 2, 3, 4, 5, 6].map((i) => (
                  <span key={i} className="eq-bar w-[3px] bg-[#d6ff3e]/80" style={{ height: 18, animationDelay: `${i * 0.12}s` }} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function VerticalBranch({ selected, setSelected, expanded, setExpanded }: any) {
  const reduced = usePrefersReducedMotion();
  // map horizontal coords into vertical rail space
  const order = ['n0', 'n1', 'n2', 'f0', 'n3', 'f1', 'n4', 'h0'];
  const pos: Record<string, { x: number; y: number }> = {
    n0: { x: 30, y: 20 }, n1: { x: 30, y: 90 }, n2: { x: 30, y: 160 },
    f0: { x: 62, y: 195 }, n3: { x: 30, y: 230 }, f1: { x: 62, y: 255 },
    n4: { x: 30, y: 300 }, h0: { x: 30, y: 370 },
  };
  return (
    <div className="flex gap-4">
      <div className="relative shrink-0">
        <svg viewBox="0 0 90 400" className="h-[420px] w-auto overflow-visible">
          <line x1="30" y1="8" x2="30" y2="392" stroke="#2a2a2a" strokeWidth="1.5" />
          <line x1="30" y1="8" x2="30" y2="392" stroke="#d6ff3e" strokeWidth="1.5" strokeDasharray="5 9" className="dash-flow" opacity="0.8" />
          <path d="M30 160 C 48 172, 52 184, 62 195 M30 230 C 48 240, 52 248, 62 255" fill="none" stroke="#555" strokeWidth="1.25" strokeDasharray="4 6" className="dash-flow-slow" />
          {!reduced && (
            <circle r="3.5" fill="#d6ff3e">
              <animateMotion dur="6s" repeatCount="indefinite" path="M30 8 L30 392" />
            </circle>
          )}
          {order.map((id) => {
            const p = pos[id];
            const isSel = selected === id;
            return (
              <g key={id} className="branch-node" onClick={() => { setSelected(id); setExpanded(true); }}>
                {isSel && <circle cx={p.x} cy={p.y} r="12" fill="none" stroke="#d6ff3e" className="ping-ring" style={{ transformOrigin: `${p.x}px ${p.y}px` }} />}
                <circle cx={p.x} cy={p.y} r={isSel ? 7 : 5} fill="#0a0a0a" stroke={isSel ? '#d6ff3e' : '#9a9a9a'} strokeWidth="1.5" />
                <circle cx={p.x} cy={p.y} r="2" fill={isSel ? '#d6ff3e' : '#e8e8e8'} />
              </g>
            );
          })}
        </svg>
      </div>
      <div className="flex-1 min-w-0 space-y-2 py-1">
        {order.map((id) => {
          const n = BRANCH_NODES.find((b) => b.id === id)!;
          const isSel = selected === id;
          return (
            <button key={id} onClick={() => { setSelected(id); setExpanded(!isSel ? true : expanded); }}
              className={`w-full text-left border px-3 py-2 transition-all duration-300 ${isSel ? 'border-[#d6ff3e]/60 bg-[#d6ff3e]/5' : 'border-neutral-900 bg-black/40 hover:border-neutral-700'}`}>
              <div className={`mono-tag text-[9px] truncate ${isSel ? 'text-[#d6ff3e]' : 'text-neutral-400'}`}>{n.label} · {n.hash}</div>
              <div className={`grid transition-all duration-400 ${isSel && expanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
                <div className="overflow-hidden">
                  <div className="mono-tag text-[9px] text-neutral-500 pt-1 normal-case tracking-normal">{n.msg}<br />{n.date} · {n.lines}</div>
                </div>
              </div>
            </button>
          );
        })}
        <div className="mono-tag text-[8px] text-neutral-600 pt-1">CLICK NODE → RAIL EXPANDS</div>
      </div>
    </div>
  );
}
