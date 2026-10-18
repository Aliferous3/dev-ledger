// Phase-1B ownership schema foundation — structural guards for
// migrations/012_ownership.sql plus dormancy proofs that no runtime wiring
// exists. Real-Postgres behavioral proofs (tenant-FK rejection, row-shape
// checks, version serve-gate, cascades, RPC output) live in
// scripts/recovery-drill.mjs and run under `npm run db:drill`.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const src = (rel) => readFileSync(path.join(ROOT, rel), 'utf8')
const MIG = src('migrations/012_ownership.sql')

const TABLES = ['ownership_scopes', 'ownership_contributors', 'ownership_snapshots', 'ownership_sync_state']

// extract the body of one CREATE TABLE block for table-scoped assertions
function tableSql(name) {
  const i = MIG.indexOf(`create table if not exists public.${name}`)
  assert.notEqual(i, -1, `${name} is not created in 012`)
  // naive-but-sufficient: table body ends at the first "\n);" after start
  const end = MIG.indexOf('\n);', i)
  return MIG.slice(i, end)
}

/* ── additive-only migration ─────────────────────────────────────────── */

test('012 is purely additive — no drops, truncates, or column rewrites', () => {
  assert.doesNotMatch(MIG, /drop\s+table|drop\s+column|truncate/i)
  assert.doesNotMatch(MIG, /alter\s+table[\s\S]*?\brename\b/i)
  // the only existing-table change is the repositories surrogate unique
  const alters = [...MIG.matchAll(/alter\s+table\s+public\.(\w+)/gi)].map((m) => m[1])
  for (const t of alters) assert.ok(TABLES.includes(t), `unexpected ALTER on ${t}`)
  assert.match(MIG, /create unique index if not exists repositories_id_user_key\s+on public\.repositories \(id, user_id\)/)
  // forward-only file numbering
  const files = readdirSync(path.join(ROOT, 'migrations')).filter((f) => f.endsWith('.sql')).sort()
  assert.equal(files[files.length - 1], '012_ownership.sql', '012 must be the latest migration')
})

/* ── tables, columns, tenant FKs ─────────────────────────────────────── */

test('all four ownership tables exist with required columns', () => {
  for (const t of TABLES) assert.match(MIG, new RegExp(`create table if not exists public\\.${t}\\b`))
  const scopes = tableSql('ownership_scopes')
  for (const col of ['id\\s+uuid', 'user_id', 'repository_id', 'scope_path_hash', 'display_path',
    'scope_type', 'depth', 'excluded', 'exclusion_reason', 'created_at', 'updated_at']) {
    assert.match(scopes, new RegExp(`\\b${col}`), `ownership_scopes missing ${col}`)
  }
  const contrib = tableSql('ownership_contributors')
  for (const col of ['contributor_key', 'identity_kind', 'github_node_id', 'display_login',
    'is_bot', 'first_seen_at', 'last_seen_at']) {
    assert.match(contrib, new RegExp(`\\b${col}`), `ownership_contributors missing ${col}`)
  }
  const snaps = tableSql('ownership_snapshots')
  for (const col of ['scope_id', 'contributor_id', 'period_granularity', 'period_start',
    'calculation_version', 'touch_commits', 'touch_share', 'surviving_lines',
    'surviving_line_share', 'recent_touch_commits', 'first_meaningful_touch',
    'last_meaningful_touch', 'total_touch_commits', 'human_contributor_count',
    'unlinked_touch_share', 'recent_human_maintainer_count',
    'top_human_contributor_share', 'total_surviving_lines', 'unlinked_surviving_line_share']) {
    assert.match(snaps, new RegExp(`\\b${col}`), `ownership_snapshots missing ${col}`)
  }
  const sync = tableSql('ownership_sync_state')
  for (const col of ['phase', 'history_cursor', 'blame_cursor', 'pending_scopes',
    'active_version', 'building_version', 'last_processed_sha', 'error',
    'primary key \\(user_id, repository_id\\)']) {
    assert.match(sync, new RegExp(`\\b${col}`), `ownership_sync_state missing ${col}`)
  }
})

test('every ownership table enforces tenant pairing by composite FK cascade', () => {
  for (const t of TABLES) {
    const body = tableSql(t)
    assert.match(body, /foreign key \(repository_id, user_id\)/i, `${t} missing composite tenant FK`)
    assert.match(body, /references public\.repositories \(id, user_id\)/i, `${t} FK target wrong`)
    assert.match(body, /on delete cascade/i, `${t} missing delete cascade`)
  }
})

test('snapshot composite FKs pin scope and contributor to the same repository', () => {
  const snaps = tableSql('ownership_snapshots')
  assert.match(snaps, /foreign key \(scope_id, repository_id\)[\s\S]*?references public\.ownership_scopes \(id, repository_id\)/i)
  assert.match(snaps, /foreign key \(contributor_id, repository_id\)[\s\S]*?references public\.ownership_contributors \(id, repository_id\)/i)
  // contributor_id must be nullable — scope-total rows have no contributor
  assert.match(snaps, /contributor_id\s+uuid(?! not null)/i)
  // supporting surrogate uniques must exist on the parent tables
  assert.match(tableSql('ownership_scopes'), /unique \(id, repository_id\)/i)
  assert.match(tableSql('ownership_contributors'), /unique \(id, repository_id\)/i)
})

/* ── row-shape / identity / period checks ────────────────────────────── */

test('scope types are repo/dir only — no file scope, bounded dir shape', () => {
  const body = tableSql('ownership_scopes')
  assert.match(body, /check \(scope_type in \('repo', 'dir'\)\)/i)
  assert.match(body, /depth between 1 and 4/i)
  assert.match(body, /length\(display_path\) <= 200/i)
  assert.match(body, /unique \(repository_id, scope_path_hash\)/i)
  // the only persisted exclusion reason is the cardinality cap
  assert.match(body, /exclusion_reason = 'cardinality_cap'/i)
  assert.doesNotMatch(body, /'vendor'|'generated'|'binary'|'submodule'/i,
    'vendor/generated/binary/submodule paths must never reach this table')
})

test('identity kinds are a closed set with shape-separating checks', () => {
  const body = tableSql('ownership_contributors')
  assert.match(body, /check \(identity_kind in \('linked', 'unlinked', 'aggregate'\)\)/i)
  assert.match(body, /contributor_key = 'unlinked'/i, 'unlinked kind must pin the fixed key')
  assert.match(body, /contributor_key = 'other'/i, 'aggregate kind must pin the fixed key')
  assert.match(body, /is_bot = false or identity_kind = 'linked'/i, 'bots must be linked-only')
  assert.match(body, /github_node_id is not null and display_login is not null/i,
    'linked rows must require the durable identity pair')
  assert.match(body, /contributor_key not in \('unlinked', 'other'\)/i,
    'linked rows must not squat the reserved synthetic keys')
  assert.match(body, /first_seen_at <= last_seen_at/i)
  assert.match(body, /unique \(repository_id, contributor_key\)/i)
})

test('no numeric databaseId, email, avatar, or author-name columns anywhere', () => {
  for (const bad of ['database_id', 'databaseId', 'email', 'avatar', 'author_name',
    'author_email', 'committer_email', 'login_history', 'name_history']) {
    assert.doesNotMatch(MIG, new RegExp(`\\b${bad}\\b`, 'i'), `forbidden field ${bad} in 012`)
  }
})

test('no source/raw-content fields can exist in the ownership schema', () => {
  for (const bad of ['commit_message', 'pr_title', 'patch', 'diff', 'blob',
    'source_code', 'source_line', 'blame_range', 'blame_text', 'raw_graphql',
    'raw_response', 'oauth_token', 'installation_token', 'webhook_body']) {
    assert.doesNotMatch(MIG, new RegExp(`\\b${bad}\\b`, 'i'), `forbidden content field ${bad} in 012`)
  }
})

test('period rules: month is first-of-month UTC, head is the fixed sentinel', () => {
  const body = tableSql('ownership_snapshots')
  assert.match(body, /check \(period_granularity in \('month', 'head'\)\)/i)
  assert.match(body, /'1970-01-01 00:00:00\+00'::timestamptz/, 'head sentinel missing')
  // month boundary must be computed on the UTC wall clock — a bare
  // date_trunc('month', timestamptz) follows the session TimeZone.
  assert.match(
    body,
    /date_trunc\('month', period_start at time zone 'UTC'\)\s*at time zone 'UTC'/i,
    'month boundary must be computed explicitly in UTC',
  )
  assert.doesNotMatch(body, /date_trunc\('month', period_start\)/i,
    'session-timezone-dependent date_trunc must not appear')
  assert.match(body, /calculation_version > 0/i)
})

test('nonnegative counts, [0,1] shares, meaningful-touch ordering', () => {
  const body = tableSql('ownership_snapshots')
  for (const col of ['touch_commits', 'surviving_lines', 'recent_touch_commits',
    'total_touch_commits', 'human_contributor_count', 'recent_human_maintainer_count',
    'total_surviving_lines']) {
    assert.match(body, new RegExp(`${col} is null or ${col} >= 0`, 'i'), `${col} missing >=0 check`)
  }
  for (const col of ['touch_share', 'surviving_line_share', 'unlinked_touch_share',
    'top_human_contributor_share', 'unlinked_surviving_line_share']) {
    assert.match(body, new RegExp(`${col} is null or ${col} between 0 and 1`, 'i'), `${col} missing [0,1] check`)
  }
  assert.match(body, /first_meaningful_touch <= last_meaningful_touch/i)
})

test('row-shape check separates the four legitimate row forms', () => {
  const body = tableSql('ownership_snapshots')
  assert.match(body, /when period_granularity = 'month' and contributor_id is not null/i)
  assert.match(body, /when period_granularity = 'month' and contributor_id is null/i)
  assert.match(body, /when period_granularity = 'head' and contributor_id is not null/i)
  assert.match(body, /when period_granularity = 'head' and contributor_id is null/i)
  assert.match(body, /else false/i, 'no fallback row shape may be allowed')
})

test('snapshot uniqueness carries calculation_version in both partial keys', () => {
  assert.match(MIG, /create unique index if not exists ownership_snapshots_contrib_key[\s\S]*?\(scope_id, contributor_id, period_granularity, period_start, calculation_version\)[\s\S]*?where contributor_id is not null/i)
  assert.match(MIG, /create unique index if not exists ownership_snapshots_total_key[\s\S]*?\(scope_id, period_granularity, period_start, calculation_version\)[\s\S]*?where contributor_id is null/i)
})

/* ── sync state ──────────────────────────────────────────────────────── */

test('sync_state is resumable, versioned, and closed-taxonomy', () => {
  const body = tableSql('ownership_sync_state')
  assert.match(body, /check \(phase in \('pending', 'history', 'blame', 'done', 'error'\)\)/i)
  assert.match(body, /active_version is null or active_version > 0/i)
  assert.match(body, /building_version is null or building_version > 0/i)
  assert.match(body, /active_version <> building_version/i)
  for (const code of ['GITHUB_RATE_LIMIT', 'GITHUB_ACCESS_REVOKED',
    'OWNERSHIP_HISTORY_FAILED', 'OWNERSHIP_BLAME_FAILED', 'OWNERSHIP_INTERNAL_ERROR']) {
    assert.ok(body.includes(`'${code}'`), `error taxonomy missing ${code}`)
  }
})

/* ── RLS / grants ────────────────────────────────────────────────────── */

test('RLS enabled on all four tables with zero browser-facing policies', () => {
  for (const t of TABLES) {
    assert.match(MIG, new RegExp(`alter table public\\.${t}\\s+enable row level security`, 'i'))
    assert.match(MIG, new RegExp(`revoke all on public\\.${t}\\s+from public, anon, authenticated`, 'i'))
    assert.match(MIG, new RegExp(`grant select, insert, update, delete on public\\.${t}\\s+to service_role`, 'i'))
  }
  // zero policies anywhere for ownership tables — the only path is service_role
  assert.doesNotMatch(MIG, /create\s+policy/i, 'no policies may be created for ownership tables')
})

/* ── dormant dashboard RPCs ──────────────────────────────────────────── */

test('dash_ownership_* RPCs are STABLE SECURITY INVOKER, tenant-scoped, serve-gated', () => {
  for (const fn of ['dash_ownership_scopes', 'dash_ownership_head', 'dash_ownership_timeline']) {
    const i = MIG.indexOf(`function public.${fn}(`)
    assert.notEqual(i, -1, `${fn} missing`)
    const j = MIG.indexOf('$$;', i)
    const body = MIG.slice(i, j)
    assert.match(body, /language sql stable security invoker set search_path = public/i, `${fn} wrong language/security attrs`)
    assert.match(body, /p_user uuid/i, `${fn} must accept p_user`)
    assert.match(body, /user_id = p_user/i, `${fn} must filter by p_user`)
    assert.match(body, /calculation_version = st\.active_version/i, `${fn} must serve active version only`)
    assert.doesNotMatch(body, /github_node_id|contributor_key|last_processed_sha|history_cursor|blame_cursor/i,
      `${fn} must not return internal identity/cursor fields`)
    assert.match(MIG, new RegExp(`revoke all on function public\\.${fn}\\(`, 'i'), `${fn} missing revoke`)
    assert.match(MIG, new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\)\\s+to service_role`, 'i'), `${fn} missing service_role grant`)
  }
})

/* ── dormancy / no-ingestion guards ──────────────────────────────────── */

// The word "ownership" legitimately appears in lib/sync.mjs (lock-claim
// comments) and the ToS (repo ownership) — the dormancy guard targets the
// feature's concrete identifiers instead of the bare word.
const OWNERSHIP_IDENTIFIERS = /ownership_scopes|ownership_contributors|ownership_snapshots|ownership_sync_state|dash_ownership|ownership_sync|identity_kind|contributor_key|scope_path_hash/i

test('no ownership ingestion or runtime wiring exists in lib/api/src', () => {
  for (const dir of ['lib', 'api', 'src']) {
    const files = readdirSync(path.join(ROOT, dir), { recursive: true })
      .filter((f) => /\.(mjs|ts|tsx|js|jsx)$/.test(String(f)))
    for (const f of files) {
      const rel = `${dir}/${String(f).replaceAll('\\', '/')}`
      const text = src(rel)
      assert.doesNotMatch(text, OWNERSHIP_IDENTIFIERS,
        `${rel} references ownership tables/RPCs — ingestion must stay dormant`)
      assert.doesNotMatch(text, /blame\(path|history\(path/i,
        `${rel} must not issue blame/history(path:) GraphQL calls`)
    }
  }
})

test('no ownership feature flag, env var, cron, or webhook wiring', () => {
  assert.doesNotMatch(src('vercel.json'), /OWNERSHIP/i)
  assert.doesNotMatch(src('.env.example'), /OWNERSHIP/i)
  for (const dir of ['lib', 'api']) {
    const files = readdirSync(path.join(ROOT, dir), { recursive: true })
      .filter((f) => /\.(mjs|ts|tsx|js|jsx)$/.test(String(f)))
    for (const f of files) {
      const rel = `${dir}/${String(f).replaceAll('\\', '/')}`
      const text = src(rel)
      assert.doesNotMatch(text, /OWNERSHIP_ENABLED|dash_ownership/i, `${rel} must not wire ownership`)
    }
  }
})

test('live SecurityPrivacyPage stays unamended until ownership collects', () => {
  const page = src('src/security/SecurityPrivacyPage.tsx')
  assert.doesNotMatch(page, /ownership/i,
    'the public trust record changes only when ownership actually collects data')
  assert.match(page, /AUTHOR IDENTIFIERS/, 'existing minimization claims must remain intact')
})
