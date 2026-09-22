export type Period = '7D' | '30D' | '90D' | 'YTD' | '1Y' | 'ALL';

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
}
