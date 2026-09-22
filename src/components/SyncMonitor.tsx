import { useEffect, useRef, useState } from 'react';
import { useIdentity, useLedger } from '../store/live';
import { isSyncBlocked } from '../ledger/syncModel.mjs';
import { manageReposUrl, reconnectUrl } from '../ledger/accountModel.mjs';
import { Num, NumGrouped } from '../ledger/Num';
import {
  COLLAPSE_HOLD_MS,
  MON_PHASES,
  OPACITY_CLEAR,
  OPACITY_OVERLAP_COLLAPSED,
  OPACITY_OVERLAP_EXPANDED,
  collapsedFrac,
  collapsedLabel,
  monitorCounts,
  monitorRows,
  monitorTag,
  occludedByContent,
  shouldAutoExpand,
} from '../ledger/syncMonitorModel.mjs';

/* SYNC.04 · SYSTEM MONITOR — the floating sync instrument.
   UNIX process-table grammar: PHASE / LOAD / ST rows with ASCII meters,
   compact counters in the footer, terminal-style "> ACTION" lines.
   A view of the shared dash.sync state — the store's /api/sync pump and
   passive polling remain the single source of truth.

   Expansion policy (model-tested):
   - status → syncing: auto-expand (app load during a run starts expanded)
   - syncing → complete: hold the DONE face ~1.8s, then collapse
   - error / rate_limited / revoked: expand and NEVER auto-collapse
   - collapsed click ↔ expanded header click toggles; Escape collapses. */

const INK = '#e9e9e6';
const ZINC = '#96968e';
const DIM = '#585853';
const FAINT = '#3a3b39';
const HAIR = '#2b2c2b';
const PANEL = '#151615';
const CLAY = '#c08379';

function Meter({ frac, on }: { frac: number | null; on: boolean }) {
  const n = 10;
  // frac null = the backend reports work in flight but no done/total pair:
  // render a moving indeterminate sweep, never a fabricated fill level.
  if (frac === null) {
    return (
      <span className="font-mono text-[9px] tracking-tighter" aria-hidden>
        <span style={{ color: DIM }}>[</span>
        <span className="mon-indet">
          <span style={{ color: FAINT }}>{'░'.repeat(n)}</span>
          <span className="mon-indet-sweep" style={{ color: on ? INK : ZINC }}>{'█'.repeat(2)}</span>
        </span>
        <span style={{ color: DIM }}>]</span>
      </span>
    );
  }
  const f = Math.round(Math.max(0, Math.min(1, frac)) * n);
  return (
    <span className="font-mono text-[9px] tracking-tighter" aria-hidden>
      <span style={{ color: DIM }}>[</span>
      <span style={{ color: on ? INK : ZINC }}>{'█'.repeat(f)}</span>
      <span style={{ color: FAINT }}>{'░'.repeat(n - f)}</span>
      <span style={{ color: DIM }}>]</span>
    </span>
  );
}

function Act({
  children,
  clay = false,
  onClick,
  disabled = false,
}: {
  children: React.ReactNode;
  clay?: boolean;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="group/act flex items-center gap-2 w-full text-left mono-tag text-[9px] py-[3px] transition-colors disabled:cursor-default"
      style={{ color: DIM }}
    >
      <span style={{ color: clay ? CLAY : DIM }}>&gt;</span>
      <span
        className={`transition-colors ${disabled ? '' : 'group-hover/act:!text-[#e9e9e6]'}`}
        style={{ color: disabled ? FAINT : clay ? CLAY : ZINC }}
      >
        {children}
      </span>
    </button>
  );
}

export function SyncMonitor() {
  const { dash, syncNow, pumping } = useLedger();
  const me = useIdentity();
  const sync = dash.sync;
  // `pumping` folds into the effective status the moment SYNC NOW fires —
  // the panel expands and DISCOVER lights RUN before the first POST
  // response lands, instead of sitting IDLE through the request gap.
  const status = pumping && (!sync || sync.status === 'idle' || sync.status === 'complete')
    ? 'syncing'
    : sync?.status || 'idle';

  const [expanded, setExpanded] = useState(false);
  const rootRef = useRef<HTMLElement | null>(null);
  const [occluded, setOccluded] = useState(false);
  const [justDone, setJustDone] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  // A deliberate user expand pins the panel — the post-success hold must
  // not yank it away; a fresh sync run resets the pin.
  const pinned = useRef(false);
  const prev = useRef(status);

  // App load during an active/blocked run starts expanded (spec §6/§8).
  useEffect(() => {
    if (shouldAutoExpand(status)) setExpanded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const was = prev.current;
    prev.current = status;
    if (status === 'syncing' && was !== 'syncing') {
      pinned.current = false;
      setExpanded(true);
    }
    if (isSyncBlocked(status)) setExpanded(true);
    if (was === 'syncing' && status !== 'syncing' && !isSyncBlocked(status)) {
      setJustDone(true);
      setExpanded(true);
      const t = setTimeout(() => {
        setJustDone(false);
        if (!pinned.current) setExpanded(false);
      }, COLLAPSE_HOLD_MS);
      return () => clearTimeout(t);
    }
  }, [status]);

  // Overlap-aware translucency: while the floating control sits over real
  // page content it dims (collapsed ~78%, expanded ~94%); over empty
  // background it stays opaque. rAF-throttled scroll/resize probe via
  // elementsFromPoint at the control's center — not a raw scrollY check.
  useEffect(() => {
    let raf = 0;
    const probe = () => {
      raf = 0;
      const el = rootRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const stack = document.elementsFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      const next = occludedByContent(stack, el);
      setOccluded((v) => (v === next ? v : next));
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(probe);
    };
    probe();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [expanded]);

  if (!sync) return null;

  const toggle = () => {
    setExpanded((v) => {
      const next = !v;
      pinned.current = next;
      return next;
    });
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && expanded) {
      e.stopPropagation();
      pinned.current = false;
      setExpanded(false);
    }
  };

  const syncing = status === 'syncing' || pumping;
  const blocked = isSyncBlocked(status);
  // Model functions read the effective sync (pumping folded in) so a fresh
  // manual run shows RUN on DISCOVER immediately — not after the first
  // POST round-trip.
  const effSync = { ...sync, status };
  const rows = monitorRows(effSync);
  const counts = monitorCounts(sync);
  // Prefer the concrete installation URL; the generic GitHub app-settings
  // page always works, so the action is never a dead button.
  const installsUrl =
    manageReposUrl(me) ?? 'https://github.com/settings/installations';
  const openExternal = (url: string | null) => {
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  };

  const opacity = occluded
    ? expanded ? OPACITY_OVERLAP_EXPANDED : OPACITY_OVERLAP_COLLAPSED
    : OPACITY_CLEAR;

  if (!expanded) {
    return (
      <button
        type="button"
        ref={(el) => { rootRef.current = el; }}
        onClick={toggle}
        aria-expanded={false}
        aria-label="sync monitor — expand"
        className="mon-occlude fixed bottom-4 right-4 z-[90] flex items-center gap-2 border px-3 py-2 hover:border-[#4a4b49]"
        style={{ background: PANEL, borderColor: blocked ? CLAY : HAIR, opacity }}
      >
        <Meter frac={collapsedFrac(effSync, justDone)} on={syncing} />
        <span
          className="mono-tag text-[8px] inline-flex items-center gap-1"
          style={{ color: status === 'error' || status === 'revoked' ? CLAY : ZINC }}
        >
          {status === 'syncing' && !justDone ? (
            <>
              <Num value={Math.round((sync?.progress || 0) * 100)} suffix="%" />
              <span>SYNC</span>
            </>
          ) : (
            collapsedLabel(effSync, justDone)
          )}
        </span>
      </button>
    );
  }

  return (
    <aside
      ref={(el) => { rootRef.current = el; }}
      aria-label="sync monitor"
      onKeyDown={onKey}
      className="mon-occlude fixed bottom-4 right-4 left-4 sm:left-auto sm:w-[280px] z-[90] border font-mono text-[9px] instrument-in"
      style={{
        background: PANEL,
        borderColor: status === 'revoked' ? FAINT : HAIR,
        borderStyle: status === 'revoked' ? 'dashed' : 'solid',
        opacity,
      }}
    >
      <button
        type="button"
        onClick={toggle}
        aria-expanded={true}
        aria-label="sync monitor — collapse"
        className="flex w-full items-center justify-between px-3 py-2 border-b mono-tag text-[8px]"
        style={{ borderColor: HAIR }}
      >
        <span style={{ color: INK }}>SYNC.MON</span>
        <span style={{ color: DIM }} className="inline-flex items-center">
          {status === 'syncing' && !justDone ? (
            <Num value={Math.round((sync?.progress || 0) * 100)} suffix="%" />
          ) : (
            monitorTag(effSync, justDone)
          )}
        </span>
      </button>

      <div className="px-3 py-2.5" aria-live="polite">
        {status === 'revoked' ? (
          <div className="space-y-1.5">
            <div style={{ color: ZINC }}>
              github: <span style={{ color: INK }}>EACCES — permission denied</span>
            </div>
            <div className="mono-tag text-[8px] leading-relaxed" style={{ color: ZINC }}>
              DEV LEDGER CANNOT REFRESH YOUR RECORD.
              <br />
              <span style={{ color: DIM }}>STORED DATA REMAINS AVAILABLE.</span>
            </div>
          </div>
        ) : status === 'error' ? (
          <div className="space-y-1.5">
            {MON_PHASES.map((ph, i) => {
              const r = rows[i];
              return (
                <div key={ph} className="grid grid-cols-[64px_1fr_44px] gap-2 items-center py-[2px]">
                  <span className="mono-tag text-[7px]" style={{ color: r.state === 'fail' ? CLAY : r.state === 'pending' ? FAINT : ZINC }}>{ph}</span>
                  <Meter frac={r.frac} on={false} />
                  <span className="text-right mono-tag text-[7px]" style={{ color: r.state === 'fail' ? CLAY : r.state === 'ok' ? ZINC : FAINT }}>{r.st}</span>
                </div>
              );
            })}
            <div className="mono-tag text-[8px] leading-relaxed pt-1" style={{ color: ZINC }}>
              SYNC FAILED{sync?.error ? ` — ${String(sync.error).slice(0, 60)}` : ''}
              <br />
              <span style={{ color: DIM }}>STORED DATA REMAINS AVAILABLE.</span>
            </div>
          </div>
        ) : (
          <>
            <div
              className="grid grid-cols-[64px_1fr_44px] gap-2 mono-tag text-[7px] pb-1.5"
              style={{ color: DIM }}
            >
              <span>PHASE</span>
              <span>LOAD</span>
              <span className="text-right">ST</span>
            </div>
            {MON_PHASES.map((ph, i) => {
              const r = rows[i];
              return (
                <div key={ph} className="grid grid-cols-[64px_1fr_44px] gap-2 items-center py-[2px]">
                  <span
                    className="mono-tag text-[7px]"
                    style={{ color: r.state === 'pending' ? FAINT : r.state === 'run' ? INK : ZINC }}
                  >
                    {ph}
                  </span>
                  <Meter frac={r.frac} on={r.state === 'run'} />
                  <span
                    className="text-right mono-tag text-[7px]"
                    style={{
                      color:
                        r.state === 'run' ? INK : r.state === 'ok' ? ZINC : FAINT,
                    }}
                  >
                    {r.st}
                  </span>
                </div>
              );
            })}
            {status === 'rate_limited' && (
              <div className="mono-tag text-[8px] leading-relaxed pt-1" style={{ color: ZINC }}>
                RATE LIMITED — RESUMES AUTOMATICALLY
                {sync?.resumeAt ? ` · ${new Date(sync.resumeAt).toLocaleTimeString()}` : ''}
              </div>
            )}
          </>
        )}
      </div>

      <div
        className="px-3 py-2 border-t flex items-center justify-between mono-tag text-[7px]"
        style={{ borderColor: HAIR, color: DIM }}
      >
        <span className="tabular-nums inline-flex items-center gap-1">
          <NumGrouped value={counts.commits} /> CMT · <NumGrouped value={counts.pulls} /> PR · <NumGrouped value={counts.repos} /> REPO
        </span>
        <span className="inline-flex items-center">
          {status === 'syncing' && !justDone ? (
            <Num value={Math.round((sync?.progress || 0) * 100)} suffix="%" />
          ) : (
            monitorTag(effSync, justDone)
          )}
        </span>
      </div>

      {showDetail && (
        <div
          className="px-3 py-2 border-t mono-tag text-[7px] space-y-1"
          style={{ borderColor: HAIR, color: DIM }}
        >
          <div className="flex justify-between">
            <span>PHASE</span>
            <span className="tabular-nums" style={{ color: ZINC }}>{sync?.phase ?? '—'}</span>
          </div>
          <div className="flex justify-between">
            <span>PROGRESS</span>
            <span className="tabular-nums" style={{ color: ZINC }}>
              <Num value={Math.round((sync?.progress || 0) * 100)} suffix="%" />
            </span>
          </div>
          <div className="flex justify-between">
            <span>LAST SYNC</span>
            <span className="tabular-nums" style={{ color: ZINC }}>
              {sync?.lastSyncedAt ? new Date(sync.lastSyncedAt).toLocaleString() : '—'}
            </span>
          </div>
          {sync?.error && (
            <div className="flex justify-between gap-2">
              <span>ERROR</span>
              <span className="text-right" style={{ color: CLAY }}>
                {String(sync.error).slice(0, 80)}
              </span>
            </div>
          )}
        </div>
      )}

      <div className="px-3 pb-2.5">
        {status === 'revoked' ? (
          <>
            <Act onClick={() => { window.location.href = reconnectUrl(); }}>RECONNECT GITHUB</Act>
            <Act onClick={() => openExternal(installsUrl)}>MANAGE ACCESS</Act>
          </>
        ) : status === 'error' ? (
          <>
            <Act clay onClick={() => syncNow()}>RETRY SYNC</Act>
            <Act onClick={() => setShowDetail((v) => !v)}>VIEW DETAILS</Act>
          </>
        ) : syncing ? (
          <>
            {/* No duplicate pumps while a run is in flight — the store's
                pumping guard also early-returns, this is the honest UI. */}
            <Act disabled>SYNCING…</Act>
            <Act onClick={() => openExternal(installsUrl)}>MANAGE REPOSITORIES</Act>
            <Act onClick={() => setShowDetail((v) => !v)}>VIEW SYNC DETAILS</Act>
          </>
        ) : status === 'rate_limited' ? (
          <>
            {/* Backend can't sync until resumeAt — the passive pump fires
                syncNow() itself once the window passes. */}
            <Act disabled>AWAITING RATE LIMIT</Act>
            <Act onClick={() => openExternal(installsUrl)}>MANAGE REPOSITORIES</Act>
            <Act onClick={() => setShowDetail((v) => !v)}>VIEW SYNC DETAILS</Act>
          </>
        ) : (
          <>
            <Act onClick={() => syncNow()}>SYNC NOW</Act>
            <Act onClick={() => openExternal(installsUrl)}>MANAGE REPOSITORIES</Act>
            <Act onClick={() => setShowDetail((v) => !v)}>VIEW SYNC DETAILS</Act>
          </>
        )}
      </div>
    </aside>
  );
}
