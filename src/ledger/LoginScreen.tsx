import { useEffect, useState } from 'react';
import type { GridCell } from './data';
import { BranchGraph } from './BranchGraph';
import { LedgerBoxes, BoxReadout, GithubButton, useReveal, usePrefersReducedMotion } from './shared';

/* LEDGER.02 — CONSOLE STACK · terminal window, typewriter, packet line.
   The Dev Ledger login screen: Variant02 internals verbatim, scaled to a
   full-viewport page. CTA wires to the real /api/auth/login OAuth flow. */
const TYPE_LINES = ['> ledger --init', '// commits become chronology', '// chronology becomes a body of work', '> connect github --live'];

export function LoginScreen() {
  const [hovered, setHovered] = useState<GridCell | null>(null);
  const [typed, setTyped] = useState(0);
  const ref = useReveal<HTMLDivElement>();
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    if (reduced) return;
    const t = setInterval(() => setTyped((v) => (v + 1) % (TYPE_LINES.join('').length + 30)), 55);
    return () => clearInterval(t);
  }, [reduced]);

  const full = TYPE_LINES.join('\n');
  const shown = reduced ? full : full.slice(0, typed);

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-neutral-100 px-3 sm:px-5 lg:px-6 py-4 sm:py-6">
      <div ref={ref} className="reveal relative w-full min-h-[calc(100vh-2rem)] sm:min-h-[calc(100vh-3rem)] border border-neutral-800 bg-black overflow-hidden glow-card">
        {/* window chrome */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-neutral-900 bg-[#0e0e0e]">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-[#2a2a2a]" />
            <span className="w-2.5 h-2.5 rounded-full bg-[#2a2a2a]" />
            <span className="w-2.5 h-2.5 rounded-full bg-[#d6ff3e] orb-pulse" />
            <span className="mono-tag text-[10px] text-neutral-400 ml-3">dev-ledger — zsh — 80×24</span>
          </div>
          <div className="mono-tag text-[9px] text-neutral-600 hidden sm:flex items-center gap-3">
            <span>UTF-8</span><span>Ln 01, Col 01</span><span className="text-[#d6ff3e]">● LIVE</span>
          </div>
        </div>
        {/* reverse marquee */}
        <div className="overflow-hidden border-b border-neutral-900 py-1 bg-[#0a0a0a]">
          <div className="marquee-track-rev flex whitespace-nowrap mono-tag text-[9px] text-neutral-600">
            {[0, 1].map((k) => (
              <span key={k} className="flex shrink-0">
                {Array.from({ length: 8 }).map((_, i) => (
                  <span key={i} className="px-6">LEDGER.STACK ◆ {2026 - (i % 8)} ◆ +{(412 - i * 37).toLocaleString()} <span className="text-[#d6ff3e]">·</span></span>
                ))}
              </span>
            ))}
          </div>
        </div>

        <div className="p-6 md:p-10 space-y-8 relative">
          <div className="absolute inset-0 terminal-grid-fine opacity-50 pointer-events-none" />
          <div className="relative text-center">
            <div className="mono-tag text-[10px] text-[#d6ff3e]">BODY OF WORK — THE DEVELOPER'S RECORD</div>
            <h1 className="font-editorial font-light text-[clamp(2.8rem,7vw,5.5rem)] leading-none mt-3 shimmer-text">DEV LEDGER</h1>
            <p className="font-editorial italic text-neutral-400 mt-2">Your GitHub history, made legible.</p>
          </div>

          <div className="relative border border-neutral-900 bg-[#0c0c0c]/80 p-4 md:p-6">
            <div className="mono-tag text-[9px] text-neutral-500 mb-3 flex justify-between"><span>$ git log --graph --oneline</span><span className="text-[#d6ff3e]">PACKET ▸ FLOWING</span></div>
            <BranchGraph layout="h" idPrefix="v2" />
          </div>

          <div className="relative border border-neutral-900 bg-[#0c0c0c]/80 p-4 md:p-6 overflow-hidden">
            <div className="pointer-events-none absolute inset-0 overflow-hidden"><div className="scan-line-vert absolute left-0 right-0 h-1/4 bg-gradient-to-b from-transparent via-[#d6ff3e]/[0.06] to-transparent" /></div>
            <div className="relative">
              <LedgerBoxes hovered={hovered} setHovered={setHovered} cell={12} gap={4} />
              <div className="mt-3"><BoxReadout hovered={hovered} /></div>
            </div>
          </div>

          <div className="grid md:grid-cols-[1fr_auto] gap-6 items-end">
            <pre className="font-mono text-[12px] leading-6 text-neutral-400 whitespace-pre-wrap min-h-[96px]">{shown}<span className="type-caret text-[#d6ff3e]">▌</span></pre>
            <GithubButton />
          </div>
        </div>
      </div>
    </div>
  );
}
