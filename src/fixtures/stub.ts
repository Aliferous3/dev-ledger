// Production stand-in for the dev-only fixture barrel (./index.ts).
// vite.config.ts aliases '../fixtures' here in build mode, so the shipped
// bundle contains no fixture module and no demo telemetry — only these
// inert, empty shapes that satisfy the module contract.
//
// Keep every export structurally compatible with the barrel; values are
// intentionally empty. Production must never render demo telemetry — the
// store gates fixture rendering on import.meta.env.DEV as well.

import type { DayData, RepoItem } from '../types';
import type { DayCell, Week } from '../fieldData';
import type { LangRow } from '../codeData';
import type { ActivityTotals, Milestone } from '../activityData';

const EMPTY_DASHBOARD = {
  generatedAt: '',
  range: { from: null, to: null },
  summary: {
    repos: 0,
    commits: 0,
    sourceAdded: 0,
    sourceDeleted: 0,
    allAdded: 0,
    allDeleted: 0,
    allChurn: 0,
    activeDays: 0,
    longestStreak: 0,
    peakDayCommits: 0,
    languageBytes: 0,
  },
  github: { connected: false, pullRequests: 0, mergedPrs: 0, revoked: false },
  sync: { status: 'idle', progress: 0 },
  rangeCoverage: { status: 'idle' },
  repositories: [],
  languages: [],
  daily: [],
  prsDaily: [],
  rhythm: [],
  workShape: {
    repoLangs: {},
    repoMonthly: [],
    span: null,
  },
};

export const DASHBOARD = EMPTY_DASHBOARD;
export const OBS_START = '';
export const OBS_END = '';
export const ARCHIVE_RANGE = { mode: 'all', from: null, to: null };
export const MONTH_SPAN: string[] = [];

export const DATA_365: DayData[] = [];
export const REPOSITORIES: RepoItem[] = [];
export const FINGERPRINT_METRICS: { id: string; title: string; val: string; sub: string; pct: number }[] = [];
export const SUCCESSION_LANGUAGES: string[] = [];
export const MIGRATION_CARDS: { name: string; duration: string; span: string }[] = [];
export const SPAN_STATS: { label: string; value: string }[] = [];
export const START_DATE = new Date(0);
export const END_DATE = new Date(0);
export function generate365Days(): DayData[] {
  return [];
}

export const START = new Date(0);
export const END = new Date(0);
export const cells: DayCell[] = [];
export const weeks: Week[] = [];
export const languages: { name: string; bytes: number }[] = [];
export const languageTotal = 0;

export const LANGUAGES: LangRow[] = [];
export const LANGUAGE_TOTAL_BYTES = 0;

export const ACTIVITY_TOTALS: ActivityTotals = {
  activeDays: 0,
  longestStreak: 0,
  peakDayCommits: 0,
  peakDayDate: '',
  avgActiveDay: 0,
};
export const EXTREMES: { id: string; label: string; value: string; numValue: number; date: string; detail: string }[] = [];
export const MILESTONES: Milestone[] = [];
export const MONTH_COMMITS: { key: string; name: string; date: string; commits: number; added: number; deleted: number }[] = [];
export const MOST_ACTIVE_MONTHS: { rank: number; commits: number; date: string }[] = [];
export const RHYTHM_DAYS: { name: string; code: string; total: number; pct: number }[] = [];
export const RHYTHM_WINDOWS: { label: string; range: string; pct: number }[] = [];
export const RHYTHM_HIGHLIGHTS = {
  peakWeekday: '—',
  peakWeekdayTotal: 0,
  peakHour: '—',
  peakWindow: '—',
  weekdayShare: '—',
  weekendShare: '—',
};
export const RHYTHM_MATRIX: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0));
