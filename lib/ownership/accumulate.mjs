// ACCUMULATE checkpoint engine — Phase 1C-B2.
//
// Implements the crash-safe history walk from the checkpoint architecture:
// one scope at a time, every page pinned to the build's immutable commit
// OID, every page committed through own_checkpoint_page's compare-and-set
// so a replayed page can never double-count. Application code holds NO
// idempotency state — the DB CAS is the exactly-once authority (§5.5).
//
// This tranche is ACCUMULATE ONLY. p_identities is always [] — RESOLVE,
// COMMIT, promotion, and retained snapshots are B3 territory.
//
// PRIVACY (§9): node ids and logins exist in memory only long enough to
// derive pseudonymous work_keys — they are never persisted, logged, or
// placed in errors. All thrown/loggable values use the closed ownership
// error taxonomy; provider payload text never crosses the boundary.
//
// The engine is transport/db agnostic for testability:
//   db.loadRepo(repositoryId)
//   db.ensureSyncRow(userId, repositoryId)
//   db.loadSync(userId, repositoryId)            -> sync-state row | null
//   db.rpc(fn, namedArgs)                        -> scalar (throws on error)
//   db.upsertScopes(rows)                        -> [{id, scope_path_hash, depth}]
//   db.insertMembership(rows)
//   db.membershipFor(userId, repositoryId, version) -> [{scope_id, excluded}]
//   db.loadScope(scopeId)                        -> {display_path, scope_type} | null
//   db.casSync({userId, repositoryId, match, patch}) -> bool
//       match = optional {building_version, history_cursor} equality
//       predicates; a null value means "IS NULL", an absent key means
//       "no predicate". patch is a plain column→value map.
//   transport.graphql(query, vars)               -> response data
//   transport.getTree({owner, repo, treeSha})    -> {tree, truncated}

import crypto from 'node:crypto'
import { RateLimitError, GitHubAuthError } from '../github.mjs'
import { assertOwnershipIngestAllowed } from './gate.mjs'
import { deriveScopeCandidates } from './scopes.mjs'
import { reducePageDeltas } from './page-deltas.mjs'
import {
  ownershipHeadProbeQuery,
  pinnedObjectQuery,
  pinnedHistoryPageQuery,
  assertOwnershipQuerySafe,
  assertOwnershipResponseSafe,
} from './queries.mjs'

// Bounded-slice model (§15): ~40s wall clock, ~300 measured GraphQL points
// per invocation, 500-point rate-limit reserve, ~90s soft lease.
export const SLICE_BUDGET_MS = 40_000
export const SLICE_COST_BUDGET = 300
export const RATE_LIMIT_RESERVE = 500
export const LEASE_TTL_MS = 90_000

const OID_RE = /^[0-9a-f]{40}$/
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Closed internal status vocabulary — the caller may act on these; they are
// never persisted verbatim and never carry provider text.
export const SLICE_STATUS = Object.freeze({
  RESOLVE_READY: 'resolve-ready',   // scope finished ACCUMULATE — B2 handoff
  SCOPES_DRAINED: 'scopes-drained', // nothing pending — B3 promote territory
  SLICE_BUDGET: 'slice-budget',     // paused cleanly at a page boundary
  RATE_LIMITED: 'rate-limited',
  LOCKED: 'locked',                 // another live worker holds the lease
  BLOCKED: 'blocked',               // a build appeared between preflight and init
  STALE: 'stale',                   // build vanished/version changed mid-flight
  ABANDONED: 'abandoned',           // invalid durable state — canonical abandon ran
  ERROR: 'error',
})

// ── slice budget ──────────────────────────────────────────────────────────
// ONE auditable per-slice budget shared through build start, pin
// validation, scope preparation, and history paging (§15). Every GraphQL
// response — HEAD probe, pinned-object validations, history pages, and the
// identical pinned-history retry — records its measured cost/remaining
// here. No persistence: the durable checkpoint stays authoritative.
function makeBudget({ now, budgetMs, costBudget }) {
  return {
    deadline: now() + budgetMs,
    costBudget,
    cost: 0,
    remaining: null,
    resetAt: null,
  }
}

// Every returned rateLimit block contributes — never assume cost=1. The
// latest response's remaining/resetAt is authoritative (a retry's values
// replace the failed-shape response's).
function recordRl(data, budget) {
  const rl = data?.rateLimit
  if (rl) {
    if (Number.isFinite(rl.cost)) budget.cost += rl.cost
    if (rl.remaining != null) budget.remaining = rl.remaining
    if (rl.resetAt) budget.resetAt = rl.resetAt
  }
}

// Enforced BEFORE each subsequent request: a just-completed request may
// legitimately drop remaining below the reserve — what is forbidden is
// knowingly issuing the NEXT request afterwards.
function budgetStop(budget, now) {
  if (now() >= budget.deadline || budget.cost >= budget.costBudget) {
    return SLICE_STATUS.SLICE_BUDGET
  }
  if (budget.remaining != null && budget.remaining < RATE_LIMIT_RESERVE) {
    return SLICE_STATUS.RATE_LIMITED
  }
  return null
}

// ── transport + error classification ──────────────────────────────────────

// Every GraphQL call goes through here: the query text is re-audited at the
// trust boundary, its telemetry feeds the shared slice budget FIRST (the
// request consumed quota even if the response is then rejected), and the
// response is scanned for contract-forbidden keys before use.
async function gql(transport, query, vars, budget) {
  const data = await transport.graphql(assertOwnershipQuerySafe(query), vars)
  recordRl(data, budget)
  return assertOwnershipResponseSafe(data)
}

function classifyFailure(e) {
  if (e instanceof RateLimitError) return { status: SLICE_STATUS.RATE_LIMITED }
  if (e instanceof GitHubAuthError) {
    return { status: SLICE_STATUS.ERROR, code: 'GITHUB_ACCESS_REVOKED' }
  }
  return { status: SLICE_STATUS.ERROR, code: 'OWNERSHIP_HISTORY_FAILED' }
}

// The durable position a worker attempted work at: the slice-entry
// history_cursor (pin, build_started_at, this worker's lease) with
// `current` pinned to the attempted (scope, pass, cursor). Checkpoints only
// ever rewrite history_cursor.current, so sibling keys still match — while
// any other worker's takeover changes the lease and fails the match.
function attemptedHistoryCursor(st, current) {
  return { ...(st?.history_cursor ?? {}), current: current ?? null }
}

// Position-aware error marking. phase='error' leaves build state for
// operator inspection until the documented sweep/abandon path runs (§7),
// but the write may land ONLY while durable state is still exactly at the
// position the worker believes failed: a stale worker must never set
// phase='error' over another worker's committed progress (§5.5).
// Returns whether the CAS landed; a thrown read/update counts as not landed.
async function markErrorAt(db, st, current, code) {
  try {
    return await db.casSync({
      userId: st.user_id,
      repositoryId: st.repository_id,
      match: {
        building_version: st.building_version,
        history_cursor: attemptedHistoryCursor(st, current),
      },
      patch: { phase: 'error', error: code },
    })
  } catch {
    return false
  }
}

// When the error CAS cannot land the row has moved under us — a stale
// worker defers to durable state instead of marking stale knowledge over
// live state. Maps the canonical row to the closed slice vocabulary.
async function followDurableState(db, st, fallback) {
  let fresh
  try {
    fresh = await db.loadSync(st.user_id, st.repository_id)
  } catch {
    fresh = null
  }
  if (fresh?.building_version !== st.building_version) {
    return { status: SLICE_STATUS.STALE }
  }
  if (fresh.phase === 'error') {
    return { status: SLICE_STATUS.ERROR, code: fresh.error ?? 'OWNERSHIP_INTERNAL_ERROR' }
  }
  if (fresh.phase !== 'history') return { status: SLICE_STATUS.STALE }
  if (fresh.history_cursor?.current?.pass === 'resolve') {
    return { status: SLICE_STATUS.RESOLVE_READY }
  }
  return fallback
}

// Closed error path for in-build failures: mark if-and-only-if the durable
// row is still exactly at the attempted position; otherwise follow it.
async function failAtPosition(db, st, current, code) {
  if (await markErrorAt(db, st, current, code)) {
    return { status: SLICE_STATUS.ERROR, code }
  }
  return followDurableState(db, st, { status: SLICE_STATUS.ERROR, code })
}

// ── lease (§14) ───────────────────────────────────────────────────────────
// Soft per-repo worker lease inside history_cursor — no separate lease
// table. The page-level CAS remains the real correctness barrier; the
// lease only bounds duplicate work. A live foreign lease wins the slice;
// an expired or absent one is taken.
async function claimLease(db, st, workerId, now) {
  const lease = st.history_cursor?.lease
  if (lease?.owner && lease.owner !== workerId) {
    if (Number.isFinite(Date.parse(lease.expires ?? '')) && Date.parse(lease.expires) > now()) {
      return null
    }
  }
  const cursor = {
    ...st.history_cursor,
    lease: { owner: workerId, expires: new Date(now() + LEASE_TTL_MS).toISOString() },
  }
  const ok = await db.casSync({
    userId: st.user_id,
    repositoryId: st.repository_id,
    match: { building_version: st.building_version, history_cursor: st.history_cursor },
    patch: { history_cursor: cursor },
  })
  return ok ? { ...st, history_cursor: cursor } : null
}

// ── §5.6b resumability ────────────────────────────────────────────────────
// A build is resumable ONLY by internal consistency — never reconstructed
// heuristically. Shape, membership, scope/pass legality, and pending-set
// membership must all hold, otherwise the caller abandons (§5.8).
export async function isResumable(db, st) {
  const V = st?.building_version
  if (V == null || st.phase !== 'history') return false
  const hc = st.history_cursor
  if (!hc || typeof hc !== 'object' || Array.isArray(hc)) return false
  if (typeof hc.pinned_oid !== 'string' || !OID_RE.test(hc.pinned_oid)) return false
  const cur = hc.current
  if (cur != null) {
    if (
      typeof cur !== 'object' ||
      !UUID_RE.test(typeof cur.scope_id === 'string' ? cur.scope_id : '') ||
      (cur.pass !== 'accumulate' && cur.pass !== 'resolve') ||
      (cur.cursor !== null && typeof cur.cursor !== 'string')
    ) {
      return false
    }
  }
  const members = await db.membershipFor(st.user_id, st.repository_id, V)
  const byId = new Map(members.map((m) => [m.scope_id, m]))
  if (cur && (!byId.has(cur.scope_id) || byId.get(cur.scope_id).excluded === true)) {
    return false
  }
  if (st.pending_scopes != null) {
    if (
      !Array.isArray(st.pending_scopes) ||
      !st.pending_scopes.every(
        (id) =>
          UUID_RE.test(typeof id === 'string' ? id : '') &&
          byId.has(id) &&
          byId.get(id).excluded !== true,
      )
    ) {
      return false
    }
  }
  return true
}

// ── build start (§5.4, split preflight → pin → init) ──────────────────────

async function startBuild({ db, transport, repo, st, budget, now }) {
  const userId = repo.user_id
  const repositoryId = repo.id

  // Step 1: preflight decides whether a build may begin. It NEVER reserves
  // one — the CAS inside own_build_init is the guard.
  const pre = await db.rpc('own_build_preflight', {
    p_user: userId,
    p_repository: repositoryId,
  })
  if (pre !== 'ready') return { status: pre } // 'blocked' | 'stale'

  // Step 2: the ONLY mutable-branch read in the engine — resolve HEAD once
  // to discover the immutable revision to pin. The shared budget gates
  // EVERY request, not just history pages.
  {
    const stop = budgetStop(budget, now)
    if (stop) return { status: stop }
  }
  let probe
  try {
    probe = await gql(transport, ownershipHeadProbeQuery(), {
      owner: repo.owner_login,
      name: repo.name,
    }, budget)
  } catch (e) {
    const r = classifyFailure(e)
    if (r.code) {
      await db.casSync({
        userId, repositoryId,
        match: { building_version: null },
        patch: { error: r.code },
      })
    }
    return r
  }
  const headOid = probe?.repository?.defaultBranchRef?.target?.oid
  if (typeof headOid !== 'string' || !OID_RE.test(headOid)) {
    await db.casSync({
      userId, repositoryId,
      match: { building_version: null },
      patch: { error: 'OWNERSHIP_HISTORY_FAILED' },
    })
    return { status: SLICE_STATUS.ERROR, code: 'OWNERSHIP_HISTORY_FAILED' }
  }

  // Step 3: the candidate must resolve as a Commit with an unchanged OID —
  // a pin established against anything else would silently mix revisions.
  {
    const stop = budgetStop(budget, now)
    if (stop) return { status: stop }
  }
  let obj
  try {
    obj = await gql(transport, pinnedObjectQuery(), {
      owner: repo.owner_login,
      name: repo.name,
      oid: headOid,
    }, budget)
  } catch (e) {
    const r = classifyFailure(e)
    if (r.code) {
      await db.casSync({
        userId, repositoryId,
        match: { building_version: null },
        patch: { error: r.code },
      })
    }
    return r
  }
  const pinned = obj?.repository?.object
  if (pinned == null || pinned.__typename !== 'Commit' || pinned.oid !== headOid) {
    await db.casSync({
      userId, repositoryId,
      match: { building_version: null },
      patch: { error: 'OWNERSHIP_HISTORY_FAILED' },
    })
    return { status: SLICE_STATUS.ERROR, code: 'OWNERSHIP_HISTORY_FAILED' }
  }

  // Step 4: guarded init — detects a concurrent build/abandon that landed
  // between preflight and now. Never write around 'blocked'/'stale'.
  const version = (st?.active_version ?? 0) + 1
  const init = await db.rpc('own_build_init', {
    p_user: userId,
    p_repository: repositoryId,
    p_new_version: version,
    p_pinned_oid: headOid,
  })
  if (init !== 'initialized') return { status: init } // 'blocked' | 'stale'
  return { status: 'started' }
}

// ── scope membership + selection (§5.3) ───────────────────────────────────
// Membership comes from deriveScopeCandidates on the PINNED tree — bounded
// (≤500 dir scopes), filtered (vendor/generated/binary/submodule), and
// ordered (depth, scope_path_hash). Overflow paths are a count only and are
// never persisted or logged.
async function prepareScopes({ db, transport, repo, st, budget, now }) {
  const userId = st.user_id
  const repositoryId = repo.id
  const V = st.building_version
  const pinnedOid = st.history_cursor.pinned_oid

  // Re-resolve the pinned object — both re-verifies the pin before heavy
  // work and yields the pinned commit's tree for scope enumeration.
  {
    const stop = budgetStop(budget, now)
    if (stop) return { ok: false, out: { status: stop } }
  }
  let data
  try {
    data = await gql(transport, pinnedObjectQuery(), {
      owner: repo.owner_login,
      name: repo.name,
      oid: pinnedOid,
    }, budget)
  } catch (e) {
    const r = classifyFailure(e)
    if (r.code) return { ok: false, out: await failAtPosition(db, st, null, r.code) }
    return { ok: false, out: r }
  }
  const obj = data?.repository?.object
  const treeOid = obj?.tree?.oid
  if (
    obj == null ||
    obj.__typename !== 'Commit' ||
    obj.oid !== pinnedOid ||
    typeof treeOid !== 'string' ||
    !OID_RE.test(treeOid)
  ) {
    return {
      ok: false,
      out: await failAtPosition(db, st, null, 'OWNERSHIP_HISTORY_FAILED'),
    }
  }

  {
    const stop = budgetStop(budget, now)
    if (stop) return { ok: false, out: { status: stop } }
  }
  let tree
  try {
    tree = await transport.getTree({ owner: repo.owner_login, repo: repo.name, treeSha: treeOid })
  } catch (e) {
    const r = classifyFailure(e)
    if (r.code) return { ok: false, out: await failAtPosition(db, st, null, r.code) }
    return { ok: false, out: r }
  }
  if (tree.truncated === true) {
    // enumeration cannot be trusted — fail closed rather than persist a
    // partial scope universe
    return {
      ok: false,
      out: await failAtPosition(db, st, null, 'OWNERSHIP_HISTORY_FAILED'),
    }
  }

  const { scopes } = deriveScopeCandidates(tree.tree)
  // excluded is deliberately absent — the column default is false and the
  // upsert must not reset base-scope exclusion state on re-derivation;
  // exclusion decisions are version-scoped (ownership_scope_versions)
  const upserted = await db.upsertScopes(
    scopes.map((c) => ({
      user_id: userId,
      repository_id: repositoryId,
      scope_path_hash: c.scope_path_hash,
      display_path: c.display_path,
      scope_type: c.scope_type,
      depth: c.depth,
    })),
  )
  await db.insertMembership(
    upserted.map((s) => ({
      user_id: userId,
      repository_id: repositoryId,
      scope_id: s.id,
      calculation_version: V,
      excluded: false,
    })),
  )
  // deterministic processing order: depth, scope_path_hash — re-derivable
  // from membership alone
  const ordered = [...upserted]
    .sort((a, b) =>
      a.depth !== b.depth
        ? a.depth - b.depth
        : a.scope_path_hash < b.scope_path_hash
          ? -1
          : a.scope_path_hash > b.scope_path_hash ? 1 : 0,
    )
    .map((s) => s.id)

  const begun = await beginScope(db, st, ordered[0], ordered)
  if (!begun) return { ok: false, out: { status: SLICE_STATUS.STALE } }
  return { ok: true, sync: begun }
}

// Guarded "first pending scope enters ACCUMULATE" write — the CAS inside
// casSync rejects any racing/advance state (§5.2).
async function beginScope(db, st, scopeId, pendingIds) {
  const cursor = {
    ...st.history_cursor,
    current: { scope_id: scopeId, pass: 'accumulate', cursor: null },
  }
  const patch = { history_cursor: cursor }
  if (pendingIds) patch.pending_scopes = pendingIds
  const ok = await db.casSync({
    userId: st.user_id,
    repositoryId: st.repository_id,
    match: { building_version: st.building_version, history_cursor: st.history_cursor },
    patch,
  })
  return ok
    ? { ...st, history_cursor: cursor, pending_scopes: pendingIds ?? st.pending_scopes }
    : null
}

// ── checkpoint unknown-outcome reconciliation (§5.5) ──────────────────────
// A thrown own_checkpoint_page call does NOT prove rollback: PostgreSQL may
// have applied the deltas, advanced the durable cursor, and COMMITTED while
// the PostgREST/HTTP response was lost. The sync row is authoritative — a
// thrown checkpoint is an UNKNOWN COMMIT OUTCOME until durable state is
// reconciled. The B1 CAS makes the resolution safe in both directions:
// if the first call truly never landed, an identical retry applies the
// page; if it landed and only the response was lost, the same retry is a
// no-op 'stale'.
//
// An attempt is identified by:
//   {userId, repositoryId, buildingVersion, scopeId, pass,
//    expectedCursor, nextCursor, lastPage}
//
// classifyCheckpointState maps a freshly-read sync row to:
//   committed — durable state proves the attempted transition landed
//   retry     — durable state sits exactly at the attempted position
//   ambiguous — at the attempted position, but nextCursor collides with
//               expectedCursor so landed/not-landed are indistinguishable
//               (retry would risk a double-apply — fail closed instead)
//   follow    — a legal canonical transition moved state elsewhere: defer
function classifyCheckpointState(st, attempt) {
  if (st?.building_version !== attempt.buildingVersion) {
    return { kind: 'follow', status: SLICE_STATUS.STALE }
  }
  if (st.phase === 'error') {
    // another worker already failed the build at a CAS-guarded position
    return { kind: 'follow', status: SLICE_STATUS.ERROR, code: st.error ?? 'OWNERSHIP_INTERNAL_ERROR' }
  }
  if (st.phase !== 'history') return { kind: 'follow', status: SLICE_STATUS.STALE }
  const c = st.history_cursor?.current
  if (!c || c.scope_id !== attempt.scopeId) {
    return { kind: 'follow', status: SLICE_STATUS.STALE }
  }
  if (c.pass === 'resolve') {
    // The B1 final-page commit flips accumulate -> resolve at a fresh
    // cursor ({pass:'resolve', accumulate_done:true, cursor:null}) — that
    // exact shape proves OUR attempt landed; any other resolve shape is
    // still the canonical handoff for this scope.
    return attempt.lastPage && c.accumulate_done === true && (c.cursor ?? null) === null
      ? { kind: 'committed' }
      : { kind: 'follow', status: SLICE_STATUS.RESOLVE_READY }
  }
  if (c.pass !== attempt.pass) return { kind: 'follow', status: SLICE_STATUS.STALE }
  const cur = c.cursor ?? null
  const samePoint = (attempt.nextCursor ?? null) === (attempt.expectedCursor ?? null)
  if (!attempt.lastPage && !samePoint && cur === (attempt.nextCursor ?? null)) {
    return { kind: 'committed' }
  }
  if (cur === (attempt.expectedCursor ?? null)) {
    // a last-page commit always disambiguates via the pass flip, so
    // accumulate@expected can only mean "not landed" — retry is safe;
    // for a non-final page it is safe only when nextCursor is distinct
    return attempt.lastPage || !samePoint ? { kind: 'retry' } : { kind: 'ambiguous' }
  }
  return { kind: 'follow', status: SLICE_STATUS.STALE }
}

// Drive one thrown checkpoint call to a canonical outcome. Returns either
// {kind:'applied'} — the page is durably committed (proven by the durable
// read or by the retry) and the caller treats it like a normal 'applied' —
// or {kind:'return', out} — a canonical slice outcome the caller returns.
async function reconcileCheckpoint({ db, st, attempt, args }) {
  const attemptedCurrent = {
    scope_id: attempt.scopeId,
    pass: attempt.pass,
    cursor: attempt.expectedCursor,
  }
  const reload = async () => {
    try {
      return await db.loadSync(attempt.userId, attempt.repositoryId)
    } catch {
      return null
    }
  }
  const done = (out) => ({ kind: 'return', out })

  const first = classifyCheckpointState(await reload(), attempt)
  if (first.kind === 'committed') return { kind: 'applied' }
  if (first.kind === 'ambiguous') {
    // cannot distinguish landed from unlanded — the error CAS is still
    // position-aware, so a racing commit elsewhere cannot be poisoned
    return done(await failAtPosition(db, st, attemptedCurrent, 'OWNERSHIP_INTERNAL_ERROR'))
  }
  if (first.kind !== 'retry') {
    // canonical state moved elsewhere — defer, write nothing
    return done({ status: first.status, ...(first.code ? { code: first.code } : {}) })
  }

  // durable state sits exactly at the attempted position: retry the exact
  // same call once — identical expected/next cursor, deltas, identities
  // and last-page flag. 'applied' means the first call truly never landed;
  // 'stale' means it committed and its response was lost. Both are safe.
  let r2
  try {
    r2 = await db.rpc('own_checkpoint_page', args)
  } catch {
    // the retry threw too — one final durable read decides
    const last = classifyCheckpointState(await reload(), attempt)
    if (last.kind === 'committed') return { kind: 'applied' }
    if (last.kind === 'retry' || last.kind === 'ambiguous') {
      // still exactly at the attempted position after two attempts: the
      // checkpoint genuinely failed to make durable progress — and ONLY a
      // worker still at this position may mark it, so a racing transition
      // can never be overwritten
      return done(await failAtPosition(db, st, attemptedCurrent, 'OWNERSHIP_INTERNAL_ERROR'))
    }
    return done({ status: last.status, ...(last.code ? { code: last.code } : {}) })
  }
  if (r2 === 'stale') {
    // 'stale' is never an error — re-read and follow durable state: our
    // page may have landed on the first call (lost response), or another
    // worker may have moved the build
    const second = classifyCheckpointState(await reload(), attempt)
    if (second.kind === 'committed') return { kind: 'applied' }
    return done({ status: second.status ?? SLICE_STATUS.STALE, ...(second.code ? { code: second.code } : {}) })
  }
  return { kind: 'applied' } // 'applied' — the first call truly failed
}

// ── page loop (§5.5) ──────────────────────────────────────────────────────
// fetch page -> reduce to grouped deltas -> own_checkpoint_page CAS.
// 'applied' advances; 'stale' re-reads the canonical row and follows it —
// never a blind retry; a thrown call is an UNKNOWN COMMIT OUTCOME and goes
// through reconcileCheckpoint before any error is considered.
async function accumulateScope({ db, transport, repo, st, budget, now }) {
  const userId = st.user_id
  const repositoryId = repo.id
  const V = st.building_version
  const pinnedOid = st.history_cursor.pinned_oid
  const cur = st.history_cursor.current

  const scope = await db.loadScope(cur.scope_id)
  if (!scope) {
    // the base scope vanished while V membership references it — invalid
    // ephemeral state; the canonical remedy is abandon (§5.6)
    await db.rpc('own_abandon_build', {
      p_user: userId,
      p_repository: repositoryId,
      p_version: V,
    })
    return { status: SLICE_STATUS.ABANDONED }
  }
  const path = scope.scope_type === 'repo' ? null : scope.display_path

  let cursor = cur.cursor ?? null
  let pages = 0

  for (;;) {
    const stop = budgetStop(budget, now)
    if (stop) return { status: stop, pages }

    const vars = { owner: repo.owner_login, name: repo.name, oid: pinnedOid, path, cursor }
    const pageCurrent = () => ({ scope_id: cur.scope_id, pass: 'accumulate', cursor })
    let data
    try {
      data = await gql(transport, pinnedHistoryPageQuery(), vars, budget)
    } catch (e) {
      const r = classifyFailure(e)
      if (r.code) return { ...(await failAtPosition(db, st, pageCurrent(), r.code)), pages }
      return { ...r, pages }
    }

    let history = data?.repository?.object
    if (history == null || history.__typename !== 'Commit' || history.oid !== pinnedOid) {
      // pinned boundary unusable — retry the identical page exactly once,
      // then fail closed. NEVER repin mid-build (§10). The retry is still a
      // GraphQL request — it obeys the shared budget like any other; its own
      // telemetry is counted and its remaining becomes authoritative.
      const retryStop = budgetStop(budget, now)
      if (retryStop) return { status: retryStop, pages }
      try {
        const retry = await gql(transport, pinnedHistoryPageQuery(), vars, budget)
        history = retry?.repository?.object
      } catch (e) {
        history = null
      }
      if (history == null || history.__typename !== 'Commit' || history.oid !== pinnedOid || !history.history) {
        const out = await failAtPosition(db, st, pageCurrent(), 'OWNERSHIP_HISTORY_FAILED')
        return { ...out, pages }
      }
    }
    const h = history.history
    if (
      h == null ||
      typeof h.pageInfo?.hasNextPage !== 'boolean' ||
      (h.pageInfo.hasNextPage && typeof h.pageInfo.endCursor !== 'string') ||
      !Array.isArray(h.nodes)
    ) {
      const out = await failAtPosition(db, st, pageCurrent(), 'OWNERSHIP_HISTORY_FAILED')
      return { ...out, pages }
    }

    let deltas
    try {
      deltas = reducePageDeltas(repositoryId, h.nodes)
    } catch {
      // malformed provider identity — page wedges at the durable cursor,
      // nothing commits (fail-closed per §5.5)
      const out = await failAtPosition(db, st, pageCurrent(), 'OWNERSHIP_HISTORY_FAILED')
      return { ...out, pages }
    }

    const lastPage = h.pageInfo.hasNextPage !== true
    const args = {
      p_user: userId,
      p_repository: repositoryId,
      p_version: V,
      p_scope: cur.scope_id,
      p_pass: 'accumulate',
      p_expected_cursor: cursor,
      p_next_cursor: h.pageInfo.endCursor ?? null,
      p_deltas: deltas,
      p_identities: [],
      p_last_page: lastPage,
    }
    // enough to identify the attempted transition for unknown-outcome
    // reconciliation if the RPC throws
    const attempt = {
      userId,
      repositoryId,
      buildingVersion: V,
      scopeId: cur.scope_id,
      pass: 'accumulate',
      expectedCursor: cursor,
      nextCursor: args.p_next_cursor,
      lastPage,
    }

    let r
    try {
      r = await db.rpc('own_checkpoint_page', args)
    } catch {
      // UNKNOWN COMMIT OUTCOME: the transaction may have committed and only
      // the response was lost — the durable sync row decides (§5.5), never
      // the exception itself
      const rec = await reconcileCheckpoint({ db, st, attempt, args })
      if (rec.kind === 'return') return { ...rec.out, pages }
      r = 'applied' // committed — proven by the durable read or the retry
    }

    if (r === 'stale') {
      // Do NOT retry blindly — read the canonical row and follow it.
      const fresh = await db.loadSync(userId, repositoryId)
      const c = fresh?.history_cursor?.current
      if (fresh?.building_version !== V) return { status: SLICE_STATUS.STALE, pages }
      if (fresh.phase === 'error') {
        // the build already failed canonically — mirror it, write nothing
        return {
          status: SLICE_STATUS.ERROR,
          code: fresh.error ?? 'OWNERSHIP_INTERNAL_ERROR',
          pages,
        }
      }
      if (fresh.phase !== 'history' || !c || c.scope_id !== cur.scope_id) {
        return { status: SLICE_STATUS.STALE, pages }
      }
      if (c.pass === 'resolve') {
        // the winner already finished this scope's ACCUMULATE
        return { status: SLICE_STATUS.RESOLVE_READY, pages }
      }
      if (c.pass !== 'accumulate') return { status: SLICE_STATUS.STALE, pages }
      cursor = c.cursor ?? null // adopt the durable cursor; our page already landed
      continue
    }

    pages += 1
    if (h.pageInfo.hasNextPage !== true) {
      // last page committed — B1 flipped the scope to pass='resolve';
      // B2 stops here for this scope (RESOLVE is B3)
      return { status: SLICE_STATUS.RESOLVE_READY, pages }
    }
    cursor = h.pageInfo.endCursor
  }
}

// ── the slice entrypoint ──────────────────────────────────────────────────

export async function runAccumulateSlice({
  db,
  transport,
  repositoryId,
  budgetMs = SLICE_BUDGET_MS,
  costBudget = SLICE_COST_BUDGET,
  workerId = crypto.randomUUID(),
  now = () => Date.now(),
  env,
}) {
  // The hard-off gate runs before any GitHub request or ownership write.
  assertOwnershipIngestAllowed(repositoryId, env)

  // One auditable budget state shared through build start, pin validation,
  // scope preparation, and history paging (§15).
  const budget = makeBudget({ now, budgetMs, costBudget })
  const done = (r) => ({ cost: budget.cost, remaining: budget.remaining, ...r })

  const repo = await db.loadRepo(repositoryId)
  if (!repo) return done({ status: SLICE_STATUS.ERROR, code: 'OWNERSHIP_INTERNAL_ERROR' })
  const userId = repo.user_id

  await db.ensureSyncRow(userId, repositoryId)
  let st = await db.loadSync(userId, repositoryId)
  if (!st) return done({ status: SLICE_STATUS.ERROR, code: 'OWNERSHIP_INTERNAL_ERROR' })

  if (st.building_version == null) {
    const start = await startBuild({ db, transport, repo, st, budget, now })
    if (start.status !== 'started') return done(start)
    st = await db.loadSync(userId, repositoryId)
    if (st?.building_version == null) return done({ status: SLICE_STATUS.STALE })
  }

  const leased = await claimLease(db, st, workerId, now)
  if (!leased) return done({ status: SLICE_STATUS.LOCKED })
  st = leased

  try {
    // §5.6b — a live build must be internally consistent to resume; anything
    // else takes the documented fail-closed abandon path.
    if (!(await isResumable(db, st))) {
      await db.rpc('own_abandon_build', {
        p_user: userId,
        p_repository: repositoryId,
        p_version: st.building_version,
      })
      return done({ status: SLICE_STATUS.ABANDONED })
    }

    // Dispatch on the durable position — current=null means either fresh
    // membership prep (pending_scopes null) or the next pending scope.
    let cur = st.history_cursor.current ?? null
    if (cur == null) {
      if (st.pending_scopes == null) {
        const prep = await prepareScopes({ db, transport, repo, st, budget, now })
        if (!prep.ok) return done(prep.out)
        st = prep.sync
      } else if (st.pending_scopes.length === 0) {
        return done({ status: SLICE_STATUS.SCOPES_DRAINED })
      } else {
        const begun = await beginScope(db, st, st.pending_scopes[0], st.pending_scopes)
        if (!begun) return done({ status: SLICE_STATUS.STALE })
        st = begun
      }
      cur = st.history_cursor.current
    }
    if (cur.pass === 'resolve') return done({ status: SLICE_STATUS.RESOLVE_READY })

    return done(await accumulateScope({ db, transport, repo, st, budget, now }))
  } finally {
    // a finished slice must never pin the lease — a dead worker is covered
    // by the TTL, a clean exit frees the next invocation immediately
    await releaseLease(db, st, workerId)
  }
}

// Best-effort lease release at slice exit. Re-loads the row so the release
// never clobbers cursor fields the checkpoint advanced during the slice.
async function releaseLease(db, st, workerId) {
  try {
    const fresh = await db.loadSync(st.user_id, st.repository_id)
    if (!fresh || fresh.history_cursor?.lease?.owner !== workerId) return
    const { lease: _dropped, ...rest } = fresh.history_cursor
    await db.casSync({
      userId: st.user_id,
      repositoryId: st.repository_id,
      match: {
        building_version: fresh.building_version,
        history_cursor: fresh.history_cursor,
      },
      patch: { history_cursor: rest },
    })
  } catch {
    // best-effort only — the TTL covers an unreleased lease
  }
}
