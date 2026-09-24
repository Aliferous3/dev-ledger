import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'

// Behavioral security tests — the handlers run for real against an
// in-memory PostgREST-compatible fake and real iron-session cookies.
// These prove the boundary (session revocation, tenant isolation, replay
// dedup, destructive scoping) rather than asserting on source strings.
//
// Env must be set BEFORE the app modules load (config.mjs snapshots env at
// import), hence dynamic imports below.

process.env.GITHUB_WEBHOOK_SECRET = 'test-webhook-secret-do-not-use'
process.env.SESSION_SECRET = 'test-session-secret-at-least-32-characters-long'

const { __setSupabaseForTests } = await import('../lib/db.mjs')
const { getSession } = await import('../lib/auth.mjs')
const { requireUser } = await import('../lib/require-user.mjs')
const sessions = await import('../lib/sessions.mjs')
const { sessionLeaseMs, appUrl } = await import('../lib/config.mjs')
const syncHandler = (await import('../api/sync.mjs')).default
const syncRangeHandler = (await import('../api/sync-range.mjs')).default
const cronHandler = (await import('../api/cron/sync.mjs')).default
const setupHandler = (await import('../api/setup.mjs')).default
const heartbeatHandler = (await import('../api/auth/heartbeat.mjs')).default
const logoutHandler = (await import('../api/auth/logout.mjs')).default
const userHandler = (await import('../api/user.mjs')).default
const dashboardHandler = (await import('../api/dashboard.mjs')).default
const disconnectHandler = userHandler
const webhookHandler = (await import('../api/webhooks/github.mjs')).default
const healthHandler = (await import('../api/health.mjs')).default

// The configured application origin — what a real browser sends on the
// app's own POST/DELETE fetches.
const ORIGIN = new URL(appUrl).origin

/* ── in-memory supabase-js fake ─────────────────────────────────────── */

// unique-key sets for upsert/ignoreDuplicates conflict detection
const UNIQUE = {
  users: [['github_user_id']],
  github_installations: [['user_id', 'installation_id']],
  repositories: [['id'], ['user_id', 'github_repo_id']],
  commits: [['id'], ['user_id', 'github_sha']],
  pull_requests: [['id'], ['user_id', 'github_pr_id']],
  repo_sync: [['user_id', 'repository_id']],
  user_sync: [['user_id']],
  repo_coverage: [['id'], ['user_id', 'repository_id', 'covered_from']],
  sync_state: [['id'], ['user_id', 'repository_id']],
  repository_languages: [['id']],
  auth_sessions: [['sid']],
  webhook_deliveries: [['delivery_id']],
  dash_repo_monthly: [],
  dash_span: [],
}

function cmpOp(col, op, val) {
  const v = val === 'null' ? null : val
  switch (op) {
    case 'eq': return (r) => r[col] === v
    case 'neq': return (r) => r[col] !== v
    case 'is': return (r) => (v === null ? r[col] == null : r[col] === v)
    case 'lt': return (r) => r[col] != null && r[col] < v
    case 'lte': return (r) => r[col] != null && r[col] <= v
    case 'gt': return (r) => r[col] != null && r[col] > v
    case 'gte': return (r) => r[col] != null && r[col] >= v
    default: throw new Error(`fake db: unsupported or() op ${op}`)
  }
}

function makeDb() {
  const store = new Map() // table -> rows[]
  const calls = [] // mutation audit log: {op, table}
  const t = (name) => store.get(name) || store.set(name, []).get(name)

  function exec(name, q) {
    const rows = t(name)
    const match = (r) => q.filters.every((f) => f(r))
    calls.push({ op: q.op, table: name })
    if (q.op === 'insert' || q.op === 'upsert') {
      const inserted = []
      for (const row of q.rows) {
        const keys = q.onConflict ? [q.onConflict.split(',')] : UNIQUE[name] || []
        const hit = rows.find((r) => keys.some((ks) => ks.every((k) => r[k] !== undefined && r[k] === row[k])))
        if (hit) {
          if (q.op === 'upsert' && !q.ignore) Object.assign(hit, row)
          continue // conflict — upsert merged or insert ignored
        }
        const copy = { ...row }
        if (copy.id === undefined && name !== 'auth_sessions' && name !== 'webhook_deliveries') {
          copy.id = crypto.randomUUID()
        }
        rows.push(copy)
        inserted.push(copy)
      }
      return { data: q.selectAfter ? inserted : null, error: null }
    }
    if (q.op === 'update') {
      let n = 0
      for (const r of rows) if (match(r)) { Object.assign(r, q.sets); n++ }
      return { data: q.selectAfter ? rows.filter(match) : null, error: null, count: n }
    }
    if (q.op === 'delete') {
      const keep = rows.filter((r) => !match(r))
      store.set(name, keep)
      return { data: null, error: null, count: rows.length - keep.length }
    }
    // select
    let out = rows.filter(match)
    if (q.orderBy) {
      out = [...out].sort((a, b) =>
        (a[q.orderBy.c] < b[q.orderBy.c] ? -1 : 1) * (q.orderBy.asc ? 1 : -1))
    }
    if (q.lim != null) out = out.slice(0, q.lim)
    return { data: out, error: null, count: out.length }
  }

  function from(name) {
    const q = {
      op: 'select', filters: [], sets: null, rows: [], orderBy: null, lim: null,
      onConflict: null, ignore: false, selectAfter: false,
    }
    const self = {
      select(cols, opts = {}) {
        if (q.op === 'select') q.selectAfter = true
        else q.selectAfter = true // select() after insert/upsert returns rows
        q.cols = cols; q.countMode = opts.count; q.head = opts.head
        return self
      },
      insert(r, opts = {}) { q.op = 'insert'; q.rows = Array.isArray(r) ? r : [r]; q.onConflict = opts.onConflict; q.ignore = opts.ignoreDuplicates === true; return self },
      upsert(r, opts = {}) { q.op = 'upsert'; q.rows = Array.isArray(r) ? r : [r]; q.onConflict = opts.onConflict; q.ignore = opts.ignoreDuplicates === true; return self },
      update(s) { q.op = 'update'; q.sets = s; return self },
      delete() { q.op = 'delete'; return self },
      eq: (c, v) => (q.filters.push(cmpOp(c, 'eq', v)), self),
      neq: (c, v) => (q.filters.push(cmpOp(c, 'neq', v)), self),
      is: (c, v) => (q.filters.push(cmpOp(c, 'is', v)), self),
      in: (c, vs) => (q.filters.push((r) => vs.includes(r[c])), self),
      lt: (c, v) => (q.filters.push(cmpOp(c, 'lt', v)), self),
      lte: (c, v) => (q.filters.push(cmpOp(c, 'lte', v)), self),
      gt: (c, v) => (q.filters.push(cmpOp(c, 'gt', v)), self),
      gte: (c, v) => (q.filters.push(cmpOp(c, 'gte', v)), self),
      or(expr) {
        const parts = expr.split(',').map((p) => {
          const i = p.indexOf('.'); const j = p.indexOf('.', i + 1)
          return cmpOp(p.slice(0, i), p.slice(i + 1, j), p.slice(j + 1))
        })
        q.filters.push((r) => parts.some((f) => f(r)))
        return self
      },
      order(c, o = {}) { q.orderBy = { c, asc: o.ascending !== false }; return self },
      limit(n) { q.lim = n; return self },
      maybeSingle() { const { data } = exec(name, q); return Promise.resolve({ data: data?.[0] ?? null, error: null }) },
      single() { const { data } = exec(name, q); const row = data?.[0] ?? null; return Promise.resolve({ data: row, error: row ? null : { message: 'PGRST116' } }) },
      then(res, rej) { Promise.resolve(exec(name, q)).then(res, rej) },
    }
    return self
  }

  // Minimal but real implementations of the dashboard RPCs — the same
  // aggregation the SQL performs, scoped by p_user. This makes the
  // isolation assertions behavioral.
  function rpc(fn, p = {}) {
    const commits = t('commits').filter((c) => c.user_id === p.p_user)
    const inRange = (iso) =>
      (!p.p_from || iso >= `${p.p_from}T00:00:00`) &&
      (!p.p_to || iso < `${p.p_to}T23:59:59.999`)
    const ranged = commits.filter((c) => inRange(c.committed_at))
    if (fn === 'dash_daily') {
      const m = new Map()
      for (const c of ranged) {
        const d = c.committed_at.slice(0, 10)
        const r = m.get(d) || { date: d, commits: 0, additions: 0, deletions: 0 }
        r.commits++; r.additions += c.additions || 0; r.deletions += c.deletions || 0
        m.set(d, r)
      }
      return Promise.resolve({ data: [...m.values()].sort((a, b) => a.date.localeCompare(b.date)), error: null })
    }
    if (fn === 'dash_repos') {
      const m = new Map()
      for (const c of ranged.filter((c) => c.repository_id)) {
        const r = m.get(c.repository_id) || { repository_id: c.repository_id, commits: 0, additions: 0, deletions: 0, last_commit_at: c.committed_at }
        r.commits++; r.additions += c.additions || 0; r.deletions += c.deletions || 0
        if (c.committed_at > r.last_commit_at) r.last_commit_at = c.committed_at
        m.set(c.repository_id, r)
      }
      return Promise.resolve({ data: [...m.values()], error: null })
    }
    if (fn === 'dash_rhythm') {
      const m = new Map()
      for (const c of ranged) {
        const d = new Date(c.committed_at)
        const k = `${d.getUTCDay()}:${d.getUTCHours()}`
        m.set(k, (m.get(k) || 0) + 1)
      }
      const data = [...m.entries()].map(([k, n]) => {
        const [weekday, hour] = k.split(':').map(Number)
        return { weekday, hour, commits: n }
      })
      return Promise.resolve({ data, error: null })
    }
    return Promise.resolve({ data: [], error: null })
  }

  return { from, rpc, calls, store, t }
}

let db
before(() => { db = makeDb(); __setSupabaseForTests(db) })

/* ── req/res/session helpers ────────────────────────────────────────── */

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
    redirect() { return this },
  }
}

function mockReq(o = {}) { return { method: 'GET', headers: {}, query: {}, ...o } }

function cookieFrom(res) {
  const sc = res.headers['set-cookie']
  const list = Array.isArray(sc) ? sc : sc ? [sc] : []
  return list.map((c) => c.split(';')[0]).join('; ')
}

// Mint a real sealed session cookie through the production code path.
async function mintSession({ userId, persistent = true }) {
  const res = mockRes()
  const req = mockReq()
  const s = await getSession(req, res, { persistent })
  s.userId = userId
  s.githubUserId = Math.floor(Math.random() * 1e9)
  s.githubLogin = `u-${userId.slice(0, 6)}`
  s.persistent = persistent
  s.sid = await sessions.createAuthSession(userId, { persistent })
  if (!persistent && sessionLeaseMs > 0) s.leaseUntil = Date.now() + sessionLeaseMs
  await s.save()
  return { cookie: cookieFrom(res), sid: s.sid }
}

function seedUser(login) {
  const id = crypto.randomUUID()
  db.t('users').push({ id, github_user_id: Math.floor(Math.random() * 9e17) + 1e17, github_login: login })
  return id
}

function seedRepo(userId, name) {
  const id = crypto.randomUUID()
  const row = {
    id, user_id: userId, github_repo_id: Math.floor(Math.random() * 9e17) + 1e17,
    owner_login: 'x', name, full_name: `x/${name}`, private: false,
  }
  db.t('repositories').push(row)
  return row
}

function seedCommit(userId, repositoryId, sha, at = new Date().toISOString()) {
  db.t('commits').push({
    id: crypto.randomUUID(), user_id: userId, repository_id: repositoryId,
    github_sha: sha, committed_at: at, additions: 5, deletions: 1,
  })
}

/* ── WS6: server-side session revocation ────────────────────────────── */

test('session: valid persistent cookie authenticates', async () => {
  const userId = seedUser('sess-a')
  const { cookie } = await mintSession({ userId, persistent: true })
  const res = mockRes()
  const uid = await requireUser(mockReq({ headers: { cookie } }), res)
  assert.equal(uid, userId)
  assert.equal(res.statusCode, 200)
})

test('session: tampered cookie fails closed', async () => {
  const userId = seedUser('sess-b')
  const { cookie } = await mintSession({ userId })
  const forged = cookie.slice(0, -6) + 'AAAAAA'
  const res = mockRes()
  const uid = await requireUser(mockReq({ headers: { cookie: forged } }), res)
  assert.equal(uid, null)
  assert.equal(res.statusCode, 401)
})

test('session: revoked sid fails even with a valid cookie', async () => {
  const userId = seedUser('sess-c')
  const { cookie, sid } = await mintSession({ userId, persistent: true })
  await sessions.revokeSession(sid)
  const res = mockRes()
  assert.equal(await requireUser(mockReq({ headers: { cookie } }), res), null)
  assert.equal(res.statusCode, 401)
})

test('session: revokeAllSessions kills a 30-day persistent cookie', async () => {
  const userId = seedUser('sess-d')
  const { cookie } = await mintSession({ userId, persistent: true })
  // sanity: works before revocation
  assert.equal(await requireUser(mockReq({ headers: { cookie } }), mockRes()), userId)
  await sessions.revokeAllSessions(userId)
  assert.equal(await requireUser(mockReq({ headers: { cookie } }), mockRes()), null)
})

test('session: pre-migration sid-less cookie fails closed', async () => {
  const userId = seedUser('sess-e')
  const res = mockRes()
  const s = await getSession(mockReq(), res, { persistent: true })
  s.userId = userId
  s.persistent = true
  // no sid — legacy cookie shape
  await s.save()
  const cookie = cookieFrom(res)
  assert.equal(await requireUser(mockReq({ headers: { cookie } }), mockRes()), null)
})

test('session: logout revokes server-side, not just the cookie', async () => {
  const userId = seedUser('sess-f')
  const { cookie, sid } = await mintSession({ userId })
  const res = mockRes()
  await logoutHandler(mockReq({ method: 'POST', headers: { cookie, origin: ORIGIN } }), res)
  assert.equal(res.statusCode, 200)
  assert.equal(await sessions.isSessionLive(sid), false)
  // the same cookie can never authenticate again
  assert.equal(await requireUser(mockReq({ headers: { cookie } }), mockRes()), null)
})

test('session: DELETE MY DATA revokes all sessions and deletes user rows', async () => {
  const userId = seedUser('sess-g')
  const { cookie, sid } = await mintSession({ userId, persistent: true })
  const res = mockRes()
  await userHandler(mockReq({ method: 'DELETE', headers: { cookie, origin: ORIGIN }, url: '/api/user?confirm=1' }), res)
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.deleted, true)
  assert.equal(await sessions.isSessionLive(sid), false)
  assert.equal(db.t('users').find((u) => u.id === userId), undefined)
  assert.equal(await requireUser(mockReq({ headers: { cookie } }), mockRes()), null)
})

test('session: heartbeat renews live non-persistent lease; rejects revoked', async () => {
  const userId = seedUser('sess-h')
  const { cookie, sid } = await mintSession({ userId, persistent: false })

  const res = mockRes()
  await heartbeatHandler(mockReq({ method: 'POST', headers: { cookie, origin: ORIGIN } }), res)
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.ok, true)
  assert.ok(res.body.leaseUntil > Date.now(), 'lease renewed forward')
  assert.ok(cookieFrom(res).includes('dev_ledger_session'), 're-sealed cookie emitted')

  // GET must never renew
  const getRes = mockRes()
  await heartbeatHandler(mockReq({ method: 'GET', headers: { cookie } }), getRes)
  assert.equal(getRes.statusCode, 405)

  // revoked session cannot renew
  await sessions.revokeSession(sid)
  const res2 = mockRes()
  await heartbeatHandler(mockReq({ method: 'POST', headers: { cookie, origin: ORIGIN } }), res2)
  assert.equal(res2.statusCode, 401)
})

test('session: /api/user reports revoked session as unauthenticated', async () => {
  const userId = seedUser('sess-i')
  const { cookie, sid } = await mintSession({ userId })
  const res = mockRes()
  await userHandler(mockReq({ headers: { cookie } }), res)
  assert.equal(res.body.authenticated, true)
  await sessions.revokeSession(sid)
  const res2 = mockRes()
  await userHandler(mockReq({ headers: { cookie } }), res2)
  assert.equal(res2.statusCode, 401)
  assert.equal(res2.body.authenticated, false)
})

/* ── WS4: tenant isolation through the real handlers ────────────────── */

test('isolation: dashboard returns only the session user\'s data', async () => {
  const a = seedUser('iso-a')
  const b = seedUser('iso-b')
  const repoA = seedRepo(a, 'alpha-repo')
  const repoB = seedRepo(b, 'beta-repo')
  const now = new Date().toISOString()
  seedCommit(a, repoA.id, 'a1', now)
  seedCommit(a, repoA.id, 'a2', now)
  seedCommit(b, repoB.id, 'b1', now)

  const { cookie } = await mintSession({ userId: a, persistent: true })
  const res = mockRes()
  // hostile client-supplied user_id must be ignored — session wins
  await dashboardHandler(mockReq({ headers: { cookie }, query: { range: 'all', user_id: b } }), res)
  assert.equal(res.statusCode, 200)
  const names = res.body.repositories.map((r) => r.name)
  assert.deepEqual(names, ['alpha-repo'])
  assert.equal(res.body.summary.commits, 2, 'user A sees exactly their own commits')
  assert.equal(res.body.summary.repos, 1)
})

test('isolation: disconnected rows still visible to owner, never to others', async () => {
  const a = seedUser('iso-c')
  const b = seedUser('iso-d')
  const repoA = seedRepo(a, 'kept-repo')
  repoA.disconnected_at = new Date().toISOString()
  repoA.disconnect_source = 'user'
  seedRepo(b, 'other-repo')
  seedCommit(a, repoA.id, 'k1', new Date().toISOString())
  const { cookie } = await mintSession({ userId: b, persistent: true })
  const res = mockRes()
  await dashboardHandler(mockReq({ headers: { cookie }, query: { range: 'all' } }), res)
  assert.deepEqual(res.body.repositories.map((r) => r.name), ['other-repo'])
})

/* ── WS10: repository disconnection — keep/delete/resume ────────────── */

test('disconnect: unauthenticated is rejected', async () => {
  const res = mockRes()
  await disconnectHandler(mockReq({ method: 'POST', headers: { origin: ORIGIN }, body: { repositoryId: 'x', mode: 'delete' } }), res)
  assert.equal(res.statusCode, 401)
})

test('disconnect: keep stops sync but preserves history', async () => {
  const a = seedUser('dc-a')
  const repo = seedRepo(a, 'keepme')
  seedCommit(a, repo.id, 'k1')
  db.t('repo_sync').push({ user_id: a, repository_id: repo.id, phase: 'done' })
  db.t('repository_languages').push({ id: crypto.randomUUID(), repository_id: repo.id, language: 'TS', bytes: 100 })

  const { cookie } = await mintSession({ userId: a, persistent: true })
  const res = mockRes()
  await disconnectHandler(mockReq({ method: 'POST', headers: { cookie, origin: ORIGIN }, body: { repositoryId: repo.id, mode: 'keep' } }), res)
  assert.equal(res.statusCode, 200)
  const row = db.t('repositories').find((r) => r.id === repo.id)
  assert.ok(row.disconnected_at, 'repo marked disconnected')
  assert.equal(row.disconnect_source, 'user')
  assert.ok(db.t('commits').some((c) => c.repository_id === repo.id), 'history preserved')
  assert.ok(db.t('repository_languages').some((l) => l.repository_id === repo.id), 'languages preserved')
})

test('disconnect: delete removes only that repo\'s rows for that user', async () => {
  const a = seedUser('dc-b')
  const repo1 = seedRepo(a, 'delete-me')
  const repo2 = seedRepo(a, 'stay')
  seedCommit(a, repo1.id, 'd1')
  seedCommit(a, repo2.id, 's1')
  db.t('pull_requests').push({ id: crypto.randomUUID(), user_id: a, repository_id: repo1.id, github_pr_id: 11, number: 1, state: 'merged', created_at: new Date().toISOString() })
  db.t('pull_requests').push({ id: crypto.randomUUID(), user_id: a, repository_id: repo2.id, github_pr_id: 22, number: 2, state: 'open', created_at: new Date().toISOString() })
  db.t('repo_sync').push({ user_id: a, repository_id: repo1.id, phase: 'done' })
  db.t('repo_coverage').push({ id: crypto.randomUUID(), user_id: a, repository_id: repo1.id, covered_from: '2024-01-01', covered_to: '2024-06-01', complete: false })
  db.t('repository_languages').push({ id: crypto.randomUUID(), repository_id: repo1.id, language: 'TS', bytes: 1 })

  const { cookie } = await mintSession({ userId: a, persistent: true })
  const res = mockRes()
  await disconnectHandler(mockReq({ method: 'POST', headers: { cookie, origin: ORIGIN }, body: { repositoryId: repo1.id, mode: 'delete' } }), res)
  assert.equal(res.statusCode, 200)

  assert.equal(db.t('repositories').find((r) => r.id === repo1.id), undefined, 'repo row gone')
  assert.equal(db.t('commits').filter((c) => c.repository_id === repo1.id).length, 0, 'commits gone')
  assert.equal(db.t('pull_requests').filter((p) => p.repository_id === repo1.id).length, 0, 'PRs gone')
  assert.equal(db.t('repo_sync').filter((s) => s.repository_id === repo1.id).length, 0)
  assert.equal(db.t('repo_coverage').filter((c) => c.repository_id === repo1.id).length, 0)
  assert.equal(db.t('repository_languages').filter((l) => l.repository_id === repo1.id).length, 0)
  // unrelated repo of the same user untouched
  assert.ok(db.t('repositories').some((r) => r.id === repo2.id))
  assert.ok(db.t('commits').some((c) => c.repository_id === repo2.id))
})

test('disconnect: user A cannot disconnect or delete user B\'s repository', async () => {
  const a = seedUser('dc-c')
  const b = seedUser('dc-d')
  const repoB = seedRepo(b, 'victim')
  seedCommit(b, repoB.id, 'v1')

  const { cookie } = await mintSession({ userId: a, persistent: true })
  for (const mode of ['keep', 'delete']) {
    const res = mockRes()
    await disconnectHandler(mockReq({ method: 'POST', headers: { cookie, origin: ORIGIN }, body: { repositoryId: repoB.id, mode } }), res)
    assert.equal(res.statusCode, 404, `mode=${mode} must not reach foreign repo`)
  }
  // nothing changed
  const row = db.t('repositories').find((r) => r.id === repoB.id)
  assert.equal(row.disconnected_at, undefined)
  assert.ok(db.t('commits').some((c) => c.repository_id === repoB.id))
})

test('disconnect: client-supplied user_id in body is ignored', async () => {
  const a = seedUser('dc-e')
  const b = seedUser('dc-f')
  const repoB = seedRepo(b, 'body-forge')
  const { cookie } = await mintSession({ userId: a, persistent: true })
  const res = mockRes()
  await disconnectHandler(mockReq({
    method: 'POST', headers: { cookie, origin: ORIGIN },
    body: { repositoryId: repoB.id, mode: 'delete', user_id: a }, // forged owner claim
  }), res)
  assert.equal(res.statusCode, 404)
  assert.ok(db.t('repositories').some((r) => r.id === repoB.id))
})

test('disconnect: resume clears a retained disconnect', async () => {
  const a = seedUser('dc-g')
  const repo = seedRepo(a, 'resume-me')
  repo.disconnected_at = new Date().toISOString()
  repo.disconnect_source = 'user'
  const { cookie } = await mintSession({ userId: a, persistent: true })
  const res = mockRes()
  await disconnectHandler(mockReq({ method: 'POST', headers: { cookie, origin: ORIGIN }, body: { repositoryId: repo.id, mode: 'resume' } }), res)
  assert.equal(res.statusCode, 200)
  const row = db.t('repositories').find((r) => r.id === repo.id)
  assert.equal(row.disconnected_at, null)
  assert.equal(row.disconnect_source, null)
})

/* ── WS7: webhook replay dedup ──────────────────────────────────────── */

function webhookReq(payload, { delivery, secret = process.env.GITHUB_WEBHOOK_SECRET, event = 'ping' } = {}) {
  const raw = Buffer.from(JSON.stringify(payload))
  const sig = 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex')
  const req = mockReq({
    method: 'POST',
    headers: {
      'x-hub-signature-256': sig,
      'x-github-event': event,
      ...(delivery ? { 'x-github-delivery': delivery } : {}),
    },
  })
  req[Symbol.asyncIterator] = async function* () { yield raw }
  return req
}

test('webhook: invalid signature rejected before dedup', async () => {
  const res = mockRes()
  await webhookHandler(webhookReq({}, { secret: 'wrong', delivery: 'd0' }), res)
  assert.equal(res.statusCode, 401)
})

test('webhook: first delivery processed, exact replay is a duplicate no-op', async () => {
  const a = seedUser('wh-a')
  const repo = seedRepo(a, 'removed-repo')
  db.t('github_installations').push({ id: crypto.randomUUID(), user_id: a, installation_id: 4242 })
  const payload = {
    action: 'removed',
    installation: { id: 4242 },
    repositories_removed: [{ id: repo.github_repo_id }],
    repositories_added: [],
  }
  const delivery = crypto.randomUUID()

  const res1 = mockRes()
  await webhookHandler(webhookReq(payload, { delivery, event: 'installation_repositories' }), res1)
  assert.equal(res1.statusCode, 200)
  assert.equal(res1.body.ok, true)
  assert.ok(db.t('repositories').find((r) => r.id === repo.id).disconnected_at, 'first delivery marked repo')
  assert.equal(db.t('repositories').find((r) => r.id === repo.id).disconnect_source, 'github')

  const mutationsAfterFirst = db.calls.length
  const res2 = mockRes()
  await webhookHandler(webhookReq(payload, { delivery, event: 'installation_repositories' }), res2)
  assert.equal(res2.statusCode, 200)
  assert.equal(res2.body.duplicate, true)
  // the replay is acknowledged without re-running the business mutation
  // telemetry writes (security_events) are not business mutations
  const replays = db.calls.slice(mutationsAfterFirst).filter((c) => c.table !== 'webhook_deliveries' && c.table !== 'security_events')
  assert.equal(replays.length, 0, 'replay applied no business mutations')
})

test('webhook: a different delivery id for the same payload processes normally', async () => {
  const res = mockRes()
  await webhookHandler(webhookReq({}, { delivery: crypto.randomUUID(), event: 'ping' }), res)
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.ok, true)
  assert.equal(res.body.duplicate, undefined)
})

/* ── WS8: minimal public health ─────────────────────────────────────── */

test('health: public response is minimal — no auth/db/env disclosure', async () => {
  const res = mockRes()
  await healthHandler(mockReq(), res)
  assert.equal(res.statusCode, 200)
  assert.deepEqual(Object.keys(res.body), ['ok'])
  assert.equal(res.body.ok, true)
})

/* ── WS3 guards: migration states the security posture ──────────────── */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('migration: RLS + revokes + invoker functions + new tables present', () => {
  const sql = readFileSync(path.join(ROOT, 'migrations/007_security_hardening.sql'), 'utf8')
  // every user-data table has RLS enabled
  for (const tbl of ['users', 'github_installations', 'repositories', 'repository_languages',
    'commits', 'pull_requests', 'repo_sync', 'user_sync', 'repo_coverage']) {
    assert.match(sql, new RegExp(`alter table public\\.${tbl}\\s+enable row level security`), `RLS missing on ${tbl}`)
  }
  // privileged RPCs are invoker-side now, granted only to service_role
  for (const fn of ['dash_daily', 'dash_repos', 'dash_rhythm']) {
    assert.match(sql, new RegExp(`${fn}\\([\\s\\S]*?security invoker`, 'i'), `${fn} not security invoker`)
    assert.match(sql, new RegExp(`revoke all on function public\\.${fn}`), `${fn} not revoked`)
    assert.match(sql, new RegExp(`grant execute on function public\\.${fn}[\\s\\S]*?to service_role`), `${fn} not granted to service_role`)
  }
  // browser roles lose everything; views pinned invoker
  assert.match(sql, /revoke all on all tables\s+in schema public from public, anon, authenticated/)
  assert.match(sql, /security_invoker = on/)
  // new tables exist with RLS
  assert.match(sql, /create table if not exists public\.auth_sessions/)
  assert.match(sql, /alter table public\.auth_sessions enable row level security/)
  assert.match(sql, /create table if not exists public\.webhook_deliveries/)
  assert.match(sql, /alter table public\.webhook_deliveries enable row level security/)
  assert.match(sql, /add column if not exists disconnected_at/)
})

/* ── same-origin / CSRF hardening ───────────────────────────────────── */

const FOREIGN = 'https://evil.example'
const fetchSite = (v) => (v ? { 'sec-fetch-site': v } : {})

// The protected browser-mutation surface. Each entry invokes the handler
// with a valid session cookie + the headers under test.
async function protectedRoutes(userId) {
  const { cookie } = await mintSession({ userId, persistent: true })
  return [
    {
      name: 'POST /api/sync',
      call: async (headers) => { const res = mockRes(); await syncHandler(mockReq({ method: 'POST', headers: { cookie, ...headers }, url: '/api/sync' }), res); return res },
    },
    {
      name: 'POST /api/sync-range',
      call: async (headers) => { const res = mockRes(); await syncRangeHandler(mockReq({ method: 'POST', headers: { cookie, ...headers }, url: '/api/sync-range?from=2024-01-01&to=2024-01-31' }), res); return res },
    },
    {
      name: 'POST /api/user (disconnect)',
      call: async (headers) => { const res = mockRes(); await userHandler(mockReq({ method: 'POST', headers: { cookie, ...headers }, body: { repositoryId: 'x', mode: 'keep' } }), res); return res },
    },
    {
      name: 'DELETE /api/user',
      call: async (headers) => { const res = mockRes(); await userHandler(mockReq({ method: 'DELETE', headers: { cookie, ...headers }, url: '/api/user?confirm=1' }), res); return res },
    },
    {
      name: 'POST /api/auth/heartbeat',
      call: async (headers) => { const res = mockRes(); await heartbeatHandler(mockReq({ method: 'POST', headers: { cookie, ...headers } }), res); return res },
    },
    {
      name: 'POST /api/auth/logout',
      call: async (headers) => { const res = mockRes(); await logoutHandler(mockReq({ method: 'POST', headers: { cookie, ...headers } }), res); return res },
    },
  ]
}

test('same-origin: every protected mutation accepts the configured origin', async () => {
  const userId = seedUser('so-ok')
  for (const route of await protectedRoutes(userId)) {
    const res = await route.call({ origin: ORIGIN, 'sec-fetch-site': 'same-origin' })
    assert.notEqual(res.statusCode, 403, `${route.name} rejected a valid same-origin request`)
    assert.notEqual(res.statusCode, 405, `${route.name} should accept POST`)
  }
})

test('same-origin: foreign / malformed / missing Origin => 403 everywhere', async () => {
  const userId = seedUser('so-bad')
  for (const route of await protectedRoutes(userId)) {
    for (const headers of [{ origin: FOREIGN }, { origin: 'not-a-url' }, {}]) {
      const res = await route.call(headers)
      assert.equal(res.statusCode, 403, `${route.name} accepted origin=${headers.origin ?? '<missing>'}`)
      assert.deepEqual(res.body, { error: 'Forbidden' })
    }
  }
})

test('same-origin: Sec-Fetch-Site must be exactly same-origin when present', async () => {
  const userId = seedUser('so-sfs')
  for (const route of await protectedRoutes(userId)) {
    for (const v of ['cross-site', 'same-site', 'none']) {
      const res = await route.call({ origin: ORIGIN, 'sec-fetch-site': v })
      assert.equal(res.statusCode, 403, `${route.name} accepted Sec-Fetch-Site: ${v}`)
    }
    // absent is tolerated (older browsers); present+same-origin passes
    const res = await route.call({ origin: ORIGIN })
    assert.notEqual(res.statusCode, 403, `${route.name} rejected absent Sec-Fetch-Site with valid Origin`)
  }
})

test('ordering: cross-site DELETE /api/user revokes nothing, deletes nothing', async () => {
  const userId = seedUser('so-victim')
  const { cookie, sid } = await mintSession({ userId, persistent: true })
  const mutationsBefore = db.calls.length
  const res = mockRes()
  await userHandler(mockReq({
    method: 'DELETE', headers: { cookie, origin: FOREIGN }, url: '/api/user?confirm=1',
  }), res)
  assert.equal(res.statusCode, 403)
  // security telemetry writes are expected — the guard must run zero
  // *user-data* operations.
  assert.equal(
    db.calls.slice(mutationsBefore).filter((c) => c.table !== 'security_events').length,
    0, 'cross-site request ran zero user-data DB operations'
  )
  assert.equal(await sessions.isSessionLive(sid), true, 'session must NOT be revoked by a forged request')
  assert.ok(db.t('users').some((u) => u.id === userId), 'user row must survive')
})

test('ordering: cross-site logout does not revoke the victim session', async () => {
  const userId = seedUser('so-victim2')
  const { cookie, sid } = await mintSession({ userId })
  const res = mockRes()
  await logoutHandler(mockReq({ method: 'POST', headers: { cookie, origin: FOREIGN } }), res)
  assert.equal(res.statusCode, 403)
  assert.equal(await sessions.isSessionLive(sid), true)
  // and the cookie was not destroyed either — no expiry Set-Cookie
  const sc = res.headers['set-cookie']
  assert.ok(!sc || !(Array.isArray(sc) ? sc : [sc]).some((c) => /Max-Age=0/.test(c)))
})

test('ordering: cross-site POST /api/user disconnect mutates nothing', async () => {
  const userId = seedUser('so-victim3')
  const repo = seedRepo(userId, 'csrf-target')
  const { cookie } = await mintSession({ userId })
  const res = mockRes()
  await userHandler(mockReq({
    method: 'POST', headers: { cookie, origin: FOREIGN },
    body: { repositoryId: repo.id, mode: 'delete' },
  }), res)
  assert.equal(res.statusCode, 403)
  const row = db.t('repositories').find((r) => r.id === repo.id)
  assert.ok(row, 'repo row untouched')
  assert.equal(row.disconnected_at, undefined)
})

// getSession() is NOT strictly read-only: an expired non-persistent lease
// calls session.destroy(), which emits a Set-Cookie expiry. Minting a
// session with leaseUntil already in the past therefore turns the presence
// of 'set-cookie' on the response into a probe for "session code ran".
async function mintExpiredLeaseSession(userId) {
  const res = mockRes()
  const s = await getSession(mockReq(), res, { persistent: false })
  s.userId = userId
  s.githubLogin = `u-${userId.slice(0, 6)}`
  s.persistent = false
  s.sid = await sessions.createAuthSession(userId, { persistent: false })
  s.leaseUntil = Date.now() - 60_000
  await s.save()
  return { cookie: cookieFrom(res), sid: s.sid }
}

test('ordering: cross-site POST/DELETE /api/user never reaches getSession', async () => {
  const userId = seedUser('so-presession')
  const { cookie, sid } = await mintExpiredLeaseSession(userId)

  for (const method of ['POST', 'DELETE']) {
    const before = db.calls.length
    const res = mockRes()
    await userHandler(mockReq({
      method,
      headers: { cookie, origin: FOREIGN },
      url: '/api/user?confirm=1',
      body: { repositoryId: 'x', mode: 'keep' },
    }), res)
    assert.equal(res.statusCode, 403, `${method} must be 403`)
    assert.deepEqual(res.body, { error: 'Forbidden' })
    assert.equal(res.headers['set-cookie'], undefined,
      `${method}: getSession ran — a destroy/expiry Set-Cookie was emitted on a forged request`)
    assert.equal(
      db.calls.slice(before).filter((c) => c.table !== 'security_events').length,
      0, `${method}: zero user-data DB operations`
    )
  }
  assert.equal(await sessions.isSessionLive(sid), true, 'sid must not be revoked')

  // Control: same expired-lease cookie, valid origin — getSession DOES run,
  // destroys the stale cookie (observable Set-Cookie), then 401s. This keeps
  // the 'no set-cookie' assertion above non-vacuous.
  const control = mockRes()
  await userHandler(mockReq({
    method: 'POST', headers: { cookie, origin: ORIGIN },
    body: { repositoryId: 'x', mode: 'keep' },
  }), control)
  assert.equal(control.statusCode, 401)
  const sc = control.headers['set-cookie']
  assert.ok(sc && (Array.isArray(sc) ? sc : [sc]).some((c) => /expires=|max-age=0/i.test(c)),
    'control: same-origin request must show the getSession destroy cookie — probe is live')
})

test('/api/user rejects unsupported methods 405 before touching the session', async () => {
  const userId = seedUser('so-405')
  const { cookie } = await mintExpiredLeaseSession(userId)
  const res = mockRes()
  await userHandler(mockReq({ method: 'PATCH', headers: { cookie } }), res)
  assert.equal(res.statusCode, 405)
  assert.equal(res.headers['set-cookie'], undefined, '405 path must not parse/emit session state')
})

/* ── method safety ──────────────────────────────────────────────────── */

test('logout: GET is rejected 405, POST is the only accepted method', async () => {
  const userId = seedUser('so-method')
  const { cookie } = await mintSession({ userId })
  const get = mockRes()
  await logoutHandler(mockReq({ method: 'GET', headers: { cookie, origin: ORIGIN } }), get)
  assert.equal(get.statusCode, 405)
  for (const m of ['PUT', 'DELETE']) {
    const r = mockRes()
    await logoutHandler(mockReq({ method: m, headers: { cookie, origin: ORIGIN } }), r)
    assert.equal(r.statusCode, 405, `${m} must be rejected`)
  }
  const post = mockRes()
  await logoutHandler(mockReq({ method: 'POST', headers: { cookie, origin: ORIGIN } }), post)
  assert.equal(post.statusCode, 200)
  assert.equal(post.body.ok, true)
})

test('read-only GETs require no Origin', async () => {
  const userId = seedUser('so-read')
  const { cookie } = await mintSession({ userId })
  // GET /api/sync — status read, no Origin needed
  const sync = mockRes()
  await syncHandler(mockReq({ method: 'GET', headers: { cookie } }), sync)
  assert.equal(sync.statusCode, 200)
  // GET /api/user — identity read
  const user = mockRes()
  await userHandler(mockReq({ method: 'GET', headers: { cookie } }), user)
  assert.equal(user.statusCode, 200)
  assert.equal(user.body.authenticated, true)
})

/* ── exemptions: server-to-server / redirect flows unguarded ────────── */

test('exempt: webhook rejects unsigned WITHOUT consulting origin (401 not 403)', async () => {
  const res = mockRes()
  await webhookHandler(webhookReq({}, { secret: 'wrong' }), res)
  assert.equal(res.statusCode, 401)
})

test('exempt: validly-signed webhook POST processes with no Origin header', async () => {
  const res = mockRes()
  await webhookHandler(webhookReq({}, { delivery: crypto.randomUUID(), event: 'ping' }), res)
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.ok, true)
})

test('exempt: cron sync authenticates by secret, not origin', async () => {
  // No secret configured → fail closed, but importantly NOT 403 (no origin check)
  const res = mockRes()
  await cronHandler(mockReq({ method: 'GET' }), res)
  assert.equal(res.statusCode, 401)
  assert.notEqual(res.statusCode, 403)
})

test('exempt: OAuth callback is a GitHub redirect — no Origin required', async () => {
  const res = mockRes()
  await import('../api/auth/callback.mjs').then((m) => m.default(mockReq({ method: 'GET', url: '/api/auth/callback' }), res))
  assert.equal(res.statusCode, 400) // bad/missing state — reached business logic, not 403
})

test('exempt: GitHub App setup redirect is not origin-gated', async () => {
  const res = mockRes()
  await setupHandler(mockReq({ method: 'GET', url: '/api/setup' }), res)
  assert.equal(res.statusCode, 302) // redirects to login — no 403
})

/* ── data minimization: webhook never persists PR title ─────────────── */

test('webhook: pull_request event persists no title column', async () => {
  const a = seedUser('wh-pr')
  db.t('users').find((u) => u.id === a).github_user_id = 777
  const repo = seedRepo(a, 'pr-repo')
  db.t('github_installations').push({ id: crypto.randomUUID(), user_id: a, installation_id: 9090 })
  const payload = {
    action: 'opened',
    installation: { id: 9090 },
    repository: { id: repo.github_repo_id },
    pull_request: {
      id: 555, number: 7, state: 'open',
      title: 'SECRET PR TITLE THAT MUST NOT BE STORED',
      created_at: new Date().toISOString(),
      merged_at: null, closed_at: null,
      user: { id: 777, login: 'wh-pr' },
    },
  }
  const res = mockRes()
  await webhookHandler(webhookReq(payload, { delivery: crypto.randomUUID(), event: 'pull_request' }), res)
  assert.equal(res.statusCode, 200)
  const row = db.t('pull_requests').find((p) => p.github_pr_id === 555)
  assert.ok(row, 'PR row was upserted')
  assert.ok(!('title' in row), 'PR title must never be persisted')
  // nothing in the store contains the title text
  for (const [tbl, rows] of db.store) {
    for (const r of rows) {
      assert.ok(!JSON.stringify(r).includes('SECRET PR TITLE'), `${tbl} leaked PR title`)
    }
  }
})

test('webhook source: handler contains no PR title write', () => {
  const src = readFileSync(path.join(ROOT, 'api/webhooks/github.mjs'), 'utf8')
  // no `title:` key in the pull_requests upsert (comment mentions are ok)
  const upsertBlock = src.match(/pull_requests'\)\.upsert\(\{[\s\S]*?\}\)/)?.[0] ?? ''
  assert.doesNotMatch(upsertBlock, /title\s*:/, 'webhook writes pull_requests.title')
})
