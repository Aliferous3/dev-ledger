// Shared data used by all design variations
export const dates = [
  '2026-09-14',
  '2026-09-15',
  '2026-09-16',
  '2026-09-17',
  '2026-09-18',
  '2026-09-19',
  '2026-09-20',
];

// Daily net source change (bytes)
export const daily = [1240, 920, 380, 220, 360, 53720, 980];

// Cumulative net source growth (bytes)
export const cumulative = daily.reduce<number[]>((acc, v, i) => {
  acc.push((acc[i - 1] ?? 0) + v);
  return acc;
}, []);

// Convenience helpers
export const totalBytes = daily.reduce((a, b) => a + b, 0);

export const formatBytes = (n: number) => {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + ' MB';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + ' kB';
  return n.toString();
};

export const formatNumber = (n: number) =>
  n.toLocaleString('en-US', { maximumFractionDigits: 0 });

// Tabs
export const tabs = ['GROWTH', 'ADDED', 'DELETED', 'CHURN', 'COMMITS'] as const;
export type Tab = (typeof tabs)[number];