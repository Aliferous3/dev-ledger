// DEV-ONLY synthetic CODE fixture — fictional language byte totals.
// Aliased to an inert stub in production builds; never ships
// user-derived telemetry.

import type { LangRow } from '../codeData';

export const LANGUAGES: LangRow[] = [
  { name: 'TYPESCRIPT', bytes: 6_940_000, size: '6.9 MB',   pct: 84.1, ext: '.ts' },
  { name: 'PYTHON',     bytes: 712_000,   size: '712.0 KB', pct: 8.6,  ext: '.py' },
  { name: 'JAVASCRIPT', bytes: 348_000,   size: '348.0 KB', pct: 4.2,  ext: '.js' },
  { name: 'SHELL',      bytes: 61_400,    size: '61.4 KB',  pct: 0.7,  ext: '.sh' },
  { name: 'CSS',        bytes: 45_200,    size: '45.2 KB',  pct: 0.5,  ext: '.css' },
  { name: 'C++',        bytes: 21_800,    size: '21.8 KB',  pct: 0.3,  ext: '.cpp' },
  { name: 'RUST',       bytes: 4_100,     size: '4.1 KB',   pct: 0.05, ext: '.rs' },
  { name: 'C',          bytes: 3_800,     size: '3.8 KB',   pct: 0.05, ext: '.c' },
  { name: 'HTML',       bytes: 2_900,     size: '2.9 KB',   pct: 0.04, ext: '.html' },
  { name: 'GO',         bytes: 1_300,     size: '1.3 KB',   pct: 0.02, ext: '.go' },
];

export const LANGUAGE_TOTAL_BYTES = LANGUAGES.reduce((a, l) => a + l.bytes, 0);
