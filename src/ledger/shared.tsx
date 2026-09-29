import { useEffect, useRef, useState } from 'react';
import { GRID, INTENSITY_BG, YEARS, COLS, type GridCell } from './data';
import { captureEvent } from '../analytics/posthog';
import { captureGoogleEvent } from '../analytics/ga4';
import { markLoginPending } from '../analytics/loginFunnel';

/* ---------- scroll reveal hook ---------- */
export function useReveal<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('is-visible'); io.unobserve(e.target); } }),
      { threshold: 0.12 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return ref;
}

/* ---------- prefers-reduced-motion ---------- */
export function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setReduced(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduced;
}

/* ---------- GitHub button → real OAuth ----------
   Phosphor terminal-command treatment: lime fill, black mono uppercase,
   sharp corners, left play indicator, thin dark baseline. */
export function GithubButton({ large = false, onLogin, remember = false }: { large?: boolean; onLogin?: () => void; remember?: boolean }) {
  const startLogin = () => {
    // Analytics only — the OAuth navigation itself is unchanged. The
    // pending flag lets the post-callback boot emit login_succeeded once.
    markLoginPending();
    captureEvent('github_login_started', {});
    captureGoogleEvent('login_start', { method: 'github' });
    window.location.assign(remember ? '/api/auth/login?remember=1' : '/api/auth/login');
  };
  return (
    <button
      onClick={onLogin ?? startLogin}
      className={`group relative flex items-center gap-2.5 bg-[#d6ff3e] text-black font-mono border-b-[3px] border-[#6f8f10] transition-colors duration-200 hover:bg-[#e4ff70] hover:border-black active:translate-y-px ${large ? 'px-6 py-3 text-[11px]' : 'px-5 py-2.5 text-[10px]'}`}
    >
      <span className="text-[9px] leading-none">▶</span>
      <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" /></svg>
      <span className="mono-tag font-semibold">&gt; continue on github</span>
      <span className="absolute bottom-0 left-0 h-[2px] w-0 bg-black/70 group-hover:w-full transition-all duration-300" />
    </button>
  );
}

/* ---------- the retained BOXES grid ---------- */
export function LedgerBoxes({
  setHovered, cell = 13, gap = 5, showYears = true, shimmer = false,
}: {
  hovered: GridCell | null;
  setHovered: (c: GridCell | null) => void;
  cell?: number; gap?: number; showYears?: boolean; shimmer?: boolean;
}) {
  return (
    <div className="flex gap-3">
      {showYears && (
        <div className="flex flex-col shrink-0" style={{ gap }}>
          {YEARS.map((y) => (
            <div key={y} className="mono-tag text-[10px] text-neutral-500 flex items-center" style={{ height: cell }}>
              {y}
            </div>
          ))}
        </div>
      )}
      <div className="grid flex-1" style={{ gridTemplateColumns: `repeat(${COLS}, minmax(0,1fr))`, gap }}>
        {GRID.map((c) => {
          return (
            <div
              key={c.id}
              onMouseEnter={() => setHovered(c)}
              onMouseLeave={() => setHovered(null)}
              className={`ledger-cell ${c.intensity >= 3 ? 'twinkle' : ''}`}
              style={{
                height: cell,
                minWidth: 4,
                background: INTENSITY_BG[c.intensity],
                animationDelay: `${c.twinkleDelay}s`,
                opacity: shimmer ? undefined : 1,
              }}
              title={`${c.year} · ${c.commits} commits`}
            />
          );
        })}
      </div>
    </div>
  );
}

/* ---------- hover readout for boxes ---------- */
export function BoxReadout({ hovered }: { hovered: GridCell | null }) {
  return (
    <div className="mono-tag text-[10px] h-4 text-neutral-500">
      {hovered ? (
        <span><span className="text-[#d6ff3e]">{hovered.year} · COL {String(hovered.col).padStart(2, '0')}</span> — {hovered.commits} commits · [{['∅','░','▒','▓','█'][hovered.intensity]}]</span>
      ) : (
        <span>HOVER FIELD TO INSPECT — {GRID.filter(g=>g.intensity>0).length} LIT CELLS</span>
      )}
    </div>
  );
}
