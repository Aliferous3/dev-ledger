/* Account-menu derivations — pure functions shared by the header account
   control and the node test suite. No DOM/React here. */

// Statuses that mean the backend sync worker is actively ingesting.
// Mirrors the pump contract in api/sync.mjs / lib/sync.mjs.
export const SYNCING_STATUSES = new Set(['syncing'])

export function initialsFromLogin(login) {
  const s = String(login || '').replace(/^@/, '').trim()
  if (!s) return '··'
  return s.slice(0, 2).toUpperCase()
}

// The authenticated user's own GitHub profile — never hardcoded.
export function profileUrl(login) {
  const s = String(login || '').replace(/^@/, '').trim()
  return s ? `https://github.com/${s}` : null
}

// Repository-access management lives on GitHub: prefer the concrete
// installation settings URL reported by /api/user, else the app install
// flow. null → the caller hides the action (no dead links).
export function manageReposUrl(me) {
  const inst = me?.installations?.[0]?.url
  if (inst) return inst
  const slug = me?.appSlug
  return slug ? `https://github.com/apps/${slug}/installations/new` : null
}

// Revoked/disconnected reconnect uses the existing auth entry point —
// the OAuth callback re-discovers installations and routes into the
// GitHub App install flow when none remain.
export function reconnectUrl() {
  return '/api/auth/login'
}

export function isSyncing(status) {
  return SYNCING_STATUSES.has(status)
}

// Menu status line — derived from real sync/github state only.
export function menuStatus({ revoked = false, status = 'idle' } = {}) {
  if (revoked || status === 'revoked') return 'GITHUB ACCESS REVOKED'
  if (isSyncing(status)) return 'GITHUB CONNECTED · SYNCING'
  return 'GITHUB CONNECTED'
}
