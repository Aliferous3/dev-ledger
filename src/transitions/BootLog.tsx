import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePrefersReducedMotion } from '../ledger/shared';

/* ------------------------------------------------------------------ */
/*  06 · Boot Log — canonical page/view transition for Dev Ledger.     */
/*  Extracted from the design study (PageTransitions.tsx, key 'boot'). */
/*  Sequencing: overlay covers → onCovered swaps the destination →     */
/*  overlay clears. Reduced motion gets a short static equivalent.     */
/* ------------------------------------------------------------------ */

const COVER_MS = 720;
const DONE_MS = 1450;

function BootLog({ label, leaving }: { label: string; leaving: boolean }) {
  const lines = [
    '[  OK  ] Started dev-ledger.service',
    '[  OK  ] Reached target Phosphor Desktop',
    '[  OK  ] Mounting chronology volumes ...',
    '[  3.2s] parsed 1,782 commits across 7 repos',
    `[  4.8s] loading ${label || 'next view'}`,
    '[ ....] syncing phosphor buffer',
    '[  OK  ] transition complete',
  ];
  return (
    <div className="absolute inset-0 bg-black font-mono text-[13px] text-[#d6ff3e] overflow-hidden">
      <div className="absolute inset-0 terminal-grid-fine opacity-40" />
      <div className="absolute inset-0 flex items-center justify-center px-6 text-center">
        <div className="w-full max-w-3xl text-left space-y-1 px-4">
          <div className="mono-tag text-[10px] text-neutral-400 mb-4">
            {leaving ? '◉ POWERING DOWN' : '◉ POWER ON SELF TEST'}
          </div>
          {lines.map((l, i) => (
            <div key={i} className="boot-line opacity-0 flex gap-3" style={{ animationDelay: `${i * 90}ms`, animationDirection: leaving ? 'reverse' : 'normal' }}>
              <span className="opacity-50 tabular-nums">[{(i * 0.7).toFixed(1)}s]</span>
              <span>{l}</span>
            </div>
          ))}
          <div className="mt-4 flex items-center gap-2 text-[#d6ff3e]"><span className="blink">▌</span></div>
        </div>
      </div>
      <div className="absolute bottom-1 left-0 right-0 h-1 bg-[#d6ff3e]/70 progress-bar" />
      <style>{`
        .boot-line { animation: boot 320ms ease forwards; }
        @keyframes boot { from { opacity:0; transform: translateY(4px);} to { opacity:1; transform:none; } }
        .progress-bar { transform-origin: left; transform: scaleX(0); animation: pbar 1.2s cubic-bezier(.2,.7,.2,1) forwards; }
        @keyframes pbar { to { transform: scaleX(1); } }
        .blink { animation: blink 1s step-end infinite; }
        @keyframes blink { 50% { opacity: 0; } }
      `}</style>
    </div>
  );
}

export function BootLogOverlay({
  active,
  label = '',
  onCovered,
  onDone,
}: {
  active: boolean;
  label?: string;
  onCovered?: () => void;
  onDone?: () => void;
}) {
  const reduced = usePrefersReducedMotion();
  const [phase, setPhase] = useState<'in' | 'out' | 'idle'>('idle');

  useEffect(() => {
    if (!active) { setPhase('idle'); return; }
    setPhase('in');
    if (reduced) {
      // non-animated equivalent: swap immediately, brief static flash
      const t0 = setTimeout(() => onCovered?.(), 60);
      const t2 = setTimeout(() => { setPhase('idle'); onDone?.(); }, 260);
      return () => { clearTimeout(t0); clearTimeout(t2); };
    }
    const t1 = setTimeout(() => { setPhase('out'); onCovered?.(); }, COVER_MS);
    const t2 = setTimeout(() => { setPhase('idle'); onDone?.(); }, DONE_MS);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [active, reduced]);

  if (phase === 'idle') return null;
  return (
    <div className="fixed inset-0 z-[80]" aria-hidden>
      <BootLog label={label} leaving={phase === 'out'} />
    </div>
  );
}

/* Fires the Boot Log overlay; `action` runs while the screen is covered. */
export function useBootTransition() {
  const [firing, setFiring] = useState(false);
  const [label, setLabel] = useState('');
  const action = useRef<(() => void) | null>(null);
  const done = useRef<(() => void) | null>(null);

  const fire = useCallback((nextLabel: string, act: () => void, after?: () => void) => {
    if (firing) return;
    action.current = act;
    done.current = after ?? null;
    setLabel(nextLabel);
    setFiring(true);
  }, [firing]);

  // Portal to body — a `fixed` overlay inside a transformed ancestor (e.g.
  // the translated sidebar) would be clipped to that ancestor's box.
  const overlay = createPortal(
    <BootLogOverlay
      active={firing}
      label={label}
      onCovered={() => action.current?.()}
      onDone={() => {
        setFiring(false);
        action.current = null;
        done.current?.();
        done.current = null;
      }}
    />,
    document.body
  );

  return { firing, fire, overlay };
}
