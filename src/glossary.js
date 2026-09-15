export const glossary = {
  currentSourceLoc: {
    term: 'Code Volume',
    definition: 'Aggregate GitHub language-byte totals across authorized repositories. This is a present-state snapshot and does not change with the selected historical date range.',
    note: 'GitHub estimates language composition from repository source bytes.',
  },
  netSourceGrowth: {
    term: 'Net Source Growth',
    definition: 'Net change in source lines during the selected period.',
    formula: 'Lines added − Lines deleted',
    note: 'Calculated from GitHub-attributed commit statistics.',
  },
  linesAdded: {
    term: 'Lines Added',
    definition: 'Total source-code lines added in GitHub-attributed commits during the selected period.',
    note: 'Repeated rewrites can cause this number to exceed the current codebase size.',
  },
  linesDeleted: {
    term: 'Lines Deleted',
    definition: 'Total source-code lines removed in GitHub-attributed commits during the selected period.',
  },
  netLines: {
    term: 'Net Lines',
    definition: 'Source additions minus source deletions during the selected period.',
    formula: 'Added − Deleted',
  },
  totalChurn: {
    term: 'Total Churn',
    definition: 'Total amount of source-code change during the selected period.',
    formula: 'Added + Deleted',
    note: 'High churn may reflect active development, refactoring, rewrites, or generated changes.',
  },
  commits: {
    term: 'Commits',
    definition: 'GitHub commits attributed to the authenticated user within the selected period.',
  },
  pullRequests: {
    term: 'Pull Requests',
    definition: 'GitHub pull requests authored by the authenticated user within the selected period.',
  },
  merged: {
    term: 'Merged',
    definition: 'GitHub pull requests authored by the authenticated user that were merged within the selected period.',
  },
  activeDays: {
    term: 'Active Days',
    definition: 'Calendar days containing at least one qualifying commit by the authenticated user during the selected period.',
  },
  longestStreak: {
    term: 'Longest Streak',
    definition: 'Longest run of consecutive active development days within the selected period.',
  },
  repositories: {
    term: 'Repositories',
    definition: 'Distinct GitHub repositories authorized for Dev Ledger analysis.',
  },
  languageComposition: {
    term: 'Language Composition',
    definition: 'Source-code distribution by programming language, based on GitHub repository language byte estimates.',
    note: 'GitHub language classification is approximate and based on bytes, not lines.',
  },
  sourceChurn: {
    term: 'Source Churn',
    definition: 'Lines added plus lines deleted for a project or period.',
  },
  primaryLanguage: {
    term: 'Primary Language',
    definition: 'Programming language with the greatest reported byte total in a repository, according to GitHub.',
  },
  cumulativeGrowth: {
    term: 'Cumulative Growth',
    definition: 'Cumulative net source change over the selected period.',
  },
  dailyContribution: {
    term: 'Daily Contribution Field',
    definition: 'Day-by-day development activity across the selected range. Cell intensity reflects the amount of qualifying commit activity on that date.',
  },
  snapshotMetric: {
    term: 'Snapshot Metric',
    definition: 'A present-state value that does not change when the historical date range changes.',
  },
  periodMetric: {
    term: 'Period Metric',
    definition: 'A value calculated only from activity inside the selected date range.',
  },
  loc: {
    term: 'LOC',
    definition: 'Lines of code. In this dashboard, commit-based line changes are reported; absolute current LOC is not computed.',
  },
  churn: {
    term: 'Churn',
    definition: 'Lines added plus lines deleted for the project during the selected period.',
  },
  days: {
    term: 'Days',
    definition: 'Active development days for the project during the selected period.',
  },
  range7d: { term: '7D', definition: 'Last 7 days ending today.' },
  range30d: { term: '30D', definition: 'Last 30 days ending today.' },
  range90d: { term: '90D', definition: 'Last 90 days ending today.' },
  rangeYtd: { term: 'YTD', definition: 'January 1 through today.' },
  range1y: { term: '1Y', definition: 'Rolling 365-day period ending today.' },
  rangeAll: { term: 'ALL', definition: 'All available history for the authenticated GitHub account.' },
  rangeCustom: { term: 'Custom', definition: 'User-selected inclusive start and end dates.' },
  github: {
    term: 'GitHub',
    definition: 'Repository metadata, commits, pull requests, and language data from the GitHub App.',
  },
  sync: {
    term: 'Sync',
    definition: 'Background refresh of GitHub repository, commit, and pull-request data.',
  },
  compare: {
    term: 'Compare',
    definition: 'Compares the selected period against the immediately preceding equivalent period.',
    note: 'ALL has no meaningful preceding period and disables the control.',
  },
  previousPeriod: {
    term: 'Previous Period',
    definition: 'The equal-length interval immediately before the selected range.',
  },
  projectMomentum: {
    term: 'Project Momentum',
    definition: 'A normalized score of current development activity across authorized repositories.',
    formula: '0.30 log1p(commits) + 0.25 active-day density + 0.25 log1p(churn) + 0.20 recency decay, scaled 0–100.',
    note: 'GitHub-attributed commit data only.',
  },
  momentumScore: {
    term: 'Momentum Score',
    definition: 'Rounded 0–100 score derived from commits, active days, churn, and recency.',
  },
  projectState: {
    term: 'Project State',
    definition: 'Human-readable momentum classification.',
    note: 'Surging ≥80, Active 60–79, Steady 35–59, Quiet 10–34, Dormant <10.',
  },
  surging: { term: 'Surging', definition: 'Momentum score 80–100.', note: 'Very high recent activity.' },
  active: { term: 'Active', definition: 'Momentum score 60–79.', note: 'Strong recent activity.' },
  steady: { term: 'Steady', definition: 'Momentum score 35–59.', note: 'Moderate ongoing activity.' },
  quiet: { term: 'Quiet', definition: 'Momentum score 10–34.', note: 'Low but visible activity.' },
  dormant: { term: 'Dormant', definition: 'Momentum score below 10.', note: 'Little or no recent activity.' },
  activityRhythm: {
    term: 'Activity Rhythm',
    definition: 'Weekday × hour-of-day commit distribution from the selected period.',
    note: '168 buckets. Based on GitHub commit timestamps.',
  },
  peakWeekday: { term: 'Peak Weekday', definition: 'Weekday with the most commits during the selected period.' },
  peakHour: { term: 'Peak Hour', definition: 'Hour window with the most commits during the selected period.' },
  peakWindow: { term: 'Peak Window', definition: 'Three-hour rolling window with the highest commit count, allowing midnight wraparound.' },
  refactorRatio: {
    term: 'Refactor Ratio',
    definition: 'Deleted source lines as a proportion of source lines added.',
    formula: 'Source deleted / Source added',
    note: 'Does not imply quality.',
  },
  retentionRatio: {
    term: 'Retention Ratio',
    definition: 'Net source change divided by total source movement.',
    formula: '(Added − Deleted) / (Added + Deleted)',
    note: 'Ranges approximately −100% to +100%.',
  },
  churnPerDay: { term: 'Churn / Active Day', definition: 'Average source churn per active development day.', formula: 'Total churn / Active days' },
  churnConcentration: { term: 'Churn Concentration', definition: 'Share of selected-period source churn attributable to the most active repositories.', note: 'Calculated from GitHub-attributed repository churn.' },
  extremes: { term: 'Extremes', definition: 'Maximum daily values for commits, churn, additions, and deletions within the selected period.' },
  milestones: { term: 'Milestones', definition: 'Notable events reconstructable from available historical data, such as commit-count thresholds.' },
}
