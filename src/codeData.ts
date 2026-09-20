// Canonical source-composition data for the CODE section.
// Language byte totals are a working-tree snapshot (they have no time
// dimension — they describe the corpus as it exists now, so they are not
// period-filtered). Line-change metrics are derived per-period from the
// fieldData day-cells by CodePage.

export interface LangRow {
  name: string;
  bytes: number;
  size: string;
  pct: number;
  ext: string;
}

export const LANGUAGES: LangRow[] = [
  { name: 'TYPESCRIPT', bytes: 8_300_000, size: '8.3 MB',   pct: 83.4, ext: '.ts' },
  { name: 'PYTHON',     bytes: 845_500,   size: '845.5 KB', pct: 8.3,  ext: '.py' },
  { name: 'JAVASCRIPT', bytes: 681_300,   size: '681.3 KB', pct: 6.7,  ext: '.js' },
  { name: 'POWERSHELL', bytes: 77_500,    size: '77.5 KB',  pct: 0.8,  ext: '.ps1' },
  { name: 'CSS',        bytes: 53_800,    size: '53.8 KB',  pct: 0.5,  ext: '.css' },
  { name: 'C++',        bytes: 26_700,    size: '26.7 KB',  pct: 0.3,  ext: '.cpp' },
  { name: 'BATCHFILE',  bytes: 4_900,     size: '4.9 KB',   pct: 0.04, ext: '.bat' },
  { name: 'C',          bytes: 4_600,     size: '4.6 KB',   pct: 0.04, ext: '.c' },
  { name: 'HTML',       bytes: 3_600,     size: '3.6 KB',   pct: 0.03, ext: '.html' },
  { name: 'JAVA',       bytes: 1_600,     size: '1.6 KB',   pct: 0.01, ext: '.java' },
];

export const LANGUAGE_TOTAL_BYTES = LANGUAGES.reduce((a, l) => a + l.bytes, 0);

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
