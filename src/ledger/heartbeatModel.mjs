/* Session-heartbeat derivations — pure functions for the Gate heartbeat
   loop and the node test suite. The lease itself is enforced server-side
   (sealed `leaseUntil` in the cookie payload); this module only decides
   whether the client should keep it alive. */

export const HEARTBEAT_INTERVAL_MS = 60_000
export const HEARTBEAT_URL = '/api/auth/heartbeat'

// Beat only for authenticated non-persistent sessions. Remembered sessions
// carry the 30-day cookie and need no lease renewal; logged-out/preview
// states have nothing to renew.
export function shouldHeartbeat({ authenticated, persistent } = {}) {
  return authenticated === true && persistent !== true
}

// A 401 from the heartbeat means the server expired the lease — the only
// outcome that must flip the UI to logged out. Network errors/other statuses
// are transient: stay authenticated, retry next interval.
export function heartbeatOutcome(status) {
  return status === 401 ? 'logout' : 'stay'
}
