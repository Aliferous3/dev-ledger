/* Scroll-chapter geometry for the Quiet-Instrument Overview. Pure module —
   the React layer binds these numbers to framer-motion scroll progress, and
   tests can exercise the pacing math without a DOM. */

export const CHAPTERS = [
  { id: 'measure', n: '01', label: 'MEASURE', vh: 330 },
  { id: 'field', n: '02', label: 'FIELD', vh: 300 },
  { id: 'index', n: '03', label: 'INDEX', vh: 380 },
  { id: 'archive', n: '04', label: 'ARCHIVE', vh: 480 },
]

/* ENTER → BUILD → HOLD → EXIT bands inside each chapter's 0–1 progress.
   FIG. A draws first; FIG. B enters and completes after it; HOLD keeps both
   graphs fully composed for ~0.6 viewport-heights of scroll before EXIT. */
export const MEASURE_BANDS = {
  label: [0.02, 0.09],
  metricId: [0.05, 0.12],
  number: [0.07, 0.16],
  meta: [0.14, 0.24],
  rail: [0.22, 0.3],
  trace: [0.28, 0.37],
  draw: [0.32, 0.52],
  figB: [0.54, 0.62],
  drawB: [0.58, 0.7],
  hold: [0.7, 0.88],
  exit: [0.88, 0.98],
}

export const INDEX_BANDS = {
  constellation: [0.04, 0.16],
  rows: [0.14, 0.34],
  lanes: [0.36, 0.44],
  draw: [0.38, 0.58],
  hold: [0.58, 0.88],
  exit: [0.88, 0.97],
}

/* Progress at which the measure entrance hands off to scroll control — the
   boot animation drives the chapter MV to this point on load. */
export const MEASURE_BOOT = 0.42

export const ARCHIVE_FIGURES = [
  { id: 'fingerprint', n: 'F · 01', label: 'FINGERPRINT' },
  { id: 'succession', n: 'F · 02', label: 'SUCCESSION' },
  { id: 'lifecycle', n: 'F · 03', label: 'LIFECYCLE' },
  { id: 'migration', n: 'F · 04', label: 'MIGRATION' },
  { id: 'span', n: 'F · 05', label: 'SPAN' },
]

/* Clamp helper — framer's useTransform clamps already, but the pure math is
   used by tests and by the flat (non-scroll) renderer. */
export const clamp01 = (v) => Math.min(1, Math.max(0, v))

/* Progress → active archive figure. The first figure owns the entry window,
   the last owns the exit/hold window; interiors share equal scroll space. */
export function figureIndex(p, count = ARCHIVE_FIGURES.length) {
  const t = clamp01(p === 1 ? 0.9999 : p)
  return Math.min(count - 1, Math.floor(t * count))
}

/* [start, end] window of figure i inside the archive chapter's progress. */
export function figureWindow(i, count = ARCHIVE_FIGURES.length) {
  return [i / count, (i + 1) / count]
}

/* Which chapter owns a viewport-center scroll position. tops/heights are
   measured offsets; returns the index whose track contains probeY. */
export function chapterAt(probeY, rects) {
  for (let i = rects.length - 1; i >= 0; i--) {
    if (probeY >= rects[i].top) return i
  }
  return 0
}
