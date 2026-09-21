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

// Indeterminate "in-flight" fill for rows the backend reports state but no
// done/total pair for — a working marker, not a claimed percentage.
const RUN_FILL = 0.35;

const PHASE_ORDER = { discover: 0, commits: 2, range: 4, finalizing: 5, done: 6 };

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

// Row state: 'pending' | 'run' | 'ok' | 'fail' | 'denied'
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

  const row = (idx, realFrac, realDone) => {
    if (denied) return { state: 'denied', frac: 0, st: 'EACCES' };
    if (done || realDone) return { state: 'ok', frac: 1, st: 'ok' };
    if (failed) {
      if (idx < failIdx) return { state: 'ok', frac: 1, st: 'ok' };
      if (idx === failIdx)
        return { state: 'fail', frac: realFrac ?? RUN_FILL, st: 'exit1' };
      return { state: 'pending', frac: 0, st: '--' };
    }
    if (status === 'idle') return { state: 'pending', frac: 0, st: '--' };
    const running = status === 'syncing' || blocked;
    if (!running) return { state: 'pending', frac: 0, st: '--' };
    // Real done/total pairs govern when present — a phase ordered before
    // the current one isn't 'ok' while its real count is still partial.
    if (realFrac != null) return { state: 'run', frac: realFrac, st: 'run' };
    if (idx < pIdx) return { state: 'ok', frac: 1, st: 'ok' };
    if (idx === pIdx) return { state: 'run', frac: RUN_FILL, st: 'run' };
    return { state: 'pending', frac: 0, st: '--' };
  };

  const reposTotal = num(repos.total);
  const reposDone = num(repos.done);
  const histTotal = num(history.total);
  const histDone = num(history.done);

  return [
    // DISCOVER — real signal: repositories enumerated (repos.total known)
    row(0, reposTotal > 0 ? 1 : null, reposTotal > 0 && pIdx > 0),
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
    // window (backend runs it concurrently), so it shows 'run' there.
    row(3, pulls.done ? 1 : pIdx >= 2 ? RUN_FILL : null, pulls.done === true),
    // RANGE — real backend phase only for explicit range syncs; the row
    // resolves ok once the run completes (aggregation rides finalizing).
    row(4, phase === 'range' ? RUN_FILL : null, false),
    // FINALIZING — real phase label
    row(5, null, false),
  ];
}

// Collapsed-bar grammar: meter + short status token.
export function collapsedLabel(sync, justDone = false) {
  const status = sync?.status || 'idle';
  if (justDone || status === 'complete' || sync?.phase === 'done') return 'DONE';
  if (status === 'syncing') return `${Math.round((sync?.progress || 0) * 100)}% SYNC`;
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
  return Math.max(0, Math.min(1, sync?.progress || 0));
}

// Expanded header right-hand readout — real values only.
export function monitorTag(sync, justDone = false) {
  const status = sync?.status || 'idle';
  if (justDone || status === 'complete' || sync?.phase === 'done') return '100%';
  if (status === 'syncing') return `${Math.round((sync?.progress || 0) * 100)}%`;
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
