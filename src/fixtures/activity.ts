// DEV-ONLY synthetic ACTIVITY fixture — fictional totals, extremes,
// milestones, and rhythm distribution. Aliased to an inert stub in
// production builds; never ships user-derived telemetry.

import type { ActivityTotals, Milestone } from '../activityData';

export const ACTIVITY_TOTALS: ActivityTotals = {
  activeDays: 52,
  longestStreak: 19,
  peakDayCommits: 186,
  peakDayDate: '2026-08-15',
  avgActiveDay: 21.2,
};

export const EXTREMES = [
  {
    id: 'commits',
    label: 'MOST COMMITS IN A DAY',
    value: '186',
    numValue: 186,
    date: '2026-08-15',
    detail: 'Demo release sprint · Saturday',
  },
  {
    id: 'churn',
    label: 'HIGHEST CHURN DAY',
    value: '1.2M',
    numValue: 1200000,
    date: '2026-08-19',
    detail: 'Sample monorepo restructuring',
  },
  {
    id: 'added',
    label: 'MOST LINES ADDED',
    value: '742K',
    numValue: 742000,
    date: '2026-09-05',
    detail: 'Fixture engine ingestion',
  },
  {
    id: 'deleted',
    label: 'MOST LINES DELETED',
    value: '614K',
    numValue: 614000,
    date: '2026-08-19',
    detail: 'Synthetic legacy prune',
  },
];

export const MILESTONES: Milestone[] = [
  { id: 'm1', date: '2026-07-26', title: '100TH COMMIT', desc: 'Fixture architecture stabilized' },
  { id: 'm2', date: '2026-08-16', title: '400TH COMMIT', desc: 'Sample indexing pass deployed' },
  { id: 'm3', date: '2026-09-04', title: '800TH COMMIT', desc: 'Demo telemetry activated' },
  { id: 'm4', date: '2026-08-19', title: 'LARGEST SOURCE CHURN DAY', desc: '1.2M lines restructured across 7 repos' },
];

export const MONTH_COMMITS = [
  { key: 'A', name: 'APR', date: '2026-04', commits: 29, added: 34000, deleted: 5400 },
  { key: 'M', name: 'MAY', date: '2026-05', commits: 9, added: 9800, deleted: 2400 },
  { key: 'J', name: 'JUN', date: '2026-06', commits: 31, added: 41000, deleted: 11800 },
  { key: 'J', name: 'JUL', date: '2026-07', commits: 421, added: 604000, deleted: 586000 },
  { key: 'A', name: 'AUG', date: '2026-08', commits: 613, added: 698000, deleted: 322000 },
];

export const MOST_ACTIVE_MONTHS = [
  { rank: 1, commits: 613, date: '2026-08' },
  { rank: 2, commits: 421, date: '2026-07' },
  { rank: 3, commits: 31,  date: '2026-06' },
  { rank: 4, commits: 29,  date: '2026-04' },
  { rank: 5, commits: 9,   date: '2026-05' },
];

export const RHYTHM_DAYS = [
  { name: 'MON', code: 'MON', total: 88,  pct: 8.0 },
  { name: 'TUE', code: 'TUE', total: 82,  pct: 7.5 },
  { name: 'WED', code: 'WED', total: 174, pct: 15.9 },
  { name: 'THU', code: 'THU', total: 101, pct: 9.2 },
  { name: 'FRI', code: 'FRI', total: 107, pct: 9.8 },
  { name: 'SAT', code: 'SAT', total: 296, pct: 27.0 },
  { name: 'SUN', code: 'SUN', total: 248, pct: 22.6 },
];

export const RHYTHM_WINDOWS = [
  { label: 'NIGHT', range: '00:00–06:00', pct: 8.4 },
  { label: 'MORNING', range: '06:00–12:00', pct: 26.1 },
  { label: 'AFTERNOON', range: '12:00–18:00', pct: 30.2 },
  { label: 'EVENING', range: '18:00–24:00', pct: 35.3 },
];

export const RHYTHM_HIGHLIGHTS = {
  peakWeekday: 'SAT',
  peakWeekdayTotal: 296,
  peakHour: '17:00',
  peakWindow: '17:00–20:00',
  weekdayShare: '48.9%',
  weekendShare: '51.1%',
};

// 7 rows (MON..SUN) x 24 columns (hours 00..23) — fictional distribution.
export const RHYTHM_MATRIX: number[][] = [
  // MON: 88 total
  [0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 2, 3, 3, 2, 1, 2, 4, 10, 15, 18, 13, 7, 4, 0],
  // TUE: 82 total
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 2, 2, 1, 3, 4, 8, 12, 18, 16, 8, 2, 0],
  // WED: 174 total
  [3, 2, 1, 0, 0, 0, 0, 0, 2, 3, 4, 4, 3, 4, 2, 3, 7, 19, 32, 38, 29, 21, 12, 4],
  // THU: 101 total
  [2, 1, 0, 0, 0, 0, 0, 0, 1, 3, 2, 4, 3, 2, 2, 4, 5, 11, 16, 22, 15, 8, 3, 0],
  // FRI: 107 total
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 2, 3, 2, 3, 4, 6, 8, 14, 21, 19, 15, 8, 3, 0],
  // SAT: 296 total
  [0, 0, 0, 0, 0, 0, 0, 0, 3, 7, 10, 15, 20, 23, 25, 26, 30, 38, 45, 35, 21, 13, 6, 2],
  // SUN: 248 total
  [0, 0, 0, 0, 0, 0, 0, 2, 6, 14, 20, 25, 28, 27, 26, 25, 23, 26, 29, 28, 19, 11, 4, 2],
];
