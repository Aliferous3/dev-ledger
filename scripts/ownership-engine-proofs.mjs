// ACCUMULATE engine proofs — the Phase 1C-B2 engine running against the
// REAL migration-013 substrate on real PostgreSQL. Invoked by the recovery
// drill on drill_src after seeding; every scenario uses its own throwaway
// tenant.
//
// The transport is synthetic (no GitHub) but the persistence path is fully
// real: own_build_preflight, own_build_init, own_checkpoint_page CAS, the
// lease CAS, membership/scopes upserts, and the abandon path all execute
// against actual constraints and triggers.
//
//   E1 end-to-end fresh build -> accumulate -> resolve-ready handoff
//   E2 differential: work-state projects EXACTLY to the canonical reducer
//   E3 restart-between-every-page resume equivalence
//   E4 committed-page replay with a stale cursor -> 'stale', no double-count
//   E5 wrong expected cursor / wrong version -> 'stale', no writes
//   E6 checkpoint transport/DB failure -> no partial delta, phase='error'
//   E7 pinned-object vanished -> one retry -> fail closed, pin preserved
//   E8 lease: live foreign wins, expired is taken, released on exit
//   E9 invalid durable state -> canonical abandon
//  E10 privacy: zero identity fields anywhere in persisted ownership state
//  E11 same-page is_bot drift -> app guard fails closed before the RPC
//  E12 cross-page is_bot drift -> the real stored-row guard rejects page 2

import crypto from 'node:crypto'
import { runAccumulateSlice, SLICE_STATUS } from '../lib/ownership/accumulate.mjs'
import { reduceHistoryToMonthly } from '../lib/ownership/history-reducer.mjs'
import { makePgOwnershipDb } from './ownership-pg-db.mjs'
import { projectWorkToMonthly } from './ownership-work-projection.mjs'

const OID = 'a'.repeat(40)
const node = (date, user) => ({ committedDate: date, author: { user: user ?? null } })
const nd = (id, login, date) => node(date, { id: `U_${id}`, login })

function syntheticNodes() {
  const nodes = []
  const months = ['2025-10', '2025-11', '2025-12']
  for (let m = 0; m < months.length; m++) {
    for (let c = 0; c < 30; c++) {
      const touches = c < 5 ? 40 - m : c === 24 || c === 25 || c === 26 ? 7 : 2 + ((c + m) % 9)
      for (let t = 0; t < touches; t++) {
        nodes.push(nd(`pg${m}_${c}`, `engineuser${m}_${c}`, `${months[m]}-${String(1 + (t % 27)).padStart(2, '0')}T12:00:00Z`))
      }
    }
    for (let t = 0; t < 5; t++) nodes.push(nd(`pgbot${m}`, `ci[bot]`, `${months[m]}-05T08:00:00Z`))
    for (let t = 0; t < 9; t++) nodes.push(node(`${months[m]}-15T09:00:00Z`, null))
  }
  return nodes
}

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

// build-start calls are telemetry-free; history pages cost 1 each — keeps
// "one committed page per slice" semantics under the unified slice budget
const PAGE_COST = (q) => (q.includes('history(first') ? 1 : 0)

export async function engineProofs(sql) {
  const problems = []
  const check = (ok, msg) => { if (!ok) problems.push(msg) }
  const tenantIds = []
  let seq = 0
  async function tenant() {
    const uid = crypto.randomUUID()
    const repoId = crypto.randomUUID()
    const gid = 81000000 + ++seq
    await sql`insert into users (id, github_user_id, github_login) values (${uid}, ${gid}, ${'eng-' + seq})`
    await sql`insert into repositories (id, user_id, github_repo_id, owner_login, name, full_name)
              values (${repoId}, ${uid}, ${gid}, 'acme', ${'engr' + seq}, ${'acme/engr' + seq})`
    tenantIds.push(uid)
    return { uid, repoId }
  }
  const env = (t) => ({ OWNERSHIP_INGEST_ENABLED: 'true', OWNERSHIP_CANARY_REPOSITORY_IDS: t.repoId })
  const run = (t, transport, opts = {}) =>
    runAccumulateSlice({ db: makePgOwnershipDb(sql), transport, repositoryId: t.repoId, env: env(t), ...opts })
  const syncRow = (t) =>
    sql`select * from ownership_sync_state where repository_id = ${t.repoId}`.then((r) => r[0] ?? null)
  const workRows = (t) =>
    sql`select * from ownership_history_work where repository_id = ${t.repoId}`.then((r) => r)

  async function drive(t, transport, opts = {}, cap = 500) {
    for (let i = 0; i < cap; i++) {
      const r = await run(t, transport, opts)
      if (r.status !== SLICE_STATUS.SLICE_BUDGET && r.status !== SLICE_STATUS.BLOCKED) return r
    }
    return { status: 'never-terminated' }
  }

  // ── E1: end-to-end fresh build on the real CAS substrate ────────────────
  {
    const t = await tenant()
    const nodes = syntheticNodes()
    const transport = makeTransport({ nodes })
    const r = await drive(t, transport)
    check(r.status === SLICE_STATUS.RESOLVE_READY, `E1: expected resolve-ready, got ${r.status}`)
    const st = await syncRow(t)
    check(st?.building_version === 1, 'E1: building_version must be 1')
    check(st?.phase === 'history', 'E1: phase must remain history for B3')
    check(st?.history_cursor?.pinned_oid === OID, 'E1: pinned_oid must be the immutable pin')
    check(st?.history_cursor?.current?.pass === 'resolve', 'E1: scope must rest at resolve')
    check(st?.history_cursor?.current?.cursor === null, 'E1: resolve cursor must be fresh')
    check(typeof st?.history_cursor?.lease === 'undefined' || st?.history_cursor?.lease === null,
      'E1: lease must be released at slice end')
    const work = await workRows(t)
    check(work.length > 0, 'E1: history_work must hold accumulated counters')
    const bw = await sql`select count(*)::int c from ownership_contributor_build_work where repository_id = ${t.repoId}`
    const cc = await sql`select count(*)::int c from ownership_contributors where repository_id = ${t.repoId}`
    const sn = await sql`select count(*)::int c from ownership_snapshots where repository_id = ${t.repoId}`
    check(bw[0].c === 0, 'E1: contributor_build_work must stay empty in B2')
    check(cc[0].c === 0, 'E1: no retained contributors may be created in B2')
    check(sn[0].c === 0, 'E1: no snapshots may be materialized in B2')
    const pages = transport.calls.filter((c) => c.query.includes('history(first'))
    check(pages.length >= 2, `E1: expected multiple pinned pages, got ${pages.length}`)
    check(pages.every((c) => c.vars.oid === OID && c.query.includes('object(oid: $oid)')
      && !c.query.includes('defaultBranchRef')),
      'E1: every history page must anchor at object(oid:$oid), never HEAD')
    // pending_scopes = the deterministic (depth, scope_path_hash) ordering
    const members = await sql`select s.id, s.depth, s.scope_path_hash
        from ownership_scope_versions v join ownership_scopes s on s.id = v.scope_id
       where v.repository_id = ${t.repoId} and v.calculation_version = 1
       order by s.depth, s.scope_path_hash`
    check(JSON.stringify(st?.pending_scopes) === JSON.stringify(members.map((m) => m.id)),
      'E1: pending_scopes must equal membership ordered by (depth, scope_path_hash)')
  }

  // ── E2: differential — work state projects exactly to the reducer ────────
  {
    const nodes = syntheticNodes()
    for (const pageSize of [1, 37, 100, 5000]) {
      const tt = await tenant()
      const expected = reduceHistoryToMonthly({ repositoryId: tt.repoId, scope: { id: 'repo' }, nodes })
      const r = await drive(tt, makeTransport({ nodes, pageSize }))
      check(r.status === SLICE_STATUS.RESOLVE_READY, `E2[${pageSize}]: expected resolve-ready, got ${r.status}`)
      const work = await workRows(tt)
      const projected = projectWorkToMonthly(work)
      check(JSON.stringify(projected.months) === JSON.stringify(expected.months),
        `E2[${pageSize}]: projected months must equal the reducer's months`)
      const expectedKeys = [...expected.contributor_candidates.map((c) => c.contributor_key)].sort()
      check(JSON.stringify([...projected.represented].sort()) === JSON.stringify(expectedKeys),
        `E2[${pageSize}]: represented key set must equal the reducer's`)
      for (const c of expected.contributor_candidates) {
        if (!/^[0-9a-f]{64}$/.test(c.contributor_key)) continue
        const b = projected.candidateBounds.get(c.contributor_key)
        check(b?.first_seen_at?.slice(0, 19) === String(c.first_seen_at).slice(0, 19)
          && b?.last_seen_at?.slice(0, 19) === String(c.last_seen_at).slice(0, 19)
          && b?.is_bot === c.is_bot,
          `E2[${pageSize}]: candidate bounds must match for ${c.contributor_key.slice(0, 8)}`)
      }
    }
  }

  // ── E3: restart between every page — identical accumulation ──────────────
  // Both runs share one tenant so repo-scoped work_keys are comparable:
  // walk to completion, canonical-abandon the version, rebuild the SAME
  // node stream — the restarted counters must be identical.
  {
    const t = await tenant()
    const nodes = syntheticNodes().slice(0, 220)
    await drive(t, makeTransport({ nodes }))
    const p1 = projectWorkToMonthly(await workRows(t))
    await sql`select own_abandon_build(${t.uid}, ${t.repoId}, 1)`
    const r = await drive(t, makeTransport({ nodes, pageSize: 10, cost: PAGE_COST }), { costBudget: 1 })
    check(r.status === SLICE_STATUS.RESOLVE_READY, `E3: restarted walk must finish, got ${r.status}`)
    const p2 = projectWorkToMonthly(await workRows(t))
    check(JSON.stringify(p1.months) === JSON.stringify(p2.months),
      'E3: restarted accumulation must equal the single-shot result')
  }

  // ── E4/E5: stale replay + wrong-version on the real CAS ──────────────────
  {
    const t = await tenant()
    const transport = makeTransport({ nodes: syntheticNodes().slice(0, 60), pageSize: 20, cost: PAGE_COST })
    await run(t, transport, { costBudget: 1 }) // exactly one committed page
    const before = await workRows(t)
    const st = await syncRow(t)
    const scopeId = st.history_cursor.current.scope_id
    const r1 = await sql`select own_checkpoint_page(${t.uid}, ${t.repoId}, 1, ${scopeId},
        'accumulate', null, 'idx:20', '[]'::jsonb, '[]'::jsonb, false)`
    check(r1[0].own_checkpoint_page === 'stale', 'E4: replayed page with stale cursor must return stale')
    const after = await workRows(t)
    check(JSON.stringify(after) === JSON.stringify(before), 'E4: stale replay must not double-count')
    const r2 = await sql`select own_checkpoint_page(${t.uid}, ${t.repoId}, 99, ${scopeId},
        'accumulate', 'idx:20', 'idx:40', '[]'::jsonb, '[]'::jsonb, false)`
    check(r2[0].own_checkpoint_page === 'stale', 'E5: wrong version must return stale')
  }

  // ── E6: checkpoint failure mid-walk — no partial delta ───────────────────
  {
    const t = await tenant()
    const db = makePgOwnershipDb(sql)
    let n = 0
    const orig = db.rpc.bind(db)
    db.rpc = async (fn, args) => {
      if (fn === 'own_checkpoint_page' && n++ === 1) throw new Error('simulated tx abort')
      return orig(fn, args)
    }
    const r = await runAccumulateSlice({
      db, transport: makeTransport({ nodes: syntheticNodes(), pageSize: 50 }),
      repositoryId: t.repoId, env: env(t),
    })
    check(r.status === SLICE_STATUS.ERROR && r.code === 'OWNERSHIP_INTERNAL_ERROR',
      `E6: expected error/OWNERSHIP_INTERNAL_ERROR, got ${r.status}/${r.code ?? 'none'}`)
    const st = await syncRow(t)
    check(st?.phase === 'error', 'E6: phase must be error after checkpoint failure')
    const work = await workRows(t)
    check(work.length > 0, 'E6: page-1 counters must remain committed')
    check(st.history_cursor.current.cursor === 'idx:50',
      'E6: durable cursor must rest at the last COMMITTED page')
  }

  // ── E7: pinned object vanished — retry once, fail closed, pin preserved ──
  {
    const t = await tenant()
    const transport = makeTransport({ nodes: syntheticNodes().slice(0, 10) })
    let historyCalls = 0
    const orig = transport.graphql
    transport.graphql = async (q, v) => {
      if (q.includes('history(first')) {
        historyCalls++
        return { repository: { object: null }, rateLimit: { cost: 1, remaining: 5000, resetAt: 'x' } }
      }
      return orig(q, v)
    }
    const r = await run(t, transport)
    check(r.status === SLICE_STATUS.ERROR && r.code === 'OWNERSHIP_HISTORY_FAILED',
      `E7: expected fail-closed error, got ${r.status}/${r.code ?? 'none'}`)
    check(historyCalls === 2, `E7: exactly one retry expected, got ${historyCalls}`)
    const st = await syncRow(t)
    check(st?.phase === 'error' && st?.history_cursor?.pinned_oid === OID,
      'E7: pin must be preserved and phase must be error — never repin mid-build')
  }

  // ── E8: lease CAS on real Postgres ────────────────────────────────────────
  {
    const t = await tenant()
    // budget stops the slice mid-build (build initialized, prep not yet run)
    // so a live history_cursor exists for the lease injection
    await run(t, makeTransport({ nodes: [] }), { costBudget: 3 })
    const st = await syncRow(t)
    const cur = { ...st.history_cursor, lease: { owner: 'foreign', expires: new Date(Date.now() + 60000).toISOString() } }
    await sql`update ownership_sync_state set history_cursor = ${sql.json(cur)}
               where repository_id = ${t.repoId}`
    const r1 = await run(t, makeTransport(), { workerId: 'other' })
    check(r1.status === SLICE_STATUS.LOCKED, `E8: live foreign lease must win, got ${r1.status}`)
    const cur2 = { ...cur, lease: { owner: 'foreign', expires: new Date(Date.now() - 1000).toISOString() } }
    await sql`update ownership_sync_state set history_cursor = ${sql.json(cur2)}
               where repository_id = ${t.repoId}`
    const r2 = await run(t, makeTransport(), { workerId: 'other', budgetMs: 0 })
    check(r2.status !== SLICE_STATUS.LOCKED, `E8: expired lease must be taken, got ${r2.status}`)
  }

  // ── E9: invalid durable state -> canonical abandon ───────────────────────
  {
    const t = await tenant()
    await run(t, makeTransport({ nodes: [] }), { costBudget: 3 })
    const st = await syncRow(t)
    const bogus = { ...st.history_cursor, current: { scope_id: crypto.randomUUID(), pass: 'accumulate', cursor: null } }
    await sql`update ownership_sync_state set history_cursor = ${sql.json(bogus)}
               where repository_id = ${t.repoId}`
    const r = await run(t, makeTransport())
    check(r.status === SLICE_STATUS.ABANDONED, `E9: expected abandoned, got ${r.status}`)
    const after = await syncRow(t)
    check(after?.building_version === null && after?.phase === 'pending',
      'E9: abandon must clear the building version')
    check((await workRows(t)).length === 0, 'E9: abandon must purge ephemeral counters')
  }

  // ── E10: no identity field anywhere in persisted ownership state ─────────
  {
    const t = await tenant()
    const nodes = syntheticNodes()
    await drive(t, makeTransport({ nodes }))
    const st = await syncRow(t)
    const cursorText = JSON.stringify(st?.history_cursor ?? {})
    for (const needle of ['engineuser', 'pgbot', 'U_pg', 'github_node_id', 'display_login', 'login']) {
      check(!cursorText.includes(needle), `E10: history_cursor leaked ${needle}`)
    }
    const leaked = await sql`select count(*)::int c from ownership_history_work
        where repository_id = ${t.repoId} and (work_key like 'U_%' or work_key like '%login%')`
    check(leaked[0].c === 0, 'E10: work_key must be opaque — no plaintext identity')
    const bw = await sql`select count(*)::int c from ownership_contributor_build_work where repository_id = ${t.repoId}`
    check(bw[0].c === 0, 'E10: identity staging must be empty during ACCUMULATE')
  }

  // ── E11: same-page is_bot drift — the app-side page guard fails closed ───
  // 'person' then 'person[bot]' share one node ID -> one work_key; the
  // frozen page-wide classification map throws before own_checkpoint_page.
  {
    const t = await tenant()
    const transport = makeTransport({
      nodes: [
        nd('drift1', 'person', '2025-10-03T10:00:00Z'),
        nd('drift1', 'person[bot]', '2025-10-04T10:00:00Z'),
      ],
    })
    const r = await run(t, transport)
    check(r.status === SLICE_STATUS.ERROR && r.code === 'OWNERSHIP_HISTORY_FAILED',
      `E11: expected error/OWNERSHIP_HISTORY_FAILED, got ${r.status}/${r.code ?? 'none'}`)
    const st = await syncRow(t)
    check(st?.phase === 'error' && st?.error === 'OWNERSHIP_HISTORY_FAILED',
      'E11: closed taxonomy only — no provider text in the error column')
    check(st?.history_cursor?.current?.cursor === null,
      'E11: durable cursor must not advance past the drifting page')
    check((await workRows(t)).length === 0,
      'E11: no page counters may commit')
    const serialized = JSON.stringify({ e: st?.error, c: st?.history_cursor })
    check(!serialized.includes('person') && !serialized.includes('U_drift1'),
      'E11: persisted state must carry no login or node id')
  }

  // ── E12: cross-page drift — the real stored-row guard rejects page 2 ─────
  // Page 1 freezes is_bot=false; page 2 arrives with is_bot=true for the
  // same (version, scope, period, work_key). The application-side page
  // guard cannot see across pages — PostgreSQL's stored-row check is the
  // complementary barrier and must reject without moving the cursor.
  {
    const t = await tenant()
    const transport = makeTransport({
      nodes: [
        nd('drift2', 'person', '2025-10-03T10:00:00Z'),
        nd('drift2', 'person[bot]', '2025-10-04T10:00:00Z'),
      ],
      pageSize: 1,
      cost: PAGE_COST,
    })
    const r1 = await run(t, transport, { costBudget: 1 })
    check(r1.status === SLICE_STATUS.SLICE_BUDGET,
      `E12: page 1 must commit then stop, got ${r1.status}`)
    const r2 = await run(t, transport)
    check(r2.status === SLICE_STATUS.ERROR && r2.code === 'OWNERSHIP_INTERNAL_ERROR',
      `E12: stored-row drift guard must fail closed, got ${r2.status}/${r2.code ?? 'none'}`)
    const st = await syncRow(t)
    check(st?.history_cursor?.current?.cursor === 'idx:1',
      'E12: durable cursor must rest at the last good page')
    const work = await workRows(t)
    check(work.length === 1 && work[0].is_bot === false && work[0].touch_commits === 1,
      'E12: page-1 counters stay; the drifting page writes nothing')
  }

  // every proof tenant self-destructs — user deletion cascades through
  // repositories into every ownership table, leaving the seeded fixture
  // untouched for the backup/restore leg
  await sql`delete from users where id = any(${tenantIds})`

  return problems
}
