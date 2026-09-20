// Shared deterministic data for all 5 ledger redesigns.
// Same theme: #0a0a0a, grays, white serif, lime #d6ff3e accent.

export const YEARS = [2026, 2025, 2024, 2023, 2022, 2021, 2020, 2019];
export const COLS = 26;

function mulberry(seed: number) {
  let s = seed;
  return () => {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface GridCell {
  id: string;
  year: number;
  col: number;
  intensity: 0 | 1 | 2 | 3 | 4;
  commits: number;
  twinkleDelay: number;
}

export const GRID: GridCell[] = (() => {
  const rand = mulberry(1337);
  const cells: GridCell[] = [];
  // hand-placed peaks to echo the screenshot's bright squares
  const peaks = new Set([
    '2026-9', '2026-13', '2025-5', '2025-9', '2025-21',
    '2024-8', '2023-2', '2023-7', '2023-21',
    '2022-8', '2022-14', '2022-13', '2021-8', '2021-14',
    '2020-8', '2020-15', '2020-16', '2020-18', '2021-18', '2021-23',
  ]);
  YEARS.forEach((year) => {
    for (let c = 0; c < COLS; c++) {
      const r = rand();
      let intensity: 0 | 1 | 2 | 3 | 4 = 0;
      if (peaks.has(`${year}-${c}`)) intensity = 4;
      else if (r > 0.965) intensity = 3;
      else if (r > 0.9) intensity = 2;
      else if (r > 0.78) intensity = 1;
      const commits = intensity === 4 ? 40 + Math.floor(rand() * 60)
        : intensity === 3 ? 12 + Math.floor(rand() * 20)
        : intensity === 2 ? 4 + Math.floor(rand() * 8)
        : intensity === 1 ? 1 + Math.floor(rand() * 3) : 0;
      cells.push({
        id: `${year}-${c}`,
        year, col: c, intensity, commits,
        twinkleDelay: rand() * 3.4,
      });
    }
  });
  return cells;
})();

export const INTENSITY_BG: Record<number, string> = {
  0: '#141414',
  1: '#232323',
  2: '#4a4a4a',
  3: '#9a9a9a',
  4: '#f2f2f2',
};

export interface BranchNode {
  id: string;
  x: number; // 0..1000 space
  y: number; // 0..260 space
  label: string;
  hash: string;
  msg: string;
  date: string;
  lines: string;
  kind: 'main' | 'fork' | 'head';
}

export const BRANCH_NODES: BranchNode[] = [
  { id: 'n0', x: 60,  y: 130, label: 'init',      hash: 'a1f9c2', msg: 'first commit — ledger seed', date: '2019-02-11', lines: '+412 −18', kind: 'main' },
  { id: 'n1', x: 230, y: 130, label: 'v0.3',      hash: '77bd01', msg: 'chronology engine',          date: '2020-06-03', lines: '+1,204 −96', kind: 'main' },
  { id: 'n2', x: 400, y: 130, label: 'v1.0',      hash: 'c04ff7', msg: 'body of work view',          date: '2022-01-19', lines: '+3,881 −402', kind: 'main' },
  { id: 'n3', x: 570, y: 130, label: 'v1.4',      hash: '9e2ad4', msg: 'trace what you built',       date: '2023-09-30', lines: '+2,140 −188', kind: 'main' },
  { id: 'n4', x: 740, y: 130, label: 'v2.0',      hash: '51c8b0', msg: 'legibility pass',            date: '2024-12-12', lines: '+5,012 −611', kind: 'main' },
  { id: 'f0', x: 470, y: 208, label: 'exp',       hash: 'd3e5aa', msg: 'experiment — radial field',  date: '2022-04-02', lines: '+860 −44', kind: 'fork' },
  { id: 'f1', x: 640, y: 208, label: 'exp.1',     hash: '08f1c9', msg: 'experiment merged back',     date: '2022-07-21', lines: '+1,102 −231', kind: 'fork' },
  { id: 'h0', x: 910, y: 52,  label: 'HEAD',      hash: 'live00', msg: 'connect github → continue',  date: '2026-09-20', lines: '+248k −31k', kind: 'head' },
];

export const LOG_LINES = [
  'c04ff7 · body of work view · +3,881 −402',
  '77bd01 · chronology engine · +1,204 −96',
  '9e2ad4 · trace what you built · +2,140 −188',
  '51c8b0 · legibility pass · +5,012 −611',
  'd3e5aa · experiment — radial field · +860 −44',
  '08f1c9 · experiment merged back · +1,102 −231',
  'a1f9c2 · first commit — ledger seed · +412 −18',
  'live00 · HEAD → 2026-09-20 · streaming…',
];

export const YEAR_STATS: Record<number, { commits: string; repos: number; note: string }> = {
  2026: { commits: '412', repos: 7, note: 'present — streak 23d' },
  2025: { commits: '358', repos: 6, note: 'steady output' },
  2024: { commits: '301', repos: 5, note: 'ledger seed grows' },
  2023: { commits: '244', repos: 5, note: 'first branches' },
  2022: { commits: '198', repos: 4, note: 'experiment fork' },
  2021: { commits: '132', repos: 3, note: 'quiet winter' },
  2020: { commits: '96',  repos: 2, note: 'early traces' },
  2019: { commits: '41',  repos: 1, note: 'first commit' },
};
