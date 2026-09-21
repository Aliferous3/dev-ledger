/* SYS.TIME — local browser time, not UTC. The IANA zone is resolved from
   the browser's own Intl environment; never hardcoded, never inferred
   from profile/IP. Pure functions for the node test suite. */

const p2 = (n) => String(n).padStart(2, '0')

// HH:mm:ss in the browser's local zone (24-hour).
export function formatLocalTime(d) {
  return `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`
}

// Authoritative IANA zone, e.g. 'Asia/Dubai'. '' when Intl is unavailable
// (non-browser execution) so callers can hide the label instead of lying.
export function resolveTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || ''
  } catch {
    return ''
  }
}
