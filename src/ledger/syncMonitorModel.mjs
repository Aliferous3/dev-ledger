// Pure derivations for the SYNC.04 SYSTEM MONITOR — maps the real
// dash.sync state (status/phase/progress/detail emitted by /api/sync and
// /api/dashboard) onto the six-row process table. No fabricated numbers:
// meters use real done/total pairs where the backend reports them, and
// state semantics elsewhere.
//
// Backend phases (lib/sync.mjs): 'discover' → 'commits' (metadata + commit
// history + pulls run CONCURRENTLY under this phase label) → 'finalizing'
// → 'done'. Range syncs report phase 'range' with detail.rangeSync.
// Statuses: idle | syncing | complete | rate_limited | error | revoked.

import { isSyncBlocked } from './syncModel.mjs';

export const MON_PHASES = [
  'DISCOVER',
  'METADATA',
  'COMMITS',
  'PULLS',
  'RANGE',
  'FINALIZING',
];

// Indeterminate "in-flight" rows carry frac:null — the backend reports the
// phase is working but exposes no done/total pair, so the meter renders a
// moving indeterminate treatment rather than a fabricated percentage.
const PHASE_ORDER = { discover: 0, commits: 2, range: 4, finalizing: 5, done: 6 };

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

// Row state: 'pending' | 'run' | 'ok' | 'fail' | 'denied'
// frac: real 0..1 when a done/total pair exists; null = indeterminate run.
export function monitorRows(sync) {
  const status = sync?.status || 'idle';
  const phase = sync?.phase || 'discover';
  const pIdx = PHASE_ORDER[phase] ?? 0;
  const detail = sync?.detail || {};
  const repos = detail.repos || {};
  const history = detail.history || {};
  const pulls = detail.pulls || {};

  const done = status === 'complete' || phase === 'done';
  const denied = status === 'revoked';
  const failed = status === 'error';
  // On error, sync.phase marks where the run died (default COMMITS like
  // the reference — the common failure point is history fetching).
  const failIdx = failed ? (PHASE_ORDER[phase] ?? 2) : -1;
  const blocked = isSyncBlocked(status) && status !== 'revoked';

  // 'ok' requires backend confirmation — either the run finished
  // (status complete / phase done), a realDone signal (count completed,
  // or the backend's own phase pointer moved past a single-step phase),
  // or — on failure — a phase that ran before the crash point. A row is
  // NEVER marked ok merely because a later phase is the active one.
  const row = (idx, realFrac, realDone) => {
    if (denied) return { state: 'denied', frac: 0, st: 'EACCES' };
    if (done || realDone) return { state: 'ok', frac: 1, st: 'ok' };
    if (failed) {
      if (idx < failIdx) return { state: 'ok', frac: 1, st: 'ok' };
      if (idx === failIdx)
        return { state: 'fail', frac: typeof realFrac === 'number' ? realFrac : 0, st: 'exit1' };
      return { state: 'pending', frac: 0, st: '--' };
    }
    if (status === 'idle') return { state: 'pending', frac: 0, st: '--' };
    const running = status === 'syncing' || blocked;
    if (!running) return { state: 'pending', frac: 0, st: '--' };
    // The rate-limit state rides on the row the backend was working —
    // terse System Monitor grammar instead of a generic RUN.
    const stRun = blocked ? 'rate' : 'run';
    // Real done/total pairs govern when present — a phase ordered before
    // the current one isn't 'ok' while its real count is still partial.
    if (typeof realFrac === 'number') return { state: 'run', frac: realFrac, st: stRun };
    if (realFrac === 'indet' || idx === pIdx) {
      return { state: 'run', frac: null, st: stRun };
    }
    return { state: 'pending', frac: 0, st: '--' };
  };

  const reposTotal = num(repos.total);
  const reposDone = num(repos.done);
  const histTotal = num(history.total);
  const histDone = num(history.done);

  return [
    // DISCOVER — complete once its output exists: repos.total is written
    // only after the full repository list is upserted, so total > 0 means
    // discovery genuinely finished. Never RUN against a known repo count —
    // a wedged 'syncing' row must not pin DISCOVER open forever.
    row(0, reposTotal > 0 ? 1 : null, reposTotal > 0 || pIdx > 0),
    // METADATA — real done/total: repo metadata pass (concurrent w/ commits)
    row(
      1,
      reposTotal > 0 ? Math.min(1, reposDone / reposTotal) : null,
      reposTotal > 0 && reposDone >= reposTotal,
    ),
    // COMMITS — real done/total: repositories whose history finished
    row(
      2,
      histTotal > 0 ? Math.min(1, histDone / histTotal) : null,
      histTotal > 0 && histDone >= histTotal,
    ),
    // PULLS — real: pulls.done flag; the fetch rides the commits/finalizing
    // window (backend runs it concurrently), so it runs indeterminate there.
    row(3, pulls.done ? 1 : pIdx >= 2 && pIdx < 5 ? 'indet' : null, pulls.done === true),
    // RANGE — only an explicit range sync runs this phase (phase==='range'
    // with detail.rangeSync). A normal run's finalizing must not claim a
    // range pass that never happened.
    row(4, phase === 'range' ? 'indet' : null, false),
    // FINALIZING — real phase label; no done/total → indeterminate while
    // active, 'ok' only when the backend reports 'done'.
    row(5, null, false),
  ];
}

// Absolute invariant: 100% is displayed ONLY when the backend confirms
// completion (status 'complete', phase 'done', or the just-done hold).
// A 'syncing' row can never display 100 — stale progress=1 left behind by
// a partial patch must not render as a finished run.
export function displayProgress(sync, justDone = false) {
  const status = sync?.status || 'idle';
  if (justDone || status === 'complete' || sync?.phase === 'done') return 1;
  if (status === 'syncing') return Math.min(0.99, Math.max(0, sync?.progress || 0));
  return Math.max(0, Math.min(1, sync?.progress || 0));
}
export const displayPct = (sync, justDone = false) =>
  Math.round(displayProgress(sync, justDone) * 100);

// Collapsed-bar grammar: meter + short status token.
export function collapsedLabel(sync, justDone = false) {
  const status = sync?.status || 'idle';
  if (justDone || status === 'complete' || sync?.phase === 'done') return 'DONE';
  if (status === 'syncing') return `${displayPct(sync)}% SYNC`;
  if (status === 'rate_limited') return 'RATE LIM';
  if (status === 'error') return 'EXIT 1';
  if (status === 'revoked') return 'EACCES';
  return 'IDLE';
}

export function collapsedFrac(sync, justDone = false) {
  const status = sync?.status || 'idle';
  if (justDone || status === 'complete' || sync?.phase === 'done') return 1;
  if (status === 'revoked') return 0;
  if (status === 'error') return Math.max(0.05, sync?.progress || 0);
  if (status === 'idle') return 0;
  return displayProgress(sync);
}

// Expanded header right-hand readout — real values only.
export function monitorTag(sync, justDone = false) {
  const status = sync?.status || 'idle';
  if (justDone || status === 'complete' || sync?.phase === 'done') return '100%';
  if (status === 'syncing') return `${displayPct(sync)}%`;
  if (status === 'rate_limited') return 'RATE LIMITED';
  if (status === 'error') return 'EXIT 1';
  if (status === 'revoked') return 'EACCES';
  return 'IDLE';
}

// Footer counters — real detail counts (commits ingested, PRs found,
// repositories discovered). Tabular numerals in the component.
export function monitorCounts(sync) {
  const d = sync?.detail || {};
  return {
    commits: num(d.history?.commits),
    pulls: num(d.pulls?.count),
    repos: num(d.repos?.total),
  };
}

/* Expansion policy (stateless — the component owns the expanded flag):
   - a sync starting (status → syncing) expands so progress is visible
   - error / rate_limited / revoked NEVER auto-collapse
   - a finished run holds the DONE face briefly, then collapses */
export function shouldAutoExpand(status) {
  return status === 'syncing' || isSyncBlocked(status);
}
export const COLLAPSE_HOLD_MS = 1800;

/* Floating-panel occlusion: the monitor dims when meaningful page content
   sits beneath it. `stack` is document.elementsFromPoint() output ordered
   top→bottom; content = anything inside the app's landmarks (main/footer/
   header/section) that isn't part of the monitor itself or a transparent
   overlay (scanlines). Pure + DOM-agnostic for tests. */
export function occludedByContent(stack, monitorEl) {
  if (!Array.isArray(stack) && typeof stack?.length !== 'number') return false;
  const doc = typeof document !== 'undefined' ? document : null;
  for (const el of stack) {
    if (!el || el === monitorEl || monitorEl?.contains?.(el)) continue;
    // Reached the page shell → nothing content-bearing beneath.
    if (doc && (el === doc.documentElement || el === doc.body)) return false;
    // `main` itself is the page scaffold — its background is empty space;
    // descendants inside it are the meaningful content.
    if (el.tagName === 'MAIN') continue;
    const landmark = el.closest?.('main, footer, header, section');
    if (landmark) return true;
  }
  return false;
}

// Overlap opacity targets — collapsed pill dims more; the expanded table
// keeps enough backing to stay readable over content.
export const OPACITY_CLEAR = 1;
export const OPACITY_OVERLAP_COLLAPSED = 0.78;
export const OPACITY_OVERLAP_EXPANDED = 0.94;
