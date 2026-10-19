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

// ── transport + error classification ──────────────────────────────────────

// Every GraphQL call goes through here: the query text is re-audited at the
// trust boundary and the response is scanned for contract-forbidden keys
// before anything else may touch it.
async function gql(transport, query, vars) {
  const data = await transport.graphql(assertOwnershipQuerySafe(query), vars)
  return assertOwnershipResponseSafe(data)
}

function classifyFailure(e) {
  if (e instanceof RateLimitError) return { status: SLICE_STATUS.RATE_LIMITED }
  if (e instanceof GitHubAuthError) {
    return { status: SLICE_STATUS.ERROR, code: 'GITHUB_ACCESS_REVOKED' }
  }
  return { status: SLICE_STATUS.ERROR, code: 'OWNERSHIP_HISTORY_FAILED' }
}

async function markError(db, st, code) {
  // phase='error' leaves build state for operator inspection until the
  // documented sweep/abandon path runs (§7).
  await db.casSync({
    userId: st.user_id,
    repositoryId: st.repository_id,
    match: { building_version: st.building_version },
    patch: { phase: 'error', error: code },
  })
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

async function startBuild({ db, transport, repo, st }) {
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
  // to discover the immutable revision to pin.
  let probe
  try {
    probe = await gql(transport, ownershipHeadProbeQuery(), {
      owner: repo.owner_login,
      name: repo.name,
    })
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
  let obj
  try {
    obj = await gql(transport, pinnedObjectQuery(), {
      owner: repo.owner_login,
      name: repo.name,
      oid: headOid,
    })
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
async function prepareScopes({ db, transport, repo, st }) {
  const userId = st.user_id
  const repositoryId = repo.id
  const V = st.building_version
  const pinnedOid = st.history_cursor.pinned_oid

  // Re-resolve the pinned object — both re-verifies the pin before heavy
  // work and yields the pinned commit's tree for scope enumeration.
  let data
  try {
    data = await gql(transport, pinnedObjectQuery(), {
      owner: repo.owner_login,
      name: repo.name,
      oid: pinnedOid,
    })
  } catch (e) {
    const r = classifyFailure(e)
    if (r.code) await markError(db, st, r.code)
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
    await markError(db, st, 'OWNERSHIP_HISTORY_FAILED')
    return { ok: false, out: { status: SLICE_STATUS.ERROR, code: 'OWNERSHIP_HISTORY_FAILED' } }
  }

  let tree
  try {
    tree = await transport.getTree({ owner: repo.owner_login, repo: repo.name, treeSha: treeOid })
  } catch (e) {
    const r = classifyFailure(e)
    if (r.code) await markError(db, st, r.code)
    return { ok: false, out: r }
  }
  if (tree.truncated === true) {
    // enumeration cannot be trusted — fail closed rather than persist a
    // partial scope universe
    await markError(db, st, 'OWNERSHIP_HISTORY_FAILED')
    return { ok: false, out: { status: SLICE_STATUS.ERROR, code: 'OWNERSHIP_HISTORY_FAILED' } }
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

// ── page loop (§5.5) ──────────────────────────────────────────────────────
// fetch page -> reduce to grouped deltas -> own_checkpoint_page CAS.
// 'applied' advances; 'stale' re-reads the canonical row and follows it —
// never a blind retry; a response lost AFTER a committed page replays to
// 'stale' and cannot double-count.
async function accumulateScope({ db, transport, repo, st, now, deadline, costBudget }) {
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
  let cost = 0
  let remaining = null

  for (;;) {
    if (now() >= deadline || cost >= costBudget) {
      return { status: SLICE_STATUS.SLICE_BUDGET, pages, cost, remaining }
    }
    if (remaining != null && remaining < RATE_LIMIT_RESERVE) {
      return { status: SLICE_STATUS.RATE_LIMITED, pages, cost, remaining }
    }

    const vars = { owner: repo.owner_login, name: repo.name, oid: pinnedOid, path, cursor }
    let data
    try {
      data = await gql(transport, pinnedHistoryPageQuery(), vars)
    } catch (e) {
      const r = classifyFailure(e)
      if (r.code) await markError(db, st, r.code)
      return { ...r, pages, cost }
    }

    let history = data?.repository?.object
    if (history == null || history.__typename !== 'Commit' || history.oid !== pinnedOid) {
      // pinned boundary unusable — retry the identical page exactly once,
      // then fail closed. NEVER repin mid-build (§10).
      try {
        const retry = await gql(transport, pinnedHistoryPageQuery(), vars)
        history = retry?.repository?.object
      } catch (e) {
        history = null
      }
      if (history == null || history.__typename !== 'Commit' || history.oid !== pinnedOid || !history.history) {
        await markError(db, st, 'OWNERSHIP_HISTORY_FAILED')
        return { status: SLICE_STATUS.ERROR, code: 'OWNERSHIP_HISTORY_FAILED', pages, cost }
      }
    }
    const h = history.history
    if (
      h == null ||
      typeof h.pageInfo?.hasNextPage !== 'boolean' ||
      (h.pageInfo.hasNextPage && typeof h.pageInfo.endCursor !== 'string') ||
      !Array.isArray(h.nodes)
    ) {
      await markError(db, st, 'OWNERSHIP_HISTORY_FAILED')
      return { status: SLICE_STATUS.ERROR, code: 'OWNERSHIP_HISTORY_FAILED', pages, cost }
    }

    let deltas
    try {
      deltas = reducePageDeltas(repositoryId, h.nodes)
    } catch {
      // malformed provider identity — page wedges at the durable cursor,
      // nothing commits (fail-closed per §5.5)
      await markError(db, st, 'OWNERSHIP_HISTORY_FAILED')
      return { status: SLICE_STATUS.ERROR, code: 'OWNERSHIP_HISTORY_FAILED', pages, cost }
    }

    let r
    try {
      r = await db.rpc('own_checkpoint_page', {
        p_user: userId,
        p_repository: repositoryId,
        p_version: V,
        p_scope: cur.scope_id,
        p_pass: 'accumulate',
        p_expected_cursor: cursor,
        p_next_cursor: h.pageInfo.endCursor ?? null,
        p_deltas: deltas,
        p_identities: [],
        p_last_page: h.pageInfo.hasNextPage !== true,
      })
    } catch {
      // own_checkpoint_page raised (bounds, drift, malformed payload) —
      // the closed internal-error taxonomy, never raw SQL text
      await markError(db, st, 'OWNERSHIP_INTERNAL_ERROR')
      return { status: SLICE_STATUS.ERROR, code: 'OWNERSHIP_INTERNAL_ERROR', pages, cost }
    }

    if (r === 'stale') {
      // Do NOT retry blindly — read the canonical row and follow it.
      const fresh = await db.loadSync(userId, repositoryId)
      const c = fresh?.history_cursor?.current
      if (fresh?.building_version !== V || !c || c.scope_id !== cur.scope_id) {
        return { status: SLICE_STATUS.STALE, pages, cost }
      }
      if (c.pass === 'resolve') {
        // the winner already finished this scope's ACCUMULATE
        return { status: SLICE_STATUS.RESOLVE_READY, pages, cost }
      }
      if (c.pass !== 'accumulate') return { status: SLICE_STATUS.STALE, pages, cost }
      cursor = c.cursor ?? null // adopt the durable cursor; our page already landed
      continue
    }

    pages += 1
    cost += data.rateLimit?.cost ?? 0
    if (data.rateLimit?.remaining != null) remaining = data.rateLimit.remaining
    if (h.pageInfo.hasNextPage !== true) {
      // last page committed — B1 flipped the scope to pass='resolve';
      // B2 stops here for this scope (RESOLVE is B3)
      return { status: SLICE_STATUS.RESOLVE_READY, pages, cost, remaining }
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

  const deadline = now() + budgetMs
  const repo = await db.loadRepo(repositoryId)
  if (!repo) return { status: SLICE_STATUS.ERROR, code: 'OWNERSHIP_INTERNAL_ERROR' }
  const userId = repo.user_id

  await db.ensureSyncRow(userId, repositoryId)
  let st = await db.loadSync(userId, repositoryId)
  if (!st) return { status: SLICE_STATUS.ERROR, code: 'OWNERSHIP_INTERNAL_ERROR' }

  if (st.building_version == null) {
    const start = await startBuild({ db, transport, repo, st })
    if (start.status !== 'started') return start
    st = await db.loadSync(userId, repositoryId)
    if (st?.building_version == null) return { status: SLICE_STATUS.STALE }
  }

  const leased = await claimLease(db, st, workerId, now)
  if (!leased) return { status: SLICE_STATUS.LOCKED }
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
      return { status: SLICE_STATUS.ABANDONED }
    }

    // Dispatch on the durable position — current=null means either fresh
    // membership prep (pending_scopes null) or the next pending scope.
    let cur = st.history_cursor.current ?? null
    if (cur == null) {
      if (st.pending_scopes == null) {
        const prep = await prepareScopes({ db, transport, repo, st })
        if (!prep.ok) return prep.out
        st = prep.sync
      } else if (st.pending_scopes.length === 0) {
        return { status: SLICE_STATUS.SCOPES_DRAINED }
      } else {
        const begun = await beginScope(db, st, st.pending_scopes[0], st.pending_scopes)
        if (!begun) return { status: SLICE_STATUS.STALE }
        st = begun
      }
      cur = st.history_cursor.current
    }
    if (cur.pass === 'resolve') return { status: SLICE_STATUS.RESOLVE_READY }

    return await accumulateScope({ db, transport, repo, st, now, deadline, costBudget })
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
