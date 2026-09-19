const today = () => {
  const d = new Date()
  d.setUTCHours(0,0,0,0)
  return d.toISOString().slice(0,10)
}

function firstOfYear(y) { return `${y}-01-01` }

export function makeRange(mode, from = null, to = null) {
  const t = today()
  const now = new Date(t + 'T00:00:00Z')
  const end = t
  let start = null
  switch (mode) {
    case '7d':
      now.setUTCDate(now.getUTCDate() - 6)
      start = now.toISOString().slice(0, 10)
      return { mode, from: start, to: end }
    case '30d':
      now.setUTCDate(now.getUTCDate() - 29)
      start = now.toISOString().slice(0, 10)
      return { mode, from: start, to: end }
    case '90d':
      now.setUTCDate(now.getUTCDate() - 89)
      start = now.toISOString().slice(0, 10)
      return { mode, from: start, to: end }
    case 'ytd':
      start = firstOfYear(new Date().getUTCFullYear())
      return { mode, from: start, to: end }
    case '1y':
      now.setUTCDate(now.getUTCDate() - 364)
      start = now.toISOString().slice(0, 10)
      return { mode, from: start, to: end }
    case 'all':
      return { mode, from: null, to: null }
    case 'custom':
      return { mode, from: from || t, to: to || t }
    default:
      now.setUTCDate(now.getUTCDate() - 364)
      start = now.toISOString().slice(0, 10)
      return { mode: '1y', from: start, to: end }
  }
}

export const DEFAULT_RANGE_MODE = '1y'
export const PRESET_MODES = ['7d', '30d', '90d', 'ytd', '1y', 'all']

export function rangeQuery(range) {
  const q = new URLSearchParams()
  if (range.mode === 'custom' && (range.from || range.to)) {
    if (range.from) q.set('from', range.from)
    if (range.to) q.set('to', range.to)
  } else if (range.mode === DEFAULT_RANGE_MODE || range.mode === 'custom') {
    return '' // the product default (and a dateless custom) is a clean URL
  } else {
    q.set('range', range.mode)
  }
  return q.toString()
}

// Pure URL resolver — returns the range encoded in a search string, or null
// when the URL carries no explicit range params. from/to always wins so an
// explicit custom window can never be masked by a stale preset param.
export function rangeFromSearch(search) {
  const q = new URLSearchParams(search)
  if (q.has('from') || q.has('to')) {
    return { mode: 'custom', from: q.get('from') || null, to: q.get('to') || null }
  }
  const r = q.get('range')
  if (r && PRESET_MODES.includes(r)) return makeRange(r)
  return null
}

export function readStoredRange() {
  try {
    const raw = window.localStorage.getItem('dev-dashboard-range')
    if (raw) {
      const j = JSON.parse(raw)
      if (j && j.mode) return makeRange(j.mode, j.from, j.to)
    }
  } catch {}
  return null
}

export function rangeDays(range) {
  if (range.mode === 'all') return 365
  const s = new Date((range.from || today()) + 'T00:00:00Z')
  const e = new Date((range.to || today()) + 'T00:00:00Z')
  return Math.max(1, Math.round((e - s) / 86400000) + 1)
}

export function rangeDisplay(range) {
  if (range.mode === 'all') return 'ALL TIME'
  if (range.mode === '7d') return 'LAST 7 DAYS'
  if (range.mode === '30d') return 'LAST 30 DAYS'
  if (range.mode === '90d') return 'LAST 90 DAYS'
  if (range.mode === '1y') return 'LAST YEAR'
  if (range.mode === 'ytd') return 'YEAR TO DATE'
  if (range.from && range.to) {
    const a = new Date(range.from + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase()
    const b = new Date(range.to + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase()
    return `${a} — ${b}`
  }
  return 'CUSTOM'
}

export function makeCompareRange(range) {
  if (range.mode === 'all') return null
  if (range.mode === 'ytd') {
    const s = new Date(range.from + 'T00:00:00Z')
    const prevYear = s.getUTCFullYear() - 1
    const prevStart = `${prevYear}-01-01`
    const e = new Date(range.to + 'T00:00:00Z')
    const prevEnd = `${prevYear}-${String(e.getUTCMonth() + 1).padStart(2, '0')}-${String(e.getUTCDate()).padStart(2, '0')}`
    return { mode: 'compare', from: prevStart, to: prevEnd }
  }
  const s = new Date((range.from || today()) + 'T00:00:00Z')
  const days = rangeDays(range) - 1
  const pStart = new Date(s.getTime() - (days + 1) * 86400000)
  const pEnd = new Date(s.getTime() - 86400000)
  const pad = (d) => d.toISOString().slice(0, 10)
  return { mode: 'compare', from: pad(pStart), to: pad(pEnd) }
}

export function compareMetric(current, previous) {
  const c = current == null ? null : Number(current)
  const p = previous == null ? null : Number(previous)
  if (c == null || p == null || isNaN(c) || isNaN(p)) return { current: c, previous: p, delta: null, pct: null, state: 'unavailable' }
  if (p === 0 && c === 0) return { current: c, previous: p, delta: 0, pct: 0, state: 'unchanged' }
  if (p === 0 && c > 0) return { current: c, previous: p, delta: c, pct: null, state: 'new' }
  if (p === 0 && c < 0) return { current: c, previous: p, delta: c, pct: null, state: 'new' }
  const delta = c - p
  const pct = (delta / Math.abs(p)) * 100
  return { current: c, previous: p, delta, pct, state: delta > 0 ? 'increase' : delta < 0 ? 'decrease' : 'unchanged' }
}

export function compareDisplay(range) {
  if (range.mode === 'ytd') return 'PRIOR YEAR'
  return 'PREVIOUS PERIOD'
}

export function readInitialRange() {
  // Explicit URL params always win; then stored preference; then the product
  // default. localStorage only resolves the range — it never writes the URL.
  return rangeFromSearch(window.location.search) ?? readStoredRange() ?? makeRange(DEFAULT_RANGE_MODE)
}
