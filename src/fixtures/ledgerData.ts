import type { Period } from '../types';
import { DATA_365 } from './metricsData';
import { periodToRange } from '../ledger/periods';

// DEV-ONLY synthetic fixture in the production /api/dashboard response
// shape — feeds the design-mode preview with completely fictional
// repositories, owners, and statistics. Aliased to an inert stub in
// production builds; never ships user-derived data.

export const OBS_START = '2024-02-01';
export const OBS_END = '2026-09-14';

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
    id: 'r1', name: 'northstar-api', path: 'octo-demo/northstar-api', private: true,
    primaryLanguage: 'TypeScript', languageBytes: 1_840_000,
    langs: [['TypeScript', 1_720_000], ['CSS', 76_000], ['HTML', 44_000]],
    monthly: {
      '2026-04': [96, 71_000, 3_100],
      '2026-07': [410, 642_000, 24_000],
      '2026-08': [434, 701_000, 31_000],
    },
  },
  {
    id: 'r2', name: 'quartz-ui', path: 'octo-demo/quartz-ui', private: true,
    primaryLanguage: 'TypeScript', languageBytes: 1_240_000,
    langs: [['TypeScript', 1_180_000], ['JavaScript', 60_000]],
    monthly: {
      '2024-04': [5, 6_900, 800],
      '2024-05': [8, 11_700, 1_500],
      '2024-06': [3, 4_200, 500],
      '2024-07': [3, 2_900, 400],
      '2025-02': [7, 9_800, 1_200],
    },
  },
  {
    id: 'r3', name: 'sample-cli', path: 'octo-demo/sample-cli', private: true,
    primaryLanguage: 'JavaScript', languageBytes: 52_000,
    langs: [['JavaScript', 41_000], ['CSS', 8_400], ['HTML', 2_600]],
    monthly: {
      '2026-06': [14, 11_200, 2_400],
      '2026-07': [20, 18_100, 3_700],
      '2026-08': [13, 12_800, 2_700],
    },
  },
  {
    id: 'r4', name: 'atlas-worker', path: 'octo-demo/atlas-worker', private: true,
    primaryLanguage: 'Python', languageBytes: 47_000,
    langs: [['Python', 45_000], ['Shell', 2_000]],
    monthly: {
      '2026-05': [33, 23_000, 5_200],
      '2026-06': [28, 19_400, 4_600],
    },
  },
  {
    id: 'r5', name: 'demo-dashboard', path: 'octo-demo/demo-dashboard', private: true,
    primaryLanguage: 'Python', languageBytes: 8_200,
    langs: [['Python', 7_600], ['Shell', 600]],
    monthly: {
      '2025-10': [7, 4_800, 800],
      '2025-11': [6, 3_400, 600],
    },
  },
  {
    id: 'r6', name: 'zephyr-sensor-fw', path: 'octo-demo/zephyr-sensor-fw', private: false,
    primaryLanguage: 'C++', languageBytes: 640,
    langs: [['C++', 640]],
    monthly: { '2024-09': [3, 700, 50] },
  },
  {
    id: 'r7', name: 'octo-demo', path: 'octo-demo/octo-demo', private: false,
    primaryLanguage: '', languageBytes: 2,
    langs: [['Markdown', 2]],
    monthly: { '2024-02': [1, 40, 0] },
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
for (const [l, b] of [['Rust', 310], ['Dockerfile', 240]] as [string, number][])
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

// Daily series for the Historical Lanes — reuse the generated year so
// lanes, the contribution field, and FIG. A/B all read the same record.
const daily = DATA_365.map((d) => ({
  date: d.date,
  commits: d.commits,
  added: d.added,
  deleted: d.deleted,
}));

// ~312 opened PRs weighted onto active days.
let prsRemaining = 312;
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
  generatedAt: '2026-09-14T00:00:00.000Z',
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
    longestStreak: 19,
    peakDayCommits: 96,
    languageBytes: [...langTotals.values()].reduce((a, b) => a + b, 0),
  },
  github: { connected: true, pullRequests: 312, mergedPrs: 303, revoked: false },
  sync: { status: 'idle', progress: 0 },
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
      activeDays: 74,
      totalCommits,
      totalAdded,
      totalDeleted,
    },
  },
};

const FIELD_END = '2026-09-14';

// Fixture convenience wrapper — live.ts imports the real periodToRange
// from '../ledger/periods' for production ranges.
export function fixturePeriodToRange(period: Period) {
  return periodToRange(period, FIELD_END, OBS_START);
}

export const ARCHIVE_RANGE = { mode: 'all', from: OBS_START, to: OBS_END };
export const MONTH_SPAN = [...monthIter('2024-02', '2026-09')];
