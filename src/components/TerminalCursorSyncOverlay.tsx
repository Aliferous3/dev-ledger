import { useEffect, useRef, useState } from 'react';
import { Num, NumPct } from '../ledger/Num';
import { useLedger } from '../store/live';

/* S10 · TERMINAL CURSOR
   Faithful to the supplied reference: one full-height 3px lime write head
   travels left→right across the viewport with a short terminal underline,
   a huge mono percentage behind it, and a subtly brightened written region.
   The cursor is driven only by Dev Ledger's canonical sync state. */

const LIME = '#d6ff3e';
const CURSOR_TWEEN_MS = 1800;
const COMPLETE_HOLD_MS = 2200;

function phaseLabel(phase?: string) {
  if (!phase) return 'WORKING';
  return phase.replace(/_/g, ' ').toUpperCase();
}

function syncTarget(
  freshPump: boolean,
  pumping: boolean,
  status: string | undefined,
  phase: string | undefined,
  progress: number | undefined,
) {
  // SYNC NOW flips pumping before the first response; ignore a stale
  // COMPLETE snapshot from the previous run until the backend reports the
  // new run. That gives every manual run a truthful left-edge start.
  if (freshPump) return 0;

  if (phase === 'done' || status === 'complete') {
    // While the POST loop is still unwinding, hold just short of the edge;
    // the confirmed completion transition supplies the final 100% leg.
    return pumping ? 99 : 100;
  }

  const n = Number(progress);
  if (!Number.isFinite(n)) return 0;

  // An active run can approach but not claim 100 before completion.
  return Math.min(99, Math.max(0, n * 100));
}

export function TerminalCursorSyncOverlay({
  previewProgress,
  previewPhase,
}: {
  previewProgress?: number;
  previewPhase?: string;
} = {}) {
  const { dash, pumping } = useLedger();
  const sync = dash.sync;
  const previewing = Number.isFinite(previewProgress);

  const [freshPump, setFreshPump] = useState(false);
  const prevPumping = useRef(pumping);

  useEffect(() => {
    const started = pumping && !prevPumping.current;
    prevPumping.current = pumping;
    if (started) setFreshPump(true);
    if (sync?.status === 'syncing' || !pumping) setFreshPump(false);
  }, [pumping, sync?.status]);

  // Same effective-state rule as SYNC.MON. A blocked/error state ends the
  // animation immediately rather than allowing a decorative overlay to lie.
  const syncing =
    previewing ||
    sync?.status === 'syncing' ||
    (pumping && (!sync || sync.status === 'idle' || sync.status === 'complete'));

  const [justDone, setJustDone] = useState(false);
  const wasSyncing = useRef(syncing);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(mq.matches);
    update();
    mq.addEventListener?.('change', update);
    return () => mq.removeEventListener?.('change', update);
  }, []);

  useEffect(() => {
    const was = wasSyncing.current;
    wasSyncing.current = syncing;

    if (syncing) {
      setJustDone(false);
      return;
    }

    if (was && (sync?.status === 'complete' || sync?.phase === 'done')) {
      setJustDone(true);
      const t = window.setTimeout(() => setJustDone(false), COMPLETE_HOLD_MS);
      return () => window.clearTimeout(t);
    }

    setJustDone(false);
  }, [syncing, sync?.status, sync?.phase]);

  if (!syncing && !justDone) return null;

  const p = previewing
    ? Math.max(0, Math.min(100, Number(previewProgress)))
    : justDone
      ? 100
      : syncTarget(
          freshPump,
          pumping,
          sync?.status,
          sync?.phase,
          sync?.progress,
        );

  const phase = previewing
    ? phaseLabel(previewPhase ?? 'commits')
    : justDone
      ? 'COMPLETE'
      : phaseLabel(sync?.phase);

  // Real sync updates arrive in discrete slices. The write head itself is a
  // compositor-friendly transform with a linear transition long enough to
  // bridge those observations, so it glides instead of stepping.
  const transformTransition = reducedMotion
    ? 'none'
    : previewing
      ? 'none'
      : `transform ${CURSOR_TWEEN_MS}ms linear`;

  const veilTransition = reducedMotion
    ? 'none'
    : previewing
      ? 'none'
      : `transform ${CURSOR_TWEEN_MS}ms linear`;

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-[88] overflow-hidden"
      data-sync-overlay="terminal-cursor-s10"
    >
      {/* S10 shell: 6% global dim; the written region is then brightened. */}
      <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,.06)' }} />

      {/* Written side of the record — scaleX keeps this GPU-friendly. */}
      <div
        className="absolute inset-0 origin-left"
        style={{
          background: 'rgba(255,255,255,.045)',
          transform: `scaleX(${p / 100})`,
          transition: veilTransition,
          willChange: 'transform',
        }}
      />

      {/* Giant three-digit terminal percentage behind the write head. */}
      <div className="absolute inset-0 flex items-center justify-center overflow-hidden">
        <Num
          value={Math.round(p)}
          format={{
            minimumIntegerDigits: 3,
            maximumFractionDigits: 0,
            useGrouping: false,
          }}
          animated={!reducedMotion}
          className="font-mono tabular-nums"
          style={{
            fontSize: 'clamp(120px,26vw,320px)',
            color: 'rgba(255,255,255,.05)',
            fontWeight: 700,
            letterSpacing: '-.04em',
            lineHeight: 1,
          }}
        />
      </div>

      {/* Full-height 3px lime write head + terminal underline. */}
      <div
        className="absolute inset-y-0 left-0"
        style={{
          transform: `translate3d(${p}vw,0,0)`,
          transition: transformTransition,
          willChange: 'transform',
        }}
      >
        <div
          className="absolute inset-y-0"
          style={{
            left: -1.5,
            width: 3,
            background: LIME,
            boxShadow: `0 0 14px ${LIME}`,
          }}
        />
        <div
          className="absolute bottom-[18%] -translate-x-1/2"
          style={{ width: 60, height: 3, background: LIME, left: 0 }}
        />
      </div>

      {/* Reference labels. */}
      <div className="absolute bottom-[9%] left-0 right-0">
        <div className="text-center">
          <span
            className="mono-tag text-[10px] tracking-[0.4em]"
            style={{ color: '#777' }}
          >
            {justDone ? 'SYNC COMPLETE' : `SYNCING · ${phase}`}
          </span>
        </div>
      </div>

      <div
        className="absolute top-4 left-4 mono-tag text-[8px] tabular-nums"
        style={{ color: '#555' }}
      >
        WRITE HEAD{' '}
        <NumPct
          value={p}
          format={{ maximumFractionDigits: 0 }}
          animated={!reducedMotion}
        />
      </div>

      <div
        className="absolute top-4 right-4 mono-tag text-[8px]"
        style={{ color: '#3a3a3a' }}
      >
        DEV LEDGER
      </div>

      {justDone && (
        <div
          className="absolute inset-0 flex items-center justify-center mono-tag text-[12px] tracking-[0.3em]"
          style={{ color: LIME }}
        >
          WRITE COMPLETE
        </div>
      )}
    </div>
  );
}
