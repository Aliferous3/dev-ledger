import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

// Feedback system — POST /api/feedback (rewritten to /api/user?action=feedback
// so the project stays inside the 12-function cap), the shared validation
// model, and the System Drawer's canonical Concept-04 states.
// Handlers run for real against an in-memory PostgREST-compatible fake and
// real sealed iron-session cookies.

process.env.GITHUB_WEBHOOK_SECRET = 'test-webhook-secret-do-not-use'
process.env.SESSION_SECRET = 'test-session-secret-at-least-32-characters-long'

const { __setSupabaseForTests } = await import('../lib/db.mjs')
const { getSession } = await import('../lib/auth.mjs')
const sessions = await import('../lib/sessions.mjs')
const { appUrl } = await import('../lib/config.mjs')
const userHandler = (await import('../api/user.mjs')).default
const {
  FEEDBACK_TYPES,
  TITLE_MAX,
  DESCRIPTION_MAX,
  SCREENSHOT_MAX_BYTES,
  normalizeFeedback,
  normalizeScreenshot,
} = await import('../src/feedback/feedbackModel.mjs')

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const src = (p) => readFileSync(path.join(root, p), 'utf8')

/* ── minimal PostgREST fake (insert/select/update chains used here) ──── */

function cmpOp(col, op, val) {
  const v = val === 'null' ? null : val
  switch (op) {
    case 'eq': return (r) => r[col] === v
    case 'is': return (r) => (v === null ? r[col] == null : r[col] === v)
    case 'gt': return (r) => r[col] != null && r[col] > v
    default: throw new Error(`fake db: unsupported op ${op}`)
  }
}

function makeDb() {
  const store = new Map()
  const t = (name) => store.get(name) || store.set(name, []).get(name)

  function exec(name, q) {
    const rows = t(name)
    if (q.op === 'insert') {
      const inserted = q.rows.map((r) => ({ id: crypto.randomUUID(), ...r }))
      rows.push(...inserted)
      return { data: q.selectAfter ? inserted : null, error: null }
    }
    if (q.op === 'update') {
      let n = 0
      for (const r of rows) if (q.filters.every((f) => f(r))) { Object.assign(r, q.sets); n++ }
      return { data: null, error: null, count: n }
    }
    return { data: rows.filter((r) => q.filters.every((f) => f(r))), error: null }
  }

  function from(name) {
    const q = { op: 'select', filters: [], selectAfter: false }
    const self = {
      select(c) { q.selectAfter = true; q.cols = c; return self },
      insert(r) { q.op = 'insert'; q.rows = Array.isArray(r) ? r : [r]; return self },
      update(s) { q.op = 'update'; q.sets = s; return self },
      eq: (c, v) => (q.filters.push(cmpOp(c, 'eq', v)), self),
      is: (c, v) => (q.filters.push(cmpOp(c, 'is', v)), self),
      gt: (c, v) => (q.filters.push(cmpOp(c, 'gt', v)), self),
      maybeSingle() { const { data } = exec(name, q); return Promise.resolve({ data: data?.[0] ?? null, error: null }) },
      single() { const { data } = exec(name, q); const row = data?.[0] ?? null; return Promise.resolve({ data: row, error: row ? null : { message: 'PGRST116' } }) },
      then(res, rej) { Promise.resolve(exec(name, q)).then(res, rej) },
    }
    return self
  }

  return { from, t }
}

let db
before(() => { db = makeDb(); __setSupabaseForTests(db) })

function mockRes() {
  return {
    statusCode: 200,
    body: undefined,
    headers: {},
    status(c) { this.statusCode = c; return this },
    json(b) { this.body = b; return this },
    setHeader(k, v) { this.headers[k.toLowerCase()] = v },
    getHeader(k) { return this.headers[k.toLowerCase()] },
    writeHead(c, h) { this.statusCode = c; if (h) Object.assign(this.headers, h); return this },
    end() { return this },
  }
}

const ORIGIN = new URL(appUrl).origin
function mockReq(o = {}) {
  const { url, ...rest } = o
  return { method: 'GET', headers: { origin: ORIGIN, 'sec-fetch-site': 'same-origin' }, url: url || '/api/user', ...rest }
}

function cookieFrom(res) {
  const sc = res.headers['set-cookie']
  const list = Array.isArray(sc) ? sc : sc ? [sc] : []
  return list.map((c) => c.split(';')[0]).join('; ')
}

async function mintSession(userId) {
  const res = mockRes()
  const s = await getSession(mockReq(), res, { persistent: true })
  s.userId = userId
  s.githubUserId = Math.floor(Math.random() * 1e9)
  s.githubLogin = `u-${String(userId).slice(0, 6)}`
  s.persistent = true
  s.sid = await sessions.createAuthSession(userId, { persistent: true })
  await s.save()
  return cookieFrom(res)
}

function feedbackReq(cookie, body, overrides = {}) {
  return mockReq({
    method: 'POST',
    url: '/api/user?action=feedback',
    body,
    headers: {
      origin: ORIGIN,
      'sec-fetch-site': 'same-origin',
      ...(cookie ? { cookie } : {}),
      ...(overrides.headers || {}),
    },
    ...overrides,
  })
}

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)

/* ── shared validation model ────────────────────────────────────────── */

test('normalizeFeedback accepts the three canonical types', () => {
  for (const type of FEEDBACK_TYPES) {
    const r = normalizeFeedback({ type, title: 'x' })
    assert.equal(r.ok, true)
    assert.equal(r.value.type, type)
  }
})

test('normalizeFeedback rejects bad type and empty/oversized title', () => {
  assert.equal(normalizeFeedback({ type: 'PRAISE', title: 'x' }).ok, false)
  assert.equal(normalizeFeedback({ type: 'BUG', title: '   ' }).ok, false)
  assert.equal(normalizeFeedback({ type: 'BUG' }).ok, false)
  assert.equal(normalizeFeedback({ type: 'BUG', title: 'x'.repeat(TITLE_MAX + 5) }).ok, false)
  assert.equal(normalizeFeedback({ type: 'bug', title: 'ok' }).value.type, 'BUG') // case-normalized
  assert.equal(normalizeFeedback({ type: 'BUG', title: 'ok', description: 'x'.repeat(DESCRIPTION_MAX + 5) }).ok, false)
})

test('normalizeFeedback clamps context fields and nulls empties', () => {
  const r = normalizeFeedback({
    type: 'FEATURE',
    title: 'add dark mode',
    page: 'ACTIVITY',
    range: '90D',
    build: 'v1.3.0',
  })
  assert.equal(r.ok, true)
  assert.equal(r.value.page, 'ACTIVITY')
  assert.equal(r.value.selectedRange, '90D')
  assert.equal(r.value.description, null)
})

test('normalizeScreenshot gates mime, base64 shape, and size', () => {
  assert.equal(normalizeScreenshot(null).value, null)
  assert.equal(normalizeScreenshot({ name: 'a.png', mime: 'image/png', data: PNG_1PX.toString('base64') }).ok, true)
  assert.equal(normalizeScreenshot({ name: 'a.gif', mime: 'image/gif', data: 'AAAA' }).ok, false)
  assert.equal(normalizeScreenshot({ name: 'a.png', mime: 'image/png', data: '!!!not-base64!!!' }).ok, false)
  const huge = 'A'.repeat(Math.ceil((SCREENSHOT_MAX_BYTES + 100) / 3) * 4)
  assert.equal(normalizeScreenshot({ name: 'a.png', mime: 'image/png', data: huge }).ok, false)
})

/* ── POST /api/feedback — the real handler path ─────────────────────── */

test('feedback requires an authenticated live session', async () => {
  const res = mockRes()
  await userHandler(feedbackReq(null, { type: 'BUG', title: 'x' }), res)
  assert.equal(res.statusCode, 401)
})

test('feedback is same-origin guarded like every other mutation', async () => {
  const userId = crypto.randomUUID()
  const cookie = await mintSession(userId)
  const res = mockRes()
  await userHandler(
    mockReq({
      method: 'POST',
      url: '/api/user?action=feedback',
      body: { type: 'BUG', title: 'x' },
      headers: { cookie, origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' },
    }),
    res,
  )
  assert.equal(res.statusCode, 403)
  const res2 = mockRes()
  await userHandler(
    mockReq({
      method: 'POST',
      url: '/api/user?action=feedback',
      body: { type: 'BUG', title: 'x' },
      headers: { cookie }, // no Origin at all → fail closed
    }),
    res2,
  )
  assert.equal(res2.statusCode, 403)
})

test('feedback rejects invalid payloads with 400', async () => {
  const cookie = await mintSession(crypto.randomUUID())
  for (const body of [
    { type: 'NOPE', title: 'x' },
    { type: 'BUG', title: '' },
    { type: 'BUG' },
  ]) {
    const res = mockRes()
    await userHandler(feedbackReq(cookie, body), res)
    assert.equal(res.statusCode, 400, JSON.stringify(body))
  }
})

test('feedback stores a user-scoped record and returns 201', async () => {
  const userId = crypto.randomUUID()
  const cookie = await mintSession(userId)
  const res = mockRes()
  await userHandler(
    feedbackReq(cookie, {
      type: 'BUG',
      title: 'Contribution graph fails after changing range',
      description: 'Switching 90D → 1Y leaves the graph empty.',
      page: 'OVERVIEW',
      range: '90D',
      build: 'v1.3.0',
    }),
    res,
  )
  assert.equal(res.statusCode, 201)
  assert.equal(res.body.ok, true)
  const rows = db.t('feedback')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].user_id, userId)
  assert.equal(rows[0].type, 'BUG')
  assert.equal(rows[0].selected_range, '90D')
  assert.equal(rows[0].screenshot, null)
})

test('feedback screenshot must verify as its declared image type', async () => {
  const cookie = await mintSession(crypto.randomUUID())
  // Claimed PNG, actual garbage bytes → rejected before storage.
  const bad = mockRes()
  await userHandler(
    feedbackReq(cookie, {
      type: 'BUG',
      title: 'x',
      screenshot: { name: 'a.png', mime: 'image/png', data: Buffer.from('not an image').toString('base64') },
    }),
    bad,
  )
  assert.equal(bad.statusCode, 400)

  // A real PNG passes the magic-byte check and persists.
  const good = mockRes()
  await userHandler(
    feedbackReq(cookie, {
      type: 'BUG',
      title: 'x',
      screenshot: { name: 'capture.png', mime: 'image/png', data: PNG_1PX.toString('base64') },
    }),
    good,
  )
  assert.equal(good.statusCode, 201)
  const row = db.t('feedback').at(-1)
  assert.equal(row.screenshot_mime, 'image/png')
  assert.ok(row.screenshot.length > 0)
})

/* ── routing + drawer wiring ────────────────────────────────────────── */

test('/api/feedback is a rewrite, not a new function (12-function cap)', () => {
  const vercel = JSON.parse(src('vercel.json'))
  const rule = vercel.rewrites.find((r) => r.source === '/api/feedback')
  assert.ok(rule, 'missing /api/feedback rewrite')
  assert.match(rule.destination, /action=feedback/)
})

test('migration creates the feedback table with cascade + closed RLS', () => {
  const sql = src('migrations/010_feedback.sql')
  assert.match(sql, /create table if not exists public\.feedback/)
  assert.match(sql, /references public\.users\(id\) on delete cascade/i)
  assert.match(sql, /enable row level security/i)
  assert.match(sql, /revoke all on public\.feedback from public, anon, authenticated/)
})

test('drawer implements the canonical Concept-04 states and fields', () => {
  const d = src('src/feedback/FeedbackDrawer.tsx')
  for (const marker of [
    'DIAGNOSTIC DRAWER',
    'TRANSMIT',
    'TRANSMISSION COMPLETE',
    'SIGNAL RECEIVED',
    'TRANSMISSION FAILED',
    'SIGNAL LOST',
    '[RETRY]',
    '+ ADD DESCRIPTION / SCREENSHOT / CONTEXT',
    'CONTEXT // AUTOMATIC',
    "fetch('/api/feedback'",
  ]) {
    assert.ok(d.includes(marker), `drawer missing ${marker}`)
  }
  // Drawer geometry: 320px right rail on sm+, full-screen below.
  assert.match(d, /sm:w-\[320px\]/)
  assert.match(d, /inset-0/)
})

test('header carries the ▣ entry between share and account', () => {
  const h = src('src/components/TerminalTickerHeader.tsx')
  assert.ok(h.includes('▣'))
  assert.match(h, /aria-haspopup="dialog"/)
  // Placement: after the share button inside the controls cluster.
  assert.ok(h.indexOf('ShareButton') < h.indexOf('▣'))
})
