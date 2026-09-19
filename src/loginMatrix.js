/* Deterministic archival contribution field for the login page.
   Pure + seeded: the same matrix renders on every load, no React state,
   no runtime reshuffling. Each year owns ROWS_PER_YEAR rows; the year
   index label centers on its band. */

export const MATRIX_YEARS = [2026, 2025, 2024, 2023, 2022, 2021, 2020, 2019]
export const MATRIX_COLS = 26
export const ROWS_PER_YEAR = 3
export const MATRIX_ROWS = MATRIX_YEARS.length * ROWS_PER_YEAR

// Luminance levels — mostly dark, sparse bright cells.
const LEVEL_BG = ['#17171a', '#26262b', '#3f3f46', '#6b6b72', '#e8e6df']

function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/* assembleStart/assembleStep position cells inside PHASE 4 of the master
   timeline (grid assembly ~1.25s → ~2.2s); breathe* values land each cell
   in a 5–12s independent ambient cycle. Each year gets a seeded activity
   bias so some years read denser than others — irregular, not uniform. */
export function buildMatrix({
  seed = 2026,
  cols = MATRIX_COLS,
  years = MATRIX_YEARS.length,
  rowsPerYear = ROWS_PER_YEAR,
  assembleStart = 1.25,
  colStep = 0.034,
  rowStep = 0.004,
} = {}) {
  const rand = mulberry32(seed)
  const rows = years * rowsPerYear
  const yearBias = Array.from({ length: years }, () => 0.45 + rand() * 0.45)
  const cells = []
  for (let r = 0; r < rows; r++) {
    const year = Math.floor(r / rowsPerYear)
    const bias = yearBias[year] * (0.85 + rand() * 0.3)
    for (let c = 0; c < cols; c++) {
      const v = rand() * bias + (rand() < 0.06 ? 0.55 : 0)
      const level = v < 0.42 ? 0 : v < 0.62 ? 1 : v < 0.78 ? 2 : v < 0.92 ? 3 : 4
      cells.push({
        r,
        c,
        year,
        level,
        bg: LEVEL_BG[level],
        assembleDelay: +(assembleStart + c * colStep + r * rowStep).toFixed(3),
        // breathing loop starts only after the cell has assembled
        breatheDelay: +(assembleStart + c * colStep + r * rowStep + 0.6 + rand() * 4).toFixed(3),
        breatheDur: +(5 + rand() * 7).toFixed(2),
        // resting + breathing opacity band per level (bright cells move more)
        lo: [0.92, 0.85, 0.72, 0.62, 0.55][level],
        hi: 1,
        glow: level === 4 ? 0.22 : 0,
      })
    }
  }
  return cells
}
