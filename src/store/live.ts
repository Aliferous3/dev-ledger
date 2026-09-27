import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { isSyncStale, passivePollMs, rateLimitElapsed, snapshotPredatesSync, SYNC_BOOT_WATCH_MS } from '../ledger/syncModel.mjs';
import { periodToRange, timelineEndIso } from '../ledger/periods';
import type { DayData, Period, RepoItem } from '../types';
import {
  cellsFromDaily,
  weeksFromCells,
  type DayCell,
  type Week,
} from '../fieldData';
import { fmtBytes, fmtCompact, type LangRow } from '../codeData';
import {
  captureEvent,
  mapSyncFailReason,
  syncFailReasonFromHttp,
  type SyncFailReason,
  type SyncTrigger,
} from '../analytics/posthog';
// Dev-only demo fixtures — '../fixtures' resolves to an inert stub in
// production builds, so none of this data ever ships.
import {
  DASHBOARD,
  OBS_START,
  OBS_END,
  DATA_365,
  REPOSITORIES,
  END,
  cells as fixtureCells,
  languages as fixtureLanguages,
  weeks as fixtureWeeks,
  LANGUAGES,
  RHYTHM_DAYS,
  RHYTHM_HIGHLIGHTS,
  RHYTHM_MATRIX,
  RHYTHM_WINDOWS,
} from '../fixtures';

/* Production data layer: the /api/dashboard endpoint returns the shape the
   fixtures model. This module fetches the real payload and normalizes it
   into the shapes the sections consume — no UI component ever sees a raw
   API row. Bundled fixtures are a DEV-ONLY preview path (import.meta.env.DEV);
   a production API failure renders a safe loading state, never demo
   telemetry. */

export interface RepoRow {
  id: string;
  name: string;
  path: string;
  private: boolean;
  fork: boolean;
  archived: boolean;
  primaryLanguage: string;
  languageBytes: number;
  commits: number;
  sourceAdded: number;
  sourceDeleted: number;
  activeDays: number;
  lastCommitAt: string | null;
  lastCommit: string | null;
  lastActivityAt: string | null;
  /** retained repos keep history but ingest nothing */
  disconnected?: boolean;
}

export interface DashboardData {
  generatedAt: string;
  range: { from: string | null; to: string | null };
  summary: {
    repos: number;
    commits: number;
    sourceAdded: number;
    sourceDeleted: number;
    allAdded: number;
    allDeleted: number;
    allChurn: number;
    activeDays: number;
    longestStreak: number;
    peakDayCommits: number;
    languageBytes: number;
  };
  github: {
    connected: boolean;
    pullRequests: number;
    mergedPrs: number;
    revoked: boolean;
  };
  sync: {
    status: string;
    phase?: string;
    progress: number;
    detail?: unknown;
    lastSyncedAt?: string | null;
    updatedAt?: string | null;
    error?: string | null;
    resumeAt?: string | null;
  };
  rangeCoverage: { status: string; [k: string]: unknown };
  repositories: RepoRow[];
  languages: { language: string; code: number; files: number }[];
  daily: { date: string; commits: number; added: number; deleted: number }[];
  prsDaily: { date: string; opened: number; merged: number }[];
  rhythm: { weekday: number; hour: number; commits: number; days: number }[];
  workShape: {
    repoLangs: Record<string, { language: string; bytes: number }[]>;
    repoMonthly: {
      repository_id: string;
      month: string;
      commits: number;
      added: number;
      deleted: number;
      activeDays: number;
    }[];
    prMonthly?: { month: string; opened: number }[];
    span: {
      firstActive: string | null;
      lastActive: string | null;
      activeDays: number;
      totalCommits: number;
      totalAdded: number;
      totalDeleted: number;
    } | null;
  };
}

export interface RhythmBundle {
  // rows MON..SUN × 24 hours of commit counts
  matrix: number[][];
  days: { name: string; code: string; total: number; pct: number }[];
  windows: { label: string; range: string; pct: number }[];
  highlights: {
    peakWeekday: string;
    peakWeekdayTotal: number;
    peakHour: string;
    peakWindow: string;
    weekdayShare: string;
    weekendShare: string;
  };
}

export interface LedgerStore {
  /** true when /api/dashboard responded; false = bundled fixture fallback */
  live: boolean;
  /** true while the first /api/dashboard fetch is in flight — pages render
      skeleton geometry instead of fixture stand-ins or placeholder zeros.
      Settles false on success AND on failure (fixture fallback is data). */
  resolving: boolean;
  /** payload scoped to the selected global period (?range=) */
  dash: DashboardData;
  /** all-time payload — structural data (field grid, archive span, lanes) */
  all: DashboardData;
  /** dense per-day series over the full observed window */
  days: DayData[];
  cells: DayCell[];
  weeks: Week[];
  repos: RepoItem[];
  langs: { name: string; bytes: number }[];
  langRows: LangRow[];
  langTotal: number;
  end: Date;
  endIso: string;
  allFromIso: string;
  /** makeRange()-shaped range for the selected period over the real window */
  range: { mode: string; from: string | null; to: string | null };
  /** weekday×hour rhythm for the selected period */
  rhythm: RhythmBundle;
  /** trigger the existing /api/sync pump — no parallel sync implementation */
  syncNow: () => void;
  /** true while a syncNow pump is in flight */
  pumping: boolean;
  /** re-fetch all dashboard payloads (e.g. after a repo disconnect) */
  refresh: () => void;
}

const PERIOD_MODE: Record<Period, string> = {
  '7D': '7d',
  '30D': '30d',
  '90D': '90d',
  YTD: 'ytd',
  '1Y': '1y',
  ALL: 'all',
};

const DOW_ORDER = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;

function isoToday() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

async function fetchDashboard(mode: string): Promise<DashboardData | null> {
  try {
    const res = await fetch(`/api/dashboard?range=${mode}`, {
      credentials: 'same-origin',
    });
    if (!res.ok) return null;
    return (await res.json()) as DashboardData;
  } catch {
    return null;
  }
}

// dash_rhythm weekday is Postgres dow (0=SUN..6=SAT); matrix rows are MON..SUN.
function rhythmFromRows(rows: DashboardData['rhythm']): RhythmBundle {
  const matrix = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  const hourTotals = new Array<number>(24).fill(0);
  for (const r of rows || []) {
    const row = (r.weekday + 6) % 7;
    const v = Number(r.commits) || 0;
    matrix[row][r.hour] += v;
    hourTotals[r.hour] += v;
  }
  const dayTotals = matrix.map((m) => m.reduce((a, b) => a + b, 0));
  const total = Math.max(1, dayTotals.reduce((a, b) => a + b, 0));
  const pct = (n: number) => Math.round((n / total) * 1000) / 10;

  const days = DOW_ORDER.map((name, i) => ({
    name,
    code: name,
    total: dayTotals[i],
    pct: pct(dayTotals[i]),
  }));

  const windowSum = (a: number, b: number) =>
    hourTotals.slice(a, b).reduce((x, y) => x + y, 0);
  const windows = [
    { label: 'NIGHT', range: '00:00–06:00', pct: pct(windowSum(0, 6)) },
    { label: 'MORNING', range: '06:00–12:00', pct: pct(windowSum(6, 12)) },
    { label: 'AFTERNOON', range: '12:00–18:00', pct: pct(windowSum(12, 18)) },
    { label: 'EVENING', range: '18:00–24:00', pct: pct(windowSum(18, 24)) },
  ];

  let peakDayIdx = 0;
  dayTotals.forEach((v, i) => {
    if (v > dayTotals[peakDayIdx]) peakDayIdx = i;
  });
  let peakHourIdx = 0;
  hourTotals.forEach((v, i) => {
    if (v > hourTotals[peakHourIdx]) peakHourIdx = i;
  });
  // best sliding 3-hour window, matching the fixture's '18:00–21:00' format
  let bestWin = 0;
  let bestWinSum = -1;
  for (let h = 0; h <= 21; h++) {
    const s = hourTotals[h] + hourTotals[h + 1] + hourTotals[h + 2];
    if (s > bestWinSum) {
      bestWinSum = s;
      bestWin = h;
    }
  }
  const hh = (n: number) => `${String(n).padStart(2, '0')}:00`;
  const weekdayTotal = dayTotals.slice(0, 5).reduce((a, b) => a + b, 0);

  return {
    matrix,
    days,
    windows,
    highlights: {
      peakWeekday: DOW_ORDER[peakDayIdx],
      peakWeekdayTotal: dayTotals[peakDayIdx],
      peakHour: hh(peakHourIdx),
      peakWindow: `${hh(bestWin)}–${hh(bestWin + 3)}`,
      weekdayShare: `${pct(weekdayTotal)}%`,
      weekendShare: `${pct(total - weekdayTotal)}%`,
    },
  };
}

const FIXTURE_RHYTHM: RhythmBundle = {
  matrix: RHYTHM_MATRIX,
  days: RHYTHM_DAYS.map((d) => ({ ...d })),
  windows: RHYTHM_WINDOWS.map((w) => ({ ...w })),
  highlights: { ...RHYTHM_HIGHLIGHTS },
};

function daysFromDaily(
  daily: DashboardData['daily'],
  endIso: string,
): DayData[] {
  const byDate = new Map(daily.map((d) => [d.date, d]));
  const startIso = daily[0]?.date ?? endIso;
  const start = new Date(startIso + 'T00:00:00').getTime();
  const end = new Date(endIso + 'T00:00:00').getTime();
  if (start > end) return [];
  const out: DayData[] = [];
  let cum = 0;
  for (let t = start, i = 0; t <= end; t += 86_400_000, i++) {
    const d = new Date(t);
    const p = (n: number) => String(n).padStart(2, '0');
    const iso = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    const row = byDate.get(iso);
    const added = row?.added ?? 0;
    const deleted = row?.deleted ?? 0;
    cum += added - deleted;
    out.push({
      date: iso,
      dayIndex: i,
      dailyChange: added - deleted,
      cumulative: cum,
      commits: row?.commits ?? 0,
      added,
      deleted,
      active: (row?.commits ?? 0) > 0,
    });
  }
  return out;
}

function repoStatus(r: RepoRow, endIso: string): RepoItem['status'] {
  if (!r.commits) return 'DORMANT';
  if (!r.lastCommitAt) return 'QUIET';
  const days =
    (new Date(endIso + 'T00:00:00').getTime() -
      new Date(r.lastCommitAt).getTime()) /
    86_400_000;
  if (days <= 30) return 'ACTIVE';
  if (days <= 90) return 'STEADY';
  return 'QUIET';
}

function reposFromRows(rows: RepoRow[], endIso: string): RepoItem[] {
  const maxCommits = Math.max(1, ...rows.map((r) => r.commits));
  const n = rows.length;
  return rows.map((r, i) => ({
    // UI-facing id mirrors the fixture's D.NN codes so constellation coords,
    // selection state and aria labels keep working unchanged.
    id: `D.${String(i + 1).padStart(2, '0')}`,
    code: `D.${String(i + 1).padStart(2, '0')}`,
    name: r.name,
    locked: r.private,
    language: (r.primaryLanguage || '—').toUpperCase(),
    status: repoStatus(r, endIso),
    bytesStr: fmtCompact(r.languageBytes),
    bytesNum: r.languageBytes,
    commits: r.commits,
    // Deterministic constellation placement: a fan like the fixture's
    // 52°..144° spread, radius by commit share (sqrt-tempered).
    angle: 50 + (i * 96) / Math.max(n - 1, 1),
    radius: 0.18 + 0.62 * Math.sqrt(r.commits / maxCommits),
    rid: r.id,
    disconnected: r.disconnected === true,
  }));
}

const EXT_MAP: Record<string, string> = {
  typescript: '.ts', javascript: '.js', python: '.py', css: '.css',
  html: '.html', 'c++': '.cpp', c: '.c', 'c#': '.cs', java: '.java',
  powershell: '.ps1', shell: '.sh', bash: '.sh', batchfile: '.bat',
  json: '.json', markdown: '.md', go: '.go', rust: '.rs', ruby: '.rb',
  dockerfile: 'Dockerfile',
};

function langRowsFrom(langs: { name: string; bytes: number }[]): LangRow[] {
  const total = Math.max(1, langs.reduce((a, l) => a + l.bytes, 0));
  return langs.map((l) => ({
    name: l.name.toUpperCase(),
    bytes: l.bytes,
    size: fmtBytes(l.bytes),
    pct: Math.round((l.bytes / total) * 1000) / 10,
    ext: EXT_MAP[l.name.toLowerCase()] ?? `.${l.name.toLowerCase().replace(/[^a-z0-9]+/g, '')}`,
  }));
}

const FIXTURE: DashboardData = DASHBOARD as DashboardData;

// Bundled fixtures exist ONLY for the Vite dev/design preview. Production
// builds resolve '../fixtures' to an inert stub, and this flag additionally
// guarantees no code path ever renders demo data outside dev mode.
const FIXTURES_ENABLED = import.meta.env.DEV;

function fixtureStore(period: Period): LedgerStore {
  const endIso = OBS_END;
  return {
    live: false,
    resolving: false,
    dash: FIXTURE,
    all: FIXTURE,
    days: DATA_365,
    cells: fixtureCells,
    weeks: fixtureWeeks,
    repos: REPOSITORIES,
    langs: fixtureLanguages.map((l) => ({ name: l.name, bytes: l.bytes })),
    langRows: LANGUAGES,
    langTotal: fixtureLanguages.reduce((a, l) => a + l.bytes, 0),
    end: END,
    endIso,
    allFromIso: OBS_START,
    range: periodToRange(period, endIso, OBS_START),
    rhythm: FIXTURE_RHYTHM,
    syncNow: () => {},
    pumping: false,
    refresh: () => {},
  };
}

// Production failure state: /api/dashboard unreachable → a safe, empty,
// permanently-resolving store (surfaces render skeletons, not telemetry).
const EMPTY_DASH: DashboardData = {
  generatedAt: '',
  range: { from: null, to: null },
  summary: {
    repos: 0, commits: 0, sourceAdded: 0, sourceDeleted: 0,
    allAdded: 0, allDeleted: 0, allChurn: 0, activeDays: 0,
    longestStreak: 0, peakDayCommits: 0, languageBytes: 0,
  },
  github: { connected: false, pullRequests: 0, mergedPrs: 0, revoked: false },
  sync: { status: 'idle', progress: 0 },
  rangeCoverage: { status: 'idle' },
  repositories: [],
  languages: [],
  daily: [],
  prsDaily: [],
  rhythm: [],
  workShape: { repoLangs: {}, repoMonthly: [], span: null },
};

const EMPTY_RHYTHM: RhythmBundle = {
  matrix: Array.from({ length: 7 }, () => new Array<number>(24).fill(0)),
  days: [],
  windows: [],
  highlights: {
    peakWeekday: '—', peakWeekdayTotal: 0, peakHour: '—',
    peakWindow: '—', weekdayShare: '—', weekendShare: '—',
  },
};

function emptyStore(period: Period, syncNow: () => void, pumping: boolean, refresh: () => void = () => {}): LedgerStore {
  const endIso = isoToday();
  return {
    live: false,
    resolving: true,
    dash: EMPTY_DASH,
    all: EMPTY_DASH,
    days: [],
    cells: [],
    weeks: [],
    repos: [],
    langs: [],
    langRows: [],
    langTotal: 0,
    end: new Date(endIso + 'T00:00:00'),
    endIso,
    allFromIso: endIso,
    range: periodToRange(period, endIso, endIso),
    rhythm: EMPTY_RHYTHM,
    syncNow,
    pumping,
    refresh,
  };
}

export function useDashboardStore(period: Period): LedgerStore {
  const mode = PERIOD_MODE[period];
  const [payloads, setPayloads] = useState<Partial<Record<string, DashboardData>>>({});
  // Live sync state reported by /api/sync during a pump — folded into
  // dash.sync so every surface (UtilityBar, account menu) shares one state.
  const [syncLive, setSyncLive] = useState<DashboardData['sync'] | null>(null);
  // Analytics: the trigger of the currently open sync run — 'manual' only
  // while this tab's pump drives it. A run opens on the first observed
  // 'syncing' and closes on the first terminal status, so exactly one
  // started + one completed/failed is emitted per run regardless of which
  // observer (pump, passive poll) reports the status. updatedAt guards the
  // reopen: a late-arriving 'syncing' snapshot older than the close can't
  // reopen a phantom run — only authoritative /api/sync responses feed
  // this, never dashboard payload snapshots.
  const syncRun = useRef<SyncTrigger | null>(null);
  const closedRunAt = useRef(0);
  // Open/close helper shared by pump and passive poll.
  const noteSyncStatus = useCallback((s: DashboardData['sync'] | null | undefined) => {
    const status = s?.status;
    const updatedAt = s?.updatedAt ? Date.parse(s.updatedAt) || 0 : 0;
    if (status === 'syncing') {
      if (!syncRun.current) {
        if (closedRunAt.current && updatedAt <= closedRunAt.current) return;
        syncRun.current = 'automatic';
        captureEvent('sync_started', { trigger: 'automatic' });
      }
      return;
    }
    const trigger = syncRun.current;
    if (!trigger) return;
    if (status === 'complete') {
      closedRunAt.current = Math.max(closedRunAt.current, updatedAt);
      syncRun.current = null;
      captureEvent('sync_completed', { trigger });
    } else if (status === 'rate_limited' || status === 'revoked' || status === 'error') {
      closedRunAt.current = Math.max(closedRunAt.current, updatedAt);
      syncRun.current = null;
      captureEvent('sync_failed', { trigger, reason: mapSyncFailReason(status) });
    }
  }, []);
  // Terminal failure paths that never produce a status row (HTTP error,
  // thrown fetch) close the run through the same single emit path.
  const failSyncRun = useCallback((reason: SyncFailReason) => {
    const trigger = syncRun.current;
    if (!trigger) return;
    syncRun.current = null;
    captureEvent('sync_failed', { trigger, reason });
  }, []);
  const [fetchTick, setFetchTick] = useState(0);
  const requested = useRef(new Set<string>());
  const pumping = useRef(false);
  const [pumpingState, setPumpingState] = useState(false);
  // First-load resolution: skeletons render until the initial dashboard
  // fetches settle. Settled counts successes AND failures — a failed fetch
  // falls back to bundled fixtures, which are real renderable data, not a
  // loading state.
  const settled = useRef(new Set<string>());
  const [settleTick, setSettleTick] = useState(0);
  // Server generation stamp per held payload — compared against a sync's
  // lastSyncedAt to detect snapshots that predate a completed run.
  const genAt = useRef<Partial<Record<string, number>>>({});
  // The last sync completion that already triggered a refresh — one-shot
  // per completion, so an externally-driven run can't start a refetch loop.
  const consumedSyncAt = useRef<string | null>(null);
  // Boot watch: a login-kicked sync may begin and even finish before the
  // first /api/sync poll lands, so the window right after mount polls at
  // the in-flight cadence regardless of what the stale payload claims.
  const [booting, setBooting] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setBooting(false), SYNC_BOOT_WATCH_MS);
    return () => clearTimeout(t);
  }, []);

  // Fetch the period-scoped payload on every period change (backend respects
  // the range) and the all-time payload once for structural views.
  useEffect(() => {
    const modes = mode === 'all' ? ['all'] : [mode, 'all'];
    for (const m of modes) {
      if (requested.current.has(m)) continue;
      requested.current.add(m);
      fetchDashboard(m).then((d) => {
        settled.current.add(m);
        setSettleTick((t) => t + 1);
        if (d) {
          genAt.current[m] = Date.parse(d.generatedAt);
          setPayloads((p) => ({ ...p, [m]: d }));
        }
      });
    }
  }, [mode, fetchTick]);

  // Existing sync mechanism: serial POST slices (each bounded in-request),
  // plus the same progressive GET poll the production UI used. Cron finishes
  // anything abandoned; cursors make slices resumable.
  const syncNow = useCallback(() => {
    if (pumping.current) return;
    pumping.current = true;
    setPumpingState(true);
    // A user-driven run begins now — claim the open run before any status
    // observation so observers don't re-label it 'automatic'.
    syncRun.current = 'manual';
    captureEvent('sync_started', { trigger: 'manual' });
    const poll = setInterval(async () => {
      try {
        const r = await fetch('/api/sync', { credentials: 'same-origin' });
        if (r.ok) {
          const s = await r.json();
          setSyncLive(s);
          noteSyncStatus(s);
        }
      } catch {
        /* transient poll failure — the POST loop is authoritative */
      }
    }, 1500);
    (async () => {
      try {
        for (;;) {
          const res = await fetch('/api/sync?force=1', {
            method: 'POST',
            credentials: 'same-origin',
          });
          if (!res.ok) {
            failSyncRun(syncFailReasonFromHttp(res.status));
            break;
          }
          const s = await res.json();
          setSyncLive(s);
          // Terminal statuses are emitted here — the finally below clears
          // syncLive, and a batched render could otherwise hide the
          // transition.
          noteSyncStatus(s);
          if (s?.status === 'syncing') {
            await new Promise((r) => setTimeout(r, 1500));
            continue;
          }
          break;
        }
      } catch {
        /* offline/API-less preview — nothing to do */
        failSyncRun('network');
      } finally {
        clearInterval(poll);
        pumping.current = false;
        setPumpingState(false);
        // Pull fresh dashboard data + canonical sync state after the run.
        requested.current.clear();
        setSyncLive(null);
        setFetchTick((t) => t + 1);
      }
    })();
  }, [noteSyncStatus, failSyncRun]);

  // Re-pull every dashboard payload — used after mutations like a repo
  // disconnect so the ledger reflects the new state immediately.
  const refresh = useCallback(() => {
    requested.current.clear();
    setFetchTick((t) => t + 1);
  }, []);

  const live = payloads.all != null || payloads[mode] != null;
  const all = payloads.all ?? FIXTURE;
  const dashBase = payloads[mode] ?? all;
  const dash = syncLive ? { ...dashBase, sync: { ...dashBase.sync, ...syncLive } } : dashBase;

  // Passive sync observation: while the local pump isn't running, keep the
  // instrument live when a sync is in flight (cron or another tab may be
  // driving it) and resume the pump once a rate-limit window passes.
  const syncStatus = dash.sync?.status;
  const resumeAt = dash.sync?.resumeAt;
  useEffect(() => {
    if (!live || pumpingState) return;
    const cadence = passivePollMs(syncStatus, booting);
    const t = setInterval(async () => {
      if (pumping.current) return;
      try {
        const r = await fetch('/api/sync', { credentials: 'same-origin' });
        if (!r.ok) return;
        const s = (await r.json()) as DashboardData['sync'];
        setSyncLive(s);
        noteSyncStatus(s);
        // A sync nobody local drove (login-kicked initial run, cron, another
        // tab) updates only syncLive — the held dashboard payloads still
        // predate the ingested data. When a completion stamp lands newer
        // than any snapshot, re-pull every payload once. consumedSyncAt
        // makes the completion a single trigger: post-refetch snapshots
        // compare clean, and no poll can start a duplicate sync or refetch
        // loop. This is the refresh the manual syncNow()'s finally performs
        // — extended to externally-driven runs.
        if (
          s?.lastSyncedAt &&
          consumedSyncAt.current !== s.lastSyncedAt &&
          snapshotPredatesSync(genAt.current, s.lastSyncedAt)
        ) {
          consumedSyncAt.current = s.lastSyncedAt;
          refresh();
        }
        // Self-heal a wedged 'syncing' claim: no writer has touched the row
        // within the slice budget, so nobody is driving it — re-enter the
        // pump. The backend lock CAS makes this safe alongside real runners.
        if (rateLimitElapsed(s) || isSyncStale(s)) syncNow();
      } catch {
        /* transient poll failure — next tick retries */
      }
    }, cadence);
    return () => clearInterval(t);
    // resumeAt re-derives cadence targets; status changes restart the poll.
  }, [live, syncStatus, resumeAt, pumpingState, syncNow, refresh, booting, noteSyncStatus]);

  // Skeleton window: still waiting on the first payload(s). Once live, or
  // once every requested fetch has settled, data (real or fixture) owns
  // the surface.
  const resolving = !live && !(settleTick > 0 && ['all', mode].every((m) => settled.current.has(m)));

  return useMemo<LedgerStore>(() => {
    // Fixture fallback still wires the REAL sync pump — SYNC NOW must fire
    // the canonical /api/sync POST even when the dashboard payload isn't
    // live. Bundled fixtures are dev-only: in production a failed/absent
    // API yields a permanently-resolving empty store (skeletons), never
    // demo telemetry.
    if (!live) {
      return FIXTURES_ENABLED
        ? { ...fixtureStore(period), resolving, syncNow, pumping: pumpingState, refresh }
        : emptyStore(period, syncNow, pumpingState, refresh);
    }

    // The visible horizon is the selected range end (or today for ALL), not
    // the last active GitHub day. Sparse activity rows are densified through
    // this date so quiet days/months remain visible as flat/zero periods.
    const endIso = timelineEndIso(dash.range.to, all.range.to, isoToday());
    const allFromIso =
      all.workShape.span?.firstActive ?? all.daily[0]?.date ?? endIso;
    const cells = cellsFromDaily(all.daily, all.prsDaily, endIso);
    const langs = all.languages.map((l) => ({ name: l.language, bytes: l.code }));

    return {
      live: true,
      resolving,
      dash,
      all,
      days: daysFromDaily(all.daily, endIso),
      cells,
      weeks: weeksFromCells(cells),
      repos: reposFromRows(all.repositories, endIso),
      langs,
      langRows: langRowsFrom(langs),
      langTotal: langs.reduce((a, l) => a + l.bytes, 0),
      end: new Date(endIso + 'T00:00:00'),
      endIso,
      allFromIso,
      range: periodToRange(period, endIso, allFromIso),
      rhythm: rhythmFromRows(dash.rhythm),
      syncNow,
      pumping: pumpingState,
      refresh,
    };
  }, [live, all, dash, period, syncNow, pumpingState, resolving, refresh]);
}

export const LedgerContext = createContext<LedgerStore | null>(null);

export function useLedger(): LedgerStore {
  const store = useContext(LedgerContext);
  if (!store) {
    // standalone render → fixture fallback in dev, empty store in prod
    return FIXTURES_ENABLED ? fixtureStore('1Y') : emptyStore('1Y', () => {}, false);
  }
  return store;
}

/* ── Authenticated identity ────────────────────────────────────────────
   Shape of GET /api/user — safe presentation data only (login, avatar,
   installations, sync). The Gate resolves this once; no credentials or
   tokens ever cross the boundary. */

export interface Identity {
  authenticated: boolean;
  user: {
    githubLogin?: string;
    avatarUrl?: string;
    displayName?: string;
  } | null;
  installations: { id: number; account: string; type: string; url: string }[];
  appSlug: string | null;
  sync?: {
    status: string;
    phase?: string;
    progress?: number;
    detail?: unknown;
    lastSyncedAt?: string | null;
    error?: string | null;
  } | null;
}

export const IdentityContext = createContext<Identity | null>(null);

export function useIdentity(): Identity | null {
  return useContext(IdentityContext);
}
