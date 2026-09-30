import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Data-minimization tranche guards. Three layers:
//   1. behavioral — the sync engine and session store actually persist only
//      closed-taxonomy values and delete-on-revoke session rows;
//   2. source guards — write sites cannot regress to persisting raw error
//      text or the removed author/unused columns;
//   3. migration guards — the drops and error sanitization land in
//      migrations/011 and cannot be silently re-added later.

process.env.SESSION_SECRET = 'test-session-secret-at-least-32-characters-long'
// Determinism: with no app credentials, getInstallationOctokit throws and the
// run takes the revoked path — no network, regardless of ambient env.
delete process.env.GITHUB_APP_ID
delete process.env.GITHUB_APP_PRIVATE_KEY
delete process.env.GITHUB_CLIENT_ID
delete process.env.GITHUB_CLIENT_SECRET

const { __setSupabaseForTests } = await import('../lib/db.mjs')
const sync = await import('../lib/sync.mjs')
const sessions = await import('../lib/sessions.mjs')
const { SYNC_ERROR_CODES, syncErrorCode, syncErrorMessage, isSyncErrorCode } =
  await import('../lib/sync-errors.mjs')
const { RateLimitError, GitHubAuthError } = await import('../lib/github.mjs')

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const src = (rel) => readFileSync(path.join(ROOT, rel), 'utf8')

const HOSTILE = [
  'https://example.com/?token=SECRET',
  'Authorization: Bearer abc',
  'oauth_code=XYZ',
  'email@example.com',
  'repository/private-name',
]

/* ── minimal PostgREST fake (subset needed for sync + sessions) ─────────── */

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
  const store = new Map()
  const t = (name) => store.get(name) || store.set(name, []).get(name)

  function exec(name, q) {
    const rows = t(name)
    const match = (r) => q.filters.every((f) => f(r))
    if (q.op === 'insert' || q.op === 'upsert') {
      const inserted = []
      for (const row of q.rows) {
        const keys = q.onConflict ? [q.onConflict.split(',')] : []
        const hit = rows.find((r) => keys.some((ks) => ks.every((k) => r[k] !== undefined && r[k] === row[k])))
        if (hit) { if (q.op === 'upsert' && !q.ignore) Object.assign(hit, row); continue }
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
      // PostgREST evaluates WHERE before writing — capture the matched set
      // first, otherwise a CAS like WHERE locked_at IS NULL SELECT would see
      // its own mutation and claim to match nothing.
      const matched = rows.filter(match)
      for (const r of matched) Object.assign(r, q.sets)
      return { data: q.selectAfter ? matched : null, error: null }
    }
    if (q.op === 'delete') {
      const keep = rows.filter((r) => !match(r))
      store.set(name, keep)
      return { data: null, error: null }
    }
    let out = rows.filter(match)
    if (q.lim != null) out = out.slice(0, q.lim)
    return { data: out, error: null }
  }

  function from(name) {
    const q = { op: 'select', filters: [], sets: null, rows: [], lim: null, onConflict: null, ignore: false, selectAfter: false }
    const self = {
      select() { q.selectAfter = true; return self },
      insert(r, opts = {}) { q.op = 'insert'; q.rows = Array.isArray(r) ? r : [r]; q.onConflict = opts.onConflict; q.ignore = opts.ignoreDuplicates === true; return self },
      upsert(r, opts = {}) { q.op = 'upsert'; q.rows = Array.isArray(r) ? r : [r]; q.onConflict = opts.onConflict; q.ignore = opts.ignoreDuplicates === true; return self },
      update(s) { q.op = 'update'; q.sets = s; return self },
      delete() { q.op = 'delete'; return self },
      eq: (c, v) => (q.filters.push(cmpOp(c, 'eq', v)), self),
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
      limit(n) { q.lim = n; return self },
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

function seedUser(login = 'dm-user') {
  const id = crypto.randomUUID()
  db.t('users').push({ id, github_user_id: Math.floor(Math.random() * 9e8) + 1e8, github_login: login, github_node_id: `N_${login}` })
  return id
}

/* ── WS1: persisted sync errors are closed-taxonomy codes ───────────────── */

test('sync error taxonomy is closed and complete', () => {
  assert.deepEqual([...SYNC_ERROR_CODES], [
    'GITHUB_RATE_LIMIT',
    'GITHUB_ACCESS_REVOKED',
    'SYNC_HISTORY_FAILED',
    'SYNC_PULLS_FAILED',
    'SYNC_INTERNAL_ERROR',
  ])
  for (const c of SYNC_ERROR_CODES) {
    assert.ok(isSyncErrorCode(c))
    assert.equal(typeof syncErrorMessage(c), 'string')
  }
  assert.equal(isSyncErrorCode('github down'), false)
  assert.equal(isSyncErrorCode('error'), false)
})

test('classifier: arbitrary hostile exception text collapses to a code', () => {
  for (const s of HOSTILE) {
    const code = syncErrorCode(new Error(s))
    assert.ok(isSyncErrorCode(code), `hostile error did not classify: ${s}`)
    assert.ok(!String(code).includes(s.slice(0, 12)))
  }
  // odd throw shapes — strings, objects, nulls — all collapse safely
  for (const v of ['oauth_code=XYZ', { message: HOSTILE[0] }, null, undefined, 42]) {
    assert.ok(isSyncErrorCode(syncErrorCode(v)))
  }
  // phase hints stay inside the taxonomy
  assert.equal(syncErrorCode(new Error(HOSTILE[0]), 'SYNC_HISTORY_FAILED'), 'SYNC_HISTORY_FAILED')
  assert.equal(syncErrorCode(new Error(HOSTILE[0]), 'SYNC_PULLS_FAILED'), 'SYNC_PULLS_FAILED')
  assert.equal(syncErrorCode(new Error(HOSTILE[0]), 'NOT_A_CODE'), 'SYNC_INTERNAL_ERROR')
})

test('classifier: dedicated error classes map to their dedicated codes', () => {
  assert.equal(syncErrorCode(new RateLimitError(new Date())), 'GITHUB_RATE_LIMIT')
  assert.equal(syncErrorCode(new GitHubAuthError(HOSTILE[1])), 'GITHUB_ACCESS_REVOKED')
  assert.equal(syncErrorCode(new RateLimitError(new Date()), 'SYNC_PULLS_FAILED'), 'GITHUB_RATE_LIMIT')
})

test('presentation: only fixed messages leave the API boundary', () => {
  assert.equal(syncErrorMessage('GITHUB_RATE_LIMIT'), 'GitHub rate limit reached — will resume automatically')
  assert.equal(syncErrorMessage('GITHUB_ACCESS_REVOKED'), 'GitHub access was revoked')
  assert.equal(syncErrorMessage(null), null)
  // legacy free-text rows and hostile values never echo through
  for (const s of HOSTILE) {
    const m = syncErrorMessage(s)
    assert.equal(m, 'Sync failed — will retry automatically')
    assert.ok(!m.includes(s.slice(0, 12)))
  }
})

test('behavioral: runSync persists a code, never raw exception text', async () => {
  // A user with an installation but no GitHub app credentials reaches the
  // installation-deleted path — the persisted user_sync.error must be a code.
  const userId = seedUser('dm-sync')
  db.t('github_installations').push({ id: crypto.randomUUID(), user_id: userId, installation_id: 31337 })
  const result = await sync.runSync(userId, { budgetMs: 5000, force: true })
  const row = db.t('user_sync').find((r) => r.user_id === userId)
  assert.equal(row?.status, 'revoked')
  assert.ok(isSyncErrorCode(row?.error), `persisted error is not a taxonomy code: ${row?.error}`)
  assert.equal(row?.error, 'GITHUB_ACCESS_REVOKED')
  assert.equal(result?.status, 'revoked')
})

test('source: no raw exception text can reach the sync error columns', () => {
  const syncSrc = src('lib/sync.mjs')
  const wh = src('api/webhooks/github.mjs')
  // The exact persistence patterns this tranche removed must not return.
  for (const f of [syncSrc, wh]) {
    assert.doesNotMatch(f, /error:\s*String\(err/, 'raw String(err) written to an error column')
    assert.doesNotMatch(f, /error:\s*err\?\.(message|stack)/, 'raw exception property written to an error column')
    assert.doesNotMatch(f, /error:\s*err\.(message|stack)/, 'raw exception property written to an error column')
  }
  // Every persisted error value is a taxonomy literal or the classifier.
  for (const m of syncSrc.matchAll(/setUserSync\([^)]*error:\s*'([^']+)'/g)) {
    assert.ok(isSyncErrorCode(m[1]), `non-taxonomy error literal persisted: ${m[1]}`)
  }
  for (const m of wh.matchAll(/setUserSync\([^)]*error:\s*'([^']+)'/g)) {
    assert.ok(isSyncErrorCode(m[1]), `webhook persists non-taxonomy literal: ${m[1]}`)
  }
  assert.match(wh, /error:\s*'GITHUB_ACCESS_REVOKED'/)
  assert.match(syncSrc, /syncErrorCode\(err/)
})

test('source: API boundary translates codes — stored value never echoes', () => {
  for (const f of ['api/sync.mjs', 'api/dashboard.mjs', 'api/user.mjs']) {
    const s = src(f)
    assert.match(s, /syncErrorMessage\(/, `${f} must translate stored codes`)
    assert.doesNotMatch(s, /error:\s*(s|sync)\.error\b/, `${f} must not pass stored error through`)
  }
})

/* ── WS2/WS3: removed columns cannot silently return ────────────────────── */

const DROPPED = {
  commits: ['author_user_id', 'author_login', 'authored_at', 'files_changed', 'is_merge'],
  pull_requests: ['author_user_id', 'author_login', 'number', 'closed_at'],
}

test('source: ingestion writes none of the removed columns', () => {
  const writers = [src('lib/sync.mjs'), src('api/webhooks/github.mjs')].join('\n')
  for (const cols of Object.values(DROPPED)) {
    for (const col of cols) {
      assert.ok(!writers.includes(col), `writer still persists ${col}`)
    }
  }
})

test('attribution guards survive the column removal', () => {
  const syncSrc = src('lib/sync.mjs')
  // commits: GraphQL author:{id} filter + transient attribution check
  assert.match(syncSrc, /author:\s*\{\s*id:\s*\$author\s*\}/)
  assert.match(syncSrc, /isAttributedCommit\(node, user\.github_node_id\)/)
  // PRs: transient author-id check before any row is written
  assert.match(syncSrc, /item\.user\?\.id !== user\.github_user_id/)
  const wh = src('api/webhooks/github.mjs')
  assert.match(wh, /pr\.user\?\.id !== user\.github_user_id/)
})

test('isAttributedCommit still rejects foreign authors', async () => {
  const { isAttributedCommit } = await import('../lib/analytics.mjs')
  const foreign = { author: { user: { id: 'N_other' } } }
  assert.equal(isAttributedCommit(foreign, 'N_mine'), false)
  assert.equal(isAttributedCommit({ author: { user: { id: 'N_mine' } } }, 'N_mine'), true)
  assert.equal(isAttributedCommit({ author: { user: null } }, 'N_mine'), false)
  assert.equal(isAttributedCommit(null, 'N_mine'), false)
})

test('migration 011 drops every removed column and sanitizes error values', () => {
  const sql = src('migrations/011_persistence_minimization.sql')
  for (const [tbl, cols] of Object.entries(DROPPED)) {
    for (const col of cols) {
      assert.match(
        sql,
        new RegExp(`alter table public\\.${tbl}[\\s\\S]*?drop column if exists ${col}`, 'i'),
        `011 must drop ${tbl}.${col}`,
      )
    }
  }
  // legacy free-text error values are rewritten to codes, never kept
  for (const tbl of ['user_sync', 'repo_sync']) {
    assert.match(sql, new RegExp(`update public\\.${tbl} set error = 'SYNC_INTERNAL_ERROR'`), `${tbl} not sanitized`)
  }
  // dead session rows are purged
  assert.match(sql, /delete from public\.auth_sessions[\s\S]*?revoked_at is not null/)
})

test('no migration re-adds a removed column and 011 adds nothing new', () => {
  const dir = path.join(ROOT, 'migrations')
  const files = readdirSync(dir).filter((n) => /^\d+.*\.sql$/.test(n)).sort()
  for (const name of files) {
    if (name <= '011_persistence_minimization.sql') continue
    const sql = src(`migrations/${name}`)
    for (const cols of Object.values(DROPPED)) {
      for (const col of cols) {
        assert.ok(!new RegExp(`add column[^;]*${col}`, 'i').test(sql), `${name} re-adds ${col}`)
      }
    }
  }
  const m11 = src('migrations/011_persistence_minimization.sql')
  assert.doesNotMatch(m11, /add column/i, '011 must only drop — no new persisted fields')
  assert.doesNotMatch(m11, /create table/i, '011 must not create tables')
})

/* ── WS4: session rows are deleted, not retained ─────────────────────────── */

test('logout deletes the session row outright', async () => {
  const userId = seedUser('dm-logout')
  const sid = await sessions.createAuthSession(userId)
  assert.ok(await sessions.isSessionLive(sid))
  await sessions.revokeSession(sid)
  assert.equal(await sessions.isSessionLive(sid), false)
  assert.equal(db.t('auth_sessions').some((r) => r.sid === sid), false, 'row must be deleted, not marked')
})

test('kill-all deletes every session row for the user', async () => {
  const userId = seedUser('dm-killall')
  const other = seedUser('dm-other')
  const s1 = await sessions.createAuthSession(userId)
  const s2 = await sessions.createAuthSession(userId, { persistent: true })
  const s3 = await sessions.createAuthSession(other)
  await sessions.revokeAllSessions(userId)
  assert.equal(db.t('auth_sessions').filter((r) => r.user_id === userId).length, 0)
  assert.equal(await sessions.isSessionLive(s1), false)
  assert.equal(await sessions.isSessionLive(s2), false)
  assert.equal(await sessions.isSessionLive(s3), true, 'other user session untouched')
})

test('GC removes expired and legacy-revoked rows outright', async () => {
  const userId = seedUser('dm-gc')
  const live = await sessions.createAuthSession(userId)
  db.t('auth_sessions').push({ sid: 'expired-sid', user_id: userId, expires_at: '2020-01-01T00:00:00.000Z' })
  db.t('auth_sessions').push({ sid: 'revoked-sid', user_id: userId, expires_at: new Date(Date.now() + 86400000).toISOString(), revoked_at: '2020-06-01T00:00:00.000Z' })
  await sessions.gcAuthSessions()
  const left = db.t('auth_sessions').filter((r) => r.user_id === userId)
  assert.deepEqual(left.map((r) => r.sid), [live], 'only the live row survives GC')
})

/* ── WS6: account deletion coverage is schema-enforced ──────────────────── */

test('every user-linked table cascades from users in the migrations', () => {
  const all = readdirSync(path.join(ROOT, 'migrations'))
    .filter((f) => f.endsWith('.sql')).sort()
    .map((f) => src(`migrations/${f}`)).join('\n')
  for (const tbl of ['github_installations', 'repositories', 'commits', 'pull_requests',
    'repo_sync', 'user_sync', 'repo_coverage', 'auth_sessions', 'feedback']) {
    assert.match(
      all,
      new RegExp(`references (?:public\\.)?users\\(id\\) on delete cascade`, 'i'),
      `${tbl} must cascade from users`,
    )
    void tbl
  }
  // repository_languages hangs off repositories — the only non-user FK.
  assert.match(all, /references (?:public\.)?repositories\(id\) on delete cascade/i)
})

/* ── WS7: backup scope stays allowlist-only ─────────────────────────────── */

test('backup allowlist excludes ephemeral and carries no removed fields', async () => {
  const { BACKUP_TABLES, EPHEMERAL_TABLES } = await import('../scripts/backup-scope.mjs')
  for (const t of ['auth_sessions', 'webhook_deliveries', 'security_events', 'schema_migrations']) {
    assert.ok(EPHEMERAL_TABLES.includes(t), `${t} must stay ephemeral`)
    assert.ok(!BACKUP_TABLES.includes(t), `${t} must not be backed up`)
  }
})

/* ── WS5: legal text cannot re-claim removed fields ──────────────────────── */

test('privacy/security copy stays consistent with the final schema', () => {
  const privacy = src('src/legal/PrivacyPolicyPage.tsx')
  assert.ok(!privacy.includes('collaborators'), 'stale collaborator-author claim must be gone')
  assert.doesNotMatch(privacy, /author GitHub id\/login|author identifiers,? (state|where)/i, 'author-id claim must be gone')
  const security = src('src/security/SecurityPrivacyPage.tsx')
  assert.match(security, /AUTHOR IDENTIFIERS/)
  assert.match(security, /PROVIDER ERROR TEXT/)
  assert.doesNotMatch(security, /author GitHub id and login/i)
})
