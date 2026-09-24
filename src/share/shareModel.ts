import type { Period } from '../types.ts';
import { intensityOf } from '../fieldData.ts';

/* Share Record data contract — the ONLY mapping between the hydrated
   dashboard store and the exported card. Everything on the card derives
   from this model: headline, terminal metrics, contribution record,
   range labels and the export file name. No fixture/random data — the
   card renders real selected-range telemetry or nothing at all. */

export interface ShareDashLike {
  generatedAt: string;
  range: { from: string | null; to: string | null };
  summary: {
    sourceAdded: number;
    sourceDeleted: number;
    activeDays: number;
    commits: number;
  };
  github: { pullRequests: number };
  daily: { date: string; commits: number; added: number; deleted: number }[];
}

export interface ShareRecordData {
  period: Period;
  /** ISO yyyy-mm-dd bounds of the selected range */
  startDate: string;
  endDate: string;
  /** summary.sourceAdded − summary.sourceDeleted — the headline figure */
  netSourceGrowth: number;
  sourceAdded: number;
  sourceDeleted: number;
  activeDays: number;
  pullRequests: number;
  commits: number;
  /** authenticated user's GitHub login — never a hardcoded fallback */
  username: string;
  /** selected-range daily series, sparse (active days only), ascending */
  daily: { date: string; commits: number; added: number; deleted: number }[];
  generatedAt: string;
}

/* Exported artifact contract — the card renders at exactly 1080×1920
   (9:16 portrait). Preview scales the same SVG; export stays fixed. */
export const SHARE_CARD = { width: 1080, height: 1920 } as const;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export function buildShareRecord(opts: {
  period: Period;
  dash: ShareDashLike | null | undefined;
  /** authenticated GitHub login — required; missing identity yields null */
  username: string | null | undefined;
  /** makeRange()-shaped bounds for the selected period (ledger.range) */
  range?: { from: string | null; to: string | null } | null;
  /** canonical ledger bounds — last-resort fallbacks (esp. ALL) */
  allFromIso?: string | null;
  endIso?: string | null;
}): ShareRecordData | null {
  const { period, dash, username, range, allFromIso, endIso } = opts;
  const user = (username ?? '').trim();
  if (!dash || !user) return null;

  const daily = [...(dash.daily ?? [])]
    .filter((d) => ISO_DAY.test(d.date))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Prefer the server-scoped selected range; fall back through the local
  // period range, canonical ledger bounds, then the real daily series.
  const start =
    dash.range?.from ?? range?.from ?? allFromIso ?? daily[0]?.date ?? null;
  const end =
    dash.range?.to ?? range?.to ?? endIso ?? daily[daily.length - 1]?.date ?? null;
  if (!start || !end || !ISO_DAY.test(start) || !ISO_DAY.test(end)) return null;
  if (start > end) return null;

  return {
    period,
    startDate: start,
    endDate: end,
    netSourceGrowth:
      Number(dash.summary?.sourceAdded ?? 0) - Number(dash.summary?.sourceDeleted ?? 0),
    sourceAdded: Number(dash.summary?.sourceAdded ?? 0),
    sourceDeleted: Number(dash.summary?.sourceDeleted ?? 0),
    activeDays: Number(dash.summary?.activeDays ?? 0),
    pullRequests: Number(dash.github?.pullRequests ?? 0),
    commits: Number(dash.summary?.commits ?? 0),
    username: user,
    daily: daily.filter((d) => d.date >= start && d.date <= end),
    generatedAt: dash.generatedAt ?? '',
  };
}

/* ── presentation helpers ── */

export const MONTHS_SHORT = [
  'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
  'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC',
] as const;

/** '2025-09-20' → 'SEP 20, 2025' */
export function fmtHumanDate(iso: string): string {
  const m = parseInt(iso.slice(5, 7), 10) - 1;
  const day = parseInt(iso.slice(8, 10), 10);
  return `${MONTHS_SHORT[m] ?? '—'} ${day}, ${iso.slice(0, 4)}`;
}

/** 'SEP 20, 2025 - SEP 19, 2026' */
export function fmtHumanRange(startIso: string, endIso: string): string {
  return `${fmtHumanDate(startIso)} - ${fmtHumanDate(endIso)}`;
}

/** $ git log --since="2025-09-20" --until="2026-09-19" */
export function gitLogCommand(startIso: string, endIso: string): string {
  return `$ git log --since="${startIso}" --until="${endIso}"`;
}

/** Full comma-separated integer: 1,234,567 */
export function fmtInt(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

/** Compact source counts: 1.7M · 1.0M · 425K · 57 — one decimal max. */
export function fmtCompact(n: number): string {
  const abs = Math.abs(n);
  const one = (v: number) => `${v.toFixed(1)}`;
  if (abs >= 1_000_000) return `${one(n / 1_000_000)}M`;
  if (abs >= 10_000) return `${Math.round(n / 1_000)}K`;
  if (abs >= 1_000) return `${one(n / 1_000)}K`;
  return String(Math.round(n));
}

/** dev-ledger-{username}-{period}-{start}-{end}.png — safe chars only. */
export function shareFileName(record: ShareRecordData): string {
  const user = record.username.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'record';
  return `dev-ledger-${user}-${record.period.toLowerCase()}-${record.startDate}-${record.endDate}.png`;
}

/* ── contribution record ──
   GitHub-style grid: columns are Monday-first weeks, rows MON..SUN.
   Cells exist ONLY for real days inside [start, end] — edge-week padding
   stays null so no phantom dates appear. Intensity reuses the FIELD
   matrix rule (commits thresholds → 0..4) so zero activity stays the
   near-black empty cell. */

export interface ContribCell {
  date: string;
  intensity: 0 | 1 | 2 | 3 | 4;
}

export interface ContribWeek {
  /** month label when this column first enters a new month */
  month: string | null;
  /** index 0 = Monday … 6 = Sunday; null = outside the selected range */
  days: (ContribCell | null)[];
}

export const DOW_LABELS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;

const DAY_MS = 86_400_000;

function isoOf(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function contributionWeeks(
  startIso: string,
  endIso: string,
  daily: { date: string; commits: number }[],
): ContribWeek[] {
  const byDate = new Map(daily.map((d) => [d.date, d]));
  const start = new Date(`${startIso}T00:00:00`);
  const end = new Date(`${endIso}T00:00:00`);
  if (!(start.getTime() <= end.getTime())) return [];

  // Monday-first index of the range start (Mon=0 … Sun=6).
  const startDow = (start.getDay() + 6) % 7;
  const totalDays = Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1;
  const totalWeeks = Math.floor((totalDays - 1 + startDow) / 7) + 1;

  const weeks: ContribWeek[] = Array.from({ length: totalWeeks }, () => ({
    month: null,
    days: [null, null, null, null, null, null, null],
  }));

  // Day-at-a-time setDate stepping keeps every calendar day distinct and
  // correctly ordered across DST edges and month boundaries.
  const cursor = new Date(start);
  const seenMonth = new Set<string>();
  for (let i = 0; i < totalDays; i++) {
    const iso = isoOf(cursor);
    const col = Math.floor((i + startDow) / 7);
    const row = (cursor.getDay() + 6) % 7;
    const key = `${cursor.getFullYear()}-${cursor.getMonth()}`;
    if (!seenMonth.has(key)) {
      seenMonth.add(key);
      weeks[col].month = MONTHS_SHORT[cursor.getMonth()] ?? null;
    }
    weeks[col].days[row] = {
      date: iso,
      intensity: intensityOf(byDate.get(iso)?.commits ?? 0),
    };
    cursor.setDate(cursor.getDate() + 1);
  }
  return weeks;
}
