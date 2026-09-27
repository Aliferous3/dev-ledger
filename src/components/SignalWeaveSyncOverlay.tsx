import { useEffect, useRef, useState } from 'react';
import { useLedger } from '../store/live';

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

function useTweenedProgress(
  target: number,
  active: boolean,
  syncing: boolean,
  durationMs: number,
  reducedMotion: boolean,
) {
  const [value, setValue] = useState(target);
  const valueRef = useRef(target);
  const wasSyncing = useRef(syncing);

  useEffect(() => {
    // A new run gets a clean baseline immediately: manual runs begin at 0,
    // while an already-running external sync opens at its truthful position.
    // Completion is NOT a new run, so the final 100% leg can tween smoothly.
    if (syncing && !wasSyncing.current) {
      valueRef.current = target;
      setValue(target);
    }
    wasSyncing.current = syncing;
  }, [syncing, target]);

  useEffect(() => {
    if (!active) return;

    if (reducedMotion || durationMs <= 0) {
      valueRef.current = target;
      setValue(target);
      return;
    }

    const from = valueRef.current;
    // A single sync's overall progress is monotonic. Ignore stale lower
    // observations rather than making the write head jerk backwards.
    const to = Math.max(from, target);
    if (Math.abs(to - from) < 0.01) return;

    let raf = 0;
    const started = performance.now();

    const frame = (now: number) => {
      const k = Math.min(1, (now - started) / durationMs);
      const next = from + (to - from) * k;
      valueRef.current = next;
      setValue(next);
      if (k < 1) raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [active, durationMs, reducedMotion, target]);

  return value;
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

  const targetP = justDone
    ? 100
    : activeProgress(pumping, sync?.status, sync?.progress);
  const realP = useTweenedProgress(
    targetP,
    syncing || justDone,
    syncing,
    REAL_SYNC_TWEEN_MS,
    reducedMotion,
  );

  if (!syncing && !justDone) return null;
  // The QA-only preview already supplies a requestAnimationFrame-driven
  // percentage, so do not smooth it a second time.
  const p = previewing
    ? Math.max(0, Math.min(100, Number(previewProgress)))
    : realP;
  const hx = p;
  // Preserve S15's faster vertical feel without the old early-stop at 100%.
  // The vertical axis leads throughout the run but reaches the bottom only
  // with the horizontal axis at completion.
  const t = Math.max(0, Math.min(1, p / 100));
  const vy = 100 * (1 - Math.pow(1 - t, 1.6));
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
        style={{ top: `${vy}%`, background: 'rgba(214,255,62,.45)', willChange: 'top' }}
      />
      <div
        className="absolute left-0 h-px motion-reduce:transition-none"
        style={{
          top: `${vy}%`,
          width: `${hx}%`,
          background: LIME,
          boxShadow: `0 0 6px ${LIME}`,
          willChange: 'top, width',
        }}
      />

      {/* Vertical scan: unresolved guide + resolved lime segment. */}
      <div
        className="absolute top-0 bottom-0 w-px motion-reduce:transition-none"
        style={{ left: `${hx}%`, background: 'rgba(214,255,62,.45)', willChange: 'left' }}
      />
      <div
        className="absolute top-0 w-px motion-reduce:transition-none"
        style={{
          left: `${hx}%`,
          height: `${vy}%`,
          background: LIME,
          boxShadow: `0 0 6px ${LIME}`,
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
            {Math.round(p)}%
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
