// DEV-ONLY synthetic FIELD fixture — fictional dates/cells/languages.
// Aliased to an inert stub in production builds; never ships
// user-derived telemetry.

import {
  addDays,
  intensityOf,
  iso,
  mulberry32,
  weeksFromCells,
  type DayCell,
  type Week,
} from '../fieldData';

export const START = new Date(2025, 8, 15); // Mon Sep 15, 2025
export const END = new Date(2026, 8, 14);   // Mon Sep 14, 2026

const DAY_MS = 86_400_000;

function buildCells(): DayCell[] {
  const rand = mulberry32(97);
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

  // 19-day fictional streak near the window edge
  const streakStart = new Date(2026, 7, 27);
  for (let i = 0; i < 19; i++) {
    const d = addDays(streakStart, i);
    const late = i > 11;
    const commits = late
      ? 24 + Math.floor(rand() * 36)
      : 10 + Math.floor(rand() * 22);
    const added = commits * (35 + Math.floor(rand() * 80));
    const deleted = Math.floor(added * (0.15 + rand() * 0.35));
    const prs = rand() > 0.3 ? 1 + Math.floor(rand() * 5) : 0;
    activate(d, commits, added, deleted, prs);
  }

  // Scattered fictional activity clusters
  const extras: [number, number, number][] = [
    // [yyyy, m0, day]
    [2026, 5, 4],
    [2026, 5, 18],
    [2026, 5, 25],
    [2026, 6, 2],
    [2026, 6, 9],
    [2026, 6, 16],
    [2026, 6, 23],
    [2026, 6, 30],
    [2026, 7, 7],
    [2026, 7, 8],
    [2026, 7, 14],
    [2026, 7, 15],
    [2026, 7, 21],
    [2026, 7, 22],
    [2026, 7, 28],
    [2026, 4, 21],
    [2026, 4, 28],
    [2026, 3, 16],
    [2025, 11, 5],
    [2025, 10, 19],
    [2026, 0, 13],
    [2026, 1, 4],
    [2026, 2, 10],
    [2026, 5, 11],
    [2026, 5, 12],
  ];

  for (const [y, m, day] of extras) {
    const d = new Date(y, m, day);
    if (byIso.get(iso(d))?.commits) continue;
    const commits = 4 + Math.floor(rand() * 19);
    const added = commits * (20 + Math.floor(rand() * 65));
    const deleted = Math.floor(added * rand() * 0.4);
    const prs = rand() > 0.5 ? 1 + Math.floor(rand() * 4) : 0;
    activate(d, commits, added, deleted, prs);
  }

  // Peak (white) days in the last two weeks
  const peaks = [new Date(2026, 8, 1), new Date(2026, 8, 2), new Date(2026, 8, 8), new Date(2026, 8, 9), new Date(2026, 8, 10)];
  for (const d of peaks) {
    activate(d, 42 + Math.floor(rand() * 18), 3600 + Math.floor(rand() * 1500), 350 + Math.floor(rand() * 500), 3 + Math.floor(rand() * 5));
  }

  return cells;
}

export const cells: DayCell[] = buildCells();
export const weeks: Week[] = weeksFromCells(cells);

export const languages = [
  { name: 'TypeScript', bytes: 6_940_000 },
  { name: 'Python', bytes: 712_000 },
  { name: 'JavaScript', bytes: 348_000 },
  { name: 'CSS', bytes: 156_000 },
  { name: 'JSON', bytes: 81_400 },
  { name: 'Markdown', bytes: 36_800 },
  { name: 'Shell', bytes: 15_200 },
] as const;

export const languageTotal = languages.reduce((a, l) => a + l.bytes, 0);
