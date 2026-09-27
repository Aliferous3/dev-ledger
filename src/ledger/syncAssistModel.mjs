// Zero-metrics assist — the SYNC.MON-adjacent help prompt for ledgers that
// resolved but never populated (never synced, initial sync failed to start,
// or completed with nothing ingested). Pure eligibility derivations live
// here so node:test covers them; the 10s persistence timer and dismissal
// live in the SyncAssist component.

// The empty condition must persist this long before the prompt is allowed
// to appear — it must never flash during ordinary loading or mid-sync.
export const ASSIST_DELAY_MS = 10_000

// Session-scoped dismissal key — closing the prompt suppresses it until
// the tab session ends, so it can never nag across interactions.
export const ASSIST_DISMISS_KEY = 'devledger.assist.dismissed'

// "Meaningful telemetry is zero" — judged on the all-time payload, so a
// user merely looking at a quiet 7D window isn't told their ledger is
// empty. Commits + active days cover every derived surface.
export function metricsEmpty(all) {
  const s = all?.summary
  if (!s) return false
  return !s.commits && !s.activeDays
}

// Armed = every condition except the delay itself. The component holds the
// timer; when armed flips false (sync starts, data arrives, prompt
// dismissed) it hides immediately and the persistence clock resets.
export function assistArmed({ live, resolving, empty, status, pumping, dismissed }) {
  if (!live || resolving || empty !== true || pumping || dismissed) return false
  // A running or rate-limited sync will populate (or resume) on its own —
  // the prompt must stay out of the way while the canonical pump owns it.
  if (status === 'syncing' || status === 'rate_limited') return false
  return true
}
