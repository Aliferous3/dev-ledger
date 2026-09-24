import crypto from 'node:crypto'
import { waitUntil } from '@vercel/functions'
import { supabase } from './db.mjs'

// Privacy-preserving security telemetry. Designated rejection points and
// privileged transitions emit ONE structured JSON line each — visible in
// Vercel Runtime Logs — plus a best-effort row in the security_events
// table (30-day retention, pruned from the existing cron handler).
//
// The allowlist is structural, not contractual: EVENT_SPEC is the only
// source of truth for event names, severities, statuses, reason codes,
// and persistence. Callers can supply ONLY {req, reasonCode, actorId,
// sourceId} — route comes from the request pathname (never the query,
// which can carry OAuth codes), method from req.method, request_id from
// the x-vercel-id header. Nothing else is ever read from the request:
// no IP, User-Agent, cookies, Authorization, bodies, tokens, or stacks.
//
// Persistence is deliberately narrower than logging: perimeter rejections
// that anonymous traffic can generate for free (CSRF blocks, bad webhook
// signatures, bad cron bearers, failed OAuth callbacks) are console-only
// so hostile traffic cannot amplify into database writes. Persisted
// events all sit behind authentication or a valid GitHub HMAC.
//
// Fail-open contract: telemetry must never break the primary request
// path. Unknown taxonomy, a missing hash key, a dead database — all
// degrade to a console line (security_internal_error) while the real
// response continues untouched.

// severity → console method. Kept private; the spec's severity list is
// fixed at authoring time and every value below is one of these three.
export const SECURITY_SEVERITIES = Object.freeze(['info', 'warning', 'high'])

const WRITER = { info: 'log', warning: 'warn', high: 'error' }

// The whole taxonomy. Each spec pins: severity (with optional per-reason
// override), status (with optional per-reason override), the closed set
// of reason codes, and whether the event may write a Supabase row.
// frozen objects — callers cannot mutate them, and lookup never touches
// a mutable structure.
export const EVENT_SPEC = Object.freeze({
  same_origin_blocked: Object.freeze({
    severity: 'warning', status: 403, persist: false,
    reasons: Object.freeze(['origin_missing', 'origin_malformed', 'origin_mismatch', 'fetch_site_mismatch']),
  }),
  session_invalid: Object.freeze({
    severity: 'warning', status: 401, persist: true,
    reasons: Object.freeze(['sid_missing']),
  }),
  session_revoked: Object.freeze({
    severity: 'warning', status: 401, persist: true,
    reasons: Object.freeze(['sid_revoked']),
  }),
  auth_callback_failed: Object.freeze({
    severity: 'warning', status: 400, persist: false,
    reasons: Object.freeze(['state_mismatch', 'token_exchange', 'user_upsert']),
    statusByReason: Object.freeze({ user_upsert: 500 }),
  }),
  webhook_signature_invalid: Object.freeze({
    severity: 'warning', status: 401, persist: false,
    reasons: Object.freeze(['secret_unconfigured', 'signature_missing', 'signature_mismatch']),
    severityByReason: Object.freeze({ signature_mismatch: 'high' }),
  }),
  webhook_replay_blocked: Object.freeze({
    severity: 'info', status: 200, persist: true,
    reasons: Object.freeze(['duplicate_delivery']),
  }),
  cron_auth_failed: Object.freeze({
    severity: 'warning', status: 401, persist: false,
    reasons: Object.freeze(['bearer_mismatch', 'secret_unconfigured']),
  }),
  logout_completed: Object.freeze({
    severity: 'info', status: 200, persist: true,
    reasons: Object.freeze([]),
  }),
  account_deleted: Object.freeze({
    severity: 'warning', status: 200, persist: true,
    reasons: Object.freeze([]),
  }),
  security_internal_error: Object.freeze({
    severity: 'warning', status: null, persist: false,
    reasons: Object.freeze(['taxonomy_rejected', 'persist_rejected', 'persist_failed', 'emit_failed', 'retention_failed']),
  }),
})

export const SECURITY_EVENTS = Object.freeze(Object.keys(EVENT_SPEC))

const TABLE = 'security_events'
const RETENTION_MS = 30 * 24 * 3600 * 1000

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

// Resolve the caller's reasonCode against the spec: multi-reason events
// require it explicitly; single-reason events derive it; zero-reason
// events accept only null. Anything else rejects the event outright.
function resolveReason(spec, reasonCode) {
  if (reasonCode != null) return spec.reasons.includes(reasonCode) ? reasonCode : undefined
  if (spec.reasons.length === 1) return spec.reasons[0]
  return spec.reasons.length === 0 ? null : undefined
}

// Emit one security event. Callers pass the event name, the request, an
// optional reason (validated per-event), and raw identifiers to HMAC —
// never severity/status/route/method. Returns the persistence promise so
// tests can await the insert; production callers ignore it (waitUntil
// keeps the serverless invocation alive for the write).
export function securityEvent(event, {
  req = null,
  reasonCode = null,
  actorId = null,
  sourceId = null,
} = {}) {
  try {
    const spec = Object.hasOwn(EVENT_SPEC, event) ? EVENT_SPEC[event] : null
    const reason = spec ? resolveReason(spec, reasonCode) : undefined
    if (!spec || reason === undefined) {
      internalFailure('taxonomy_rejected')
      return null
    }
    const severity = spec.severityByReason?.[reason] ?? spec.severity
    const record = {
      timestamp: new Date().toISOString(),
      event,
      severity,
      route: routeOf(req),
      method: safeText(req?.method, 10),
      status: spec.statusByReason?.[reason] ?? spec.status,
      request_id: requestIdOf(req),
      reason_code: reason,
      actor_hash: correlate(actorId),
      source_hash: correlate(sourceId),
    }
    const line = JSON.stringify(record)
    try {
      console[WRITER[severity] || 'warn'](line)
    } catch {
      /* console unavailable — persistence still proceeds */
    }
    // Console-only events never touch the database — anonymous perimeter
    // traffic cannot amplify into writes.
    if (!spec.persist) return Promise.resolve()
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
    actorId: session.userId,
  })
}

// 30-day retention, driven by the existing authenticated cron handler —
// no separate endpoint. Never throws: retention failure must not break
// the primary cron work. Callers run it via waitUntil, not await, so a
// slow delete can never delay the response.
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
