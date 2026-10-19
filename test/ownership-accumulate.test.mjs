// Phase 1C-B2 — ACCUMULATE engine unit tests.
//
// The engine is driven against an in-memory db adapter that implements the
// SAME compare-and-set semantics as own_checkpoint_page/own_build_init
// (the real functions are proven on PostgreSQL in the drill). The
// differential harness proves: every GraphQL page partition of one node
// stream accumulates to work-state that projects to exactly the canonical
// reducer's result.

import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { reduceHistoryToMonthly } from '../lib/ownership/history-reducer.mjs'
import {
  contributorKey,
  UNLINKED_KEY,
  OwnershipIdentityError,
} from '../lib/ownership/contributors.mjs'
import { reducePageDeltas } from '../lib/ownership/page-deltas.mjs'
import {
  runAccumulateSlice,
  isResumable,
  SLICE_STATUS,
  RATE_LIMIT_RESERVE,
} from '../lib/ownership/accumulate.mjs'
import {
  pinnedHistoryPageQuery,
  pinnedObjectQuery,
  ownershipHeadProbeQuery,
  assertOwnershipQuerySafe,
  assertOwnershipResponseSafe,
  OwnershipResponseContractError,
} from '../lib/ownership/queries.mjs'
import { RateLimitError, GitHubAuthError } from '../lib/github.mjs'
import { projectWorkToMonthly } from '../scripts/ownership-work-projection.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = '11111111-1111-1111-1111-111111111111'
const USER = '22222222-2222-2222-2222-222222222222'
const OID = 'a'.repeat(40)
const ENV = { OWNERSHIP_INGEST_ENABLED: 'true', OWNERSHIP_CANARY_REPOSITORY_IDS: REPO }

const isKey = (s) => /^[0-9a-f]{64}$/.test(s)
const node = (date, user) => ({ committedDate: date, author: { user: user ?? null } })
const nd = (id, login, date) => node(date, { id: `U_${id}`, login })

// ── in-memory db adapter ─────────────────────────────────────────────────
// Faithful CAS/upsert semantics for the ACCUMULATE surface: the checkpoint
// compares (building_version, scope, pass, expected_cursor) BEFORE any
// write and commits the page + cursor atomically — a replay with a stale
// expected cursor is 'stale' and writes nothing.
function makeMemDb({ repoRow } = {}) {
  const repo = repoRow ?? {
    id: REPO, user_id: USER, owner_login: 'acme', name: 'widget', installation_id: 7,
  }
  const state = {
    repo,
    sync: null,
    scopes: new Map(), // scopeId -> row
    scopeIds: new Map(), // hash -> scopeId
    membership: new Map(), // `${scopeId}|${v}` -> row
    work: new Map(), // `${v}|${scope}|${period}|${key}` -> row
    calls: { checkpoint: 0, checkpointArgs: [] },
    failNext: new Map(), // fn -> error to throw once
  }
  const key = (v, s, p, k) => `${v}|${s}|${p}|${k}`

  const db = {
    _state: state,
    failOnce(fn, err) { state.failNext.set(fn, err) },
    workRows() { return [...state.work.values()].map((r) => ({ ...r })) },

    async loadRepo() { return state.repo },
    async ensureSyncRow() {
      state.sync ??= {
        user_id: USER, repository_id: REPO, phase: 'pending', error: null,
        active_version: null, building_version: null,
        history_cursor: null, pending_scopes: null,
        updated_at: new Date().toISOString(),
      }
    },
    async loadSync() { return state.sync ? { ...state.sync } : null },
    async rpc(fn, args) {
      const err = state.failNext.get(fn)
      if (err) { state.failNext.delete(fn); throw err }
      switch (fn) {
        case 'own_build_preflight':
          if (!state.sync) return 'stale'
          return state.sync.building_version != null ? 'blocked' : 'ready'
        case 'own_build_init': {
          if (!state.sync) return 'stale'
          if (state.sync.building_version != null) return 'blocked'
          state.sync.building_version = args.p_new_version
          state.sync.phase = 'history'
          state.sync.error = null
          state.sync.pending_scopes = null
          state.sync.history_cursor = {
            pinned_oid: args.p_pinned_oid,
            current: null,
            build_started_at: new Date().toISOString(),
          }
          return 'initialized'
        }
        case 'own_abandon_build': {
          if (!state.sync) return 'stale'
          const V = args.p_version
          if (state.sync.building_version !== V) return 'no-active-build'
          for (const k of [...state.work.keys()]) if (k.startsWith(`${V}|`)) state.work.delete(k)
          for (const k of [...state.membership.keys()]) if (k.endsWith(`|${V}`)) state.membership.delete(k)
          state.sync.building_version = null
          state.sync.phase = 'pending'
          state.sync.history_cursor = null
          state.sync.pending_scopes = null
          return 'abandoned'
        }
        case 'own_checkpoint_page': {
          state.calls.checkpoint += 1
          state.calls.checkpointArgs.push(structuredClone(args))
          const st = state.sync
          if (!st || st.building_version !== args.p_version || st.phase !== 'history') return 'stale'
          const cur = st.history_cursor?.current
          if (!cur || cur.scope_id !== args.p_scope || cur.pass !== args.p_pass) return 'stale'
          if ((cur.cursor ?? null) !== (args.p_expected_cursor ?? null)) return 'stale'
          // additive upsert — same row exists => sums merge; mirrors the
          // real function's stored-row is_bot drift guard (fail closed)
          for (const d of args.p_deltas) {
            const k = key(args.p_version, args.p_scope, d.period_start, d.work_key)
            const prev = state.work.get(k)
            if (prev && prev.is_bot !== d.is_bot) {
              throw new Error('is_bot classification drift')
            }
            state.work.set(k, prev
              ? {
                  ...prev,
                  touch_commits: prev.touch_commits + d.touches,
                  first_seen_at: prev.first_seen_at < d.first_seen_at ? prev.first_seen_at : d.first_seen_at,
                  last_seen_at: prev.last_seen_at > d.last_seen_at ? prev.last_seen_at : d.last_seen_at,
                }
              : {
                  calculation_version: args.p_version, scope_id: args.p_scope,
                  period_start: d.period_start, work_key: d.work_key,
                  is_bot: d.is_bot, touch_commits: d.touches,
                  first_seen_at: d.first_seen_at, last_seen_at: d.last_seen_at,
                })
          }
          // mirrors the real function's last-page merge: the B1 contract
          // flips to resolve at a fresh cursor carrying accumulate_done
          if (args.p_last_page) {
            st.history_cursor.current = {
              ...cur,
              pass: 'resolve',
              accumulate_done: true,
              cursor: null,
            }
          } else {
            st.history_cursor.current = { ...cur, cursor: args.p_next_cursor }
          }
          return 'applied'
        }
        default:
          throw new Error(`mem db: unhandled rpc ${fn}`)
      }
    },
    async upsertScopes(rows) {
      const out = []
      for (const r of rows) {
        let id = state.scopeIds.get(r.scope_path_hash)
        if (!id) {
          id = crypto.randomUUID()
          state.scopeIds.set(r.scope_path_hash, id)
          state.scopes.set(id, { ...r, id })
        }
        out.push({ id, scope_path_hash: r.scope_path_hash, depth: r.depth })
      }
      return out
    },
    async insertMembership(rows) {
      for (const r of rows) {
        state.membership.set(`${r.scope_id}|${r.calculation_version}`, r)
      }
    },
    async membershipFor(_u, _r, version) {
      return [...state.membership.values()].filter((m) => m.calculation_version === version)
    },
    async loadScope(scopeId) { return state.scopes.get(scopeId) ?? null },
    async casSync({ userId, repositoryId, match = {}, patch }) {
      const st = state.sync
      if (!st) return false
      if ('building_version' in match) {
        if ((match.building_version ?? null) !== (st.building_version ?? null)) return false
      }
      if ('history_cursor' in match) {
        const a = JSON.stringify(match.history_cursor ?? null)
        const b = JSON.stringify(st.history_cursor ?? null)
        if (a !== b) return false
      }
      Object.assign(st, structuredClone(patch))
      return true
    },
  }
  return db
}

// ── fake transport ────────────────────────────────────────────────────────
// Serves the three audited queries off a synthetic node stream partitioned
// by opaque index cursors — the same stream a real history(path:) walk
// would produce. calls[] records every query+vars for static assertions.
// cost/remaining accept a constant or (query, vars, callIndex) -> value so
// tests can assign distinct telemetry per request type.
function makeTransport({ nodes = [], tree = [], pinnedOid = OID, pageSize = 100, remaining = 5000, cost = 1 } = {}) {
  const calls = []
  const pick = (v, q, vars) => (typeof v === 'function' ? v(q, vars, calls.length) : v)
  const rl = (q, vars) => ({ cost: pick(cost, q, vars), remaining: pick(remaining, q, vars), resetAt: '2026-01-01T00:00:00Z' })
  return {
    calls,
    async graphql(query, vars) {
      calls.push({ query, vars })
      const meta = rl(query, vars)
      if (query.includes('defaultBranchRef')) {
        return { repository: { defaultBranchRef: { target: { oid: pinnedOid } } }, rateLimit: meta }
      }
      if (query.includes('tree {')) {
        return {
          repository: { object: { __typename: 'Commit', oid: vars.oid, tree: { oid: 'b'.repeat(40) } } },
          rateLimit: meta,
        }
      }
      // pinned history page — object(oid:) mismatch yields a null object
      if (vars.oid !== pinnedOid) return { repository: { object: null }, rateLimit: meta }
      const start = vars.cursor == null ? 0 : Number(vars.cursor.split(':')[1])
      const end = Math.min(start + pageSize, nodes.length)
      return {
        repository: {
          object: {
            __typename: 'Commit', oid: vars.oid,
            history: {
              pageInfo: { hasNextPage: end < nodes.length, endCursor: `idx:${end}` },
              nodes: nodes.slice(start, end),
            },
          },
        },
        rateLimit: meta,
      }
    },
    async getTree() { return { tree, truncated: false } },
  }
}

// request-type predicates for per-query telemetry
const isProbe = (q) => q.includes('defaultBranchRef')
const isHistory = (q) => q.includes('history(first')
const isObject = (q) => !isProbe(q) && !isHistory(q)
// build-start calls are telemetry-free; history pages cost `n` each — keeps
// "one page per slice" semantics under the unified slice budget
const pageCosts = (n = 1) => (q) => (isHistory(q) ? n : 0)

const run = (db, transport, opts = {}) =>
  runAccumulateSlice({ db, transport, repositoryId: REPO, env: ENV, ...opts })

// drive slices until a terminal state (budget = 1 page per slice => resume)
async function driveToTerminal(db, transport, opts = {}) {
  const seen = []
  for (let i = 0; i < 500; i++) {
    const r = await run(db, transport, opts)
    seen.push(r.status)
    if (r.status === SLICE_STATUS.RESOLVE_READY || r.status === SLICE_STATUS.SCOPES_DRAINED) {
      return { status: r.status, history: seen, last: r }
    }
    if ([SLICE_STATUS.ERROR, SLICE_STATUS.ABANDONED, SLICE_STATUS.STALE, SLICE_STATUS.LOCKED].includes(r.status)) {
      return { status: r.status, history: seen, last: r }
    }
  }
  throw new Error('did not reach a terminal state')
}

// a deterministic synthetic stream: multiple months, ties at the Top-25
// boundary, bots, unlinked nodes, heavy repeat contributors
function syntheticNodes() {
  const nodes = []
  const months = ['2025-06', '2025-07', '2025-08']
  for (let m = 0; m < months.length; m++) {
    for (let c = 0; c < 30; c++) {
      const touches = c < 5 ? 40 - m : c === 24 || c === 25 || c === 26 ? 7 : 2 + ((c + m) % 9)
      for (let t = 0; t < touches; t++) {
        nodes.push(nd(`c${c}`, `user${c}`, `${months[m]}-${String(1 + (t % 27)).padStart(2, '0')}T12:00:00Z`))
      }
    }
    for (let t = 0; t < 5; t++) nodes.push(nd(`bot${m}`, `deploy[bot]`, `${months[m]}-05T08:00:00Z`))
    for (let t = 0; t < 9; t++) nodes.push(node(`${months[m]}-15T09:00:00Z`, null))
  }
  return nodes
}

// ══ pure page-delta reducer ══════════════════════════════════════════════

test('page-delta reduction groups (period x work_key) with correct bounds', () => {
  const nodes = [
    nd('a1', 'alice', '2025-06-03T10:00:00Z'),
    nd('a1', 'alice', '2025-06-20T08:00:00Z'),
    nd('a1', 'alice', '2025-06-01T09:00:00Z'),
    nd('b2', 'bot[bot]', '2025-06-05T00:00:00Z'),
    node('2025-06-07T00:00:00Z', null),
    nd('a1', 'alice', '2025-07-02T00:00:00Z'),
  ]
  const d = reducePageDeltas(REPO, nodes)
  assert.equal(d.length, 4)
  const aliceJun = d.find((x) => x.work_key === contributorKey(REPO, 'U_a1') && x.period_start === '2025-06-01T00:00:00.000Z')
  assert.equal(aliceJun.touches, 3)
  assert.equal(aliceJun.is_bot, false)
  assert.equal(aliceJun.first_seen_at, '2025-06-01T09:00:00Z')
  assert.equal(aliceJun.last_seen_at, '2025-06-20T08:00:00Z')
  const bot = d.find((x) => x.work_key === contributorKey(REPO, 'U_b2'))
  assert.equal(bot.is_bot, true)
  const unl = d.find((x) => x.work_key === UNLINKED_KEY)
  assert.equal(unl.touches, 1)
  const aliceJul = d.find((x) => x.work_key === contributorKey(REPO, 'U_a1') && x.period_start === '2025-07-01T00:00:00.000Z')
  assert.equal(aliceJul.touches, 1)
})

test('page-delta keys are pseudonymous and deterministic', () => {
  const d = reducePageDeltas(REPO, [nd('a1', 'alice', '2025-06-03T10:00:00Z')])
  assert.equal(d[0].work_key, contributorKey(REPO, 'U_a1'))
  assert.ok(isKey(d[0].work_key))
})

test('checkpoint delta payload contains no plaintext identity (hard guard)', () => {
  const nodes = [nd('a1', 'alice-pii', '2025-06-03T10:00:00Z'), nd('b2', 'bob-secret', '2025-06-04T10:00:00Z')]
  const payload = JSON.stringify(reducePageDeltas(REPO, nodes))
  for (const forbidden of ['U_a1', 'U_b2', 'alice-pii', 'bob-secret', 'github_node_id', 'display_login', 'login', 'email', 'message', 'oid']) {
    assert.ok(!payload.includes(forbidden), `delta payload leaked ${forbidden}`)
  }
  const fields = new Set(Object.keys(JSON.parse(payload)[0]).sort())
  assert.deepEqual([...fields], ['first_seen_at', 'is_bot', 'last_seen_at', 'period_start', 'touches', 'work_key'])
})

test('malformed nodes fail closed', () => {
  assert.throws(() => reducePageDeltas(REPO, [{ author: {} }]), TypeError)
  assert.throws(() => reducePageDeltas(REPO, [node('2025-06-01T00:00:00Z', { id: 42, login: 'x' })]))
  assert.throws(() => reducePageDeltas(REPO, [node('2025-06-01T00:00:00Z', { id: 'U_x', login: 5 })]))
})

// ══ pinned query contract ════════════════════════════════════════════════

test('every history page is anchored at object(oid:$oid) with Commit verification', () => {
  const q = pinnedHistoryPageQuery()
  assert.ok(q.includes('object(oid: $oid)'))
  assert.ok(q.includes('__typename'))
  assert.ok(q.includes('oid'))
  assert.ok(q.includes('history(first: 100, path: $path, after: $cursor)'))
  assert.ok(!q.includes('defaultBranchRef'))
  assert.ok(!q.includes('expression:'))
  assertOwnershipQuerySafe(q)
})

test('pin/object queries pass the field audit', () => {
  assertOwnershipQuerySafe(pinnedObjectQuery())
  assertOwnershipQuerySafe(ownershipHeadProbeQuery())
})

test('accumulate engine never queries defaultBranchRef for build pages', () => {
  const src = readFileSync(join(HERE, '..', 'lib', 'ownership', 'accumulate.mjs'), 'utf8')
  assert.ok(src.includes('pinnedHistoryPageQuery'))
  assert.ok(!src.includes('historyPathQuery'))
  // the only defaultBranchRef reference is inside the HEAD probe call site
  assert.equal(src.split('ownershipHeadProbeQuery').length - 1 >= 2, true)
  const q = pinnedHistoryPageQuery()
  assert.ok(!/defaultBranchRef|expression\s*:/.test(q))
})

test('response contract tripwire rejects forbidden keys', () => {
  assert.throws(
    () => assertOwnershipResponseSafe({ repository: { object: { message: 'x' } } }),
    OwnershipResponseContractError,
  )
  assert.throws(
    () => assertOwnershipResponseSafe({ a: [{ b: [{ email: 'x@y.z' }] }] }),
    OwnershipResponseContractError,
  )
  assertOwnershipResponseSafe({ repository: { object: { __typename: 'Commit', oid: OID } } })
})

// ══ build start / resume flow ════════════════════════════════════════════

test('fresh build: preflight -> pin -> init -> prep -> accumulate -> resolve-ready', async () => {
  const db = makeMemDb()
  const t = makeTransport({ nodes: syntheticNodes(), pageSize: 100 })
  const r = await driveToTerminal(db, t)
  assert.equal(r.status, SLICE_STATUS.RESOLVE_READY)
  const sync = await db.loadSync()
  assert.equal(sync.building_version, 1)
  assert.equal(sync.phase, 'history')
  assert.equal(sync.history_cursor.pinned_oid, OID)
  assert.equal(sync.history_cursor.current.pass, 'resolve')
  // every history page used the pinned oid — no defaultBranchRef pages
  const pages = t.calls.filter((c) => c.query.includes('history(first'))
  assert.ok(pages.length >= 1)
  for (const c of pages) {
    assert.equal(c.vars.oid, OID)
    assert.ok(c.query.includes('object(oid: $oid)'))
    assert.ok(!c.query.includes('defaultBranchRef'))
  }
})

test('scope ordering: repo scope first, pending ordered by depth+hash', async () => {
  const db = makeMemDb()
  const tree = [
    { path: 'src/a.ts', type: 'blob' }, { path: 'src/lib/b.ts', type: 'blob' },
    { path: 'docs/x.md', type: 'blob' }, { path: 'node_modules/pkg/i.js', type: 'blob' },
    { path: '.gitmodules', type: 'blob' },
  ]
  const t = makeTransport({ nodes: syntheticNodes(), tree })
  // budget covers build-start + scope prep (3 requests) + exactly one page —
  // the loop must stop before page 2 with the repo scope current
  const r = await run(db, t, { costBudget: 4 })
  const sync = await db.loadSync()
  assert.ok([SLICE_STATUS.SLICE_BUDGET, SLICE_STATUS.RESOLVE_READY].includes(r.status))
  const cur = sync.history_cursor?.current
  assert.ok(cur)
  assert.equal(cur.pass, 'accumulate')
  const repoScope = await db.loadScope(cur.scope_id)
  assert.equal(repoScope.scope_type, 'repo')
  // membership is exactly the candidate set — vendor paths never persisted
  const members = await db.membershipFor(USER, REPO, 1)
  const paths = [...db._state.scopes.values()].map((s) => s.display_path)
  assert.ok(!paths.includes('node_modules'))
  assert.ok(members.length >= 2)
  // pending order = (depth, scope_path_hash)
  const ordered = [...db._state.scopes.values()]
    .sort((a, b) => (a.depth !== b.depth ? a.depth - b.depth : a.scope_path_hash < b.scope_path_hash ? -1 : 1))
    .map((s) => s.id)
  assert.deepEqual(sync.pending_scopes, ordered)
})

test('resume: second slice picks up the durable cursor with no double-count', async () => {
  const nodes = syntheticNodes()
  const db1 = makeMemDb()
  const t1 = makeTransport({ nodes })
  await driveToTerminal(db1, t1)

  const db2 = makeMemDb()
  const t2 = makeTransport({ nodes, cost: pageCosts(1) })
  const first = await run(db2, t2, { costBudget: 1 }) // one page per slice
  assert.equal(first.status, SLICE_STATUS.SLICE_BUDGET)
  const r = await driveToTerminal(db2, t2, { costBudget: 1 })
  assert.equal(r.status, SLICE_STATUS.RESOLVE_READY)

  const p1 = projectWorkToMonthly(db1.workRows())
  const p2 = projectWorkToMonthly(db2.workRows())
  assert.deepEqual(p2.months, p1.months)
})

// ══ differential reducer equivalence ═════════════════════════════════════

test('differential: every page partition accumulates to the reducer result', async () => {
  const nodes = syntheticNodes()
  const expected = reduceHistoryToMonthly({ repositoryId: REPO, scope: { id: 's' }, nodes })
  for (const pageSize of [1000, 1, 7, 100, 333]) {
    const db = makeMemDb()
    const t = makeTransport({ nodes, pageSize })
    const r = await driveToTerminal(db, t)
    assert.equal(r.status, SLICE_STATUS.RESOLVE_READY, `pageSize=${pageSize}`)
    const projected = projectWorkToMonthly(db.workRows())
    assert.deepEqual(projected.months, expected.months, `pageSize=${pageSize} months`)
    const expectedKeys = new Set(expected.contributor_candidates.map((c) => c.contributor_key))
    assert.deepEqual([...projected.represented].sort(), [...expectedKeys].sort(), `pageSize=${pageSize} keys`)
    // candidate first/last-seen bounds match the reducer's seen bookkeeping
    for (const c of expected.contributor_candidates) {
      if (!isKey(c.contributor_key)) continue
      const b = projected.candidateBounds.get(c.contributor_key)
      assert.equal(b.first_seen_at, c.first_seen_at, `${c.contributor_key} first`)
      assert.equal(b.last_seen_at, c.last_seen_at, `${c.contributor_key} last`)
      assert.equal(b.is_bot, c.is_bot)
    }
  }
})

test('differential: adversarial partitions of an identical stream agree', async () => {
  const nodes = syntheticNodes()
  const runs = []
  for (const pageSize of [1, 3, 50, 100, 10000]) {
    const db = makeMemDb()
    const r = await driveToTerminal(db, makeTransport({ nodes, pageSize }))
    assert.equal(r.status, SLICE_STATUS.RESOLVE_READY)
    runs.push(projectWorkToMonthly(db.workRows()).months)
  }
  for (const m of runs.slice(1)) assert.deepEqual(m, runs[0])
})

// ══ crash / replay matrix ════════════════════════════════════════════════

test('A: failure before the first request writes nothing', async () => {
  const db = makeMemDb()
  const t = makeTransport()
  t.graphql = () => Promise.reject(new Error('network gone'))
  const r = await run(db, t)
  assert.equal(r.status, SLICE_STATUS.ERROR)
  assert.equal(db.workRows().length, 0)
  assert.equal((await db.loadSync()).building_version ?? null, null)
})

test('B: checkpoint throws before commit — the identical call is retried once', async () => {
  const db = makeMemDb()
  db.failOnce('own_checkpoint_page', new Error('process died'))
  const attempts = []
  const orig = db.rpc.bind(db)
  db.rpc = async (fn, args) => {
    if (fn === 'own_checkpoint_page') attempts.push(structuredClone(args))
    return orig(fn, args)
  }
  const r = await run(db, makeTransport({ nodes: syntheticNodes().slice(0, 3) }))
  // reconciliation saw the expected cursor unchanged -> one retry -> applied
  assert.equal(r.status, SLICE_STATUS.RESOLVE_READY)
  assert.equal(attempts.length, 2)
  assert.deepEqual(attempts[1], attempts[0]) // identical payload on retry
  assert.ok(db.workRows().length > 0)
  const sync = await db.loadSync()
  assert.equal(sync.phase, 'history')
  assert.equal(sync.error, null)
})

test('C+D: committed page replayed with the old cursor -> stale, no double-count', async () => {
  const db = makeMemDb()
  await run(db, makeTransport({ nodes: syntheticNodes().slice(0, 30), pageSize: 10, cost: pageCosts(1) }), { costBudget: 1 })
  const before = db.workRows()
  // replay the committed page with the now-stale expected cursor
  const lastArgs = db._state.calls.checkpointArgs.at(-1)
  const r = await db.rpc('own_checkpoint_page', {
    ...lastArgs,
    p_expected_cursor: lastArgs.p_expected_cursor, // old cursor
  })
  assert.equal(r, 'stale')
  assert.deepEqual(db.workRows(), before)
})

test('E+F: wrong expected cursor / wrong version write nothing', async () => {
  const db = makeMemDb()
  const t = makeTransport({ nodes: syntheticNodes().slice(0, 10), cost: pageCosts(1) })
  await run(db, t, { costBudget: 1 })
  const sync = await db.loadSync()
  const args = db._state.calls.checkpointArgs.at(-1)
  const r1 = await db.rpc('own_checkpoint_page', { ...args, p_expected_cursor: 'bogus' })
  assert.equal(r1, 'stale')
  const r2 = await db.rpc('own_checkpoint_page', { ...args, p_version: 99 })
  assert.equal(r2, 'stale')
  assert.equal(sync.phase, 'history')
})

test('G+H: restart between every page completes identically', async () => {
  const nodes = syntheticNodes().slice(0, 250)
  const db1 = makeMemDb()
  await driveToTerminal(db1, makeTransport({ nodes }))
  const db2 = makeMemDb()
  // fresh workerId + tiny budget each slice = a restart between pages
  const r = await driveToTerminal(db2, makeTransport({ nodes, pageSize: 25, cost: pageCosts(1) }), {
    costBudget: 1,
    get workerId() { return crypto.randomUUID() },
  })
  assert.equal(r.status, SLICE_STATUS.RESOLVE_READY)
  assert.deepEqual(projectWorkToMonthly(db2.workRows()).months, projectWorkToMonthly(db1.workRows()).months)
})

test('I: rate-limit error before the page commits writes nothing', async () => {
  const db = makeMemDb()
  const t = makeTransport({ nodes: syntheticNodes() })
  let hits = 0
  const orig = t.graphql
  t.graphql = async (q, v) => {
    if (q.includes('history(first') && hits++ === 0) throw new RateLimitError('rate limit')
    return orig(q, v)
  }
  const r = await run(db, t)
  assert.equal(r.status, SLICE_STATUS.RATE_LIMITED)
  assert.equal(db.workRows().length, 0)
  const cur = (await db.loadSync()).history_cursor.current
  assert.equal(cur.cursor, null)
})

test('J: rate-limit reserve stops the slice after a committed page; next slice resumes', async () => {
  const nodes = syntheticNodes()
  const db = makeMemDb()
  // only history-page telemetry dips below the reserve — build-start
  // requests keep their headroom so the slice reaches the page loop
  const t = makeTransport({
    nodes, pageSize: 100,
    remaining: (q) => (isHistory(q) ? RATE_LIMIT_RESERVE - 1 : 5000),
  })
  const r = await run(db, t)
  assert.equal(r.status, SLICE_STATUS.RATE_LIMITED)
  assert.ok(db.workRows().length > 0) // page 1 committed before the reserve check
  // next invocation with headroom resumes from the durable cursor
  const t2 = makeTransport({ nodes, pageSize: 100 })
  const r2 = await driveToTerminal(db, t2)
  assert.equal(r2.status, SLICE_STATUS.RESOLVE_READY)
})

test('K: both checkpoint attempts fail before commit — then (and only then) error', async () => {
  const db = makeMemDb()
  const origRpc = db.rpc.bind(db)
  let attempts = 0
  db.rpc = async (fn, args) => {
    // every page-2 attempt dies before commit — the retry cannot help;
    // durable state never leaves the attempted position
    if (fn === 'own_checkpoint_page' && args.p_expected_cursor === 'idx:50') {
      attempts += 1
      throw new Error('tx aborted')
    }
    return origRpc(fn, args)
  }
  const r = await run(db, makeTransport({ nodes: syntheticNodes(), pageSize: 50 }))
  assert.equal(r.status, SLICE_STATUS.ERROR)
  assert.equal(r.code, 'OWNERSHIP_INTERNAL_ERROR')
  assert.equal(attempts, 2) // exactly one retry, then the closed error path
  // page-1 counters stay committed; the failed page wrote nothing
  const keys = new Set(db.workRows().map((w) => w.work_key))
  assert.ok(keys.size > 0)
  const sync = await db.loadSync()
  assert.equal(sync.phase, 'error')
  assert.equal(sync.error, 'OWNERSHIP_INTERNAL_ERROR')
  assert.equal(sync.history_cursor.current.cursor, 'idx:50') // unmoved
})

// ══ pinned-object failure ════════════════════════════════════════════════

test('pinned object null -> retry once -> fail closed, never repin', async () => {
  const db = makeMemDb()
  const nodes = syntheticNodes().slice(0, 5)
  const t = makeTransport({ nodes })
  let historyCalls = 0
  const orig = t.graphql
  t.graphql = async (q, v) => {
    if (q.includes('history(first')) {
      historyCalls++
      return { repository: { object: null }, rateLimit: { cost: 1, remaining: 5000, resetAt: 'x' } }
    }
    return orig(q, v)
  }
  const r = await run(db, t)
  assert.equal(r.status, SLICE_STATUS.ERROR)
  assert.equal(r.code, 'OWNERSHIP_HISTORY_FAILED')
  assert.equal(historyCalls, 2) // exactly one retry
  const sync = await db.loadSync()
  assert.equal(sync.phase, 'error')
  assert.equal(sync.history_cursor.pinned_oid, OID) // still the original pin
})

// ══ lease / concurrency ══════════════════════════════════════════════════

test('live foreign lease wins the slice; expired lease is taken', async () => {
  const db = makeMemDb()
  const t = makeTransport({ nodes: syntheticNodes().slice(0, 3) })
  await run(db, t, { workerId: 'w1' })
  // force the lease to look live-foreign
  const sync = await db.loadSync()
  sync.history_cursor.lease = { owner: 'other-worker', expires: new Date(Date.now() + 60000).toISOString() }
  const r = await run(db, t, { workerId: 'w2' })
  assert.equal(r.status, SLICE_STATUS.LOCKED)
  // expired lease -> takeover
  const sync2 = await db.loadSync()
  sync2.history_cursor.lease = { owner: 'other-worker', expires: new Date(Date.now() - 1000).toISOString() }
  const r2 = await run(db, t, { workerId: 'w2' })
  assert.notEqual(r2.status, SLICE_STATUS.LOCKED)
})

// ══ §5.6b resumability validation ════════════════════════════════════════

test('invalid durable state takes the fail-closed abandon path', async () => {
  const db = makeMemDb()
  const t = makeTransport({ nodes: [] })
  await run(db, t)
  // corrupt the cursor: unknown scope id as current
  const sync = await db.loadSync()
  sync.history_cursor.current = { scope_id: '33333333-3333-3333-3333-333333333333', pass: 'accumulate', cursor: null }
  const r = await run(db, t)
  assert.equal(r.status, SLICE_STATUS.ABANDONED)
  const after = await db.loadSync()
  assert.equal(after.building_version, null)
  assert.equal(after.phase, 'pending')
})

test('isResumable rejects malformed cursor shapes', async () => {
  const db = makeMemDb()
  const base = {
    user_id: USER, repository_id: REPO, phase: 'history', building_version: 1,
    history_cursor: { pinned_oid: OID, current: null },
    pending_scopes: null,
  }
  assert.equal(await isResumable(db, { ...base, history_cursor: { pinned_oid: 'zzz', current: null } }), false)
  assert.equal(await isResumable(db, { ...base, phase: 'error' }), false)
  assert.equal(await isResumable(db, { ...base, history_cursor: { pinned_oid: OID, current: { scope_id: 'x', pass: 'accumulate', cursor: null } } }), false)
  assert.equal(await isResumable(db, { ...base, history_cursor: { pinned_oid: OID, current: { scope_id: crypto.randomUUID(), pass: 'bogus', cursor: null } } }), false)
  assert.equal(await isResumable(db, base), true)
})

test('resolve pass is a B2 terminal handoff — no resolve work is attempted', async () => {
  const db = makeMemDb()
  await driveToTerminal(db, makeTransport({ nodes: syntheticNodes().slice(0, 3) }))
  const checkpoints = db._state.calls.checkpointArgs
  for (const c of checkpoints) {
    assert.deepEqual(c.p_identities, [])
    assert.equal(c.p_pass, 'accumulate')
  }
  // invoking again returns the same handoff, unchanged state
  const r = await run(db, makeTransport())
  assert.equal(r.status, SLICE_STATUS.RESOLVE_READY)
})

test('gate refuses when the repo is not enabled', async () => {
  const db = makeMemDb()
  await assert.rejects(
    () => runAccumulateSlice({ db, transport: makeTransport(), repositoryId: REPO, env: {} }),
    (e) => e.name === 'OwnershipDisabledError',
  )
})

test('lease is transient — released on slice exit, carries no provider data', async () => {
  const db = makeMemDb()
  // inject a live foreign lease to capture its persisted shape
  await run(db, makeTransport({ nodes: syntheticNodes().slice(0, 3) }))
  const sync = await db.loadSync()
  assert.equal(sync.history_cursor.lease, undefined) // released on exit
  sync.history_cursor.lease = { owner: 'other', expires: new Date(Date.now() + 60000).toISOString() }
  const r = await run(db, makeTransport(), { workerId: 'w2' })
  assert.equal(r.status, SLICE_STATUS.LOCKED)
  const held = (await db.loadSync()).history_cursor.lease
  assert.deepEqual(Object.keys(held).sort(), ['expires', 'owner'])
})

// ══ same-page is_bot classification drift ════════════════════════════════
// One GraphQL page may observe the same node ID under contradictory logins
// (e.g. 'person' vs 'person[bot]'). Contributor keys derive from the node
// ID, so both map to one work_key — collapsing them would hide the drift
// from the DB guard. reducePageDeltas freezes the first classification
// page-wide; any conflict fails closed before own_checkpoint_page runs.

test('A: same key, same month, same classification groups and sums', () => {
  const d = reducePageDeltas(REPO, [
    nd('a1', 'alice', '2025-06-03T10:00:00Z'),
    nd('a1', 'alice', '2025-06-17T08:00:00Z'),
    nd('a1', 'alice', '2025-06-09T12:00:00Z'),
  ])
  assert.equal(d.length, 1)
  assert.equal(d[0].work_key, contributorKey(REPO, 'U_a1'))
  assert.equal(d[0].touches, 3)
  assert.equal(d[0].is_bot, false)
})

test('B: same key, same month, classification flip fails closed', () => {
  assert.throws(
    () => reducePageDeltas(REPO, [
      nd('a1', 'person', '2025-06-03T10:00:00Z'),
      nd('a1', 'person[bot]', '2025-06-04T10:00:00Z'),
    ]),
    (e) => {
      assert.equal(e.name, 'OwnershipIdentityError')
      // closed error only — no login or node id in the message
      assert.ok(!e.message.includes('person'))
      assert.ok(!e.message.includes('a1'))
      assert.ok(!e.message.includes('U_'))
      return true
    },
  )
})

test('C: reverse-order flip fails identically — no first-observation bias', () => {
  assert.throws(
    () => reducePageDeltas(REPO, [
      nd('a1', 'person[bot]', '2025-06-03T10:00:00Z'),
      nd('a1', 'person', '2025-06-04T10:00:00Z'),
    ]),
    OwnershipIdentityError,
  )
})

test('D: cross-month drift inside one page fails before checkpoint', () => {
  assert.throws(
    () => reducePageDeltas(REPO, [
      nd('a1', 'person', '2025-06-03T10:00:00Z'),
      nd('a1', 'person[bot]', '2025-07-02T10:00:00Z'),
    ]),
    OwnershipIdentityError,
  )
})

test('unlinked observations never participate in drift checking', () => {
  const d = reducePageDeltas(REPO, [
    node('2025-06-01T00:00:00Z', null),
    nd('a1', 'alice', '2025-06-03T10:00:00Z'),
    node('2025-06-02T00:00:00Z', null),
  ])
  assert.equal(d.length, 2)
  const unl = d.find((x) => x.work_key === UNLINKED_KEY)
  assert.equal(unl.is_bot, false)
  assert.equal(unl.touches, 2)
})

test('B-engine: same-page drift — no checkpoint, no cursor move, closed error', async () => {
  const db = makeMemDb()
  const t = makeTransport({
    nodes: [
      nd('a1', 'person', '2025-06-03T10:00:00Z'),
      nd('a1', 'person[bot]', '2025-06-04T10:00:00Z'),
    ],
  })
  const r = await run(db, t)
  assert.equal(r.status, SLICE_STATUS.ERROR)
  assert.equal(r.code, 'OWNERSHIP_HISTORY_FAILED')
  assert.equal(db._state.calls.checkpoint, 0) // own_checkpoint_page never called
  assert.equal(db.workRows().length, 0)       // no partial counters
  const sync = await db.loadSync()
  assert.equal(sync.phase, 'error')
  assert.equal(sync.error, 'OWNERSHIP_HISTORY_FAILED')
  assert.equal(sync.history_cursor.current.cursor, null) // cursor unmoved
  const persisted = JSON.stringify({ phase: sync.phase, error: sync.error, cursor: sync.history_cursor })
  for (const needle of ['person', 'U_a1', 'a1', 'login', 'node']) {
    assert.ok(!persisted.includes(needle), `error state leaked ${needle}`)
  }
})

test('E: cross-page drift — DB rejects page 2, cursor stays at page 1', async () => {
  // page 1 freezes is_bot=false; page 2 sends is_bot=true for the SAME row —
  // the stored-row drift guard (app-side page guard + DB guard complement)
  const db = makeMemDb()
  const t = makeTransport({
    nodes: [
      nd('a1', 'person', '2025-06-03T10:00:00Z'),
      nd('a1', 'person[bot]', '2025-06-04T10:00:00Z'),
    ],
    pageSize: 1,
    cost: pageCosts(1),
  })
  const r1 = await run(db, t, { costBudget: 1 })
  assert.equal(r1.status, SLICE_STATUS.SLICE_BUDGET) // page 1 committed
  const r2 = await run(db, t)
  assert.equal(r2.status, SLICE_STATUS.ERROR)
  assert.equal(r2.code, 'OWNERSHIP_INTERNAL_ERROR')
  const sync = await db.loadSync()
  assert.equal(sync.phase, 'error')
  assert.equal(sync.error, 'OWNERSHIP_INTERNAL_ERROR')
  assert.equal(sync.history_cursor.current.cursor, 'idx:1') // unmoved
  const rows = db.workRows()
  assert.equal(rows.length, 1)
  assert.equal(rows[0].is_bot, false)
  assert.equal(rows[0].touch_commits, 1)
})

// ══ unified slice-budget accounting (F–L) ════════════════════════════════
// ONE budget state covers the HEAD probe, pin validation, scope-prep pin
// revalidation, history pages, and the identical retry. Returned rateLimit
// cost/remaining/resetAt are authoritative — never assume cost=1.

test('F: HEAD probe cost is counted in the slice total', async () => {
  const db = makeMemDb()
  const t = makeTransport({
    nodes: syntheticNodes().slice(0, 2),
    cost: (q) => (isProbe(q) ? 7 : 0),
  })
  const r = await run(db, t)
  assert.equal(r.status, SLICE_STATUS.RESOLVE_READY)
  assert.equal(r.cost, 7)
})

test('G: HEAD + pin-validation costs are cumulative', async () => {
  const db = makeMemDb()
  let objectCalls = 0
  const t = makeTransport({
    nodes: syntheticNodes().slice(0, 2),
    cost: (q) => {
      if (isProbe(q)) return 7
      if (isObject(q)) return objectCalls++ === 0 ? 5 : 0 // pin validation only
      return 0
    },
  })
  const r = await run(db, t)
  assert.equal(r.status, SLICE_STATUS.RESOLVE_READY)
  assert.equal(r.cost, 12) // 7 (probe) + 5 (pin)
})

test('H: scope-preparation pinned-object revalidation is counted', async () => {
  const db = makeMemDb()
  let objectCalls = 0
  const t = makeTransport({
    nodes: syntheticNodes().slice(0, 2),
    cost: (q) => {
      if (isObject(q)) return objectCalls++ === 0 ? 0 : 3 // revalidation only
      return 0
    },
  })
  const r = await run(db, t)
  assert.equal(r.status, SLICE_STATUS.RESOLVE_READY)
  assert.equal(r.cost, 3)
})

test('I: history page costs are counted per page', async () => {
  const db = makeMemDb()
  const t = makeTransport({
    nodes: syntheticNodes().slice(0, 30),
    pageSize: 10,
    cost: pageCosts(4),
  })
  const r = await run(db, t)
  assert.equal(r.status, SLICE_STATUS.RESOLVE_READY)
  assert.equal(r.cost, 12) // 3 pages x 4
})

test('J: identical retry counts both responses; retry remaining is authoritative', async () => {
  const db = makeMemDb()
  const t = makeTransport({ nodes: syntheticNodes().slice(0, 3) })
  let historyCalls = 0
  const orig = t.graphql
  t.graphql = async (q, v) => {
    if (isHistory(q)) {
      historyCalls++
      if (historyCalls === 1) {
        // first response consumed quota but the pinned object was unusable
        return { repository: { object: null }, rateLimit: { cost: 7, remaining: 4900, resetAt: 'x1' } }
      }
      const ok = await orig(q, v)
      return { ...ok, rateLimit: { cost: 11, remaining: 4700, resetAt: 'x2' } }
    }
    return orig(q, v)
  }
  const r = await run(db, t)
  assert.equal(historyCalls, 2)
  // probe(1) + pin(1) + scope-prep revalidation(1) + first page(7) + retry(11)
  assert.equal(r.cost, 21)
  assert.equal(r.remaining, 4700) // retry telemetry wins, not the failed shape's
})

test('K: a completed response below the reserve stops the NEXT request', async () => {
  const db = makeMemDb()
  const t = makeTransport({
    nodes: syntheticNodes().slice(0, 3),
    remaining: (q) => (isProbe(q) ? RATE_LIMIT_RESERVE - 1 : 5000),
  })
  const r = await run(db, t)
  assert.equal(r.status, SLICE_STATUS.RATE_LIMITED)
  assert.equal(t.calls.length, 1) // the HEAD probe ran — pin validation never issued
  assert.equal((await db.loadSync()).building_version, null)
})

test('K2: page response below the reserve commits, then the next page is never issued', async () => {
  const db = makeMemDb()
  const t = makeTransport({
    nodes: syntheticNodes().slice(0, 20),
    pageSize: 10,
    remaining: (q) => (isHistory(q) ? RATE_LIMIT_RESERVE - 1 : 5000),
  })
  const r = await run(db, t)
  assert.equal(r.status, SLICE_STATUS.RATE_LIMITED)
  const pages = t.calls.filter((c) => isHistory(c.query))
  assert.equal(pages.length, 1) // page 1 committed; page 2 never requested
  assert.ok(db.workRows().length > 0)
})

test('L: build-start/pin cost consumption prevents history paging', async () => {
  const db = makeMemDb()
  const t = makeTransport({ nodes: syntheticNodes(), cost: () => 3 })
  const r = await run(db, t, { costBudget: 5 })
  // probe(3) + pin(3) = 6 >= 5 — the scope-prep revalidation and every
  // history page are blocked; the initialized build resumes safely next slice
  assert.equal(r.status, SLICE_STATUS.SLICE_BUDGET)
  assert.equal(r.cost, 6)
  const pages = t.calls.filter((c) => isHistory(c.query))
  assert.equal(pages.length, 0)
  assert.equal((await db.loadSync()).building_version, 1)
})


// ══ checkpoint unknown-outcome reconciliation ═══════════════════════════
// A thrown own_checkpoint_page call may have COMMITTED — only the response
// was lost. The engine must reconcile the durable sync row before deciding:
// adopt a proven commit, retry the identical call at the expected position,
// and never let a stale worker mark phase='error' over newer state.
// (spec C is covered by crash-matrix test B; spec E by crash-matrix test K)

test('UA: page commits then response is lost — reconcile adopts it, no replay', async () => {
  const nodes = syntheticNodes().slice(0, 30)
  const db = makeMemDb()
  const attempts = []
  let thrown = false
  const orig = db.rpc.bind(db)
  db.rpc = async (fn, args) => {
    if (fn !== 'own_checkpoint_page') return orig(fn, args)
    attempts.push(structuredClone(args))
    const r = await orig(fn, args) // the in-memory commit LANDS
    if (!thrown) { thrown = true; throw new Error('response lost after commit') }
    return r
  }
  const r = await run(db, makeTransport({ nodes, pageSize: 10 }))
  assert.equal(r.status, SLICE_STATUS.RESOLVE_READY)
  // 3 pages -> exactly 3 checkpoint calls: reconciliation recognized the
  // commit on the first durable read and never retried or replayed
  assert.equal(attempts.length, 3)
  const sync = await db.loadSync()
  assert.equal(sync.phase, 'history')
  assert.equal(sync.error, null)
  assert.equal(sync.history_cursor.current.pass, 'resolve')
  // counted exactly once — the full stream projects to the reducer result
  const expected = reduceHistoryToMonthly({ repositoryId: REPO, scope: { id: 's' }, nodes })
  assert.deepEqual(projectWorkToMonthly(db.workRows()).months, expected.months)
})

test('UB: final page commits then response is lost — reconcile returns resolve-ready', async () => {
  const nodes = syntheticNodes().slice(0, 15)
  const db = makeMemDb()
  const attempts = []
  const orig = db.rpc.bind(db)
  db.rpc = async (fn, args) => {
    if (fn !== 'own_checkpoint_page') return orig(fn, args)
    attempts.push(structuredClone(args))
    const r = await orig(fn, args) // commit lands — B1 flips pass -> resolve
    if (args.p_last_page === true) throw new Error('response lost after commit')
    return r
  }
  const r = await run(db, makeTransport({ nodes, pageSize: 10 }))
  assert.equal(r.status, SLICE_STATUS.RESOLVE_READY)
  assert.equal(attempts.length, 2) // one call per page — no replay
  const cur = (await db.loadSync()).history_cursor.current
  assert.equal(cur.pass, 'resolve')
  assert.equal(cur.cursor, null)
  assert.equal(cur.accumulate_done, true)
  const sync = await db.loadSync()
  assert.equal(sync.phase, 'history')
  assert.equal(sync.error, null)
  const expected = reduceHistoryToMonthly({ repositoryId: REPO, scope: { id: 's' }, nodes })
  assert.deepEqual(projectWorkToMonthly(db.workRows()).months, expected.months)
})

test('UD: commit landed, reconcile read raced it, retry returns stale', async () => {
  const nodes = syntheticNodes().slice(0, 30)
  const db = makeMemDb()
  const attempts = []
  let preCommit = null
  const orig = db.rpc.bind(db)
  db.rpc = async (fn, args) => {
    if (fn !== 'own_checkpoint_page') return orig(fn, args)
    attempts.push(structuredClone(args))
    if (attempts.length === 1) {
      preCommit = structuredClone(await db.loadSync()) // durable row BEFORE commit
      await orig(fn, args)                             // commit lands
      throw new Error('response lost')
    }
    return orig(fn, args)
  }
  const origLoad = db.loadSync.bind(db)
  db.loadSync = async () => {
    // the first reconcile read still shows the pre-commit position, so the
    // engine retries — and the real CAS answers 'stale' for the replay
    if (preCommit) { const p = preCommit; preCommit = null; return p }
    return origLoad()
  }
  const r = await run(db, makeTransport({ nodes, pageSize: 10 }))
  assert.equal(r.status, SLICE_STATUS.RESOLVE_READY)
  // commit+throw, identical retry -> stale, then the remaining 2 pages
  assert.equal(attempts.length, 4)
  assert.deepEqual(attempts[1], attempts[0])
  const sync = await db.loadSync()
  assert.equal(sync.phase, 'history')
  assert.equal(sync.error, null)
  const expected = reduceHistoryToMonthly({ repositoryId: REPO, scope: { id: 's' }, nodes })
  assert.deepEqual(projectWorkToMonthly(db.workRows()).months, expected.months)
})

test('UF: a stalled worker cannot poison a cursor another worker advanced', async () => {
  const nodes = syntheticNodes().slice(0, 60)
  const db = makeMemDb()
  const t1 = makeTransport({ nodes, pageSize: 10, cost: pageCosts(1) })
  const first = await run(db, t1, { costBudget: 1, workerId: 'A-slice-1' })
  assert.equal(first.status, SLICE_STATUS.SLICE_BUDGET) // page 1 -> idx:10
  const st1 = await db.loadSync()
  const scopeId = st1.history_cursor.current.scope_id
  assert.equal(st1.history_cursor.current.cursor, 'idx:10')

  // Worker A's next slice: its checkpoint request never reaches the DB —
  // while it is in flight worker B commits two further pages through the
  // real CAS
  const orig = db.rpc.bind(db)
  let fired = false
  db.rpc = async (fn, args) => {
    if (fn !== 'own_checkpoint_page' || fired) return orig(fn, args)
    fired = true
    for (const [from, to] of [['idx:10', 'idx:20'], ['idx:20', 'idx:30']]) {
      await orig(fn, {
        p_user: USER, p_repository: REPO, p_version: 1, p_scope: scopeId,
        p_pass: 'accumulate', p_expected_cursor: from, p_next_cursor: to,
        p_deltas: [], p_identities: [], p_last_page: false,
      })
    }
    throw new Error('A: request lost in flight')
  }
  const r = await run(db, makeTransport({ nodes, pageSize: 10 }), { workerId: 'A-stale' })
  // A defers to the canonical row — never an error from stale knowledge
  assert.equal(r.status, SLICE_STATUS.STALE)
  const sync = await db.loadSync()
  assert.equal(sync.phase, 'history')
  assert.equal(sync.error, null)
  assert.equal(sync.history_cursor.current.cursor, 'idx:30')
  assert.equal(await isResumable(db, sync), true)
  // position-awareness proof: an error write pinned to A's attempted
  // position cannot land on the advanced row — while the same write at the
  // CURRENT position would
  const current = (await db.loadSync()).history_cursor
  assert.equal(await db.casSync({
    userId: USER, repositoryId: REPO,
    match: { building_version: 1, history_cursor: current },
    patch: {},
  }), true)
  const poisoned = await db.casSync({
    userId: USER, repositoryId: REPO,
    match: {
      building_version: 1,
      history_cursor: { ...current, current: { scope_id: scopeId, pass: 'accumulate', cursor: 'idx:10' } },
    },
    patch: { phase: 'error', error: 'OWNERSHIP_INTERNAL_ERROR' },
  })
  assert.equal(poisoned, false)
  assert.equal((await db.loadSync()).phase, 'history')
  // B's frontier is authoritative and resumable
  const done = await driveToTerminal(db, makeTransport({ nodes, pageSize: 10 }))
  assert.equal(done.status, SLICE_STATUS.RESOLVE_READY)
})

test('UG: a stalled worker cannot poison the ACCUMULATE -> RESOLVE transition', async () => {
  const nodes = syntheticNodes().slice(0, 20)
  const db = makeMemDb()
  const t1 = makeTransport({ nodes, pageSize: 10, cost: pageCosts(1) })
  const first = await run(db, t1, { costBudget: 1, workerId: 'A-slice-1' })
  assert.equal(first.status, SLICE_STATUS.SLICE_BUDGET) // page 1 -> idx:10

  // A attempts the final page; the call commits under another worker's
  // takeover (pass flips to resolve) before A's failure is handled
  let calls = 0
  const orig = db.rpc.bind(db)
  db.rpc = async (fn, args) => {
    if (fn !== 'own_checkpoint_page') return orig(fn, args)
    calls += 1
    const r = await orig(fn, args) // the final-page commit lands
    throw new Error('A: response lost')
  }
  const r = await run(db, makeTransport({ nodes, pageSize: 10 }), { workerId: 'A-stale' })
  assert.equal(r.status, SLICE_STATUS.RESOLVE_READY)
  assert.equal(calls, 1) // committed once, never replayed
  const sync = await db.loadSync()
  assert.equal(sync.phase, 'history') // no error overwrite on the handoff
  assert.equal(sync.error, null)
  const cur = sync.history_cursor.current
  assert.equal(cur.pass, 'resolve')
  assert.equal(cur.accumulate_done, true)
  // no duplicate counters — the stream still projects to the reducer result
  const expected = reduceHistoryToMonthly({ repositoryId: REPO, scope: { id: 's' }, nodes })
  assert.deepEqual(projectWorkToMonthly(db.workRows()).months, expected.months)
})
