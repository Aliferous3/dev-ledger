export const glossary = {
  currentSourceLoc: {
    term: 'Current Source LOC',
    definition: 'Current lines of source code across all included repositories. This is a present-state snapshot and does not change with the selected historical date range.',
  },
  netSourceGrowth: {
    term: 'Net Source Growth',
    definition: 'Net change in source lines during the selected period.',
    formula: 'Lines added − Lines deleted',
    note: 'This is not the same as current LOC.',
  },
  linesAdded: {
    term: 'Lines Added',
    definition: 'Total source-code lines added in Git commits during the selected period.',
    note: 'Repeated rewrites can cause this number to exceed the current codebase size.',
  },
  linesDeleted: {
    term: 'Lines Deleted',
    definition: 'Total source-code lines removed in Git commits during the selected period.',
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
    definition: 'Git commits attributed to your configured author identity within the selected period.',
  },
  pullRequests: {
    term: 'Pull Requests',
    definition: 'GitHub pull requests authored within the selected period.',
  },
  merged: {
    term: 'Merged',
    definition: 'Authored pull requests merged within the selected period.',
  },
  activeDays: {
    term: 'Active Days',
    definition: 'Calendar days containing at least one qualifying Git commit during the selected period.',
  },
  longestStreak: {
    term: 'Longest Streak',
    definition: 'Longest run of consecutive active development days within the selected period.',
  },
  repositories: {
    term: 'Repositories',
    definition: 'Distinct canonical Git repositories included in the dashboard after duplicate worktrees and clones are removed.',
  },
  productionDeploys: {
    term: 'Production Deploys',
    definition: "Vercel deployments targeting the 'production' environment during the selected period.",
  },
  previewDeploys: {
    term: 'Preview Deploys',
    definition: 'Vercel non-production preview deployments during the selected period.',
  },
  succeeded: {
    term: 'Succeeded',
    definition: "Deployments that reached Vercel's successful/ready state during the selected period.",
  },
  failed: {
    term: 'Failed',
    definition: 'Deployments that ended in an error/failed state during the selected period.',
  },
  codingHours: {
    term: 'Coding Hours',
    definition: 'When WakaTime is connected, total tracked coding time during the selected period.',
    note: 'Currently not connected.',
  },
  avgHours: {
    term: 'Avg Hours / Day',
    definition: 'Average tracked coding time per active day during the selected period.',
    note: 'Only available when WakaTime is connected.',
  },
  languageComposition: {
    term: 'Language Composition',
    definition: 'Current source-code distribution by programming language, based on cloc. Ancillary formats such as JSON and Markdown are excluded from the headline composition.',
    note: 'Snapshot metric.',
  },
  sourceChurn: {
    term: 'Source Churn',
    definition: 'Lines added plus lines deleted for a project or period.',
  },
  primaryLanguage: {
    term: 'Primary Language',
    definition: 'Programming language with the greatest current source LOC in a repository.',
  },
  cumulativeGrowth: {
    term: 'Cumulative Growth',
    definition: 'Cumulative net source change over the selected period.',
  },
  dailyContribution: {
    term: 'Daily Contribution Field',
    definition: 'Day-by-day development activity across the selected range. Cell intensity reflects the amount of qualifying commit activity on that date.',
  },
  vercelMapping: {
    term: 'Vercel Mapping',
    definition: 'Deployment state is shown only when the local repository is confidently linked to a Vercel project.',
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
    definition: 'Current source lines of code for the project.',
  },
  churn: {
    term: 'Churn',
    definition: 'Lines added plus lines deleted for the project during the selected period.',
  },
  days: {
    term: 'Days',
    definition: 'Active development days for the project during the selected period.',
  },
  hours: {
    term: 'Hours',
    definition: 'WakaTime-tracked coding hours for this project and period, when available.',
    note: 'Currently not connected.',
  },
  range7d: { term: '7D', definition: 'Last 7 days ending today.' },
  range30d: { term: '30D', definition: 'Last 30 days ending today.' },
  range90d: { term: '90D', definition: 'Last 90 days ending today.' },
  rangeYtd: { term: 'YTD', definition: 'January 1 through today.' },
  range1y: { term: '1Y', definition: 'Rolling 365-day period ending today.' },
  rangeAll: { term: 'ALL', definition: 'All available history in the connected data sources.' },
  rangeCustom: { term: 'Custom', definition: 'User-selected inclusive start and end dates.' },
  localGit: {
    term: 'Local Git',
    definition: 'Repository discovery, commit history, and source-code metrics from the local scan root.',
  },
  github: {
    term: 'GitHub',
    definition: 'Pull requests and contribution metadata from the GitHub CLI.',
  },
  vercel: {
    term: 'Vercel',
    definition: 'Deployment history and project status from the Vercel API.',
  },
  wakatime: {
    term: 'WakaTime',
    definition: 'Coding-time tracking is not connected.',
  },
  aiTools: {
    term: 'AI Tools',
    definition: 'AI tooling status is not connected.',
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
    definition: 'A normalized score of current development activity across included repositories.',
    formula: '0.30 log1p(commits) + 0.25 active-day density + 0.25 log1p(churn) + 0.20 recency decay, scaled 0–100.',
    note: 'Local Git data only.',
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
    note: '168 buckets. Local Git timestamps in the user/system local timezone.',
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
  churnConcentration: { term: 'Churn Concentration', definition: 'Share of selected-period source churn attributable to the most active repositories.', note: 'Calculated from Local Git project churn.' },
  extremes: { term: 'Extremes', definition: 'Maximum daily values for commits, churn, additions, and deletions within the selected period.' },
  milestones: { term: 'Milestones', definition: 'Notable events reconstructable from available historical data, such as commit-count thresholds and first production deployments.' },
  shippingCadence: { term: 'Shipping Cadence', definition: 'Production deployment interval metrics from Vercel deployment history.', note: 'Partial if pagination limits are reached.' },
}
