import { useEffect, useState } from 'react';
import type { GridCell } from './data';
import { BranchGraph } from './BranchGraph';
import { LedgerBoxes, BoxReadout, GithubButton, useReveal, usePrefersReducedMotion } from './shared';
import { VapourTitle } from './VapourTitle';
import { m12Delay, registerM12 } from './m12';

/* LEDGER.02 — CONSOLE STACK · terminal window, typewriter, packet line.
   The Dev Ledger login screen: Variant02 internals verbatim, scaled to a
   full-viewport page. CTA wires to the real /api/auth/login OAuth flow. */
const TYPE_LINES = ['> ledger --init', '// commits become chronology', '// chronology becomes a body of work', '> connect github --live'];

export function LoginScreen({ onLogin }: { onLogin?: () => void }) {
  const [hovered, setHovered] = useState<GridCell | null>(null);
  const [typed, setTyped] = useState(0);
  // Opt-in persistent session (30-day cookie); unchecked = browser-session
  // cookie that ends when the browser closes.
  const [remember, setRemember] = useState(false);
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
        {/* window chrome — deliberately full width; M12 applies it first
            as the registration mark the rest of the page diffs onto */}
        <div ref={registerM12} style={m12Delay(0)} className="m12 relative flex items-center justify-between px-4 py-2.5 border-b border-neutral-900 bg-[#0e0e0e]">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#2a2a2a]" />
            <span className="w-2 h-2 rounded-full bg-[#2a2a2a]" />
            <span className="w-2 h-2 rounded-full bg-[#d6ff3e] orb-pulse" />
            <span className="mono-tag text-[9px] text-neutral-400 ml-3">dev-ledger — zsh — 80×24</span>
          </div>
          <div className="mono-tag text-[9px] text-neutral-600 hidden sm:flex items-center gap-3">
            <span>UTF-8</span><span>Ln 01, Col 01</span><span className="text-[#d6ff3e]">● LIVE</span>
          </div>
        </div>

        {/* reverse marquee — deliberately full width */}
        <div ref={registerM12} style={m12Delay(1)} className="m12 relative overflow-hidden border-b border-neutral-900 py-1 bg-[#0a0a0a]">
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
        <div className="relative p-5 md:p-8" style={{ containerType: 'inline-size' }}>
          <div className="absolute inset-0 terminal-grid-fine opacity-50 pointer-events-none" />

          <div className="relative mx-auto w-full max-w-[960px] min-w-0 space-y-6">
            <div className="relative text-center">
              <div ref={registerM12} style={m12Delay(2)} className="m12 relative mono-tag text-[9px] text-[#d6ff3e]">BODY OF WORK — THE DEVELOPER'S RECORD</div>
              {/* Vapour coalescence on the title — canvas particles resolve
                  into the real h1 once, then the simulation stops. Reduced
                  motion renders the title immediately. */}
              <VapourTitle
                text="DEV LEDGER"
                className="font-editorial font-light text-[clamp(2.4rem,6.2vw,5.6rem)] leading-none mt-2"
              />
              <p ref={registerM12} style={m12Delay(3)} className="m12 relative font-editorial italic text-sm text-neutral-400 mt-2">Your GitHub history, made legible.</p>
            </div>

            {/* mission line — full content width, 22px single line on desktop,
                cqw-scaled only on narrow viewports */}
            <div ref={registerM12} style={m12Delay(4)} className="m12 relative min-w-0 w-[100cqw] ml-[calc((100%-100cqw)/2)] text-center">
              <p
                className="font-mono whitespace-nowrap max-md:whitespace-normal"
                style={{ fontSize: 'clamp(11px, 1.7cqw, 22px)', letterSpacing: '-0.1em' }}
              >
                FROM YOUR FIRST COMMIT TO YOUR LATEST. TRACE WHAT YOU BUILT, WHEN YOU BUILT IT, AND HOW YOUR WORK CHANGED ALONG THE WAY.
              </p>
            </div>

            <div ref={registerM12} style={m12Delay(5)} className="m12 relative border border-neutral-900 bg-[#0c0c0c]/80 p-3 md:p-5">
              <div className="mono-tag text-[9px] text-neutral-500 mb-2 flex justify-between"><span>$ git log --graph --oneline</span><span className="text-[#d6ff3e]">PACKET ▸ FLOWING</span></div>
              <BranchGraph layout="h" idPrefix="v2" />
            </div>

            <div ref={registerM12} style={m12Delay(6)} className="m12 relative border border-neutral-900 bg-[#0c0c0c]/80 p-3 md:p-5 overflow-hidden">
              <div className="relative">
                <LedgerBoxes hovered={hovered} setHovered={setHovered} cell={10} gap={3} />
                <div className="mt-2"><BoxReadout hovered={hovered} /></div>
              </div>
            </div>

            <div className="relative grid md:grid-cols-[1fr_auto] gap-5 items-end">
              <pre ref={registerM12} style={m12Delay(7)} className="m12 relative font-mono text-[10px] leading-5 text-neutral-400 whitespace-pre-wrap min-h-[80px]">{shown}<span className="type-caret text-[#d6ff3e]">▌</span></pre>
              <div className="flex flex-col items-start md:items-end gap-2.5">
                {/* Controls stay clickable while their entrance plays —
                    .m12-wait is opacity-only, never pointer-events. */}
                <label ref={registerM12} style={m12Delay(8)} className="m12 relative mono-tag text-[9px] text-neutral-500 flex items-center gap-2 cursor-pointer select-none hover:text-neutral-300 transition-colors">
                  <input
                    type="checkbox"
                    checked={remember}
                    onChange={(e) => setRemember(e.target.checked)}
                    className="h-3 w-3 accent-[#d6ff3e] cursor-pointer"
                  />
                  KEEP ME SIGNED IN
                </label>
                <div ref={registerM12} style={m12Delay(9)} className="m12 relative">
                  <GithubButton onLogin={onLogin} remember={remember} />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
