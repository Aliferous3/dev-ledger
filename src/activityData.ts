// Rhythm level + heat color helpers shared by production code.
// The dev-only fixture activity dataset (totals, extremes, milestones,
// rhythm matrix) lives in ./fixtures/activity.ts — production builds
// alias it away, so no demo telemetry ever ships.

export interface ActivityTotals {
  activeDays: number;
  longestStreak: number;
  peakDayCommits: number;
  peakDayDate: string;
  avgActiveDay: number;
}

export interface Milestone {
  id: string;
  date: string;
  title: string;
  desc: string;
}

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
