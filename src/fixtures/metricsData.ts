import type { DayData, RepoItem } from '../types';

// DEV-ONLY synthetic fixture — every repository name, owner, and statistic
// below is fictional. This module is aliased to an inert stub in production
// builds (vite.config.ts) and never ships user-derived data.

export const START_DATE = new Date(2025, 8, 15); // Sep 15, 2025
export const END_DATE = new Date(2026, 8, 14);   // Sep 14, 2026

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function formatDateIso(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function generate365Days(): DayData[] {
  const days: DayData[] = [];
  let cum = 0;
  const totalDays = 365;

  // Synthetic curve: quiet baseline → mid-year ramp → late-summer surge.
  for (let i = 0; i < totalDays; i++) {
    const curDate = new Date(START_DATE.getTime() + i * 86400000);
    const dateStr = formatDateIso(curDate);

    let daily = 0;
    let commits = 0;
    let added = 0;
    let deleted = 0;

    // Early quiet period
    if (i === 37) { daily = 950; commits = 3; added = 1100; deleted = 150; }
    else if (i === 108) { daily = 2400; commits = 6; added = 2700; deleted = 300; }
    else if (i === 172) { daily = 700; commits = 2; added = 820; deleted = 120; }
    else if (i === 214) { daily = 1600; commits = 4; added = 1900; deleted = 300; }
    else if (i === 240) { daily = 3800; commits = 9; added = 4200; deleted = 400; }
    else if (i >= 255 && i < 295) {
      if (i % 3 === 0) {
        daily = 2900 + (i % 5) * 1000;
        commits = 5 + (i % 4) * 3;
        added = daily + 350;
        deleted = 350;
      }
    } else if (i >= 295 && i < 330) {
      // Ramp
      if (i % 2 === 0 || i > 315) {
        daily = 11500 + ((i * 41) % 15000);
        commits = 15 + (i % 6) * 4;
        added = daily + 1000;
        deleted = 1000;
      }
    } else if (i >= 330) {
      // Late-window climb
      const peakDay = (i === 352);
      const peakSpike = (i === 355);
      if (peakDay) {
        daily = 152000;
        commits = 78;
        added = 158000;
        deleted = 6000;
      } else if (peakSpike) {
        daily = 198000;
        commits = 96;
        added = 205000;
        deleted = 7000;
      } else if (i % 7 === 0) {
        daily = 17500;
        commits = 12;
        added = 19000;
        deleted = 1500;
      } else {
        daily = 39000 + ((i * 67) % 52000);
        commits = 30 + (i % 5) * 7;
        added = daily + 2600;
        deleted = 2600;
      }
    }

    cum += daily;
    days.push({
      date: dateStr,
      dayIndex: i,
      dailyChange: daily,
      cumulative: cum,
      commits,
      added,
      deleted,
      active: commits > 0,
    });
  }

  // Round the final cumulative total to a clean fictional figure
  const targetTotal = 984_210;
  const currentTotal = days[days.length - 1].cumulative;
  const diff = targetTotal - currentTotal;
  days[days.length - 1].dailyChange += diff;
  days[days.length - 1].cumulative = targetTotal;

  return days;
}

export const DATA_365 = generate365Days();

export const REPOSITORIES: RepoItem[] = [
  {
    id: 'D.01',
    code: 'D.01',
    name: 'northstar-api',
    locked: true,
    language: 'TYPESCRIPT',
    status: 'ACTIVE',
    bytesStr: '1.8M',
    bytesNum: 1840000,
    commits: 940,
    angle: 52,
    radius: 0.78,
  },
  {
    id: 'D.02',
    code: 'D.02',
    name: 'quartz-ui',
    locked: true,
    language: 'TYPESCRIPT',
    status: 'STEADY',
    bytesStr: '1.2M',
    bytesNum: 1240000,
    commits: 38,
    angle: 68,
    radius: 0.88,
  },
  {
    id: 'D.03',
    code: 'D.03',
    name: 'sample-cli',
    locked: true,
    language: 'JAVASCRIPT',
    status: 'STEADY',
    bytesStr: '52K',
    bytesNum: 52000,
    commits: 47,
    angle: 82,
    radius: 0.58,
  },
  {
    id: 'D.04',
    code: 'D.04',
    name: 'atlas-worker',
    locked: true,
    language: 'PYTHON',
    status: 'STEADY',
    bytesStr: '47K',
    bytesNum: 47000,
    commits: 61,
    angle: 96,
    radius: 0.64,
  },
  {
    id: 'D.05',
    code: 'D.05',
    name: 'demo-dashboard',
    locked: true,
    language: 'PYTHON',
    status: 'QUIET',
    bytesStr: '8.2K',
    bytesNum: 8200,
    commits: 13,
    angle: 112,
    radius: 0.44,
  },
  {
    id: 'D.06',
    code: 'D.06',
    name: 'zephyr-sensor-fw',
    locked: false,
    language: 'C++',
    status: 'QUIET',
    bytesStr: '640',
    bytesNum: 640,
    commits: 3,
    angle: 128,
    radius: 0.32,
  },
  {
    id: 'D.07',
    code: 'D.07',
    name: 'octo-demo',
    locked: false,
    language: '—',
    status: 'DORMANT',
    bytesStr: '2',
    bytesNum: 2,
    commits: 1,
    angle: 144,
    radius: 0.18,
  },
];

export const FINGERPRINT_METRICS = [
  { id: '01', title: 'CREATION', val: '71', sub: '71% ADDED', pct: 71 },
  { id: '02', title: 'SWEEP', val: '88', sub: '2241 LINES/COMMIT', pct: 88 },
  { id: '03', title: 'FOCUS', val: '87', sub: '87% TOP REPO', pct: 87 },
  { id: '04', title: 'BREADTH', val: '100', sub: '7/7 REPOS', pct: 100 },
  { id: '05', title: 'DIVERSITY', val: '31', sub: '9 LANGUAGES', pct: 31 },
  { id: '06', title: 'CADENCE', val: '92', sub: '18.2 COMMITS/DAY', pct: 92 },
  { id: '07', title: 'DENSITY', val: '100', sub: '41208 LINES/ACTIVE-DAY', pct: 100 },
  { id: '08', title: 'PR SHARE', val: '21', sub: '312 PRS', pct: 21 },
  { id: '09', title: 'SPREAD', val: '14', sub: '52/365 DAYS', pct: 14 },
];

export const SUCCESSION_LANGUAGES = [
  'TYPESCRIPT',
  'PYTHON',
  'JAVASCRIPT',
  'SHELL',
  'CSS',
  'C++',
  'HTML',
  'RUST',
  '+2 MINOR STRATA ELIDED',
];

export const MIGRATION_CARDS = [
  { name: 'octo-demo', duration: '1 MO', span: 'JAN 2024' },
  { name: 'quartz-ui', duration: '1 MO', span: 'MAR 2026' },
  { name: 'atlas-worker', duration: '2 MO', span: 'MAY — JUN 2026' },
  { name: 'northstar-api', duration: '2 MO', span: 'JUL — SEP 2026' },
];

export const SPAN_STATS = [
  { label: 'FIRST OBSERVED', value: '2024-02-01' },
  { label: 'LATEST OBSERVED', value: '2026-09-14' },
  { label: 'OBSERVED SPAN', value: '2Y 7M' },
  { label: 'TOTAL COMMITS', value: '1,103' },
  { label: 'ACTIVE DAYS', value: '74' },
  { label: 'REPOSITORIES', value: '7' },
  { label: 'ACTIVE / REVIVED', value: '5 / 0' },
  { label: 'LANGUAGES OBSERVED', value: '9' },
];
