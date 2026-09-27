import { useEffect, useRef, useState } from 'react';
import { useLedger } from '../store/live';
import { NumPct } from '../ledger/Num';

/* S15 · SIGNAL WEAVE
   Adapted directly from the supplied sync-overlay prototype. The overlay is
   purely visual (pointer-events:none) and covers the viewport whenever the
   canonical Dev Ledger sync state is actively working. It leaves the existing
   SYNC.MON controls usable above it and never invents a second sync state. */

const LIME = '#d6ff3e';
const REAL_SYNC_TWEEN_MS = 1450;
const COMPLETE_HOLD_MS = 1750;

function phaseLabel(phase?: string) {
  if (!phase) return 'WORKING';
  return phase.replace(/_/g, ' ').toUpperCase();
}

function activeProgress(
  pumping: boolean,
  status: string | undefined,
  progress: number | undefined,
) {
  // The instant SYNC NOW is pressed the store sets pumping=true before the
  // first response arrives. If the held snapshot is an old COMPLETE row its
  // progress may still be 1, so start the new weave at zero rather than 99%.
  if (pumping && status !== 'syncing') return 0;
  const n = Number(progress);
  if (!Number.isFinite(n)) return 0;
  return Math.min(99, Math.max(0, n * 100));
}

export function SignalWeaveSyncOverlay({
  previewProgress,
  previewPhase,
}: {
  previewProgress?: number;
  previewPhase?: string;
} = {}) {
  const { dash, pumping } = useLedger();
  const sync = dash.sync;
  // Match SYNC.MON's effective-status rule exactly: a local pump counts as
  // active before the first response only while the held server state is
  // idle/complete. A real blocked/error state immediately stops the weave.
  const previewing = Number.isFinite(previewProgress);
  const syncing =
    previewing ||
    sync?.status === 'syncing' ||
    (pumping && (!sync || sync.status === 'idle' || sync.status === 'complete'));
  const [justDone, setJustDone] = useState(false);
  const wasSyncing = useRef(syncing);

  useEffect(() => {
    const was = wasSyncing.current;
    wasSyncing.current = syncing;

    if (syncing) {
      setJustDone(false);
      return;
    }

    if (
      was &&
      (sync?.status === 'complete' || sync?.phase === 'done')
    ) {
      setJustDone(true);
      const t = window.setTimeout(() => setJustDone(false), COMPLETE_HOLD_MS);
      return () => window.clearTimeout(t);
    }

    setJustDone(false);
  }, [syncing, sync?.status, sync?.phase]);

  if (!syncing && !justDone) return null;

  const p = previewing
    ? Math.max(0, Math.min(100, Math.round(Number(previewProgress))))
    : justDone
      ? 100
      : activeProgress(pumping, sync?.status, sync?.progress);
  const hx = p;
  // Keep S15's faster vertical lead, but do not let it hit the bottom early
  // and sit there while the horizontal axis keeps moving. This continuous
  // lead curve reaches 100 only when H reaches 100, so the weave stays alive
  // and visually balanced for the entire sync.
  const t = Math.max(0, Math.min(1, p / 100));
  const vy = 100 * (1 - Math.pow(1 - t, 1.6));
  // Real sync state arrives in ~1.5s slices. Tween almost the whole interval
  // so each new target retimes from the current rendered position instead of
  // jumping in short 150ms bursts. Preview mode already updates every frame.
  const tweenMs = previewing ? 90 : REAL_SYNC_TWEEN_MS;
  const motionTransition = `all ${tweenMs}ms linear`;
  const phase = previewing
    ? phaseLabel(previewPhase ?? 'commits')
    : justDone
      ? 'COMPLETE'
      : phaseLabel(sync?.phase);

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-[88] overflow-hidden"
      data-sync-overlay="signal-weave-s15"
    >
      {/* Reference S15 uses a very light full-screen dim so the write head
          remains legible without hiding the dashboard underneath. */}
      <div className="absolute inset-0 bg-black/10" />

      {/* Horizontal scan: unresolved guide + resolved lime segment. */}
      <div
        className="absolute left-0 right-0 h-px motion-reduce:transition-none"
        style={{ top: `${vy}%`, background: 'rgba(214,255,62,.45)', transition: motionTransition, willChange: 'top' }}
      />
      <div
        className="absolute left-0 h-px motion-reduce:transition-none"
        style={{
          top: `${vy}%`,
          width: `${hx}%`,
          background: LIME,
          boxShadow: `0 0 6px ${LIME}`,
          transition: motionTransition,
          willChange: 'top, width',
        }}
      />

      {/* Vertical scan: unresolved guide + resolved lime segment. */}
      <div
        className="absolute top-0 bottom-0 w-px motion-reduce:transition-none"
        style={{ left: `${hx}%`, background: 'rgba(214,255,62,.45)', transition: motionTransition, willChange: 'left' }}
      />
      <div
        className="absolute top-0 w-px motion-reduce:transition-none"
        style={{
          left: `${hx}%`,
          height: `${vy}%`,
          background: LIME,
          boxShadow: `0 0 6px ${LIME}`,
          transition: motionTransition,
          willChange: 'left, height',
        }}
      />

      {/* Crosshatch trail left behind by the write head. */}
      <div
        className="absolute left-0 top-0 motion-reduce:transition-none"
        style={{
          width: `${hx}%`,
          height: `${vy}%`,
          background:
            'repeating-linear-gradient(45deg, rgba(214,255,62,.055) 0 2px, transparent 2px 10px)',
          WebkitMaskImage:
            'linear-gradient(135deg, rgba(0,0,0,.18) 0%, rgba(0,0,0,.48) 58%, #000 100%)',
          maskImage:
            'linear-gradient(135deg, rgba(0,0,0,.18) 0%, rgba(0,0,0,.48) 58%, #000 100%)',
          transition: motionTransition,
          willChange: 'width, height',
        }}
      />

      {/* Reticle / write head at the intersection. */}
      <div
        className="absolute motion-reduce:transition-none"
        style={{
          left: `${hx}%`,
          top: `${vy}%`,
          transform: 'translate(-50%,-50%)',
          transition: motionTransition,
          willChange: 'left, top',
        }}
      >
        <div className="relative">
          <span
            className="absolute -inset-3 border"
            style={{ borderColor: LIME }}
          />
          <span
            className="absolute left-1/2 -top-4 -translate-x-1/2 whitespace-nowrap px-1 mono-tag text-[8px] tabular-nums"
            style={{ color: '#0a0a0a', background: LIME }}
          >
            <NumPct value={p} format={{ maximumFractionDigits: 0 }} />
          </span>
        </div>
      </div>

      <div
        className="absolute top-4 left-4 mono-tag text-[7px] tabular-nums"
        style={{ color: '#555' }}
      >
        H-AXIS {Math.round(hx)}%
      </div>
      <div
        className="absolute bottom-4 left-4 mono-tag text-[7px] tabular-nums"
        style={{ color: '#555' }}
      >
        V-AXIS {Math.round(vy)}%
      </div>
      <div
        className="absolute top-4 right-4 mono-tag text-[8px]"
        style={{ color: LIME }}
      >
        ● {phase}
      </div>

      {justDone && (
        <div
          className="absolute bottom-4 right-4 mono-tag text-[8px]"
          style={{ color: LIME }}
        >
          WEAVE COMPLETE
        </div>
      )}
    </div>
  );
}
