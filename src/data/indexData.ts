import { RepositoryItem } from '../types';

export const REPOSITORIES: RepositoryItem[] = [
  {
    id: 'D.01',
    name: 'lexica-aeterna',
    isPrivate: true,
    language: 'TYPESCRIPT',
    status: 'ACTIVE',
    size: '2.1M',
    commits: 1290,
    temporalCenter: 0.92,
    radius: 38,
    angle: 310, // radar position
    tracesTo: ['D.02', 'D.03', 'D.04'],
    activeRange: 'MAY 2026 — SEP 2026',
    timelineBlocks: [
      { month: 28, active: true },
      { month: 29, active: false },
      { month: 30, active: true },
      { month: 31, active: true },
      { month: 32, active: true },
    ],
  },
  {
    id: 'D.02',
    name: 'Influencer-Tracker',
    isPrivate: true,
    language: 'TYPESCRIPT',
    status: 'STEADY',
    size: '1.7M',
    commits: 22,
    temporalCenter: 0.88,
    radius: 54,
    angle: 340,
    tracesTo: ['D.01'],
    activeRange: 'AUG 2026 — AUG 2026',
    timelineBlocks: [{ month: 31, active: true }],
  },
  {
    id: 'D.03',
    name: 'dev-ledger',
    isPrivate: true,
    language: 'JAVASCRIPT',
    status: 'STEADY',
    size: '39K',
    commits: 42,
    temporalCenter: 0.94,
    radius: 72,
    angle: 290,
    tracesTo: ['D.01'],
    activeRange: 'SEP 2026 — SEP 2026',
    timelineBlocks: [{ month: 32, active: true }],
  },
  {
    id: 'D.04',
    name: 'gold-bot',
    isPrivate: true,
    language: 'PYTHON',
    status: 'STEADY',
    size: '39K',
    commits: 54,
    temporalCenter: 0.82,
    radius: 88,
    angle: 260,
    tracesTo: ['D.01', 'D.05'],
    activeRange: 'JUN 2026 — AUG 2026',
    timelineBlocks: [
      { month: 29, active: true },
      { month: 30, active: true },
      { month: 31, active: true },
    ],
  },
  {
    id: 'D.05',
    name: 'taskbar-kitty',
    isPrivate: true,
    language: 'PYTHON',
    status: 'QUIET',
    size: '5.5K',
    commits: 10,
    temporalCenter: 0.86,
    radius: 110,
    angle: 235,
    tracesTo: ['D.04'],
    activeRange: 'AUG 2026 — AUG 2026',
    timelineBlocks: [{ month: 31, active: true }],
  },
  {
    id: 'D.06',
    name: 'Live-Flight-Radar-Scanner-M5Stack',
    isPrivate: false,
    language: 'C++',
    status: 'QUIET',
    size: '527',
    commits: 2,
    temporalCenter: 0.78,
    radius: 128,
    angle: 215,
    activeRange: 'JUL 2026 — JUL 2026',
    timelineBlocks: [{ month: 30, active: true }],
  },
  {
    id: 'D.07',
    name: 'Aliferous3',
    isPrivate: false,
    language: '—',
    status: 'DORMANT',
    size: '2',
    commits: 1,
    temporalCenter: 0.15,
    radius: 148,
    angle: 180,
    returnCount: 1,
    activeRange: 'JAN 2024 — JUL 2026',
    timelineBlocks: [
      { month: 0, active: true },
      { month: 30, active: true },
    ],
  },
];

// Historical stream lane curves (Commits, Pull Requests, Net Lines)
export function generateHistoricalLanes(steps = 100) {
  const commitsCurve: number[] = [];
  const prsCurve: number[] = [];
  const netLinesCurve: number[] = [];

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    // Flat until t > 0.75, then upward smooth exponential rise
    const surge = t > 0.7 ? Math.pow((t - 0.7) / 0.3, 2.2) : 0.02 * Math.sin(t * 12);
    
    commitsCurve.push(surge);
    prsCurve.push(surge * 0.88 + 0.01 * Math.cos(t * 8));
    netLinesCurve.push(surge * 0.95 + 0.015 * Math.sin(t * 15));
  }

  return { commitsCurve, prsCurve, netLinesCurve };
}
