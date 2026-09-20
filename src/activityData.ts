// Deterministic activity and rhythm data faithful to the screenshots

export interface ActivityTotals {
  activeDays: number;
  longestStreak: number;
  peakDayCommits: number;
  peakDayDate: string;
  avgActiveDay: number;
}

export const ACTIVITY_TOTALS: ActivityTotals = {
  activeDays: 58,
  longestStreak: 23,
  peakDayCommits: 238,
  peakDayDate: '2026-08-22',
  avgActiveDay: 24.6,
};

export const EXTREMES = [
  {
    id: 'commits',
    label: 'MOST COMMITS IN A DAY',
    value: '238',
    numValue: 238,
    date: '2026-08-22',
    detail: 'Peak release sprint · Saturday',
  },
  {
    id: 'churn',
    label: 'HIGHEST CHURN DAY',
    value: '1.7M',
    numValue: 1700000,
    date: '2026-08-26',
    detail: 'Monorepo restructuring',
  },
  {
    id: 'added',
    label: 'MOST LINES ADDED',
    value: '955K',
    numValue: 955000,
    date: '2026-09-12',
    detail: 'New runtime engine ingestion',
  },
  {
    id: 'deleted',
    label: 'MOST LINES DELETED',
    value: '807K',
    numValue: 807000,
    date: '2026-08-26',
    detail: 'Legacy dependencies pruned',
  },
];

export interface Milestone {
  id: string;
  date: string;
  title: string;
  desc: string;
}

export const MILESTONES: Milestone[] = [
  { id: 'm1', date: '2026-08-02', title: '100TH COMMIT', desc: 'Core architecture stabilized' },
  { id: 'm2', date: '2026-08-23', title: '500TH COMMIT', desc: 'Vector indexing pass deployed' },
  { id: 'm3', date: '2026-09-10', title: '1,000TH COMMIT', desc: 'Production telemetry activated' },
  { id: 'm4', date: '2026-08-26', title: 'LARGEST SOURCE CHURN DAY', desc: '1.7M lines restructured across 7 repos' },
];

export const MONTH_COMMITS = [
  { key: 'M', name: 'MAY', date: '2026-05', commits: 36, added: 42000, deleted: 6800 },
  { key: 'J', name: 'JUN', date: '2026-06', commits: 11, added: 12500, deleted: 3100 },
  { key: 'J', name: 'JUL', date: '2026-07', commits: 39, added: 54000, deleted: 14200 },
  { key: 'A', name: 'AUG', date: '2026-08', commits: 588, added: 840000, deleted: 820000 },
  { key: 'S', name: 'SEP', date: '2026-09', commits: 751, added: 885000, deleted: 410000 },
];

export const MOST_ACTIVE_MONTHS = [
  { rank: 1, commits: 751, date: '2026-09' },
  { rank: 2, commits: 588, date: '2026-08' },
  { rank: 3, commits: 39,  date: '2026-07' },
  { rank: 4, commits: 36,  date: '2026-05' },
  { rank: 5, commits: 11,  date: '2026-06' },
];

export const RHYTHM_DAYS = [
  { name: 'MON', code: 'MON', total: 101, pct: 7.1 },
  { name: 'TUE', code: 'TUE', total: 94,  pct: 6.6 },
  { name: 'WED', code: 'WED', total: 218, pct: 15.3 },
  { name: 'THU', code: 'THU', total: 117, pct: 8.2 },
  { name: 'FRI', code: 'FRI', total: 123, pct: 8.6 },
  { name: 'SAT', code: 'SAT', total: 393, pct: 27.6 },
  { name: 'SUN', code: 'SUN', total: 379, pct: 26.6 },
];

export const RHYTHM_WINDOWS = [
  { label: 'NIGHT', range: '00:00–06:00', pct: 7.6 },
  { label: 'MORNING', range: '06:00–12:00', pct: 24.7 },
  { label: 'AFTERNOON', range: '12:00–18:00', pct: 29.1 },
  { label: 'EVENING', range: '18:00–24:00', pct: 38.6 },
];

export const RHYTHM_HIGHLIGHTS = {
  peakWeekday: 'SAT',
  peakWeekdayTotal: 393,
  peakHour: '18:00',
  peakWindow: '18:00–21:00',
  weekdayShare: '45.8%',
  weekendShare: '54.2%',
};

// 7 rows (MON..SUN) x 24 columns (hours 00..23)
// Faithfully matches the density of Screenshot 1 (hot weekends, evening Wednesday, late night Saturday, peak 18:00)
export const RHYTHM_MATRIX: number[][] = [
  // MON: 101 total
  [0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 2, 4, 3, 2, 1, 2, 4, 12, 18, 22, 16, 8, 4, 0],
  // TUE: 94 total
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 2, 2, 1, 3, 4, 9, 14, 21, 19, 10, 3, 0],
  // WED: 218 total (hot in evening: 17:00..22:00)
  [4, 3, 1, 0, 0, 0, 0, 0, 2, 4, 5, 4, 3, 4, 2, 3, 8, 22, 38, 45, 36, 26, 14, 4],
  // THU: 117 total
  [2, 1, 0, 0, 0, 0, 0, 0, 1, 3, 2, 4, 3, 2, 2, 4, 6, 12, 19, 26, 18, 9, 3, 0],
  // FRI: 123 total
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 2, 3, 2, 3, 4, 6, 9, 16, 24, 22, 18, 9, 3, 0],
  // SAT: 393 total (blazing 12..23, peak 18:00)
  [0, 0, 0, 0, 0, 0, 0, 0, 4, 8, 12, 18, 24, 28, 30, 32, 38, 48, 56, 44, 26, 16, 7, 2],
  // SUN: 379 total (heavy all day 08..23)
  [0, 0, 0, 0, 0, 0, 0, 2, 8, 18, 26, 32, 38, 36, 34, 32, 30, 34, 38, 36, 24, 14, 5, 2],
];

// Helper to get heat color level 0..4
export function getRhythmLevel(value: number): 0 | 1 | 2 | 3 | 4 {
  if (value === 0) return 0;
  if (value < 8) return 1;
  if (value < 20) return 2;
  if (value < 38) return 3;
  return 4;
}

export const HEAT_COLORS = {
  0: '#141414',
  1: '#262626',
  2: '#525252',
  3: '#9e9e9e',
  4: '#f5f5f5',
};

export const HEAT_COLORS_PHOSPHOR = {
  0: '#0e110c',
  1: '#1b250e',
  2: '#415914',
  3: '#8cb71e',
  4: '#d6ff3e',
};
