import type { DayData, RepoItem } from '../types';

export const START_DATE = new Date(2025, 8, 21); // Sep 21, 2025
export const END_DATE = new Date(2026, 8, 20);   // Sep 20, 2026

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

  // Pattern matches Screenshot 1 & 2:
  // Days 0..270: very minimal changes (occasional small maintenance)
  // Days 270..330: gradual uptick (summer 2026)
  // Days 330..365: massive surge up to 1,756,748 lines and 1,421 commits
  for (let i = 0; i < totalDays; i++) {
    const curDate = new Date(START_DATE.getTime() + i * 86400000);
    const dateStr = formatDateIso(curDate);

    let daily = 0;
    let commits = 0;
    let added = 0;
    let deleted = 0;

    // Early quiet period
    if (i === 42) { daily = 1200; commits = 4; added = 1400; deleted = 200; }
    else if (i === 115) { daily = 2800; commits = 8; added = 3100; deleted = 300; }
    else if (i === 180) { daily = 800; commits = 2; added = 950; deleted = 150; }
    else if (i === 220) { daily = 1900; commits = 5; added = 2200; deleted = 300; }
    else if (i === 245) { daily = 4600; commits = 12; added = 5100; deleted = 500; }
    else if (i >= 260 && i < 300) {
      if (i % 3 === 0) {
        daily = 3500 + (i % 5) * 1200;
        commits = 6 + (i % 4) * 3;
        added = daily + 400;
        deleted = 400;
      }
    } else if (i >= 300 && i < 335) {
      // August ramp
      if (i % 2 === 0 || i > 320) {
        daily = 14000 + ((i * 37) % 18000);
        commits = 18 + (i % 7) * 4;
        added = daily + 1200;
        deleted = 1200;
      }
    } else if (i >= 335) {
      // Late August — September 2026 exponential climb
      const peakDay = (i === 358); // near Sep 14
      const peakSpike = (i === 361); // near Sep 17
      if (peakDay) {
        daily = 184500;
        commits = 92;
        added = 192000;
        deleted = 7500;
      } else if (peakSpike) {
        daily = 248000;
        commits = 114;
        added = 256000;
        deleted = 8000;
      } else if (i % 7 === 0) {
        daily = 22000;
        commits = 14;
        added = 24000;
        deleted = 2000;
      } else {
        daily = 48000 + ((i * 71) % 64000);
        commits = 36 + (i % 5) * 8;
        added = daily + 3200;
        deleted = 3200;
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

  // Adjust final cumulative total to exactly 1,756,748
  const targetTotal = 1756748;
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
    name: 'lexica-aeterna',
    locked: true,
    language: 'TYPESCRIPT',
    status: 'ACTIVE',
    bytesStr: '2.1M',
    bytesNum: 2100000,
    commits: 1290,
    angle: 52,
    radius: 0.78,
  },
  {
    id: 'D.02',
    code: 'D.02',
    name: 'Influencer-Tracker',
    locked: true,
    language: 'TYPESCRIPT',
    status: 'STEADY',
    bytesStr: '1.7M',
    bytesNum: 1700000,
    commits: 22,
    angle: 68,
    radius: 0.88,
  },
  {
    id: 'D.03',
    code: 'D.03',
    name: 'dev-ledger',
    locked: true,
    language: 'JAVASCRIPT',
    status: 'STEADY',
    bytesStr: '39K',
    bytesNum: 39000,
    commits: 42,
    angle: 82,
    radius: 0.58,
  },
  {
    id: 'D.04',
    code: 'D.04',
    name: 'gold-bot',
    locked: true,
    language: 'PYTHON',
    status: 'STEADY',
    bytesStr: '39K',
    bytesNum: 39000,
    commits: 54,
    angle: 96,
    radius: 0.64,
  },
  {
    id: 'D.05',
    code: 'D.05',
    name: 'taskbar-kitty',
    locked: true,
    language: 'PYTHON',
    status: 'QUIET',
    bytesStr: '5.5K',
    bytesNum: 5500,
    commits: 10,
    angle: 112,
    radius: 0.44,
  },
  {
    id: 'D.06',
    code: 'D.06',
    name: 'Live-Flight-Radar-Scanner-M5Stack',
    locked: false,
    language: 'C++',
    status: 'QUIET',
    bytesStr: '527',
    bytesNum: 527,
    commits: 2,
    angle: 128,
    radius: 0.32,
  },
  {
    id: 'D.07',
    code: 'D.07',
    name: 'Aliferous3',
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
  { id: '01', title: 'CREATION', val: '73', sub: '73% ADDED', pct: 73 },
  { id: '02', title: 'SWEEP', val: '100', sub: '2703 LINES/COMMIT', pct: 100 },
  { id: '03', title: 'FOCUS', val: '91', sub: '91% TOP REPO', pct: 91 },
  { id: '04', title: 'BREADTH', val: '100', sub: '7/7 REPOS', pct: 100 },
  { id: '05', title: 'DIVERSITY', val: '27', sub: '10 LANGUAGES', pct: 27 },
  { id: '06', title: 'CADENCE', val: '100', sub: '24.5 COMMITS/DAY', pct: 100 },
  { id: '07', title: 'DENSITY', val: '100', sub: '66223 LINES/ACTIVE-DAY', pct: 100 },
  { id: '08', title: 'PR SHARE', val: '24', sub: '439 PRS', pct: 24 },
  { id: '09', title: 'SPREAD', val: '16', sub: '58/365 DAYS', pct: 16 },
];

export const SUCCESSION_LANGUAGES = [
  'TYPESCRIPT',
  'PYTHON',
  'JAVASCRIPT',
  'POWERSHELL',
  'CSS',
  'C++',
  'HTML',
  'JAVA',
  '+2 MINOR STRATA ELIDED',
];

export const MIGRATION_CARDS = [
  { name: 'Aliferous3', duration: '1 MO', span: 'JAN 2024' },
  { name: 'lexica-aeterna', duration: '1 MO', span: 'MAY 2026' },
  { name: 'gold-bot', duration: '2 MO', span: 'JUN — JUL 2026' },
  { name: 'lexica-aeterna', duration: '2 MO', span: 'AUG — SEP 2026' },
];

export const SPAN_STATS = [
  { label: 'FIRST OBSERVED', value: '2024-01-01' },
  { label: 'LATEST OBSERVED', value: '2026-09-20' },
  { label: 'OBSERVED SPAN', value: '2Y 9M' },
  { label: 'TOTAL COMMITS', value: '1,493' },
  { label: 'ACTIVE DAYS', value: '89' },
  { label: 'REPOSITORIES', value: '7' },
  { label: 'ACTIVE / REVIVED', value: '5 / 0' },
  { label: 'LANGUAGES OBSERVED', value: '10' },
];
