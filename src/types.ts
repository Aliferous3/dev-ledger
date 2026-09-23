export type Period = '7D' | '30D' | '90D' | 'YTD' | '1Y' | 'ALL';

export type ArchiveTab =
  | 'F · 01 FINGERPRINT'
  | 'F · 02 SUCCESSION'
  | 'F · 03 LIFECYCLE'
  | 'F · 04 MIGRATION'
  | 'F · 05 SPAN';

export type MetricKey = 'GROWTH' | 'ADDED' | 'DELETED' | 'CHURN' | 'COMMITS';

export interface DayData {
  date: string;
  dayIndex: number;
  dailyChange: number;
  cumulative: number;
  commits: number;
  added: number;
  deleted: number;
  active: boolean;
}

export interface RepoItem {
  id: string;
  code: string;
  name: string;
  locked: boolean;
  language: string;
  status: 'ACTIVE' | 'STEADY' | 'QUIET' | 'DORMANT';
  bytesStr: string;
  bytesNum: number;
  commits: number;
  // Polar coords for constellation radar: angle in deg, radius (0..1)
  angle: number;
  radius: number;
  // Internal repository uuid (live data only) — needed for the explicit
  // disconnect flow. Dev fixtures leave it undefined.
  rid?: string;
  /** retained: history kept, ingestion stopped */
  disconnected?: boolean;
}
