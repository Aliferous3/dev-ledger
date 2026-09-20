export type Period = '7D' | '30D' | '90D' | 'YTD' | '1Y' | 'ALL';
export const PERIODS: Period[] = ['7D', '30D', '90D', 'YTD', '1Y', 'ALL'];

export const MONTHS = [
  'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
  'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC',
] as const;

export const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const;

export const START = new Date(2025, 8, 21); // Sun Sep 21, 2025
export const END = new Date(2026, 8, 20);   // Sun Sep 20, 2026

const DAY_MS = 86_400_000;

function mulberry32(seed: number) {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function iso(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function formatLong(d: Date) {
  return `${MONTHS[d.getMonth()]} ${String(d.getDate()).padStart(2, '0')}, ${d.getFullYear()}`;
}

export function formatBytes(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + ' MB';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + ' KB';
  return n + ' B';
}

export function formatNumber(n: number) {
  return n.toLocaleString('en-US');
}

export type DayCell = {
  date: Date;
  iso: string;
  dayOfWeek: number;
  weekIndex: number;
  commits: number;
  added: number;
  deleted: number;
  prs: number;
  intensity: 0 | 1 | 2 | 3 | 4;
};

export type Week = {
  index: number;
  days: (DayCell | null)[];
  monthLabel: string | null;
};

function intensityOf(commits: number): 0 | 1 | 2 | 3 | 4 {
  if (commits <= 0) return 0;
  if (commits < 8) return 1;
  if (commits < 18) return 2;
  if (commits < 36) return 3;
  return 4;
}

function buildCells(): DayCell[] {
  const rand = mulberry32(42);
  const cells: DayCell[] = [];
  const totalDays = Math.round((END.getTime() - START.getTime()) / DAY_MS) + 1;

  for (let i = 0; i < totalDays; i++) {
    const date = addDays(START, i);
    cells.push({
      date,
      iso: iso(date),
      dayOfWeek: date.getDay(),
      weekIndex: Math.floor(i / 7),
      commits: 0,
      added: 0,
      deleted: 0,
      prs: 0,
      intensity: 0,
    });
  }

  const byIso = new Map(cells.map((c) => [c.iso, c]));
  const activate = (
    d: Date,
    commits: number,
    added: number,
    deleted: number,
    prs: number,
  ) => {
    const c = byIso.get(iso(d));
    if (!c) return;
    c.commits = commits;
    c.added = added;
    c.deleted = deleted;
    c.prs = prs;
    c.intensity = intensityOf(commits);
  };

  // 23-day streak: Sat Aug 29 → Sun Sep 20 2026
  const streakStart = new Date(2026, 7, 29);
  for (let i = 0; i < 23; i++) {
    const d = addDays(streakStart, i);
    const late = i > 14;
    const commits = late
      ? 28 + Math.floor(rand() * 42)
      : 12 + Math.floor(rand() * 28);
    const added = commits * (40 + Math.floor(rand() * 90));
    const deleted = Math.floor(added * (0.15 + rand() * 0.35));
    const prs = rand() > 0.25 ? 1 + Math.floor(rand() * 6) : 0;
    activate(d, commits, added, deleted, prs);
  }

  // Hand-placed clusters to match the reference silhouette
  const extras: [number, number, number][] = [
    // [yyyy, m0, day]
    [2026, 5, 3],
    [2026, 5, 17],
    [2026, 5, 24],
    [2026, 6, 1],
    [2026, 6, 2],
    [2026, 6, 8],
    [2026, 6, 9],
    [2026, 6, 15],
    [2026, 6, 22],
    [2026, 6, 23],
    [2026, 6, 29],
    [2026, 7, 4],
    [2026, 7, 5],
    [2026, 7, 6],
    [2026, 7, 11],
    [2026, 7, 12],
    [2026, 7, 13],
    [2026, 7, 18],
    [2026, 7, 19],
    [2026, 7, 20],
    [2026, 7, 21],
    [2026, 7, 25],
    [2026, 7, 26],
    [2026, 7, 27],
    [2026, 7, 28],
    [2026, 4, 20],
    [2026, 4, 27],
    [2026, 3, 15],
    [2025, 11, 4],
    [2025, 10, 18],
    [2026, 0, 12],
    [2026, 1, 3],
    [2026, 2, 9],
    [2026, 5, 10],
    [2026, 5, 11],
  ];

  for (const [y, m, day] of extras) {
    const d = new Date(y, m, day);
    if (byIso.get(iso(d))?.commits) continue;
    const commits = 4 + Math.floor(rand() * 22);
    const added = commits * (20 + Math.floor(rand() * 70));
    const deleted = Math.floor(added * rand() * 0.4);
    const prs = rand() > 0.45 ? 1 + Math.floor(rand() * 4) : 0;
    activate(d, commits, added, deleted, prs);
  }

  // Force a handful of peak (white) days in the last two weeks
  const peaks = [new Date(2026, 8, 8), new Date(2026, 8, 9), new Date(2026, 8, 14), new Date(2026, 8, 15), new Date(2026, 8, 16)];
  for (const d of peaks) {
    activate(d, 48 + Math.floor(rand() * 20), 4200 + Math.floor(rand() * 1800), 400 + Math.floor(rand() * 600), 4 + Math.floor(rand() * 5));
  }

  return cells;
}

export const cells: DayCell[] = buildCells();

// Dense day cells from real /api/dashboard telemetry: `daily` is sparse
// (one row per active day), `prsDaily` carries opened counts. Cells are
// emitted for every calendar day from the first observed day through
// `endIso` so the FIELD matrix keeps its continuous GitHub-style shape.
export function cellsFromDaily(
  daily: { date: string; commits: number; added: number; deleted: number }[],
  prsDaily: { date: string; opened: number }[],
  endIso: string,
): DayCell[] {
  const byDate = new Map(daily.map((d) => [d.date, d]));
  const prsByDate = new Map(prsDaily.map((p) => [p.date, p.opened]));
  const first = daily[0]?.date ?? endIso;
  const start = new Date(first + 'T00:00:00');
  const end = new Date(endIso + 'T00:00:00');
  if (start.getTime() > end.getTime()) return [];
  const out: DayCell[] = [];
  const baseDow = start.getDay();
  for (let t = start.getTime(), i = 0; t <= end.getTime(); t += DAY_MS, i++) {
    const date = new Date(t);
    const isoStr = iso(date);
    const d = byDate.get(isoStr);
    const commits = d?.commits ?? 0;
    out.push({
      date,
      iso: isoStr,
      dayOfWeek: date.getDay(),
      weekIndex: Math.floor((i + baseDow) / 7),
      commits,
      added: d?.added ?? 0,
      deleted: d?.deleted ?? 0,
      prs: prsByDate.get(isoStr) ?? 0,
      intensity: intensityOf(commits),
    });
  }
  return out;
}

export function weeksFromCells(cells: DayCell[]): Week[] {
  const maxWeek = cells[cells.length - 1]?.weekIndex ?? 0;
  const list: Week[] = [];
  const seenMonth = new Set<string>();
  for (let w = 0; w <= maxWeek; w++) {
    const days: (DayCell | null)[] = [null, null, null, null, null, null, null];
    for (const c of cells) {
      if (c.weekIndex === w) days[c.dayOfWeek] = c;
    }
    let monthLabel: string | null = null;
    for (const d of days) {
      if (!d) continue;
      const key = `${d.date.getFullYear()}-${d.date.getMonth()}`;
      if (!seenMonth.has(key)) {
        seenMonth.add(key);
        monthLabel = MONTHS[d.date.getMonth()];
      }
      break;
    }
    list.push({ index: w, days, monthLabel });
  }
  return list;
}

export const weeks: Week[] = weeksFromCells(cells);

export const languages = [
  { name: 'TypeScript', bytes: 8_300_000 },
  { name: 'Python', bytes: 845_500 },
  { name: 'JavaScript', bytes: 412_000 },
  { name: 'CSS', bytes: 188_000 },
  { name: 'JSON', bytes: 96_400 },
  { name: 'Markdown', bytes: 41_200 },
  { name: 'Shell', bytes: 18_600 },
] as const;

export const languageTotal = languages.reduce((a, l) => a + l.bytes, 0);

// `end` defaults to the fixture window edge; live data passes the last
// observed day so period math tracks the real telemetry horizon.
export function inPeriod(d: Date, period: Period, end: Date = END): boolean {
  const t = d.getTime();
  const e = end.getTime();
  switch (period) {
    case '7D':
      return t >= e - 6 * DAY_MS;
    case '30D':
      return t >= e - 29 * DAY_MS;
    case '90D':
      return t >= e - 89 * DAY_MS;
    case 'YTD':
      return d.getFullYear() === end.getFullYear();
    case '1Y':
      return t >= e - 364 * DAY_MS && t <= e;
    case 'ALL':
    default:
      return t <= e;
  }
}

export function periodRange(period: Period, end: Date = END): [Date, Date] {
  switch (period) {
    case '7D':
      return [addDays(end, -6), end];
    case '30D':
      return [addDays(end, -29), end];
    case '90D':
      return [addDays(end, -89), end];
    case 'YTD':
      return [new Date(end.getFullYear(), 0, 1), end];
    case '1Y':
      return [addDays(end, -364), end];
    case 'ALL':
    default:
      return [START, end];
  }
}

export function periodDayCount(period: Period, end: Date = END) {
  const [a, b] = periodRange(period, end);
  return Math.round((b.getTime() - a.getTime()) / DAY_MS) + 1;
}

export type FieldStats = {
  commits: number;
  prs: number;
  activeDays: number;
  merged: number;
  streak: number;
  repos: number;
  span: number;
};

export function computeStats(visible: DayCell[], repoCount = 7): FieldStats {
  const commits = visible.reduce((a, c) => a + c.commits, 0);
  const prs = visible.reduce((a, c) => a + c.prs, 0);
  const activeDays = visible.filter((c) => c.commits > 0).length;
  const merged = Math.round(prs * 0.97);

  let streak = 0;
  let run = 0;
  const sorted = [...visible].sort((a, b) => a.date.getTime() - b.date.getTime());
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].commits > 0) {
      if (i > 0) {
        const gap = (sorted[i].date.getTime() - sorted[i - 1].date.getTime()) / DAY_MS;
        run = gap === 1 ? run + 1 : 1;
      } else {
        run = 1;
      }
      if (run > streak) streak = run;
    } else {
      run = 0;
    }
  }

  return {
    commits,
    prs,
    activeDays,
    merged,
    streak,
    repos: repoCount,
    span: visible.length,
  };
}

export function peakCell(list: DayCell[]): DayCell | null {
  let best: DayCell | null = null;
  for (const c of list) {
    if (!best || c.commits > best.commits) best = c;
  }
  return best && best.commits > 0 ? best : null;
}

export const GRAY = ['#1c1c1c', '#2e2e2e', '#5c5c5c', '#a8a8a8', '#f4f4f4'] as const;
export const LIME = ['#1c1c1c', '#2a3310', '#5a6b14', '#a4c41e', '#d6ff3e'] as const;
