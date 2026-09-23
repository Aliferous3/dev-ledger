// Source-composition helpers for the CODE section.
// Language byte totals are a working-tree snapshot (they have no time
// dimension — they describe the corpus as it exists now, so they are not
// period-filtered). Line-change metrics are derived per-period from the
// fieldData day-cells by CodePage.
// The dev-only fixture language corpus lives in ./fixtures/code.ts —
// production builds alias it away, so no demo telemetry ever ships.

export interface LangRow {
  name: string;
  bytes: number;
  size: string;
  pct: number;
  ext: string;
}

export function fmtBytes(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} MB`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)} KB`;
  return `${n} B`;
}

export function fmtCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}

export function fmt(n: number): string {
  return n.toLocaleString('en-US');
}
