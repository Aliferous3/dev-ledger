import { useEffect, useRef, useState } from 'react';
import { useLedger } from '../store/live';
import {
  blockedCopy,
  detailRows,
  isSyncBlocked,
  syncPct,
  syncTitle,
  syncVisible,
} from '../ledger/syncModel.mjs';

/* Bottom-right sync instrument — redesign port of the production panel.
   Reads the shared dash.sync state (same source as UtilityBar/account
   menu): phase title, per-stage counts, progress hairline. Stays pinned on
   error/rate-limit/revoked, flashes SYNC COMPLETE briefly after a run, and
   never renders as a toast. Passive polling in the store keeps it live when
   cron or another tab drives the sync; rate-limited states resume
   automatically once resume_at passes. */

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between mono-tag text-[9.5px] tracking-[0.18em]">
      <span className="text-neutral-700">{k}</span>
      <span className="text-neutral-400 tabular-nums">{v}</span>
    </div>
  );
}

export function SyncInstrument() {
  const { dash, live } = useLedger();
  const sync = dash.sync;
  const status = sync?.status;
  const [justDone, setJustDone] = useState(false);
  const prev = useRef<string | undefined>(undefined);

  // Flash a brief complete state when a running sync finishes cleanly.
  useEffect(() => {
    const was = prev.current;
    prev.current = status;
    if (was === 'syncing' && status && status !== 'syncing' && !isSyncBlocked(status)) {
      setJustDone(true);
      const t = setTimeout(() => setJustDone(false), 1800);
      return () => clearTimeout(t);
    }
  }, [status]);

  if (!live || !syncVisible(sync, justDone)) return null;

  const blocked = isSyncBlocked(status);
  const pct = syncPct(sync?.progress);
  const detail = (sync?.detail || {}) as Parameters<typeof detailRows>[0];

  return (
    <aside
      aria-live="polite"
      aria-label="sync status"
      className="fixed bottom-4 right-4 left-4 sm:left-auto sm:w-[308px] z-[90] border border-neutral-800 bg-[#0a0a0a] px-4 py-3.5 instrument-in"
    >
      <div className="flex items-baseline justify-between">
        <span className="mono-tag text-[9px] tracking-[0.18em] text-neutral-500">
          {syncTitle(sync, justDone)}
        </span>
        <span className="mono-tag text-[9px] tracking-[0.18em] text-neutral-600 tabular-nums">
          {justDone ? '100%' : blocked ? '—' : `${pct}%`}
        </span>
      </div>

      {!blocked && (
        <div className="mt-3 space-y-1.5">
          {detailRows(detail).map(([k, v]) => (
            <Row key={k} k={k} v={v} />
          ))}
        </div>
      )}
      {blocked && (
        <p className="mono-tag text-[8px] tracking-[0.18em] mt-3 leading-relaxed text-neutral-600">
          {blockedCopy(status)}
        </p>
      )}

      <div className="mt-3.5 flex items-center gap-3">
        <div className="h-px flex-1 bg-neutral-900">
          <div
            className="h-px bg-[#d6ff3e] origin-left transition-transform duration-500 ease-out"
            style={{ transform: `scaleX(${justDone ? 1 : Math.max(sync?.progress || 0, 0.02)})` }}
          />
        </div>
      </div>
    </aside>
  );
}
