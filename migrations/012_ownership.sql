-- 012 — ownership schema foundation (additive; forward-only; idempotent).
--
-- Contract: docs/ownership-data-privacy-spec.md. This tranche creates the
-- four ownership tables, relational/tenant integrity, RLS, grants, and
-- dormant dashboard RPC foundations ONLY. No ingestion exists — the tables
-- are expected to hold zero production rows until a later tranche.
--
-- Hard invariants encoded here:
--   * tenant consistency is DATABASE-enforced via composite foreign keys:
--     (repository_id, user_id) -> repositories(id, user_id) so no row can
--     pair one tenant's user_id with another tenant's repository.
--   * linked contributor identity = github_node_id (GraphQL User.id) +
--     display_login. Identity fields beyond that pair are never stored.
--   * 'unlinked' and 'aggregate' rows are synthetic and can never carry
--     GitHub identity fields or be mistaken for people.
--   * monthly rows are immutable period facts; mutable/current-state
--     fields live only on 'head' rows.
--   * calculation_version is part of snapshot row identity so served and
--     building versions coexist (active_version/building_version gate).
--   * error is a CHECK-constrained closed taxonomy — no provider text.

-- ── 0. tenant-consistency surrogate on repositories ─────────────────────
-- repositories.id is already the PK; the composite unique index lets
-- ownership tables foreign-key (repository_id, user_id) as a pair, proving
-- the repo belongs to the tenant. Unique index is sufficient as an FK
-- target; idempotent via if not exists.
create unique index if not exists repositories_id_user_key
  on public.repositories (id, user_id);

-- ── 1. ownership_scopes ──────────────────────────────────────────────────

create table if not exists public.ownership_scopes (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null,
  repository_id    uuid not null,
  scope_path_hash  text not null,
  display_path     text,
  scope_type       text not null,
  depth            int not null,
  excluded         boolean not null default false,
  exclusion_reason text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint ownership_scopes_repo_tenant
    foreign key (repository_id, user_id)
    references public.repositories (id, user_id)
    on delete cascade,

  constraint ownership_scopes_type
    check (scope_type in ('repo', 'dir')),

  -- repo scope: no path, depth 0. dir scope: bounded normalized path.
  -- there is deliberately no 'file' scope type — file paths are never
  -- persisted in V1.
  constraint ownership_scopes_shape
    check (
      (scope_type = 'repo' and display_path is null and depth = 0)
      or (scope_type = 'dir' and display_path is not null
          and depth between 1 and 4
          and length(display_path) <= 200)
    ),

  -- vendor/generated/binary/submodule paths never reach this table; the
  -- only legitimate persisted exclusion is the cardinality cap.
  constraint ownership_scopes_exclusion
    check (
      (not excluded and exclusion_reason is null)
      or (excluded and exclusion_reason = 'cardinality_cap')
    ),

  unique (repository_id, scope_path_hash),
  -- surrogate for snapshot composite FKs
  unique (id, repository_id)
);

create index if not exists ownership_scopes_repo_depth
  on public.ownership_scopes (repository_id, depth);

-- ── 2. ownership_contributors ────────────────────────────────────────────

create table if not exists public.ownership_contributors (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null,
  repository_id  uuid not null,
  contributor_key text not null,
  identity_kind  text not null,
  github_node_id text,
  display_login  text,
  is_bot         boolean not null default false,
  first_seen_at  timestamptz,
  last_seen_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint ownership_contributors_repo_tenant
    foreign key (repository_id, user_id)
    references public.repositories (id, user_id)
    on delete cascade,

  constraint ownership_contributors_kind
    check (identity_kind in ('linked', 'unlinked', 'aggregate')),

  -- linked rows carry the durable identity pair; synthetic rows never can.
  constraint ownership_contributors_linked
    check (identity_kind <> 'linked'
           or (github_node_id is not null and display_login is not null)),

  constraint ownership_contributors_unlinked
    check (identity_kind <> 'unlinked'
           or (contributor_key = 'unlinked' and github_node_id is null
               and display_login is null and is_bot = false)),

  constraint ownership_contributors_aggregate
    check (identity_kind <> 'aggregate'
           or (contributor_key = 'other' and github_node_id is null
               and display_login is null and is_bot = false)),

  -- bots are only ever linked identities
  constraint ownership_contributors_bot
    check (is_bot = false or identity_kind = 'linked'),

  constraint ownership_contributors_seen
    check (first_seen_at is null or last_seen_at is null
           or first_seen_at <= last_seen_at),

  unique (repository_id, contributor_key),
  -- surrogate for snapshot composite FKs
  unique (id, repository_id)
);

-- Deliberately NO index on github_node_id — cross-tenant contributor
-- enumeration must not even be convenient.
create index if not exists ownership_contributors_repo
  on public.ownership_contributors (repository_id);

-- ── 3. ownership_snapshots ───────────────────────────────────────────────

create table if not exists public.ownership_snapshots (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null,
  repository_id   uuid not null,
  scope_id        uuid not null,
  contributor_id  uuid,
  period_granularity text not null,
  period_start    timestamptz not null,

  -- monthly contributor fields
  touch_commits   int,
  touch_share     numeric(5,4),

  -- head contributor fields (mutable current-state)
  surviving_lines bigint,
  surviving_line_share numeric(5,4),
  recent_touch_commits int,
  first_meaningful_touch timestamptz,
  last_meaningful_touch  timestamptz,

  -- monthly scope-total fields
  total_touch_commits int,
  human_contributor_count int,
  unlinked_touch_share numeric(5,4),

  -- head scope-total fields
  recent_human_maintainer_count int,
  top_human_contributor_share numeric(5,4),
  total_surviving_lines bigint,
  unlinked_surviving_line_share numeric(5,4),

  calculation_version int not null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint ownership_snapshots_repo_tenant
    foreign key (repository_id, user_id)
    references public.repositories (id, user_id)
    on delete cascade,

  -- scope must belong to the same repository the snapshot claims
  constraint ownership_snapshots_scope_repo
    foreign key (scope_id, repository_id)
    references public.ownership_scopes (id, repository_id)
    on delete cascade,

  -- contributor must belong to the same repository (null = scope-total row)
  constraint ownership_snapshots_contrib_repo
    foreign key (contributor_id, repository_id)
    references public.ownership_contributors (id, repository_id)
    on delete cascade,

  constraint ownership_snapshots_granularity
    check (period_granularity in ('month', 'head')),

  constraint ownership_snapshots_version
    check (calculation_version > 0),

  -- head rows use the fixed sentinel; month rows are first-of-month UTC
  constraint ownership_snapshots_period
    check (
      (period_granularity = 'head'
        and period_start = '1970-01-01 00:00:00+00'::timestamptz)
      or (period_granularity = 'month'
        and period_start = date_trunc('month', period_start))
    ),

  constraint ownership_snapshots_counts
    check (
      (touch_commits is null or touch_commits >= 0)
      and (surviving_lines is null or surviving_lines >= 0)
      and (recent_touch_commits is null or recent_touch_commits >= 0)
      and (total_touch_commits is null or total_touch_commits >= 0)
      and (human_contributor_count is null or human_contributor_count >= 0)
      and (recent_human_maintainer_count is null or recent_human_maintainer_count >= 0)
      and (total_surviving_lines is null or total_surviving_lines >= 0)
    ),

  constraint ownership_snapshots_shares
    check (
      (touch_share is null or touch_share between 0 and 1)
      and (surviving_line_share is null or surviving_line_share between 0 and 1)
      and (unlinked_touch_share is null or unlinked_touch_share between 0 and 1)
      and (top_human_contributor_share is null or top_human_contributor_share between 0 and 1)
      and (unlinked_surviving_line_share is null or unlinked_surviving_line_share between 0 and 1)
    ),

  constraint ownership_snapshots_meaningful
    check (first_meaningful_touch is null or last_meaningful_touch is null
           or first_meaningful_touch <= last_meaningful_touch),

  -- row-shape guardrails: monthly rows are immutable period facts and must
  -- not carry current-state fields; head rows must not carry monthly
  -- fields; contributor rows must not carry scope-total fields and vice
  -- versa. Prevents impossible mixed row shapes without constraining
  -- legitimate null/zero cases.
  constraint ownership_snapshots_shape
    check (
      case
        when period_granularity = 'month' and contributor_id is not null
          then surviving_lines is null and surviving_line_share is null
            and recent_touch_commits is null
            and first_meaningful_touch is null and last_meaningful_touch is null
            and total_touch_commits is null and human_contributor_count is null
            and unlinked_touch_share is null and recent_human_maintainer_count is null
            and top_human_contributor_share is null and total_surviving_lines is null
            and unlinked_surviving_line_share is null
        when period_granularity = 'month' and contributor_id is null
          then touch_commits is null and touch_share is null
            and surviving_lines is null and surviving_line_share is null
            and recent_touch_commits is null
            and first_meaningful_touch is null and last_meaningful_touch is null
            and recent_human_maintainer_count is null
            and top_human_contributor_share is null and total_surviving_lines is null
            and unlinked_surviving_line_share is null
        when period_granularity = 'head' and contributor_id is not null
          then touch_commits is null and touch_share is null
            and total_touch_commits is null and human_contributor_count is null
            and unlinked_touch_share is null
            and recent_human_maintainer_count is null
            and top_human_contributor_share is null and total_surviving_lines is null
            and unlinked_surviving_line_share is null
        when period_granularity = 'head' and contributor_id is null
          then touch_commits is null and touch_share is null
            and surviving_lines is null and surviving_line_share is null
            and recent_touch_commits is null
            and first_meaningful_touch is null and last_meaningful_touch is null
            and total_touch_commits is null and unlinked_touch_share is null
        else false
      end
    )
);

create index if not exists ownership_snapshots_repo_period
  on public.ownership_snapshots (repository_id, period_start);

-- calculation_version is part of row identity: served (active) and
-- building versions coexist, so version is in both unique keys.
create unique index if not exists ownership_snapshots_contrib_key
  on public.ownership_snapshots
    (scope_id, contributor_id, period_granularity, period_start, calculation_version)
  where contributor_id is not null;

create unique index if not exists ownership_snapshots_total_key
  on public.ownership_snapshots
    (scope_id, period_granularity, period_start, calculation_version)
  where contributor_id is null;

-- ── 4. ownership_sync_state ──────────────────────────────────────────────

create table if not exists public.ownership_sync_state (
  user_id         uuid not null,
  repository_id   uuid not null,
  phase           text not null default 'pending',
  history_cursor  jsonb,
  blame_cursor    jsonb,
  pending_scopes  jsonb,
  active_version  int,
  building_version int,
  last_processed_sha text,
  last_processed_at  timestamptz,
  error           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  primary key (user_id, repository_id),

  constraint ownership_sync_state_repo_tenant
    foreign key (repository_id, user_id)
    references public.repositories (id, user_id)
    on delete cascade,

  constraint ownership_sync_state_phase
    check (phase in ('pending', 'history', 'blame', 'done', 'error')),

  constraint ownership_sync_state_active
    check (active_version is null or active_version > 0),

  constraint ownership_sync_state_building
    check (building_version is null or building_version > 0),

  -- the same version can never be both served and under construction
  constraint ownership_sync_state_versions
    check (active_version is null or building_version is null
           or active_version <> building_version),

  -- closed taxonomy only — raw provider text can never reach this column
  constraint ownership_sync_state_error
    check (error is null or error in (
      'GITHUB_RATE_LIMIT',
      'GITHUB_ACCESS_REVOKED',
      'OWNERSHIP_HISTORY_FAILED',
      'OWNERSHIP_BLAME_FAILED',
      'OWNERSHIP_INTERNAL_ERROR'
    ))
);

-- ── 5. RLS — zero browser-facing policies on every ownership table ───────
-- Mirrors 007: the only data path is the server-side service_role key.

alter table public.ownership_scopes       enable row level security;
alter table public.ownership_contributors enable row level security;
alter table public.ownership_snapshots    enable row level security;
alter table public.ownership_sync_state   enable row level security;

revoke all on public.ownership_scopes       from public, anon, authenticated;
revoke all on public.ownership_contributors from public, anon, authenticated;
revoke all on public.ownership_snapshots    from public, anon, authenticated;
revoke all on public.ownership_sync_state   from public, anon, authenticated;

grant select, insert, update, delete on public.ownership_scopes       to service_role;
grant select, insert, update, delete on public.ownership_contributors to service_role;
grant select, insert, update, delete on public.ownership_snapshots    to service_role;
grant select, insert, update, delete on public.ownership_sync_state   to service_role;

-- ── 6. dormant dashboard RPC foundations ─────────────────────────────────
-- SECURITY INVOKER (inherit caller privileges), EXECUTE service_role only,
-- every row filtered through p_user, and only rows whose
-- calculation_version equals the repo's active_version are served:
-- active_version IS NULL ("not ready") or a mid-build building_version can
-- never leak rows. Internal ids, github_node_id, contributor_key, commit
-- SHAs, and cursors are never returned.

-- 6a. per-scope current summary (HEAD scope-total row + scope metadata)
create or replace function public.dash_ownership_scopes(p_user uuid, p_repository uuid)
returns table(
  scope_path_hash text,
  scope_type text,
  display_path text,
  depth int,
  excluded boolean,
  human_contributor_count int,
  recent_human_maintainer_count int,
  top_human_contributor_share numeric,
  total_surviving_lines bigint,
  unlinked_surviving_line_share numeric
)
language sql stable security invoker set search_path = public as
$$
  select sc.scope_path_hash, sc.scope_type, sc.display_path, sc.depth, sc.excluded,
         t.human_contributor_count, t.recent_human_maintainer_count,
         t.top_human_contributor_share, t.total_surviving_lines,
         t.unlinked_surviving_line_share
  from public.ownership_scopes sc
  join public.ownership_sync_state st
    on st.repository_id = sc.repository_id and st.user_id = sc.user_id
  left join public.ownership_snapshots t
    on t.scope_id = sc.id and t.repository_id = sc.repository_id
   and t.contributor_id is null and t.period_granularity = 'head'
   and t.calculation_version = st.active_version
  where sc.user_id = p_user
    and sc.repository_id = p_repository
    and st.active_version is not null
  order by sc.depth, sc.display_path
$$;

-- 6b. HEAD per-contributor rows for one scope (blame + recent signals)
create or replace function public.dash_ownership_head(p_user uuid, p_repository uuid, p_scope text)
returns table(
  display_login text,
  identity_kind text,
  is_bot boolean,
  surviving_lines bigint,
  surviving_line_share numeric,
  recent_touch_commits int,
  last_meaningful_touch timestamptz
)
language sql stable security invoker set search_path = public as
$$
  select c.display_login, c.identity_kind, c.is_bot,
         s.surviving_lines, s.surviving_line_share,
         s.recent_touch_commits, s.last_meaningful_touch
  from public.ownership_snapshots s
  join public.ownership_scopes sc on sc.id = s.scope_id and sc.repository_id = s.repository_id
  join public.ownership_sync_state st
    on st.repository_id = s.repository_id and st.user_id = s.user_id
  left join public.ownership_contributors c
    on c.id = s.contributor_id and c.repository_id = s.repository_id
  where s.user_id = p_user
    and s.repository_id = p_repository
    and sc.scope_path_hash = p_scope
    and s.contributor_id is not null
    and s.period_granularity = 'head'
    and s.calculation_version = st.active_version
  order by s.surviving_line_share desc nulls last
$$;

-- 6c. monthly timeline for one scope — contributor rows (contributor
-- columns populated) interleaved with scope-total rows (total columns
-- populated); consumers split on contributor display/identity being null.
create or replace function public.dash_ownership_timeline(p_user uuid, p_repository uuid, p_scope text)
returns table(
  period_start timestamptz,
  display_login text,
  identity_kind text,
  is_bot boolean,
  touch_commits int,
  touch_share numeric,
  total_touch_commits int,
  human_contributor_count int,
  unlinked_touch_share numeric
)
language sql stable security invoker set search_path = public as
$$
  select s.period_start, c.display_login, c.identity_kind, c.is_bot,
         s.touch_commits, s.touch_share,
         s.total_touch_commits, s.human_contributor_count, s.unlinked_touch_share
  from public.ownership_snapshots s
  join public.ownership_scopes sc on sc.id = s.scope_id and sc.repository_id = s.repository_id
  join public.ownership_sync_state st
    on st.repository_id = s.repository_id and st.user_id = s.user_id
  left join public.ownership_contributors c
    on c.id = s.contributor_id and c.repository_id = s.repository_id
  where s.user_id = p_user
    and s.repository_id = p_repository
    and sc.scope_path_hash = p_scope
    and s.period_granularity = 'month'
    and s.calculation_version = st.active_version
  order by s.period_start
$$;

-- Functions default to EXECUTE for PUBLIC — revoke everywhere, then grant
-- the backend role only (007 pattern).
revoke all on function public.dash_ownership_scopes(uuid, uuid)      from public, anon, authenticated;
revoke all on function public.dash_ownership_head(uuid, uuid, text)  from public, anon, authenticated;
revoke all on function public.dash_ownership_timeline(uuid, uuid, text) from public, anon, authenticated;

grant execute on function public.dash_ownership_scopes(uuid, uuid)      to service_role;
grant execute on function public.dash_ownership_head(uuid, uuid, text)  to service_role;
grant execute on function public.dash_ownership_timeline(uuid, uuid, text) to service_role;
