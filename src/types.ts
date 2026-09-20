export type Period = '7D' | '30D' | '90D' | 'YTD' | '1Y' | 'ALL';
export const PERIODS: Period[] = ['7D', '30D', '90D', 'YTD', '1Y', 'ALL'];

export type MeasureTab = 'GROWTH' | 'ADDED' | 'DELETED' | 'CHURN' | 'COMMITS';
export const MEASURE_TABS: MeasureTab[] = ['GROWTH', 'ADDED', 'DELETED', 'CHURN', 'COMMITS'];

export type ArchiveSubTab =
  | 'F_01_FINGERPRINT'
  | 'F_02_SUCCESSION'
  | 'F_03_LIFECYCLE'
  | 'F_04_MIGRATION'
  | 'F_05_SPAN';

export interface DailyPoint {
  date: string; // YYYY-MM-DD
  dayIndex: number;
  growth: number;
  cumulativeGrowth: number;
  added: number;
  cumulativeAdded: number;
  deleted: number;
  cumulativeDeleted: number;
  churn: number;
  commits: number;
  cumulativeCommits: number;
}

export interface RepositoryItem {
  id: string; // D.01
  name: string;
  isPrivate: boolean;
  language: string;
  status: 'ACTIVE' | 'STEADY' | 'QUIET' | 'DORMANT' | 'QUIESCENT';
  size: string;
  commits: number;
  temporalCenter: number; // 0-1 for radar angle/radius
  radius: number;
  angle: number;
  tracesTo?: string[];
  activeRange: string;
  timelineBlocks: { month: number; active: boolean; label?: string }[];
  returnCount?: number;
}

export interface FingerprintMetric {
  id: string; // "01", "02", etc.
  name: string;
  score: number; // 0-100
  detail: string;
  ringRadius: number;
  fillPct: number;
}

export interface MonthStrata {
  language: string;
  activeMonths: boolean[]; // 33 months (Jan 2024 to Sep 2026)
  peakPct: number;
}

export interface MigrationStep {
  repoName: string;
  months: number;
  isDominant: boolean;
  isShared?: boolean;
}
