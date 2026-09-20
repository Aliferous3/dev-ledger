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
      {/* faint phosphor atmosphere bleeding into the black grid — restrained */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0"
        style={{ background: 'radial-gradient(ellipse 75% 45% at 50% 22%, rgba(214,255,62,0.05), transparent 70%)' }}
      />
      <div ref={ref} className="reveal relative w-full min-h-[calc(100vh-2rem)] sm:min-h-[calc(100vh-3rem)] border border-neutral-800 bg-black overflow-hidden glow-card">
        {/* window chrome — deliberately full width */}
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

        {/* reverse marquee — deliberately full width */}
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

        {/* all login content below the top chrome/ticker lives in one centered container */}
        <div className="relative p-6 md:p-10" style={{ containerType: 'inline-size' }}>
          <div className="absolute inset-0 terminal-grid-fine opacity-50 pointer-events-none" />

          <div className="relative mx-auto w-full max-w-[1180px] min-w-0 space-y-8">
            <div className="relative text-center">
              <div className="mono-tag text-[10px] text-[#d6ff3e]">BODY OF WORK — THE DEVELOPER'S RECORD</div>
              <h1 className="font-editorial font-light text-[clamp(2.8rem,7vw,5.5rem)] leading-none mt-3">DEV LEDGER</h1>
              <p className="font-editorial italic text-neutral-400 mt-2">Your GitHub history, made legible.</p>
            </div>

            {/* mission line — full content width, 22px single line on desktop,
                cqw-scaled only on narrow viewports */}
            <div className="relative min-w-0 w-[100cqw] ml-[calc((100%-100cqw)/2)] text-center">
              <p
                className="font-mono whitespace-nowrap max-md:whitespace-normal"
                style={{ fontSize: 'clamp(11px, 1.7cqw, 22px)', letterSpacing: '-0.1em' }}
              >
                <span className="hl">FROM YOUR FIRST COMMIT TO YOUR LATEST. TRACE WHAT YOU BUILT, WHEN YOU BUILT IT, AND HOW YOUR WORK CHANGED ALONG THE WAY.</span>
              </p>
            </div>

            <div className="relative border border-neutral-900 bg-[#0c0c0c]/80 p-4 md:p-6">
              <div className="mono-tag text-[9px] text-neutral-500 mb-3 flex justify-between"><span>$ git log --graph --oneline</span><span className="text-[#d6ff3e]">PACKET ▸ FLOWING</span></div>
              <BranchGraph layout="h" idPrefix="v2" />
            </div>

            <div className="relative border border-neutral-900 bg-[#0c0c0c]/80 p-4 md:p-6 overflow-hidden">
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
    </div>
  );
}
