import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Security telemetry tests — real handlers, real iron-session cookies, an
// in-memory PostgREST fake. Env must be set BEFORE app modules load
// (config.mjs snapshots env at import), hence dynamic imports below.
// Sentinel secret values let the tests prove they can never be emitted.

process.env.SESSION_SECRET = 'test-session-secret-at-least-32-characters-long'
process.env.GITHUB_WEBHOOK_SECRET = 'test-webhook-secret-not-real'
process.env.CRON_SECRET = 'test-cron-secret-not-real'
process.env.SECURITY_EVENT_HASH_KEY = 'test-hash-key-not-real'

const { __setSupabaseForTests } = await import('../lib/db.mjs')
const { getSession } = await import('../lib/auth.mjs')
const { appUrl } = await import('../lib/config.mjs')
const { requireUser } = await import('../lib/require-user.mjs')
const sec = await import('../lib/security-events.mjs')
const { securityEvent, pruneSecurityEvents, sessionDenied, SECURITY_EVENTS, SECURITY_SEVERITIES } = sec
const { forbidCrossSite } = await import('../lib/same-origin.mjs')
const cronHandler = (await import('../api/cron/sync.mjs')).default
const webhookHandler = (await import('../api/webhooks/github.mjs')).default
const logoutHandler = (await import('../api/auth/logout.mjs')).default
const userHandler = (await import('../api/user.mjs')).default

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ORIGIN = new URL(appUrl).origin

/* ── capture + fake-db helpers ──────────────────────────────────────── */

// Collect every line security telemetry writes to console.*
function captureConsole() {
  const lines = []
  const orig = { log: console.log, warn: console.warn, error: console.error }
  const push = (a) => { try { lines.push(JSON.parse(a.join(' '))) } catch { lines.push({ raw: a.join(' ') }) } }
  console.log = (...a) => push(a)
  console.warn = (...a) => push(a)
  console.error = (...a) => push(a)
  return { lines, restore() { console.log = orig.log; console.warn = orig.warn; console.error = orig.error } }
}

// Minimal PostgREST-compatible fake: every chained call is recorded and
// awaitable; results are configured per table.
function fakeDb(results = {}) {
  const queries = []
  const METHODS = ['select', 'eq', 'neq', 'is', 'in', 'lt', 'lte', 'gt', 'gte',
    'or', 'order', 'limit', 'single', 'maybeSingle', 'insert', 'update', 'upsert', 'delete']
  return {
    queries,
    from(table) {
      const q = { table, ops: [] }
      const self = {}
      for (const m of METHODS) self[m] = (...args) => (q.ops.push({ m, args }), self)
      self.then = (res, rej) => Promise.resolve()
        .then(() => {
          const fn = results[table]
          return typeof fn === 'function' ? fn(q) : (fn ?? { data: null, error: null })
        })
        .then(res, rej)
      queries.push(q)
      return self
    },
  }
}

// security_events rows inserted through the fake, and their column payloads
function insertedEvents(db) {
  return db.queries
    .filter((q) => q.table === 'security_events')
    .flatMap((q) => q.ops.filter((o) => o.m === 'insert').map((o) => o.args[0]))
}

const flush = async () => { await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r)) }

function mockRes() {
  return {
    statusCode: 200,
    body: undefined,
    headers: {},
    status(c) { this.statusCode = c; return this },
    json(b) { this.body = b; return this },
    setHeader(k, v) { this.headers[k.toLowerCase()] = v },
    getHeader(k) { return this.headers[k.toLowerCase()] },
    getHeaders() { return this.headers },
    writeHead(c, h) { this.statusCode = c; if (h) Object.assign(this.headers, h); return this },
    end() { return this },
  }
}

function mockReq(o = {}) { return { method: 'GET', url: '/api/x', headers: {}, ...o } }

// Mint a real sealed cookie via the production session path.
async function mintCookie(fields) {
  const req = mockReq()
  const res = mockRes()
  const s = await getSession(req, res, { persistent: true })
  Object.assign(s, fields)
  await s.save()
  const sc = res.headers['set-cookie']
  const list = Array.isArray(sc) ? sc : [sc].filter(Boolean)
  return list.find((c) => c.startsWith('dev_ledger_session='))?.split(';')[0]
}

let db
before(() => { db = fakeDb(); __setSupabaseForTests(db) })
after(() => __setSupabaseForTests(null))

/* ── taxonomy ───────────────────────────────────────────────────────── */

test('event names and severities are strictly allowlisted', async () => {
  const cap = captureConsole()
  try {
    for (const bad of ['free_text', 'DROP TABLE', '', 'debug_info']) {
      assert.equal(securityEvent(bad, {}), null, `event ${bad} must be rejected`)
    }
    assert.equal(securityEvent('logout_completed', { severity: 'critical' }), null, 'unknown severity rejected')
    assert.equal(securityEvent('logout_completed', { severity: 'INFO' }), null, 'severity is case-sensitive')
    for (const name of SECURITY_EVENTS) {
      const p = securityEvent(name, { severity: 'info' })
      assert.ok(p instanceof Promise, `${name} accepted`)
      await p
    }
  } finally {
    cap.restore()
  }
  const emitted = cap.lines.filter((l) => SECURITY_EVENTS.has(l.event) && l.reason_code !== 'taxonomy_rejected')
  const rejected = cap.lines.filter((l) => l.reason_code === 'taxonomy_rejected')
  assert.equal(emitted.length, SECURITY_EVENTS.size, 'all allowlisted events emit')
  assert.equal(rejected.length, 6, 'every off-list name/severity produced an internal error')
})

test('exact taxonomy matches the documented set', () => {
  assert.deepEqual([...SECURITY_EVENTS].sort(), [
    'account_deleted',
    'auth_callback_failed',
    'cron_auth_failed',
    'logout_completed',
    'same_origin_blocked',
    'security_internal_error',
    'session_invalid',
    'session_revoked',
    'webhook_replay_blocked',
    'webhook_signature_invalid',
  ])
  assert.deepEqual([...SECURITY_SEVERITIES].sort(), ['high', 'info', 'warning'])
})

/* ── privacy: nothing sensitive can be emitted ──────────────────────── */

test('emitted records carry only the fixed field set and no secrets', async (t) => {
  const cap = captureConsole()
  try {
    const req = mockReq({
      method: 'POST',
      url: '/api/user?confirm=1',
      headers: {
        origin: ORIGIN,
        authorization: `Bearer ${process.env.CRON_SECRET}`,
        cookie: `dev_ledger_session=${process.env.SESSION_SECRET}`,
        'x-hub-signature-256': `sha256=${process.env.GITHUB_WEBHOOK_SECRET}`,
        'x-vercel-id': 'iad1::req-abc-123',
        'user-agent': 'sentinel-ua-string-must-not-appear',
        'x-forwarded-for': '203.0.113.99',
      },
      body: { token: 'sentinel-body-token', repositoryId: 'repo-1', mode: 'delete' },
    })
    const p = securityEvent('same_origin_blocked', {
      req, status: 403, severity: 'warning', reasonCode: 'origin_mismatch', actorId: 'user-uuid-9',
    })
    await p
  } finally {
    cap.restore()
  }
  const rec = cap.lines.find((l) => l.event === 'same_origin_blocked')
  assert.ok(rec, 'event line emitted')
  assert.deepEqual(Object.keys(rec).sort(), [
    'actor_hash', 'event', 'method', 'reason_code', 'request_id',
    'route', 'severity', 'source_hash', 'status', 'timestamp',
  ])
  const blob = JSON.stringify(cap.lines) + JSON.stringify(insertedEvents(db))
  for (const secret of [
    process.env.SESSION_SECRET,
    process.env.CRON_SECRET,
    process.env.GITHUB_WEBHOOK_SECRET,
    process.env.SECURITY_EVENT_HASH_KEY,
    'sentinel-body-token',
    'sentinel-ua-string-must-not-appear',
    '203.0.113.99',
    'repo-1',
    'user-uuid-9',
  ]) {
    assert.ok(!blob.includes(secret), `secret/private value must not appear: ${secret.slice(0, 20)}`)
  }
  assert.equal(rec.request_id, 'iad1::req-abc-123', 'vercel request id used')
  assert.equal(rec.route, '/api/user', 'query string stripped from route')
  assert.match(rec.actor_hash, /^[0-9a-f]{64}$/, 'actor is an HMAC, not the raw id')
  const expected = crypto.createHmac('sha256', process.env.SECURITY_EVENT_HASH_KEY).update('user-uuid-9').digest('hex')
  assert.equal(rec.actor_hash, expected)
  // The same row reached the persistent store with identical fields.
  const row = insertedEvents(db).find((r) => r.event === 'same_origin_blocked' && r.reason_code === 'origin_mismatch')
  assert.ok(row, 'row persisted')
  assert.equal(row.actor_hash, expected)
})

test('correlation degrades to null without SECURITY_EVENT_HASH_KEY', async (t) => {
  const key = process.env.SECURITY_EVENT_HASH_KEY
  delete process.env.SECURITY_EVENT_HASH_KEY
  t.after(() => { process.env.SECURITY_EVENT_HASH_KEY = key })
  const cap = captureConsole()
  try {
    await securityEvent('logout_completed', { severity: 'info', actorId: 'u1', sourceId: 's1' })
  } finally {
    cap.restore()
  }
  const rec = cap.lines.find((l) => l.event === 'logout_completed')
  assert.equal(rec.actor_hash, null)
  assert.equal(rec.source_hash, null)
})

/* ── designated rejection paths emit exactly once ───────────────────── */

test('same-origin guard emits same_origin_blocked per rejection', async () => {
  const cap = captureConsole()
  try {
    for (const [headers, reason] of [
      [{ origin: 'https://evil.example' }, 'origin_mismatch'],
      [{}, 'origin_missing'],
      [{ origin: 'not a url' }, 'origin_malformed'],
      [{ origin: ORIGIN, 'sec-fetch-site': 'cross-site' }, 'fetch_site_mismatch'],
    ]) {
      const res = mockRes()
      assert.equal(forbidCrossSite(mockReq({ method: 'POST', url: '/api/sync', headers }), res), true)
      assert.equal(res.statusCode, 403)
    }
    const ok = mockRes()
    assert.equal(forbidCrossSite(mockReq({ method: 'POST', url: '/api/sync', headers: { origin: ORIGIN } }), ok), false)
  } finally {
    cap.restore()
  }
  await flush()
  const events = cap.lines.filter((l) => l.event === 'same_origin_blocked')
  assert.equal(events.length, 4, 'one event per rejection, none for the allowed request')
  assert.deepEqual(events.map((e) => e.reason_code), ['origin_mismatch', 'origin_missing', 'origin_malformed', 'fetch_site_mismatch'])
  assert.ok(events.every((e) => e.route === '/api/sync' && e.status === 403))
})

test('revoked and sid-less sessions emit distinct session events', async () => {
  const revoked = await mintCookie({ userId: 'u-revoked', sid: 'dead-sid', persistent: true })
  const sidless = await mintCookie({ userId: 'u-legacy', persistent: true })
  const cap = captureConsole()
  try {
    const r1 = mockRes()
    assert.equal(await requireUser(mockReq({ headers: { cookie: revoked } }), r1), null)
    assert.equal(r1.statusCode, 401)
    const r2 = mockRes()
    assert.equal(await requireUser(mockReq({ headers: { cookie: sidless } }), r2), null)
    assert.equal(r2.statusCode, 401)
    // anonymous request — routine, must NOT emit
    const r3 = mockRes()
    await requireUser(mockReq(), r3)
  } finally {
    cap.restore()
  }
  await flush()
  const revokedEv = cap.lines.find((l) => l.event === 'session_revoked')
  const invalidEv = cap.lines.find((l) => l.event === 'session_invalid')
  assert.ok(revokedEv && invalidEv, 'both session rejections emitted')
  assert.equal(revokedEv.reason_code, 'sid_revoked')
  assert.equal(invalidEv.reason_code, 'sid_missing')
  assert.equal(cap.lines.filter((l) => l.event === 'session_revoked').length, 1, 'no duplicate per request')
  assert.ok(!cap.lines.some((l) => l.event === 'session_invalid' && l.reason_code !== 'sid_missing'))
})

test('webhook rejects a bad signature and logs without the body', async () => {
  const raw = Buffer.from(JSON.stringify({ secret_field: 'sentinel-webhook-body-content' }))
  const sig = 'sha256=' + crypto.createHmac('sha256', 'wrong-secret').update(raw).digest('hex')
  const req = mockReq({
    method: 'POST', url: '/api/webhooks/github',
    headers: { 'x-hub-signature-256': sig, 'x-github-event': 'push' },
  })
  req[Symbol.asyncIterator] = async function* () { yield raw }
  const cap = captureConsole()
  try {
    const res = mockRes()
    await webhookHandler(req, res)
    assert.equal(res.statusCode, 401)
  } finally {
    cap.restore()
  }
  await flush()
  const ev = cap.lines.find((l) => l.event === 'webhook_signature_invalid')
  assert.ok(ev, 'signature failure logged')
  assert.equal(ev.severity, 'high')
  assert.equal(ev.reason_code, 'signature_mismatch')
  assert.ok(!JSON.stringify(cap.lines).includes('sentinel-webhook-body-content'), 'webhook body never logged')
  assert.ok(!JSON.stringify(cap.lines).includes(sig), 'signature value never logged')
})

test('webhook replay dedup emits webhook_replay_blocked', async () => {
  const raw = Buffer.from(JSON.stringify({ action: 'created', installation: { id: 1 } }))
  const sig = 'sha256=' + crypto.createHmac('sha256', process.env.GITHUB_WEBHOOK_SECRET).update(raw).digest('hex')
  const delivery = 'delivery-sentinel-42'
  // Fake: dedup insert conflicts → zero rows back → duplicate path
  const replayDb = fakeDb({ webhook_deliveries: (q) => q.ops.some((o) => o.m === 'insert') ? { data: [], error: null } : { data: null, error: null } })
  __setSupabaseForTests(replayDb)
  try {
    const req = mockReq({
      method: 'POST', url: '/api/webhooks/github',
      headers: {
        'x-hub-signature-256': sig,
        'x-github-event': 'installation',
        'x-github-delivery': delivery,
      },
    })
    req[Symbol.asyncIterator] = async function* () { yield raw }
    const cap = captureConsole()
    try {
      const res = mockRes()
      await webhookHandler(req, res)
      assert.equal(res.statusCode, 200)
      assert.equal(res.body.duplicate, true)
    } finally {
      cap.restore()
    }
    await flush()
    const ev = cap.lines.find((l) => l.event === 'webhook_replay_blocked')
    assert.ok(ev, 'replay event emitted')
    assert.equal(ev.severity, 'info')
    assert.match(ev.source_hash, /^[0-9a-f]{64}$/, 'delivery id is HMACed')
    assert.ok(!JSON.stringify(cap.lines).includes(delivery), 'raw delivery id never logged')
  } finally {
    __setSupabaseForTests(db)
  }
})

test('cron rejects a bad bearer and logs cron_auth_failed', async () => {
  const cap = captureConsole()
  try {
    const res = mockRes()
    await cronHandler(mockReq({
      method: 'GET', url: '/api/cron/sync',
      headers: { authorization: 'Bearer wrong' },
    }), res)
    assert.equal(res.statusCode, 401)
  } finally {
    cap.restore()
  }
  await flush()
  const ev = cap.lines.find((l) => l.event === 'cron_auth_failed')
  assert.ok(ev)
  assert.equal(ev.reason_code, 'bearer_mismatch')
  assert.ok(!JSON.stringify(cap.lines).includes(process.env.CRON_SECRET), 'cron secret never logged')
})

test('logout emits logout_completed with a hashed actor', async () => {
  const cookie = await mintCookie({ userId: 'u-logout', sid: 'live-sid', persistent: true })
  const cap = captureConsole()
  try {
    const res = mockRes()
    await logoutHandler(mockReq({
      method: 'POST', url: '/api/auth/logout',
      headers: { origin: ORIGIN, cookie },
    }), res)
    assert.equal(res.statusCode, 200)
  } finally {
    cap.restore()
  }
  await flush()
  const ev = cap.lines.find((l) => l.event === 'logout_completed')
  assert.ok(ev)
  assert.equal(ev.severity, 'info')
  assert.equal(ev.actor_hash, crypto.createHmac('sha256', process.env.SECURITY_EVENT_HASH_KEY).update('u-logout').digest('hex'))
  assert.ok(!JSON.stringify(cap.lines).includes('u-logout'))
})

test('account deletion emits account_deleted', async () => {
  const cookie = await mintCookie({ userId: 'u-delete', sid: 'live-sid', persistent: true })
  const liveDb = fakeDb({ auth_sessions: () => ({ data: { sid: 'live-sid' }, error: null }) })
  __setSupabaseForTests(liveDb)
  try {
    const cap = captureConsole()
    try {
      const res = mockRes()
      await userHandler(mockReq({
        method: 'DELETE', url: '/api/user?confirm=1',
        headers: { origin: ORIGIN, cookie },
      }), res)
      assert.equal(res.statusCode, 200)
      assert.equal(res.body.deleted, true)
    } finally {
      cap.restore()
    }
    await flush()
    const ev = cap.lines.find((l) => l.event === 'account_deleted')
    assert.ok(ev)
    assert.equal(ev.severity, 'warning')
    assert.ok(ev.actor_hash, 'actor correlated')
  } finally {
    __setSupabaseForTests(db)
  }
})

/* ── fail-open: telemetry can never break the request path ──────────── */

test('a dead event store still returns the primary response', async () => {
  const deadDb = fakeDb({
    security_events: () => { throw new Error('connection reset') },
    auth_sessions: () => ({ data: { sid: 's' }, error: null }),
  })
  __setSupabaseForTests(deadDb)
  const cap = captureConsole()
  try {
    const res = mockRes()
    assert.equal(forbidCrossSite(mockReq({ method: 'POST', url: '/api/sync', headers: { origin: 'https://evil.example' } }), res), true)
    assert.equal(res.statusCode, 403, 'CSRF rejection unaffected by telemetry failure')
    const cronRes = mockRes()
    await cronHandler(mockReq({ method: 'GET', url: '/api/cron/sync', headers: { authorization: 'Bearer wrong' } }), cronRes)
    assert.equal(cronRes.statusCode, 401, 'cron rejection unaffected')
    await pruneSecurityEvents() // must not throw either
  } finally {
    cap.restore()
    __setSupabaseForTests(db)
  }
  await flush()
  assert.ok(cap.lines.some((l) => l.event === 'security_internal_error'), 'telemetry failure itself is reported to console')
})

test('securityEvent itself never throws, even with a hostile req shape', () => {
  const cap = captureConsole()
  try {
    assert.doesNotThrow(() => securityEvent('logout_completed', { req: Object.create(null), severity: 'info' }))
    assert.doesNotThrow(() => securityEvent('logout_completed', { req: { headers: null }, severity: 'info' }))
  } finally {
    cap.restore()
  }
})

/* ── retention: 30-day prune through the existing cron path ─────────── */

test('authenticated cron run prunes events older than 30 days', async () => {
  const cronDb = fakeDb({ user_sync: () => ({ data: [], error: null }) })
  __setSupabaseForTests(cronDb)
  const cap = captureConsole()
  try {
    const res = mockRes()
    await cronHandler(mockReq({
      method: 'GET', url: '/api/cron/sync',
      headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
    }), res)
    assert.equal(res.statusCode, 200)
  } finally {
    cap.restore()
    __setSupabaseForTests(db)
  }
  const prune = cronDb.queries.find((q) => q.table === 'security_events' && q.ops.some((o) => o.m === 'delete'))
  assert.ok(prune, 'cron performs the security_events retention delete')
  const lt = prune.ops.find((o) => o.m === 'lt')
  assert.equal(lt.args[0], 'occurred_at')
  const cutoff = new Date(lt.args[1]).getTime()
  const days = (Date.now() - cutoff) / 86400_000
  assert.ok(days >= 29.9 && days <= 30.1, `retention window is ~30 days, got ${days}`)
})

test('pruneSecurityEvents deletes only rows older than the cutoff', async () => {
  const pruneDb = fakeDb()
  __setSupabaseForTests(pruneDb)
  try {
    await pruneSecurityEvents()
  } finally {
    __setSupabaseForTests(db)
  }
  const q = pruneDb.queries.find((x) => x.table === 'security_events')
  assert.ok(q.ops.some((o) => o.m === 'delete'))
  assert.ok(q.ops.some((o) => o.m === 'lt' && o.args[0] === 'occurred_at'))
})

/* ── migration + function budget ────────────────────────────────────── */

const migration = readFileSync(path.join(ROOT, 'migrations/009_security_events.sql'), 'utf8')

test('security_events table is service_role-only: RLS on, zero browser privilege', () => {
  assert.match(migration, /create table if not exists public\.security_events/i)
  assert.match(migration, /alter table public\.security_events enable row level security/i)
  // No policies → every non-service_role role is denied by default.
  assert.doesNotMatch(migration, /create policy/i, 'no RLS policies — closed barrier')
  assert.match(migration, /revoke all on public\.security_events from public, anon, authenticated/i)
  assert.match(migration, /grant select, insert, delete on public\.security_events to service_role/i)
  assert.doesNotMatch(migration, /grant .* to (anon|authenticated)/i, 'no browser-facing grants')
  assert.doesNotMatch(migration, /security definer/i, 'no SECURITY DEFINER helper')
})

test('migration stores only the fixed field set — no free-form metadata blob', () => {
  for (const col of ['occurred_at', 'event', 'severity', 'route', 'method', 'status', 'request_id', 'reason_code', 'actor_hash', 'source_hash']) {
    assert.match(migration, new RegExp(`\\b${col}\\b`), `column ${col} present`)
  }
  assert.doesNotMatch(migration, /\bjsonb?\b/i, 'no unrestricted JSON metadata column')
})

test('no 13th serverless function was added', () => {
  const apiDir = path.join(ROOT, 'api')
  const files = []
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (/\.(mjs|js|ts)$/.test(e.name)) files.push(p)
    }
  }
  walk(apiDir)
  assert.equal(files.length, 12, `expected exactly 12 API functions, found ${files.length}: ${files.map((f) => path.relative(apiDir, f)).join(', ')}`)
})

test('retention uses the existing cron path, not a new endpoint', () => {
  const cron = readFileSync(path.join(ROOT, 'api/cron/sync.mjs'), 'utf8')
  assert.match(cron, /pruneSecurityEvents\(\)/, 'cron invokes the retention helper')
  assert.match(cron, /CRON_SECRET/, 'cron stays authenticated')
  const mod = readFileSync(path.join(ROOT, 'lib/security-events.mjs'), 'utf8')
  assert.match(mod, /30 \* 24 \* 3600 \* 1000/, '30-day retention constant')
})
