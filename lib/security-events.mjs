import crypto from 'node:crypto'
import { waitUntil } from '@vercel/functions'
import { supabase } from './db.mjs'

// Privacy-preserving security telemetry. Designated rejection points and
// privileged transitions emit ONE structured JSON line each — visible in
// Vercel Runtime Logs — plus a best-effort row in the security_events
// table (30-day retention, pruned from the existing cron handler).
//
// Privacy rules are enforced here, not trusted to callers:
//   - only the fixed field set below can ever leave the process;
//   - actor/source identifiers are HMAC'd with SECURITY_EVENT_HASH_KEY — a
//     dedicated key, never SESSION_SECRET / CRON_SECRET / webhook secrets;
//   - no raw IP, User-Agent, cookies, Authorization values, request or
//     webhook bodies, OAuth codes, tokens, or stack traces — nothing else
//     is ever read from the request.
//
// Fail-open contract: telemetry must never break the primary request
// path. Unknown taxonomy, a missing hash key, a dead database — all
// degrade to a console line (security_internal_error) while the real
// response continues untouched.

export const SECURITY_EVENTS = Object.freeze(new Set([
  'same_origin_blocked',
  'session_invalid',
  'session_revoked',
  'auth_callback_failed',
  'webhook_signature_invalid',
  'webhook_replay_blocked',
  'cron_auth_failed',
  'logout_completed',
  'account_deleted',
  'security_internal_error',
]))

export const SECURITY_SEVERITIES = Object.freeze(new Set(['info', 'warning', 'high']))

const TABLE = 'security_events'
const RETENTION_MS = 30 * 24 * 3600 * 1000
const WRITER = { info: 'log', warning: 'warn', high: 'error' }

// Bound every free-text field to a short printable string — a caller bug
// can then never smuggle a header/body/secret into a record.
function safeText(v, max = 128) {
  if (v == null) return null
  const s = [...String(v)].filter((c) => c.codePointAt(0) > 31 && c.codePointAt(0) !== 127).join('').trim().slice(0, max)
  return s || null
}

// HMAC correlation: identical inputs produce identical hashes so one
// actor's events can be grouped, but the hash reveals nothing without the
// dedicated key. Missing key → null: telemetry loses correlation, the app
// keeps working.
export function correlate(value) {
  const key = process.env.SECURITY_EVENT_HASH_KEY
  if (!key || value == null || value === '') return null
  try {
    return crypto.createHmac('sha256', key).update(String(value)).digest('hex')
  } catch {
    return null
  }
}

// Pathname only — req.url can carry OAuth codes/state in the query, so the
// raw URL is never emitted.
function routeOf(req) {
  try {
    return safeText(new URL(req?.url || '/', 'http://localhost').pathname, 200)
  } catch {
    return null
  }
}

// Vercel's per-request id lets log lines correlate with platform logs
// without inventing (and leaking) our own request fingerprint.
function requestIdOf(req) {
  return safeText(req?.headers?.['x-vercel-id'], 200)
}

// Telemetry's own failure path: console only — it never writes to the
// table, so a broken store cannot recurse into itself.
function internalFailure(reasonCode) {
  try {
    console.error(JSON.stringify({
      timestamp: new Date().toISOString(),
      event: 'security_internal_error',
      severity: 'warning',
      route: null,
      method: null,
      status: null,
      request_id: null,
      reason_code: safeText(reasonCode, 80),
      actor_hash: null,
      source_hash: null,
    }))
  } catch {
    /* even console failed — nothing left to do */
  }
}

async function persist(record) {
  if (!supabase) return
  const { timestamp, ...row } = record
  try {
    const { error } = await supabase
      .from(TABLE)
      .insert({ ...row, occurred_at: timestamp })
    if (error) internalFailure('persist_rejected')
  } catch {
    internalFailure('persist_failed')
  }
}

// Emit one security event. Returns the persistence promise so tests can
// await the insert; production callers ignore it (waitUntil keeps the
// serverless invocation alive for the write).
export function securityEvent(event, {
  severity = 'warning',
  req = null,
  route = null,
  method = null,
  status = null,
  reasonCode = null,
  actorId = null,
  sourceId = null,
} = {}) {
  try {
    if (!SECURITY_EVENTS.has(event) || !SECURITY_SEVERITIES.has(severity)) {
      internalFailure('taxonomy_rejected')
      return null
    }
    const record = {
      timestamp: new Date().toISOString(),
      event,
      severity,
      route: safeText(route, 200) || routeOf(req),
      method: safeText(method ?? req?.method, 10),
      status: Number.isInteger(status) ? status : null,
      request_id: requestIdOf(req),
      reason_code: safeText(reasonCode, 80),
      actor_hash: correlate(actorId),
      source_hash: correlate(sourceId),
    }
    const line = JSON.stringify(record)
    try {
      console[WRITER[severity] || 'warn'](line)
    } catch {
      /* console unavailable — persistence still proceeds */
    }
    const p = persist(record)
    try {
      waitUntil(p)
    } catch {
      /* outside a Vercel invocation — the promise still runs */
    }
    return p
  } catch {
    internalFailure('emit_failed')
    return null
  }
}

// Shared shape for "a well-formed session presented a dead sid": the seal
// verified and the lease is alive, but the server-side record is gone or
// revoked. sid present → revoked (logout elsewhere / delete / kill-all);
// sid absent → invalid (pre-migration or tampered payload). Emitted once
// per request at the layer that rejects it.
export function sessionDenied(req, session) {
  if (!session?.userId) return
  securityEvent(session.sid ? 'session_revoked' : 'session_invalid', {
    req,
    status: 401,
    severity: 'warning',
    reasonCode: session.sid ? 'sid_revoked' : 'sid_missing',
    actorId: session.userId,
  })
}

// 30-day retention, driven by the existing authenticated cron handler —
// no separate endpoint. Never throws: retention failure must not break
// the primary cron work.
export async function pruneSecurityEvents() {
  if (!supabase) return
  try {
    await supabase
      .from(TABLE)
      .delete()
      .lt('occurred_at', new Date(Date.now() - RETENTION_MS).toISOString())
  } catch {
    internalFailure('retention_failed')
  }
}
