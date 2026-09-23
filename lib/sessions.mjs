import crypto from 'node:crypto'
import { supabase } from './db.mjs'
import { persistentTtl } from './config.mjs'

// Server-side session records. Every issued Dev Ledger session carries a
// random `sid` sealed inside the iron-session cookie; requireUser validates
// it against auth_sessions before trusting the identity. Revocation is a
// single row update — a stolen but well-formed cookie dies immediately.
//
// Backward compatibility: cookies issued before this shipped carry no sid.
// They fail validation → one forced re-login. Intentional: a pre-migration
// cookie has no server-side kill switch, so it must not stay trusted.

const TABLE = 'auth_sessions'

// Create a server-side session record; returns the sid to seal into the
// cookie. expires_at is a hard ceiling (the non-persistent inactivity
// lease is still enforced separately inside the sealed payload).
export async function createAuthSession(userId, { persistent = false } = {}) {
  if (!supabase) return null
  const sid = crypto.randomBytes(24).toString('base64url')
  const expiresAt = new Date(Date.now() + persistentTtl * 1000).toISOString()
  const { error } = await supabase.from(TABLE).insert({
    sid,
    user_id: userId,
    persistent,
    expires_at: expiresAt,
  })
  if (error) return null
  return sid
}

// Live check — exists, not revoked, not expired. Read-only per request;
// no write on ordinary traffic.
export async function isSessionLive(sid) {
  if (!supabase || !sid) return false
  const { data } = await supabase
    .from(TABLE)
    .select('sid')
    .eq('sid', sid)
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle()
  return Boolean(data)
}

// Revoke one session (logout).
export async function revokeSession(sid) {
  if (!supabase || !sid) return
  await supabase
    .from(TABLE)
    .update({ revoked_at: new Date().toISOString() })
    .eq('sid', sid)
    .is('revoked_at', null)
}

// Revoke every session for a user (DELETE MY DATA, credential rotation).
export async function revokeAllSessions(userId) {
  if (!supabase || !userId) return
  await supabase
    .from(TABLE)
    .update({ revoked_at: new Date().toISOString() })
    .eq('user_id', userId)
    .is('revoked_at', null)
}

// Bounded retention: expired/revoked rows older than 30 days can be
// garbage-collected. Called opportunistically (login), not per request.
export async function gcAuthSessions() {
  if (!supabase) return
  const cutoff = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString()
  try {
    await supabase
      .from(TABLE)
      .delete()
      .or(`expires_at.lt.${cutoff},revoked_at.lt.${cutoff}`)
  } catch {
    /* GC is best-effort — next call retries */
  }
}
