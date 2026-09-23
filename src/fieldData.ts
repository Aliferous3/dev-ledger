export type Period = '7D' | '30D' | '90D' | 'YTD' | '1Y' | 'ALL';
export const PERIODS: Period[] = ['7D', '30D', '90D', 'YTD', '1Y', 'ALL'];

export const MONTHS = [
  'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
  'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC',
] as const;

export const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const;

// NOTE: the dev-only fixture dataset (START/END/cells/weeks/languages)
// lives in ./fixtures/field.ts — production builds alias it away, so no
// demo telemetry ever ships. The utils below are shared production code.

const DAY_MS = 86_400_000;

export function mulberry32(seed: number) {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function iso(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDays(d: Date, n: number) {
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

export function intensityOf(commits: number): 0 | 1 | 2 | 3 | 4 {
  if (commits <= 0) return 0;
  if (commits < 8) return 1;
  if (commits < 18) return 2;
  if (commits < 36) return 3;
  return 4;
}

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

// `end` is the last observed day — always passed by callers (live telemetry
// horizon or the dev fixture edge); never silently defaults to fixture data.
export function inPeriod(d: Date, period: Period, end: Date): boolean {
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

export function periodRange(period: Period, end: Date, start: Date = new Date(0)): [Date, Date] {
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
      return [start, end];
  }
}

export function periodDayCount(period: Period, end: Date, start?: Date) {
  const [a, b] = periodRange(period, end, start);
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
