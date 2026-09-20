import type { Period } from './types';
import { DATA_365 } from './store/metricsData';

// Static fixture in the production /api/dashboard response shape — feeds the
// retained Quiet Instrument components (Historical Lanes, Archive figures)
// with the same data contract they consume in the real app.

export const OBS_START = '2024-01-01';
export const OBS_END = '2026-09-20';

interface RepoSeed {
  id: string;
  name: string;
  path: string;
  private: boolean;
  primaryLanguage: string;
  languageBytes: number;
  langs: [string, number][];
  // month → [commits, added, deleted]
  monthly: Record<string, [number, number, number]>;
}

const REPO_SEEDS: RepoSeed[] = [
  {
    id: 'r1', name: 'lexica-aeterna', path: 'Aliferous3/lexica-aeterna', private: true,
    primaryLanguage: 'TypeScript', languageBytes: 2_100_000,
    langs: [['TypeScript', 1_980_000], ['CSS', 82_000], ['HTML', 38_000]],
    monthly: {
      '2026-05': [120, 96_000, 4_000],
      '2026-08': [540, 812_000, 31_000],
      '2026-09': [630, 901_000, 42_000],
    },
  },
  {
    id: 'r2', name: 'Influencer-Tracker', path: 'Aliferous3/Influencer-Tracker', private: true,
    primaryLanguage: 'TypeScript', languageBytes: 1_700_000,
    langs: [['TypeScript', 1_620_000], ['JavaScript', 80_000]],
    monthly: {
      '2024-03': [6, 8_400, 900],
      '2024-04': [9, 14_200, 1_800],
      '2024-05': [4, 5_100, 600],
      '2024-06': [3, 3_400, 500],
      '2025-01': [8, 11_800, 1_400],
    },
  },
  {
    id: 'r3', name: 'dev-ledger', path: 'Aliferous3/dev-ledger', private: true,
    primaryLanguage: 'JavaScript', languageBytes: 39_000,
    langs: [['JavaScript', 31_000], ['CSS', 6_200], ['HTML', 1_800]],
    monthly: {
      '2026-07': [12, 9_800, 2_100],
      '2026-08': [18, 16_400, 3_200],
      '2026-09': [12, 11_200, 2_400],
    },
  },
  {
    id: 'r4', name: 'gold-bot', path: 'Aliferous3/gold-bot', private: true,
    primaryLanguage: 'Python', languageBytes: 39_000,
    langs: [['Python', 37_500], ['Shell', 1_500]],
    monthly: {
      '2026-06': [30, 21_000, 4_800],
      '2026-07': [24, 17_600, 4_100],
    },
  },
  {
    id: 'r5', name: 'taskbar-kitty', path: 'Aliferous3/taskbar-kitty', private: true,
    primaryLanguage: 'Python', languageBytes: 5_500,
    langs: [['Python', 5_100], ['PowerShell', 400]],
    monthly: {
      '2025-11': [6, 4_200, 700],
      '2025-12': [4, 2_600, 500],
    },
  },
  {
    id: 'r6', name: 'Live-Flight-Radar-Scanner-M5Stack', path: 'Aliferous3/Live-Flight-Radar-Scanner-M5Stack', private: false,
    primaryLanguage: 'C++', languageBytes: 527,
    langs: [['C++', 527]],
    monthly: { '2024-08': [2, 600, 40] },
  },
  {
    id: 'r7', name: 'Aliferous3', path: 'Aliferous3/Aliferous3', private: false,
    primaryLanguage: '', languageBytes: 2,
    langs: [['Markdown', 2]],
    monthly: { '2024-01': [1, 40, 0] },
  },
];

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function* monthIter(from: string, to: string) {
  let [y, m] = from.split('-').map(Number);
  const [ey, em] = to.split('-').map(Number);
  while (y < ey || (y === ey && m <= em)) {
    yield `${y}-${pad(m)}`;
    if (++m > 12) { m = 1; y++; }
  }
}

// Expand seeds into the API's repoMonthly rows — commits land on a few days
// inside each active month so activeDays stays plausible.
const repoMonthly: { repository_id: string; month: string; commits: number; added: number; deleted: number; activeDays: number }[] = [];
for (const r of REPO_SEEDS) {
  for (const [month, [commits, added, deleted]] of Object.entries(r.monthly)) {
    repoMonthly.push({
      repository_id: r.id,
      month,
      commits,
      added,
      deleted,
      activeDays: Math.min(commits, Math.max(2, Math.round(commits / 9))),
    });
  }
}
repoMonthly.sort((a, b) => a.month.localeCompare(b.month));

const repoLangs = Object.fromEntries(
  REPO_SEEDS.map((r) => [r.id, r.langs.map(([language, bytes]) => ({ language, bytes }))]),
);

const langTotals = new Map<string, number>();
for (const r of REPO_SEEDS) for (const [l, b] of r.langs) langTotals.set(l, (langTotals.get(l) || 0) + b);
// Minor strata observed across the corpus
for (const [l, b] of [['Java', 240], ['Dockerfile', 180]] as [string, number][])
  langTotals.set(l, (langTotals.get(l) || 0) + b);

const repositories = REPO_SEEDS.map((r) => {
  const rows = repoMonthly.filter((m) => m.repository_id === r.id);
  return {
    id: r.id,
    name: r.name,
    path: r.path,
    private: r.private,
    fork: false,
    archived: false,
    primaryLanguage: r.primaryLanguage,
    languageBytes: r.languageBytes,
    commits: rows.reduce((a, m) => a + m.commits, 0),
    sourceAdded: rows.reduce((a, m) => a + m.added, 0),
    sourceDeleted: rows.reduce((a, m) => a + m.deleted, 0),
    activeDays: rows.reduce((a, m) => a + m.activeDays, 0),
    lastCommitAt: null,
    lastCommit: null,
    lastActivityAt: null,
  };
});

// Daily series for the Historical Lanes — reuse the ZIP's generated year so
// lanes, the contribution field, and FIG. A/B all read the same record.
const daily = DATA_365.map((d) => ({
  date: d.date,
  commits: d.commits,
  added: d.added,
  deleted: d.deleted,
}));

// ~439 opened PRs weighted onto active days.
let prsRemaining = 439;
const activeDays = DATA_365.filter((d) => d.commits > 0);
const prsDaily: { date: string; opened: number; merged: number }[] = [];
activeDays.forEach((d, i) => {
  const left = activeDays.length - i;
  const opened = i === left - 1 ? prsRemaining : Math.min(prsRemaining, Math.max(1, Math.round(d.commits / 3)));
  prsRemaining -= opened;
  if (opened > 0) prsDaily.push({ date: d.date, opened, merged: Math.max(0, opened - (i % 9 === 0 ? 1 : 0)) });
});

const totalCommits = repoMonthly.reduce((a, m) => a + m.commits, 0);
const totalAdded = repoMonthly.reduce((a, m) => a + m.added, 0);
const totalDeleted = repoMonthly.reduce((a, m) => a + m.deleted, 0);
const totalActiveDays = repoMonthly.reduce((a, m) => a + m.activeDays, 0);

export const DASHBOARD = {
  generatedAt: '2026-09-20T00:00:00.000Z',
  range: { from: OBS_START, to: OBS_END },
  summary: {
    repos: repositories.length,
    commits: totalCommits,
    sourceAdded: totalAdded,
    sourceDeleted: totalDeleted,
    allAdded: totalAdded,
    allDeleted: totalDeleted,
    allChurn: totalAdded + totalDeleted,
    activeDays: totalActiveDays,
    longestStreak: 23,
    peakDayCommits: 114,
    languageBytes: [...langTotals.values()].reduce((a, b) => a + b, 0),
  },
  github: { connected: true, pullRequests: 439, mergedPrs: 426, revoked: false },
  sync: { status: 'idle', progress: 1 },
  rangeCoverage: { status: 'complete' },
  repositories,
  languages: [...langTotals.entries()]
    .map(([language, code]) => ({ language, code, files: 0 }))
    .sort((a, b) => b.code - a.code),
  daily,
  prsDaily,
  rhythm: [],
  workShape: {
    repoLangs,
    repoMonthly,
    span: {
      firstActive: OBS_START,
      lastActive: OBS_END,
      activeDays: 89,
      totalCommits,
      totalAdded,
      totalDeleted,
    },
  },
};

const FIELD_END = '2026-09-20';

// ZIP period label → a makeRange()-shaped range. `endIso` defaults to the
// fixture window edge; live data passes the real last-observed day.
export function periodToRange(
  period: Period,
  endIso: string = FIELD_END,
  allFromIso: string = OBS_START,
): { mode: string; from: string | null; to: string | null } {
  const end = endIso;
  const shift = (days: number) => {
    const d = new Date(end + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - days);
    return d.toISOString().slice(0, 10);
  };
  switch (period) {
    case '7D': return { mode: '7d', from: shift(6), to: end };
    case '30D': return { mode: '30d', from: shift(29), to: end };
    case '90D': return { mode: '90d', from: shift(89), to: end };
    case 'YTD': return { mode: 'ytd', from: `${end.slice(0, 4)}-01-01`, to: end };
    case 'ALL': return { mode: 'all', from: allFromIso, to: end };
    case '1Y':
    default: return { mode: '1y', from: shift(364), to: end };
  }
}

export const ARCHIVE_RANGE = { mode: 'all', from: OBS_START, to: OBS_END };
export const MONTH_SPAN = [...monthIter('2024-01', '2026-09')];
