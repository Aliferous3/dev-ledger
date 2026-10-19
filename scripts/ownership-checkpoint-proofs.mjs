// Ownership checkpointing proofs — real-Postgres integrity tests for the
// migration-013 substrate (docs/ownership-checkpoint-architecture.md).
//
// Invoked by scripts/recovery-drill.mjs on the drill_src database AFTER
// seeding and BEFORE the backup. Every scenario runs on its own throwaway
// tenant and cleans itself up, so the net effect on seeded rows is zero.
// Negative cases assert the SPECIFIC constraint that fires — a malformed
// statement cannot masquerade as a passing invariant proof.
//
// Matrix (architecture §12 + the B1 tranche requirements):
//   A–F  snapshot<->membership composite-FK integrity
//   G–I  base-scope NO ACTION enforcement + legal prune order
//   J–L  single-statement repository/account teardown incl. work tables
//   M–O  active-version dashboard isolation
//   P–Q  canonical abandon (initial-build and N->N+1)
//   R–T  scope-restart staging cleanup (committed-V provenance)
//   U–W  promotion exact-set invariant
//   X–AA retired-version lifecycle gate + idempotent GC
//   own_checkpoint_page CAS: apply / replay-stale / stale-cursor /
//        stale-version / resolve staging / is_bot drift fail-closed
//   own_sweep_stale_work: orphan sweep + stale-build abandon routing

import crypto from 'node:crypto'

const HEX = (n) => n.toString(16).padStart(64, '0')
const MONTH = '2026-09-01T00:00:00Z'

export async function checkpointingProofs(sql) {
  const problems = []
  const check = (ok, msg) => { if (!ok) problems.push(msg) }
  const mustFail = async (fn, label, expected = null) => {
    try {
      await fn()
      problems.push(`${label}: statement must have been rejected`)
    } catch (e) {
      if (!expected) return
      const names = [].concat(expected.name)
      const cname = e.constraint_name || e.constraint || ''
      const code = e.code || ''
      const msg = String(e.message || '')
      const hit = names.some((n) => cname === n || msg.includes(n))
      if (!hit) {
        problems.push(`${label}: expected constraint ${names.join('/')} `
          + `(${expected.code || 'any'}), got ${cname || code || msg.slice(0, 80)}`)
      }
      if (expected.code && code !== expected.code) {
        problems.push(`${label}: expected SQLSTATE ${expected.code}, got ${code || 'none'}`)
      }
    }
  }
  const mustRaise = async (fn, label) => {
    try {
      await fn()
      problems.push(`${label}: expected OWNERSHIP_INTERNAL_ERROR, got success`)
    } catch (e) {
      if (!String(e.message || '').includes('OWNERSHIP_INTERNAL_ERROR')) {
        problems.push(`${label}: expected OWNERSHIP_INTERNAL_ERROR, got ${String(e.message || '').slice(0, 90)}`)
      }
    }
  }
  const FK = (name) => ({ name, code: '23503' })
  const CHK = (name) => ({ name, code: '23514' })

  let tenantSeq = 0
  async function tenant() {
    const uid = crypto.randomUUID()
    const repoId = crypto.randomUUID()
    const gid = 80000000 + ++tenantSeq
    await sql`insert into users (id, github_user_id, github_login) values (${uid}, ${gid}, ${'ckpt-' + tenantSeq})`
    await sql`insert into repositories (id, user_id, github_repo_id, owner_login, name, full_name)
              values (${repoId}, ${uid}, ${gid}, 'ckpt', ${'r' + tenantSeq}, ${'ckpt/r' + tenantSeq})`
    return { uid, repoId }
  }
  let scopeSeq = 0
  const scope = (t, hash = null, path = 'src', type = 'dir', depth = 1) => {
    const id = crypto.randomUUID()
    const h = hash ?? `h-${++scopeSeq}` // unique per call — hash is repo-scoped
    return sql`insert into ownership_scopes (id, user_id, repository_id, scope_path_hash, display_path, scope_type, depth)
               values (${id}, ${t.uid}, ${t.repoId}, ${h}, ${path}, ${type}, ${depth})`.then(() => id)
  }
  const membership = (t, scopeId, ver, excluded = false, reason = null) =>
    sql`insert into ownership_scope_versions (user_id, repository_id, scope_id, calculation_version, excluded, exclusion_reason)
        values (${t.uid}, ${t.repoId}, ${scopeId}, ${ver}, ${excluded}, ${reason})`
  const contributor = (t, key, kind = 'linked', node = 'N', login = 'x', bot = false) => {
    const id = crypto.randomUUID()
    return sql`insert into ownership_contributors (id, user_id, repository_id, contributor_key, identity_kind, github_node_id, display_login, is_bot)
               values (${id}, ${t.uid}, ${t.repoId}, ${key}, ${kind}, ${node}, ${login}, ${bot})`.then(() => id)
  }
  const snapshot = (t, scopeId, contribId, ver, touches = 1) =>
    sql`insert into ownership_snapshots (user_id, repository_id, scope_id, contributor_id, period_granularity, period_start, touch_commits, calculation_version)
        values (${t.uid}, ${t.repoId}, ${scopeId}, ${contribId}, 'month', ${MONTH}, ${touches}, ${ver})`
  const sync = (t, phase, active, building, cursor = null, pending = null) =>
    sql`insert into ownership_sync_state (user_id, repository_id, phase, active_version, building_version, history_cursor, pending_scopes)
        values (${t.uid}, ${t.repoId}, ${phase}, ${active}, ${building}, ${cursor}, ${pending})`
  const workRow = (t, scopeId, ver, key, touches = 1, bot = false) =>
    sql`insert into ownership_history_work (user_id, repository_id, scope_id, calculation_version, period_start, work_key, is_bot, touch_commits)
        values (${t.uid}, ${t.repoId}, ${scopeId}, ${ver}, ${MONTH}, ${key}, ${bot}, ${touches})`
  const stageRow = (t, ver, key, node = 'N', login = 'x', bot = false) =>
    sql`insert into ownership_contributor_build_work (user_id, repository_id, calculation_version, work_key, github_node_id, display_login, is_bot)
        values (${t.uid}, ${t.repoId}, ${ver}, ${key}, ${node}, ${login}, ${bot})`
  const count = async (t, table, ver = null) => {
    const [r] = ver == null
      ? await sql`select count(*)::int c from ${sql(table)} where repository_id = ${t.repoId}`
      : await sql`select count(*)::int c from ${sql(table)} where repository_id = ${t.repoId} and calculation_version = ${ver}`
    return r.c
  }
  // calls an own_* primitive; args are bound by position and Postgres
  // infers each parameter type from the function signature (strings
  // containing JSON land correctly on jsonb params). Failures are tagged
  // with the call site so a raise reports WHICH primitive rejected.
  const call = (fn, ...args) =>
    sql.unsafe(
      `select ${fn}(${args.map((_, i) => `$${i + 1}`).join(',')}) as r`,
      args
    ).then(([r]) => r.r, (e) => {
      e.message = `${fn}(${args.map((a) => JSON.stringify(a)).join(', ')}): ${e.message}`
      throw e
    })

  const mark = (m) => { if (process.env.CKPT_DEBUG) console.log('  [ckpt]', m) }
  mark('A-F')
  /* ── A–F: snapshot<->membership composite-FK integrity ──────────────── */
  {
    const t = await tenant()
    const s1 = await scope(t)
    const c1 = await contributor(t, HEX(1))
    await membership(t, s1, 1)
    // A: snapshot with no matching membership → rejected
    const sOrphan = await scope(t)
    await mustFail(() => snapshot(t, sOrphan, c1, 1), 'A: snapshot without membership',
      FK(['ownership_snapshots_scope_version']))
    // B: membership at V1, snapshot claims V2 → rejected (wrong version)
    await mustFail(() => snapshot(t, s1, c1, 2), 'B: snapshot at wrong version',
      FK('ownership_snapshots_scope_version'))
    // C: snapshot claims another repository's scope → rejected (either
    //    the scope/repo pair FK or the membership composite fires — both
    //    encode the same isolation invariant; a valid-shape contributor
    //    row is used so only the FK can reject)
    const t2 = await tenant()
    const s2 = await scope(t2)
    await membership(t2, s2, 1)
    await mustFail(() => sql`insert into ownership_snapshots
      (user_id, repository_id, scope_id, contributor_id, period_granularity, period_start, touch_commits, calculation_version)
      values (${t.uid}, ${t.repoId}, ${s2}, ${c1}, 'month', ${MONTH}, 1, 1)`,
      'C: snapshot using another repo scope', FK(['ownership_snapshots_scope_repo', 'ownership_snapshots_scope_version']))
    // D: cross-tenant — repoA's user/repo pairing violated under user B
    await mustFail(() => sql`insert into ownership_snapshots
      (user_id, repository_id, scope_id, contributor_id, period_granularity, period_start, touch_commits, calculation_version)
      values (${t2.uid}, ${t.repoId}, ${s1}, ${c1}, 'month', ${MONTH}, 1, 1)`,
      'D: snapshot user mismatched to repo tenant', FK(['ownership_snapshots_repo_tenant', 'ownership_snapshots_scope_version']))
    // E: delete membership while a snapshot references it → rejected
    await snapshot(t, s1, c1, 1)
    await mustFail(
      () => sql`delete from ownership_scope_versions where scope_id = ${s1} and calculation_version = 1`,
      'E: membership delete with referencing snapshot', FK('ownership_snapshots_scope_version'))
    // F: legal order — snapshots first, membership second → succeeds
    await sql`delete from ownership_snapshots where repository_id = ${t.repoId} and calculation_version = 1`
    await sql`delete from ownership_scope_versions where repository_id = ${t.repoId} and calculation_version = 1`
    check(await count(t, 'ownership_scope_versions') === 0, 'F: legal delete order failed')

    /* ── G–I: base-scope NO ACTION + legal prune order ───────────────── */
    // G: direct delete of scope referenced by membership → rejected
    await membership(t, s1, 1) // re-add membership on s1
    await mustFail(() => sql`delete from ownership_scopes where id = ${s1}`,
      'G: scope delete referenced by membership', FK('ownership_scope_versions_scope_repo'))
    // H: direct delete of scope referenced by snapshot → rejected. A
    //    snapshot implies same-version membership, so the membership FK
    //    may legitimately fire first — either NO ACTION constraint
    //    rejecting the delete proves the protection (the upgrade leg
    //    separately asserts confdeltype='a' on all three FKs)
    await snapshot(t, s1, c1, 1)
    await mustFail(() => sql`delete from ownership_scopes where id = ${s1}`,
      'H: scope delete referenced by snapshot',
      FK(['ownership_snapshots_scope_repo', 'ownership_scope_versions_scope_repo']))
    // I: snapshots → membership → scope → succeeds
    await sql`delete from ownership_snapshots where repository_id = ${t.repoId}`
    await sql`delete from ownership_scope_versions where repository_id = ${t.repoId}`
    await sql`delete from ownership_scopes where id = ${s1}`
    check((await count(t, 'ownership_scopes')) === 1, 'I: legal scope prune order failed')

    /* ── J–L: single-statement teardown incl. work tables ────────────── */
    const tJ = await tenant()
    const sJ = await scope(tJ)
    const cJ = await contributor(tJ, HEX(2))
    await membership(tJ, sJ, 1)
    await snapshot(tJ, sJ, cJ, 1)
    await sync(tJ, 'history', 1, 2)
    await workRow(tJ, sJ, 2, HEX(3))
    await stageRow(tJ, 2, HEX(3))
    await sql`delete from repositories where id = ${tJ.repoId}`
    for (const table of ['ownership_scopes', 'ownership_scope_versions', 'ownership_snapshots',
      'ownership_contributors', 'ownership_sync_state', 'ownership_history_work',
      'ownership_contributor_build_work']) {
      check(await count(tJ, table) === 0, `J/L: ${table} survived single-statement repository delete`)
    }
    const tK = await tenant()
    const sK = await scope(tK)
    const cK = await contributor(tK, HEX(4))
    await membership(tK, sK, 1)
    await snapshot(tK, sK, cK, 1)
    await sync(tK, 'done', 1, null)
    await workRow(tK, sK, 1, HEX(5))
    await stageRow(tK, 1, HEX(5))
    await sql`delete from users where id = ${tK.uid}`
    for (const table of ['ownership_scopes', 'ownership_scope_versions', 'ownership_snapshots',
      'ownership_contributors', 'ownership_sync_state', 'ownership_history_work',
      'ownership_contributor_build_work']) {
      const [r] = await sql`select count(*)::int c from ${sql(table)} where user_id = ${tK.uid}`
      check(r.c === 0, `K/L: ${table} survived single-statement user delete`)
    }
    const [{ c: repoLeft }] = await sql`select count(*)::int c from repositories where id = ${tK.repoId}`
    check(repoLeft === 0, 'K: repositories row survived user delete')

    /* ── M–O: active-version dashboard isolation ─────────────────────── */
    const tM = await tenant()
    const sM = await scope(tM, 'h-m1')
    const sN2 = await scope(tM, 'h-m2', 'lib')
    await membership(tM, sM, 1)
    await membership(tM, sN2, 2)          // building-V2-only scope
    await sync(tM, 'done', 1, 2)
    const out0 = await sql`select scope_path_hash, excluded from dash_ownership_scopes(${tM.uid}, ${tM.repoId})`
    check(out0.length === 1 && out0[0].scope_path_hash === 'h-m1',
      `M: building-version scope leaked into active output (${JSON.stringify(out0)})`)
    // N: N+1 exclusion change must not move N output
    await membership(tM, sM, 2, true, 'cardinality_cap')
    const outN = await sql`select scope_path_hash, excluded from dash_ownership_scopes(${tM.uid}, ${tM.repoId})`
    check(outN.length === 1 && outN[0].excluded === false,
      'N: building-version exclusion state leaked into active output')
    // O: the N+1-only scope stays invisible until promotion
    const [outO] = await sql`select count(*)::int c from dash_ownership_scopes(${tM.uid}, ${tM.repoId}) where scope_path_hash = 'h-m2'`
    check(outO.c === 0, 'O: N+1-only base scope visible under active N')
    await sql`delete from users where id = ${tM.uid}`
    await sql`delete from users where id = ${t2.uid}`
    await sql`delete from users where id = ${t.uid}`

    /* ── P: initial-build abort → zero V1 artifacts ──────────────────── */
    const tP = await tenant()
    const sP = await scope(tP)
    const cP = await contributor(tP, HEX(6))
    const cP2 = await contributor(tP, HEX(7))
    await membership(tP, sP, 1)
    await snapshot(tP, sP, cP, 1)
    await workRow(tP, sP, 1, HEX(8))
    await stageRow(tP, 1, HEX(6))
    await stageRow(tP, 1, HEX(9))
    await sync(tP, 'history', null, 1)
    const rP = await call('own_abandon_build', tP.uid, tP.repoId, 1)
    check(rP === 'abandoned', `P: abandon returned ${rP}`)
    check(await count(tP, 'ownership_snapshots') === 0, 'P: V1 snapshots survived abandon')
    check(await count(tP, 'ownership_scope_versions') === 0, 'P: V1 membership survived abandon')
    check(await count(tP, 'ownership_history_work') === 0, 'P: history work survived abandon')
    check(await count(tP, 'ownership_contributor_build_work') === 0, 'P: staging survived abandon')
    // contributors unreferenced by any snapshot across all versions prune
    check(await count(tP, 'ownership_contributors') === 0, 'P: V1-only contributors not pruned')
    // unreferenced base scope prunes too
    check(await count(tP, 'ownership_scopes') === 0, 'P: V1-only base scope not pruned')
    const [{ phase: pPhase, active_version: pActive, building_version: pBuild }] =
      await sql`select phase, active_version, building_version from ownership_sync_state where repository_id = ${tP.repoId}`
    check(pPhase === 'pending' && pActive === null && pBuild === null,
      `P: sync state not reset (phase=${pPhase}, active=${pActive}, building=${pBuild})`)
    await sql`delete from users where id = ${tP.uid}`

    /* ── Q: N→N+1 abort — N byte-identical, N+1 gone ─────────────────── */
    const tQ = await tenant()
    const sQ = await scope(tQ, 'h-q1')
    const sQ2 = await scope(tQ, 'h-q2')
    const cQ = await contributor(tQ, HEX(10), 'linked', 'Nq', 'carol')
    const cQ2 = await contributor(tQ, HEX(11), 'linked', 'Nq2', 'newbie')
    await membership(tQ, sQ, 1)
    await membership(tQ, sQ, 2)
    await membership(tQ, sQ2, 2)          // N+1-only scope
    await snapshot(tQ, sQ, cQ, 1, 7)      // N snapshot
    await snapshot(tQ, sQ, cQ, 2, 9)      // committed N+1 snapshot
    await snapshot(tQ, sQ2, cQ2, 2, 4)    // N+1-only contributor snapshot
    await workRow(tQ, sQ2, 2, HEX(12))
    await stageRow(tQ, 2, HEX(10))
    await sync(tQ, 'history', 1, 2)
    const rQ = await call('own_abandon_build', tQ.uid, tQ.repoId, 2)
    check(rQ === 'abandoned', `Q: abandon returned ${rQ}`)
    check(await count(tQ, 'ownership_snapshots', 2) === 0, 'Q: N+1 snapshots survived')
    check(await count(tQ, 'ownership_scope_versions', 2) === 0, 'Q: N+1 membership survived')
    check(await count(tQ, 'ownership_history_work') === 0, 'Q: work rows survived')
    check(await count(tQ, 'ownership_contributor_build_work') === 0, 'Q: staging survived')
    check(await count(tQ, 'ownership_snapshots', 1) === 1, 'Q: N snapshot lost')
    check(await count(tQ, 'ownership_scope_versions', 1) === 1, 'Q: N membership lost')
    // N-referenced contributor survives untouched; N+1-only pruned
    const qContribs = await sql`select contributor_key, display_login from ownership_contributors where repository_id = ${tQ.repoId}`
    check(qContribs.length === 1 && qContribs[0].contributor_key === HEX(10) && qContribs[0].display_login === 'carol',
      `Q: contributors wrong after abort (${JSON.stringify(qContribs)})`)
    // N-referenced base scope survives; N+1-only base scope pruned
    const qScopes = await sql`select scope_path_hash from ownership_scopes where repository_id = ${tQ.repoId}`
    check(qScopes.length === 1 && qScopes[0].scope_path_hash === 'h-q1',
      `Q: base scopes wrong after abort (${JSON.stringify(qScopes)})`)
    const [{ active_version: qActive, building_version: qBuild, phase: qPhase }] =
      await sql`select active_version, building_version, phase from ownership_sync_state where repository_id = ${tQ.repoId}`
    check(qActive === 1 && qBuild === null && qPhase === 'done',
      `Q: sync state wrong after abort (active=${qActive}, building=${qBuild}, phase=${qPhase})`)
    await sql`delete from users where id = ${tQ.uid}`

    /* ── R–T: scope-restart staging cleanup ──────────────────────────── */
    const tR = await tenant()
    const sR = await scope(tR, 'h-r1')
    const sR2 = await scope(tR, 'h-r2')
    const cR = await contributor(tR, HEX(20), 'linked', 'Nr', 'kee')
    const cR2 = await contributor(tR, HEX(21), 'linked', 'Nr2', 'solo')
    await membership(tR, sR, 2)
    await membership(tR, sR2, 2)
    await snapshot(tR, sR, cR, 2)   // committed V2 snapshot references cR
    // staging: HEX(20) — preserved (committed-V snapshot), HEX(21) —
    // existing retained contributor staged ONLY by the failed scope
    // (no V2 snapshot) → staging row removed, retained row untouched.
    // HEX(22) — brand-new contributor staged by failed attempt → removed.
    await stageRow(tR, 2, HEX(20))
    await stageRow(tR, 2, HEX(21), 'Nr2', 'solo')
    await stageRow(tR, 2, HEX(22), 'Nnew', 'ghost')
    await workRow(tR, sR2, 2, HEX(20))
    await sync(tR, 'history', 1, 2,
      sql`jsonb_build_object('current', jsonb_build_object('scope_id', ${sR2}::text, 'pass', 'resolve', 'cursor', 'zz'))`)
    const rR = await call('own_restart_scope', tR.uid, tR.repoId, 2, sR2)
    check(rR === 'restarted', `R/S/T: restart returned ${rR}`)
    check(await count(tR, 'ownership_history_work') === 0, 'R: scope work rows survived restart')
    const staged = await sql`select work_key from ownership_contributor_build_work
                             where repository_id = ${tR.repoId} order by work_key`
    check(staged.length === 1 && staged[0].work_key === HEX(20),
      `R/S/T: staging wrong after restart (${JSON.stringify(staged)})`)
    check((await count(tR, 'ownership_contributors')) === 2,
      'S: retained contributor deleted by restart cleanup')
    const [{ pass: rPass, cursor: rCur }] = await sql`
      select history_cursor #>> '{current,pass}' as pass,
             history_cursor #>> '{current,cursor}' as cursor
      from ownership_sync_state where repository_id = ${tR.repoId}`
    check(rPass === 'accumulate' && rCur === null,
      `R: cursor not reset to fresh ACCUMULATE (pass=${rPass}, cursor=${rCur})`)
    await sql`delete from users where id = ${tR.uid}`

    /* ── U–W: promotion exact-set invariant ──────────────────────────── */
    mark('U-W')
    const mkPromotable = async () => {
      const t = await tenant()
      const s = await scope(t)
      const c = await contributor(t, HEX(30), 'linked', 'Np', 'promo')
      await membership(t, s, 1)
      await snapshot(t, s, c, 1)
      await stageRow(t, 1, HEX(30), 'Np', 'promo')
      await sync(t, 'history', null, 1, null, sql`'[]'::jsonb`)
      return { t, s, c }
    }
    // U: extra staged key → fail closed, nothing applied
    {
      const { t } = await mkPromotable()
      await stageRow(t, 1, HEX(31), 'Nextra', 'stale')
      await mustRaise(() => call('own_promote_build', t.uid, t.repoId, 1), 'U: extra staged key')
      const [{ building_version }] = await sql`select building_version from ownership_sync_state where repository_id = ${t.repoId}`
      check(building_version === 1, 'U: building version lost after failed promotion')
      check(await count(t, 'ownership_contributor_build_work') === 2,
        'U: staging mutated by failed promotion')
      await sql`delete from users where id = ${t.uid}`
    }
    // V: missing staged key → fail closed
    {
      const { t } = await mkPromotable()
      await sql`delete from ownership_contributor_build_work where repository_id = ${t.repoId}`
      await mustRaise(() => call('own_promote_build', t.uid, t.repoId, 1), 'V: missing staged key')
      await sql`delete from users where id = ${t.uid}`
    }
    // W: exact set → promoted atomically (flip + metadata + staging delete)
    {
      mark('W')
      const { t } = await mkPromotable()
      const r = await call('own_promote_build', t.uid, t.repoId, 1)
      check(r === 'promoted', `W: promote returned ${r}`)
      const [{ active_version, building_version, phase }] =
        await sql`select active_version, building_version, phase from ownership_sync_state where repository_id = ${t.repoId}`
      check(active_version === 1 && building_version === null && phase === 'done',
        `W: flip wrong (active=${active_version}, building=${building_version}, phase=${phase})`)
      check(await count(t, 'ownership_contributor_build_work') === 0, 'W: staging not consumed')
      const [{ display_login }] = await sql`select display_login from ownership_contributors where repository_id = ${t.repoId}`
      check(display_login === 'promo', 'W: staged metadata not applied')
      await sql`delete from users where id = ${t.uid}`
    }

    /* ── X–AA: retired-version lifecycle gate ────────────────────────── */
    const tX = await tenant()
    const sX = await scope(tX)
    const cX = await contributor(tX, HEX(40))
    await membership(tX, sX, 1)
    await membership(tX, sX, 2)
    await snapshot(tX, sX, cX, 2)
    // stale retired V1 snapshot too — simulates post-promotion GC-pending
    await snapshot(tX, sX, cX, 1)
    await sync(tX, 'done', 2, null)
    // X: init request while retired V1 rows remain → blocked, stays null
    const rX = await call('own_build_init', tX.uid, tX.repoId, 3, 'b'.repeat(40))
    check(rX === 'blocked', `X: init with retired rows returned ${rX}`)
    const [{ building_version: xBuild }] = await sql`select building_version from ownership_sync_state where repository_id = ${tX.repoId}`
    check(xBuild === null, 'X: building_version set despite retired rows')
    // Y: preflight GC removes retired V1 in legal order → init proceeds
    const rY = await call('own_build_preflight', tX.uid, tX.repoId)
    check(rY === 'ready', `Y: preflight returned ${rY}`)
    const yVers = await sql`select distinct calculation_version v from (
      select calculation_version from ownership_snapshots where repository_id = ${tX.repoId}
      union select calculation_version from ownership_scope_versions where repository_id = ${tX.repoId}) q`
    check(yVers.length === 1 && yVers[0].v === 2, `Y: retired rows survived GC (${JSON.stringify(yVers)})`)
    const rY2 = await call('own_build_init', tX.uid, tX.repoId, 3, 'b'.repeat(40))
    check(rY2 === 'initialized', `Y: init after GC returned ${rY2}`)
    const [{ building_version: yBuild, phase: yPhase }] =
      await sql`select building_version, phase from ownership_sync_state where repository_id = ${tX.repoId}`
    check(yBuild === 3 && yPhase === 'history', 'Y: build not initialized after GC')
    // AA: clean-state preflight is a no-op retry path — clear the build,
    // re-run preflight (nothing retired), init again
    await sql`update ownership_sync_state set building_version = null, phase = 'done' where repository_id = ${tX.repoId}`
    const rAA = await call('own_build_preflight', tX.uid, tX.repoId)
    check(rAA === 'ready', `AA: clean preflight returned ${rAA}`)
    check(await count(tX, 'ownership_snapshots') === 1 && await count(tX, 'ownership_scope_versions') === 1,
      'AA: clean preflight deleted active data')
    await sql`delete from users where id = ${tX.uid}`

    // Z: forced GC failure mid-preflight — a trigger that raises inside
    //    the same transaction makes the membership delete fail → the
    //    whole preflight rolls back: active keeps serving, building stays
    //    null, retired rows remain, and the next attempt retries the same
    //    idempotent GC (DDL rolls back with the tx, so the trigger is
    //    self-cleaning)
    {
      const tZ = await tenant()
      const sZ = await scope(tZ)
      const cZ = await contributor(tZ, HEX(41))
      await membership(tZ, sZ, 1)
      await membership(tZ, sZ, 2)
      await snapshot(tZ, sZ, cZ, 2)
      await snapshot(tZ, sZ, cZ, 1)
      await sync(tZ, 'done', 2, null)
      await sql.begin(async (tx) => {
        await tx`create function gc_fail() returns trigger language plpgsql as
                 $f$ begin raise exception 'forced gc failure'; end $f$`
        await tx`create trigger force_gc_fail before delete on ownership_scope_versions
                 for each row execute function gc_fail()`
        let failed = false
        try {
          await tx`select own_build_preflight(${tZ.uid}, ${tZ.repoId})`
        } catch (e) {
          failed = String(e.message || '').includes('forced gc failure')
          if (!failed) problems.push(`Z: unexpected error ${String(e.message).slice(0, 80)}`)
        }
        if (!failed) problems.push('Z: GC failure was not triggered')
        throw new Error('rollback trigger + failed preflight')
      }).catch(() => {})
      const [zStill] = await sql`select count(*)::int c from ownership_scope_versions
                                 where repository_id = ${tZ.repoId} and calculation_version = 1`
      const [zStillSnap] = await sql`select count(*)::int c from ownership_snapshots
                                     where repository_id = ${tZ.repoId} and calculation_version = 1`
      check(zStill.c === 1 && zStillSnap.c === 1,
        `Z: GC effects persisted across forced failure (mem=${zStill.c}, snap=${zStillSnap.c})`)
      const [{ active_version: zAct, building_version: zBld }] =
        await sql`select active_version, building_version from ownership_sync_state where repository_id = ${tZ.repoId}`
      check(zAct === 2 && zBld === null, `Z: active/building wrong after forced abort (${zAct}/${zBld})`)
      // retry runs the same idempotent GC — trigger rolled back with the tx
      const rZ = await call('own_build_preflight', tZ.uid, tZ.repoId)
      check(rZ === 'ready', `Z: preflight retry returned ${rZ}`)
      const [zGone] = await sql`select count(*)::int c from ownership_scope_versions
                                where repository_id = ${tZ.repoId} and calculation_version = 1`
      check(zGone.c === 0, 'Z: retired V1 not collected on retry')
      await sql`delete from users where id = ${tZ.uid}`
    }
  }

  /* ── own_checkpoint_page — CAS / crash-window proofs ───────────────── */
  {
    const t = await tenant()
    const s = await scope(t)
    await membership(t, s, 1)
    await sync(t, 'history', null, 1,
      sql`jsonb_build_object('pinned_oid', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        'current', jsonb_build_object('scope_id', ${s}::text, 'pass', 'accumulate', 'cursor', null))`,
      sql`jsonb_build_array(${s}::text)`)

    // jsonb params through sql.unsafe must be JS values — the driver
    // JSON-encodes them; a pre-stringified payload would land as a jsonb
    // STRING and trip the function's array-shape guard
    const delta = (key, touches, bot = false) => [{
      period_start: MONTH, work_key: key, is_bot: bot, touches,
      first_seen_at: '2026-09-02T00:00:00Z', last_seen_at: '2026-09-05T00:00:00Z',
    }]
    const ident = (key, node, login, obs) => [{
      work_key: key, github_node_id: node, display_login: login, observed_is_bot: obs,
    }]

    // apply page 1
    const r1 = await call('own_checkpoint_page', t.uid, t.repoId, 1, s, 'accumulate',
      null, 'cur1', delta(HEX(50), 5))
    check(r1 === 'applied', `checkpoint page1 returned ${r1}`)
    // crash window A: response lost after commit — replay sees stale, no
    // double-apply
    const r2 = await call('own_checkpoint_page', t.uid, t.repoId, 1, s, 'accumulate',
      null, 'cur1', delta(HEX(50), 5))
    check(r2 === 'stale', `replay after commit returned ${r2}`)
    let [{ c: touch }] = await sql`select touch_commits::int c from ownership_history_work where repository_id = ${t.repoId}`
    check(touch === 5, `double-count after lost response (touch=${touch})`)
    // stale cursor → rejected, no writes
    const r3 = await call('own_checkpoint_page', t.uid, t.repoId, 1, s, 'accumulate',
      'wrong-cursor', 'cur2', delta(HEX(51), 2))
    check(r3 === 'stale', `stale cursor returned ${r3}`)
    check(await count(t, 'ownership_history_work') === 1, 'stale cursor wrote rows')
    // stale version → rejected
    const r4 = await call('own_checkpoint_page', t.uid, t.repoId, 9, s, 'accumulate',
      'cur1', 'cur2', delta(HEX(52), 2))
    check(r4 === 'stale', `stale version returned ${r4}`)
    check(await count(t, 'ownership_history_work') === 1, 'stale version wrote rows')
    // accumulate page 2 adds to the same bucket
    const r5 = await call('own_checkpoint_page', t.uid, t.repoId, 1, s, 'accumulate',
      'cur1', 'cur2', delta(HEX(50), 3))
    check(r5 === 'applied', `checkpoint page2 returned ${r5}`)
    ;[{ c: touch }] = await sql`select touch_commits::int c from ownership_history_work where repository_id = ${t.repoId}`
    check(touch === 8, `additive upsert wrong (touch=${touch})`)
    // bot drift inside the build fails closed and leaves cursor at cur2
    await mustRaise(() => call('own_checkpoint_page', t.uid, t.repoId, 1, s, 'accumulate',
      'cur2', 'cur3', delta(HEX(50), 1, true)), 'accumulate is_bot drift')
    const [{ cursor: curNow }] = await sql`select history_cursor #>> '{current,cursor}' as cursor from ownership_sync_state where repository_id = ${t.repoId}`
    check(curNow === 'cur2', `cursor moved on failed page (${curNow})`)
    // last accumulate page flips to resolve
    const r6 = await call('own_checkpoint_page', t.uid, t.repoId, 1, s, 'accumulate',
      'cur2', null, [], [], true)
    check(r6 === 'applied', `flip call returned ${r6}`)
    const [{ pass: curPass }] = await sql`select history_cursor #>> '{current,pass}' as pass from ownership_sync_state where repository_id = ${t.repoId}`
    check(curPass === 'resolve', `pass not flipped (${curPass})`)
    // resolve stages identity with FROZEN is_bot
    const r7 = await call('own_checkpoint_page', t.uid, t.repoId, 1, s, 'resolve',
      null, 'r1', [], ident(HEX(50), 'Nz', 'zed', false))
    check(r7 === 'applied', `resolve stage returned ${r7}`)
    const staged = await sql`select github_node_id, display_login, is_bot from ownership_contributor_build_work where repository_id = ${t.repoId}`
    check(staged.length === 1 && staged[0].github_node_id === 'Nz' && staged[0].is_bot === false,
      `staged row wrong (${JSON.stringify(staged)})`)
    // pass-2 bot drift fails closed
    await mustRaise(() => call('own_checkpoint_page', t.uid, t.repoId, 1, s, 'resolve',
      'r1', 'r2', [], ident(HEX(50), 'Nz', 'zed', true)), 'resolve is_bot drift')
    // key seen only in pass 2 (no pass-1 counters) is ignored
    const r8 = await call('own_checkpoint_page', t.uid, t.repoId, 1, s, 'resolve',
      'r1', 'r2', [], ident(HEX(53), 'Nn', 'newguy', false))
    check(r8 === 'applied', `pass2-only key call returned ${r8}`)
    check(await count(t, 'ownership_contributor_build_work') === 1,
      'pass-2-only key was staged')
    await sql`delete from users where id = ${t.uid}`
  }

  /* ── own_sweep_stale_work — orphans vs stale-build routing ─────────── */
  {
    // orphans with building_version null → bare delete
    const t = await tenant()
    const s = await scope(t)
    await membership(t, s, 1)
    await workRow(t, s, 1, HEX(60))
    await stageRow(t, 1, HEX(60))
    await sync(t, 'done', 1, null)
    const rO = await call('own_sweep_stale_work', t.uid, t.repoId)
    check(rO === 'swept-orphans', `orphan sweep returned ${rO}`)
    check(await count(t, 'ownership_history_work') === 0 && await count(t, 'ownership_contributor_build_work') === 0,
      'orphan rows survived sweep')
    // stale live build → routed through canonical abandon
    const s2 = await scope(t, 'h-sw2', 'lib')
    const c2 = await contributor(t, HEX(61))
    await membership(t, s2, 2)
    await snapshot(t, s2, c2, 2)
    await workRow(t, s2, 2, HEX(61))
    // stale means NO activity inside the window — backdate the sync row
    // AND the work/staging updated_at, or the sweep correctly refuses
    await sql`update ownership_history_work set updated_at = now() - interval '20 days'
              where repository_id = ${t.repoId}`
    await sql`update ownership_contributor_build_work set updated_at = now() - interval '20 days'
              where repository_id = ${t.repoId}`
    await sql`update ownership_sync_state set building_version = 2, phase = 'history',
                     updated_at = now() - interval '20 days'
              where repository_id = ${t.repoId}`
    const rS = await call('own_sweep_stale_work', t.uid, t.repoId)
    check(rS === 'abandoned', `stale-build sweep returned ${rS}`)
    check(await count(t, 'ownership_snapshots', 2) === 0, 'swept build snapshots survived')
    const [{ building_version: swB, active_version: swA }] =
      await sql`select building_version, active_version from ownership_sync_state where repository_id = ${t.repoId}`
    check(swA === 1 && swB === null, `sweep touched active state (${swA}/${swB})`)
    await sql`delete from users where id = ${t.uid}`

    // active (non-stale) build → not swept
    const tA = await tenant()
    const sA = await scope(tA)
    await membership(tA, sA, 1)
    await workRow(tA, sA, 1, HEX(62))
    await sync(tA, 'history', null, 1)
    const rA = await call('own_sweep_stale_work', tA.uid, tA.repoId)
    check(rA === 'active', `fresh build sweep returned ${rA}`)
    check(await count(tA, 'ownership_history_work') === 1, 'active build work swept')
    await sql`delete from users where id = ${tA.uid}`
  }

  /* ── work_key / privacy shape guards ───────────────────────────────── */
  {
    const t = await tenant()
    const s = await scope(t)
    await membership(t, s, 1)
    await mustFail(() => workRow(t, s, 1, 'not-hex'), 'work_key plaintext',
      CHK('ownership_history_work_key'))
    await mustFail(() => workRow(t, s, 1, 'other'), 'work_key aggregate bucket',
      CHK('ownership_history_work_key'))
    await mustFail(() => stageRow(t, 1, 'unlinked'), 'staging synthetic unlinked',
      CHK('ownership_contributor_build_work_key'))
    await mustFail(() => stageRow(t, 1, 'other'), 'staging synthetic other',
      CHK('ownership_contributor_build_work_key'))
    await mustFail(() => workRow(t, s, 0, HEX(70)), 'work version 0',
      CHK('ownership_history_work_version'))
    await mustFail(() => sql`insert into ownership_scope_versions
      (user_id, repository_id, scope_id, calculation_version, excluded, exclusion_reason)
      values (${t.uid}, ${t.repoId}, ${s}, 1, true, 'vendor')`,
      'membership vendor exclusion', CHK('ownership_scope_versions_exclusion'))
    await sql`delete from users where id = ${t.uid}`
  }

  return problems
}
