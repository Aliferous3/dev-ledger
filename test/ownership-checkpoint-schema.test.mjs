// Phase-1C-B1 ownership checkpointing — structural guards for
// migrations/013_ownership_checkpointing.sql. Real-Postgres behavioral
// proofs (A–AA integrity matrix, checkpoint CAS, lifecycle gate, upgrade
// leg) live in scripts/ownership-checkpoint-proofs.mjs, invoked by
// scripts/recovery-drill.mjs under `npm run db:drill`.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const src = (rel) => readFileSync(path.join(ROOT, rel), 'utf8')
const MIG = src('migrations/013_ownership_checkpointing.sql')

const NEW_TABLES = ['ownership_scope_versions', 'ownership_history_work', 'ownership_contributor_build_work']

function tableSql(name) {
  const i = MIG.indexOf(`create table if not exists public.${name}`)
  assert.notEqual(i, -1, `${name} is not created in 013`)
  const end = MIG.indexOf('\n);', i)
  return MIG.slice(i, end)
}

/* ── forward-only, additive relative to 012 ──────────────────────────── */

test('013 is the latest migration; 012 untouched by the file', () => {
  const files = readdirSync(path.join(ROOT, 'migrations')).filter((f) => f.endsWith('.sql')).sort()
  assert.equal(files[files.length - 1], '013_ownership_checkpointing.sql')
  assert.ok(files.includes('012_ownership.sql'))
  // no drops/truncates — only the sanctioned constraint replacement on
  // ownership_snapshots (drop constraint + re-add, same name/keys)
  assert.doesNotMatch(MIG, /drop\s+table|truncate|drop\s+column|alter\s+.*\brename\b/i)
  const drops = [...MIG.matchAll(/drop\s+constraint\s+(\w+)/gi)].map((m) => m[1])
  assert.deepEqual(drops, ['ownership_snapshots_scope_repo'],
    `only the scope_repo FK may be dropped/re-added, got ${drops}`)
})

/* ── ownership_scope_versions — RETAINED membership ──────────────────── */

test('scope_versions grain, tenant pair, and NO ACTION scope FK', () => {
  const t = tableSql('ownership_scope_versions')
  for (const col of ['scope_id', 'user_id', 'repository_id', 'calculation_version',
    'excluded', 'exclusion_reason', 'created_at', 'updated_at']) {
    assert.match(t, new RegExp(`\\b${col}`), `missing ${col}`)
  }
  assert.match(t, /unique \(scope_id, calculation_version\)/i, 'missing (scope,version) membership grain')
  assert.match(t, /unique \(scope_id, repository_id, user_id, calculation_version\)/i,
    'missing supporting composite unique for the snapshot FK')
  assert.match(t, /foreign key \(repository_id, user_id\)[\s\S]*?references public\.repositories \(id, user_id\)[\s\S]*?on delete cascade/i,
    'tenant pair must cascade (teardown path)')
  assert.match(t, /foreign key \(scope_id, repository_id\)[\s\S]*?references public\.ownership_scopes \(id, repository_id\)[\s\S]*?on delete no action/i,
    'retained child->scope FK must be exactly NO ACTION')
  assert.match(t, /calculation_version > 0/i)
  // the only exclusion_reason allowed is the cardinality cap
  assert.match(t, /exclusion_reason = 'cardinality_cap'/i)
  assert.doesNotMatch(t, /display_path|scope_path|path_text/i, 'no path inventory columns')
})

/* ── ownership_history_work — EPHEMERAL counters ─────────────────────── */

test('history_work carries counters only — no plaintext identity, no paths', () => {
  const t = tableSql('ownership_history_work')
  for (const col of ['user_id', 'repository_id', 'scope_id', 'calculation_version',
    'period_start', 'work_key', 'is_bot', 'touch_commits', 'first_seen_at',
    'last_seen_at', 'created_at', 'updated_at']) {
    assert.match(t, new RegExp(`\\b${col}`), `missing ${col}`)
  }
  for (const bad of ['github_node_id', 'display_login', 'email', 'author_name',
    'commit_message', 'patch', 'diff', 'source', 'path', 'payload', 'database_id']) {
    assert.doesNotMatch(t, new RegExp(`\\b${bad}\\b`, 'i'), `forbidden field ${bad} in history_work`)
  }
  assert.match(t, /work_key = 'unlinked' or work_key ~ '\^\[0-9a-f\]\{64\}\$'/i,
    'work_key domain must be literal unlinked or 64-hex')
  assert.match(t, /unique \(scope_id, calculation_version, period_start, work_key\)/i,
    'missing scope×version×month×key grain')
  assert.match(t, /foreign key \(repository_id, user_id\)[\s\S]*?on delete cascade/i, 'tenant cascade missing')
  assert.match(t, /foreign key \(scope_id, repository_id\)[\s\S]*?on delete cascade/i, 'scope cascade missing')
  assert.match(t, /calculation_version > 0/i)
  // month grain mirrors the snapshot period rule — explicit UTC wall clock
  assert.match(t, /date_trunc\('month', period_start at time zone 'UTC'\)\s*at time zone 'UTC'/i)
})

/* ── ownership_contributor_build_work — EPHEMERAL staging ────────────── */

test('build_work stages represented keys only — no synthetics, no provenance column', () => {
  const t = tableSql('ownership_contributor_build_work')
  for (const col of ['user_id', 'repository_id', 'calculation_version', 'work_key',
    'github_node_id', 'display_login', 'is_bot', 'first_seen_at', 'last_seen_at']) {
    assert.match(t, new RegExp(`\\b${col}`), `missing ${col}`)
  }
  assert.match(t, /unique \(repository_id, calculation_version, work_key\)/i, 'missing build grain')
  assert.match(t, /work_key ~ '\^\[0-9a-f\]\{64\}\$'/i, 'staging must refuse synthetic bucket keys')
  assert.doesNotMatch(t, /scope_id/i, 'no scope provenance column (§5.3 uses committed-V provenance)')
  for (const bad of ['email', 'author_name', 'database_id', 'avatar', 'path', 'payload']) {
    assert.doesNotMatch(t, new RegExp(`\\b${bad}\\b`, 'i'), `forbidden field ${bad} in build_work`)
  }
})

/* ── snapshot FK actions — exact NO ACTION ───────────────────────────── */

test('snapshot->scope FK re-created NO ACTION; snapshot->membership composite FK NO ACTION', () => {
  // the deployed constraint is dropped and re-added under the SAME name
  // and keys with the delete action changed — not left as CASCADE
  assert.match(MIG, /drop constraint ownership_snapshots_scope_repo[\s\S]*?add constraint ownership_snapshots_scope_repo[\s\S]*?foreign key \(scope_id, repository_id\)[\s\S]*?references public\.ownership_scopes \(id, repository_id\)[\s\S]*?on delete no action/i,
    'ownership_snapshots_scope_repo must be re-created with exact NO ACTION')
  assert.match(MIG, /add constraint ownership_snapshots_scope_version[\s\S]*?foreign key \(scope_id, repository_id, user_id, calculation_version\)[\s\S]*?references public\.ownership_scope_versions[\s\S]*?\(scope_id, repository_id, user_id, calculation_version\)[\s\S]*?on delete no action/i,
    'snapshot->membership composite FK must be NO ACTION over all four columns')
  // no surviving CASCADE on the snapshot->scope relation
  const scopeRepo = MIG.match(/add constraint ownership_snapshots_scope_repo[\s\S]*?on delete (\w+( \w+)?)/i)
  assert.ok(scopeRepo && !/cascade/i.test(scopeRepo[1]), 'scope_repo FK must not remain CASCADE')
})

/* ── backfill exists before the composite FK validates ───────────────── */

test('012-era membership backfill runs inside 013 before the FK is added', () => {
  const backfill = MIG.indexOf('insert into public.ownership_scope_versions')
  const fkAdd = MIG.indexOf('add constraint ownership_snapshots_scope_version')
  assert.ok(backfill !== -1 && fkAdd !== -1 && backfill < fkAdd,
    'membership backfill must precede the composite FK validation')
})

/* ── RLS + grants — same model as 012 ────────────────────────────────── */

test('RLS enabled, zero browser policies, service_role-only DML on all new tables', () => {
  for (const t of NEW_TABLES) {
    assert.match(MIG, new RegExp(`alter table public\\.${t}\\s+enable row level security`, 'i'))
    assert.match(MIG, new RegExp(`revoke all on public\\.${t}\\s+from public, anon, authenticated`, 'i'))
    assert.match(MIG, new RegExp(`grant select, insert, update, delete on public\\.${t}\\s+to service_role`, 'i'))
  }
  assert.doesNotMatch(MIG, /create\s+policy/i, 'no RLS policies may be created')
})

/* ── database primitives — service-role-only SECURITY INVOKER ────────── */

test('all own_* primitives exist, are SECURITY INVOKER, service_role-only', () => {
  const fns = ['own_checkpoint_page', 'own_restart_scope', 'own_promote_build',
    'own_abandon_build', 'own_build_preflight', 'own_build_init', 'own_sweep_stale_work']
  for (const fn of fns) {
    const i = MIG.indexOf(`function public.${fn}(`)
    assert.notEqual(i, -1, `${fn} missing`)
    const j = MIG.indexOf('$$;', i)
    const body = MIG.slice(i, j)
    assert.match(body, /security invoker/i, `${fn} must be SECURITY INVOKER`)
    assert.match(body, /set search_path = public/i, `${fn} must pin search_path`)
    assert.match(MIG, new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\)\\s+from public, anon, authenticated`, 'i'),
      `${fn} missing revoke`)
    assert.match(MIG, new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\)\\s+to service_role`, 'i'),
      `${fn} missing service_role grant`)
  }
  assert.doesNotMatch(MIG, /security definer/i, 'no function may be SECURITY DEFINER')
})

/* ── closed error taxonomy — no provider text leaks ──────────────────── */

test('all function raises use the closed OWNERSHIP_INTERNAL_ERROR taxonomy', () => {
  const raises = [...MIG.matchAll(/raise exception\s+('[^']*')/g)].map((m) => m[1])
  assert.ok(raises.length > 10, 'expected many fail-closed raise sites')
  for (const r of raises) assert.equal(r, `'OWNERSHIP_INTERNAL_ERROR'`, `non-canonical error ${r}`)
})

/* ── dash_ownership_scopes — active-version membership ───────────────── */

test('dash_ownership_scopes enumerates scopes via scope_versions at active_version', () => {
  const i = MIG.indexOf('function public.dash_ownership_scopes(')
  assert.notEqual(i, -1)
  const body = MIG.slice(i, MIG.indexOf('$$;', i))
  assert.match(body, /join public\.ownership_scope_versions sv/i, 'must join version membership')
  assert.match(body, /sv\.calculation_version = st\.active_version/i, 'must gate at active_version')
  assert.match(body, /sv\.excluded/i, 'exclusion state must come from version membership')
  assert.match(body, /security invoker/i)
  assert.doesNotMatch(body, /sc\.excluded/, 'legacy base-scope excluded must not be authoritative')
  assert.match(MIG, /revoke all on function public\.dash_ownership_scopes\(uuid, uuid\)/i)
  assert.match(MIG, /grant execute on function public\.dash_ownership_scopes\(uuid, uuid\) to service_role/i)
})

/* ── checkpoint primitive semantics — structural assertions ──────────── */

test('own_checkpoint_page: CAS envelope returns stale, single-tx cursor advance', () => {
  const i = MIG.indexOf('function public.own_checkpoint_page(')
  const body = MIG.slice(i, MIG.indexOf('$$;', i))
  assert.match(body, /for update/i, 'must take the sync-state row lock')
  assert.match(body, /is distinct from p_version/i, 'CAS must compare building_version')
  assert.match(body, /current,cursor/i, 'CAS must compare the cursor')
  assert.match(body, /return 'stale'/i, 'mismatch must return stale, not raise')
  assert.match(body, /on conflict \(scope_id, calculation_version, period_start, work_key\)/i,
    'accumulate must be an additive upsert at the work grain')
  assert.match(body, /jsonb_set\(st\.history_cursor, '\{current\}'/i,
    'cursor advance must commit in the same transaction')
  assert.match(body, /least\(public\.ownership_history_work\.first_seen_at/i)
  assert.match(body, /greatest\(public\.ownership_history_work\.last_seen_at/i)
})

// §6.4 durable-identity minimization, enforced in the database itself:
// existence in ownership_history_work is NOT sufficient authorization to
// persist contributor identity — only membership in the deterministic
// per-period Top-25 union (touch_commits DESC, work_key ASC, 'unlinked'
// excluded) may stage github_node_id/display_login.
test('own_checkpoint_page: resolve gates staging on the represented Top-25 union', () => {
  const i = MIG.indexOf('function public.own_checkpoint_page(')
  const body = MIG.slice(i, MIG.indexOf('$$;', i))
  const resolve = body.slice(body.indexOf("p_pass = 'resolve'"))
  // the represented set is computed from THIS scope's frozen pass-1
  // counters with the reducer's ranking semantics
  assert.match(resolve, /row_number\(\) over \(\s*partition by period_start\s+order by touch_commits desc, work_key asc\s*\)/i,
    'represented set must rank per period by touch_commits DESC, work_key ASC')
  assert.match(resolve, /rnk <= 25/i, 'only ranks 1..25 are represented (TOP_LINKED_PER_PERIOD)')
  assert.match(resolve, /work_key <> 'unlinked'/i, 'unlinked bucket must not rank as linked')
  assert.match(resolve, /scope_id = p_scope and calculation_version = p_version/i,
    'represented set is scoped to the current scope+version counters')
  // the staging insert must be gated on set membership — counter
  // existence alone never authorizes identity persistence
  const insert = resolve.indexOf('insert into public.ownership_contributor_build_work')
  assert.notEqual(insert, -1, 'resolve staging insert missing')
  const insertTail = resolve.slice(insert)
  assert.match(insertTail, /where i->>'work_key' = any\(v_represented\)/i,
    'staging insert must require represented-set membership')
  // pass-2 identity checks apply only to represented keys — an overflow
  // observation is ignored, never validated or persisted into state
  const checks = resolve.slice(0, insert)
  const checkCount = (checks.match(/= any\(v_represented\)/g) || []).length
  assert.ok(checkCount >= 4,
    `all resolve-time checks must restrict to represented keys (${checkCount}/4 found)`)
  // the reducer constant must appear verbatim so drift is visible
  const reducer = src('lib/ownership/history-reducer.mjs')
  assert.match(reducer, /TOP_LINKED_PER_PERIOD = 25/, 'reducer Top-25 constant missing')
})

test('abandon deletes in the NO ACTION order and preserves active_version', () => {
  const i = MIG.indexOf('function public.own_abandon_build(')
  const body = MIG.slice(i, MIG.indexOf('$$;', i))
  const snapDel = body.indexOf('delete from public.ownership_snapshots')
  const memDel = body.indexOf('delete from public.ownership_scope_versions')
  const workDel = body.indexOf('delete from public.ownership_history_work')
  const stageDel = body.indexOf('delete from public.ownership_contributor_build_work')
  assert.ok(snapDel !== -1 && memDel !== -1 && workDel !== -1 && stageDel !== -1)
  assert.ok(snapDel < memDel, 'snapshots must be deleted before membership (NO ACTION order)')
  const flip = body.indexOf('building_version = null')
  assert.ok(flip !== -1, 'must clear building_version')
  assert.doesNotMatch(body, /active_version\s*=/, 'abandon must never write active_version')
})

test('preflight GC order + init gate: snapshots -> membership -> prune, verify-empty', () => {
  const i = MIG.indexOf('function public.own_build_preflight(')
  const body = MIG.slice(i, MIG.indexOf('$$;', i))
  const snapDel = body.indexOf('delete from public.ownership_snapshots')
  const memDel = body.indexOf('delete from public.ownership_scope_versions')
  assert.ok(snapDel !== -1 && memDel !== -1 && snapDel < memDel, 'GC must delete snapshots before membership')
  assert.match(body, /<> st\.active_version/i, 'GC must target retired (non-active) versions')
  const j = MIG.indexOf('function public.own_build_init(')
  const init = MIG.slice(j, MIG.indexOf('$$;', j))
  assert.match(init, /return 'blocked'/i, 'init must refuse when retired rows remain')
  assert.match(init, /building_version = p_new_version/i, 'init sets the building version only after the gate')
})

test('promotion validates the exact-set invariant before applying metadata', () => {
  const i = MIG.indexOf('function public.own_promote_build(')
  const body = MIG.slice(i, MIG.indexOf('$$;', i))
  const extra = body.indexOf('a staged key no committed V snapshot represents')
  const missing = body.indexOf('no staged build-work row')
  const apply = body.indexOf('update public.ownership_contributors')
  const flip = body.indexOf('set active_version = p_version')
  assert.ok(extra !== -1 && missing !== -1, 'both directions of the exact-set check required')
  assert.ok(extra < apply && missing < apply, 'metadata application must come after exact-set validation')
  assert.ok(apply < flip, 'staged metadata applies before the version flip, same transaction')
  assert.match(body, /active_version = p_version/i)
})

test('restart preserves staging referenced by committed-V snapshots only', () => {
  const i = MIG.indexOf('function public.own_restart_scope(')
  const body = MIG.slice(i, MIG.indexOf('$$;', i))
  assert.match(body, /delete from public\.ownership_history_work/i)
  assert.match(body, /delete from public\.ownership_contributor_build_work/i)
  assert.match(body, /ownership_snapshots/i, 'provenance is committed-V snapshots, not a scope column')
  assert.doesNotMatch(body, /delete from public\.ownership_contributors\b/i,
    'restart must never delete retained contributor rows')
  assert.doesNotMatch(body, /delete from public\.ownership_scopes\b/i,
    'restart must never delete base scopes')
})

/* ── backup classification is consistent with the migration ──────────── */

test('backup-scope.mjs classification: scope_versions CORE, work tables EPHEMERAL', async () => {
  const { CORE_TABLES, EPHEMERAL_TABLES, BACKUP_TABLES } = await import('../scripts/backup-scope.mjs')
  assert.ok(CORE_TABLES.includes('ownership_scope_versions'), 'membership must be CORE')
  assert.ok(BACKUP_TABLES.includes('ownership_scope_versions'))
  for (const t of ['ownership_history_work', 'ownership_contributor_build_work']) {
    assert.ok(EPHEMERAL_TABLES.includes(t), `${t} must be EPHEMERAL`)
    assert.ok(!BACKUP_TABLES.includes(t), `${t} must not be backed up`)
  }
})
