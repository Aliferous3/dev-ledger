import { useEffect, useState } from 'react';
import { useLedger } from '../store/live';
import {
  ASSIST_DELAY_MS,
  ASSIST_DISMISS_KEY,
  assistArmed,
  metricsEmpty,
} from '../ledger/syncAssistModel.mjs';

/* SYNC.ASSIST — contextual zero-metrics prompt, part of the SYNC.MON
   instrument family (same panel grammar, anchored above it). Appears only
   when an authenticated, resolved ledger has stayed empty for >10s with no
   sync running or queued — it suggests the canonical syncNow() pump; it
   never starts a sync on its own. Dismissal (or firing SYNC NOW from it)
   suppresses it for the browser session. */

const ZINC = '#96968e';
const DIM = '#585853';
const HAIR = '#2b2c2b';
const PANEL = '#151615';
const LIME = '#d6ff3e';

function readDismissed(): boolean {
  try {
    return sessionStorage.getItem(ASSIST_DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

export function SyncAssist() {
  const { live, resolving, all, dash, syncNow, pumping } = useLedger();
  const [dismissed, setDismissed] = useState(readDismissed);
  const [visible, setVisible] = useState(false);

  const armed = assistArmed({
    live,
    resolving,
    empty: metricsEmpty(all),
    status: dash.sync?.status,
    pumping,
    dismissed,
  });

  // The persistence clock: armed must hold continuously for the delay.
  // Any unarm (sync begins, data lands, dismissal) resets it instantly.
  useEffect(() => {
    if (!armed) {
      setVisible(false);
      return;
    }
    const t = setTimeout(() => setVisible(true), ASSIST_DELAY_MS);
    return () => clearTimeout(t);
  }, [armed]);

  if (!visible) return null;

  const dismiss = () => {
    try {
      sessionStorage.setItem(ASSIST_DISMISS_KEY, '1');
    } catch {
      /* storage unavailable — in-memory dismissal still applies */
    }
    setDismissed(true);
  };

  const fire = () => {
    // The user acted — the prompt's job is done for this session even if
    // the run fails (the SYNC.MON error state owns recovery from there).
    dismiss();
    syncNow();
  };

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="sync assist"
      className="fixed z-[89] bottom-14 right-3 sm:bottom-[4.75rem] sm:right-4 w-[240px] border instrument-in"
      style={{ background: PANEL, borderColor: HAIR }}
    >
      <div
        className="flex items-center justify-between px-3 py-2 border-b mono-tag text-[8px]"
        style={{ borderColor: HAIR }}
      >
        <span style={{ color: LIME }}>NO METRICS YET</span>
        <button
          type="button"
          onClick={dismiss}
          aria-label="dismiss sync prompt"
          className="mono-tag text-[8px] transition-colors hover:text-[#e9e9e6]"
          style={{ color: DIM }}
        >
          [ DISMISS ]
        </button>
      </div>
      <div className="px-3 py-2.5 mono-tag text-[8px] leading-relaxed" style={{ color: ZINC }}>
        YOUR LEDGER HAS NOT BEEN POPULATED.
        {!dash.sync?.lastSyncedAt && (
          <>
            <br />
            <span style={{ color: DIM }}>NO SYNC ON RECORD.</span>
          </>
        )}
      </div>
      <div className="px-3 pb-2.5">
        <button
          type="button"
          onClick={fire}
          className="group/fire mono-tag text-[9px] flex items-center gap-2"
        >
          <span style={{ color: DIM }}>&gt;</span>
          <span
            className="transition-colors group-hover/fire:text-[#e9e9e6]"
            style={{ color: LIME }}
          >
            SYNC NOW
          </span>
        </button>
      </div>
    </div>
  );
}
