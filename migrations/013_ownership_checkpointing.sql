-- 013 — ownership checkpointing database foundation (additive; forward-only;
-- idempotent). Implements the database substrate of
-- docs/ownership-checkpoint-architecture.md (contract amendment recorded in
-- docs/ownership-data-privacy-spec.md §27):
--
--   * RETAINED: ownership_scope_versions splits immutable base-scope identity
--     from per-version membership — exclusion state is versioned, dashboard
--     reads join membership at active_version, and every retained child ->
--     base-scope relation is ON DELETE NO ACTION (§5.9/§5.9a).
--   * EPHEMERAL: ownership_history_work + ownership_contributor_build_work
--     hold crash-safe multi-invocation build state; backup-excluded,
--     service-role only, zero browser policies, cascade on teardown.
--   * DB-enforced membership integrity: snapshots gain a composite FK
--     (scope_id, repository_id, user_id, calculation_version) ->
--     ownership_scope_versions ON DELETE NO ACTION — a snapshot cannot exist
--     without matching same-repo/same-tenant/same-version membership.
--   * Database primitives: own_checkpoint_page (single-transaction page CAS),
--     own_restart_scope (committed-V-provenance staging cleanup),
--     own_promote_build (exact-set promotion + atomic version flip),
--     own_abandon_build (the ONE canonical build cleanup),
--     own_build_preflight + own_build_init (§5.6c retired-version
--     lifecycle gate and the gated initialization behind it),
--     own_sweep_stale_work (abandon-routed stale/orphan sweep).
--
-- 012 is never edited: the deployed ownership_snapshots_scope_repo
-- constraint is dropped and re-created with ON DELETE NO ACTION — same
-- name, same keys, only the delete action changes. Existing 012-era rows
-- are made consistent by a membership backfill BEFORE the composite FK is
-- added, so the FK validates on real deployments.

-- ── 1. ownership_scope_versions — RETAINED / CORE ───────────────────────
-- Grain (scope_id, calculation_version): one row means the scope belongs
-- to that calculation version. excluded=true is permitted only for
-- 'cardinality_cap' — never a generic path-inventory marker.

create table if not exists public.ownership_scope_versions (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null,
  repository_id      uuid not null,
  scope_id           uuid not null,
  calculation_version int not null,
  excluded           boolean not null default false,
  exclusion_reason   text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  -- tenant pair: the repo must belong to the claimed user (teardown cascade)
  constraint ownership_scope_versions_repo_tenant
    foreign key (repository_id, user_id)
    references public.repositories (id, user_id)
    on delete cascade,

  -- retained child -> base scope: NO ACTION so a referenced scope cannot be
  -- deleted while membership exists (§5.9a). Cross-repository membership is
  -- impossible — repository_id must match the scope's own repository.
  constraint ownership_scope_versions_scope_repo
    foreign key (scope_id, repository_id)
    references public.ownership_scopes (id, repository_id)
    on delete no action,

  constraint ownership_scope_versions_version
    check (calculation_version > 0),

  -- same contract as ownership_scopes_exclusion, versioned
  constraint ownership_scope_versions_exclusion
    check (
      (not excluded and exclusion_reason is null)
      or (excluded and exclusion_reason = 'cardinality_cap')
    ),

  -- membership uniqueness: a scope belongs to a version at most once
  unique (scope_id, calculation_version),
  -- supporting unique for the snapshot composite FK: proves same-scope +
  -- same-repo + same-tenant + same-version, not merely same-scope
  unique (scope_id, repository_id, user_id, calculation_version)
);

-- repo-scoped cleanup/cascade lookups (uniques are scope_id-first)
create index if not exists ownership_scope_versions_repo
  on public.ownership_scope_versions (repository_id);

-- ── 2. membership backfill for pre-existing 012-era rows ────────────────
-- Production holds zero ownership rows, but forward-only migrations must
-- keep any existing data consistent before the composite FK validates:
--   (a) every snapshot's (scope, repo, user, version) implies membership —
--       required for the new FK;
--   (b) 012 served every base scope of a repo while active_version was set —
--       preserving that output means every base scope also belongs to the
--       repo's active version (and its building version, if any).
-- Exclusion state is copied from the base scope's own (legacy) columns.
insert into public.ownership_scope_versions
  (user_id, repository_id, scope_id, calculation_version, excluded, exclusion_reason)
select distinct s.user_id, s.repository_id, s.scope_id, s.calculation_version,
       sc.excluded, sc.exclusion_reason
from public.ownership_snapshots s
join public.ownership_scopes sc
  on sc.id = s.scope_id and sc.repository_id = s.repository_id
on conflict do nothing;

insert into public.ownership_scope_versions
  (user_id, repository_id, scope_id, calculation_version, excluded, exclusion_reason)
select sc.user_id, sc.repository_id, sc.id, v.ver, sc.excluded, sc.exclusion_reason
from public.ownership_scopes sc
join public.ownership_sync_state st
  on st.repository_id = sc.repository_id and st.user_id = sc.user_id
cross join lateral (
  select st.active_version union all select st.building_version
) as v(ver)
where v.ver is not null
on conflict do nothing;

-- ── 3. ownership_snapshots — retained child FK actions → NO ACTION ──────
-- §5.9a: the 012 CASCADE lets an erroneous direct scope delete destroy
-- active snapshots (and, transitively, membership). The constraint is
-- re-created under the same name/keys; only the delete action changes.
alter table public.ownership_snapshots
  drop constraint ownership_snapshots_scope_repo,
  add constraint ownership_snapshots_scope_repo
    foreign key (scope_id, repository_id)
    references public.ownership_scopes (id, repository_id)
    on delete no action;

-- The hard membership invariant (§5.9): a snapshot can exist only for a
-- scope belonging to the snapshot's own version, repository, and tenant.
-- NO ACTION — never CASCADE — so deleting membership can never destroy
-- snapshots; the legal cleanup order is snapshots first, membership second.
alter table public.ownership_snapshots
  add constraint ownership_snapshots_scope_version
    foreign key (scope_id, repository_id, user_id, calculation_version)
    references public.ownership_scope_versions
      (scope_id, repository_id, user_id, calculation_version)
    on delete no action;

-- ── 4. ownership_history_work — EPHEMERAL counter state ─────────────────
-- Per (scope × version × month × work_key) accumulation counters. Only
-- counters/timestamps live here — no plaintext contributor identity, no
-- paths, no provider payloads. work_key is the pseudonymous contributor
-- key: literal 'unlinked' or a 64-hex key — structurally disjoint classes.
create table if not exists public.ownership_history_work (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null,
  repository_id      uuid not null,
  scope_id           uuid not null,
  calculation_version int not null,
  period_start       timestamptz not null,
  work_key           text not null,
  is_bot             boolean not null default false,
  touch_commits      int not null default 0,
  first_seen_at      timestamptz,
  last_seen_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint ownership_history_work_repo_tenant
    foreign key (repository_id, user_id)
    references public.repositories (id, user_id)
    on delete cascade,

  -- EPHEMERAL rows are not retained children — cascade is correct here
  -- (the §5.9a NO ACTION rule covers the two retained child->scope FKs).
  constraint ownership_history_work_scope_repo
    foreign key (scope_id, repository_id)
    references public.ownership_scopes (id, repository_id)
    on delete cascade,

  constraint ownership_history_work_version
    check (calculation_version > 0),

  constraint ownership_history_work_key
    check (work_key = 'unlinked' or work_key ~ '^[0-9a-f]{64}$'),

  -- month grain mirrors ownership_snapshots_period (UTC wall clock)
  constraint ownership_history_work_period
    check (
      period_start =
        (date_trunc('month', period_start at time zone 'UTC')
         at time zone 'UTC')
    ),

  constraint ownership_history_work_counts
    check (touch_commits >= 0),

  constraint ownership_history_work_seen
    check (first_seen_at is null or last_seen_at is null
           or first_seen_at <= last_seen_at),

  unique (scope_id, calculation_version, period_start, work_key)
);

create index if not exists ownership_history_work_repo
  on public.ownership_history_work (repository_id);

-- ── 5. ownership_contributor_build_work — EPHEMERAL identity staging ────
-- Build-level staging, one row per REPRESENTED key per repository build.
-- Identity fields (github_node_id + display_login) may exist only here and
-- in retained tables — and only for already-represented keys. Deliberately
-- no scope provenance column (committed-V provenance drives cleanup, §5.3)
-- and never a synthetic bucket key.
create table if not exists public.ownership_contributor_build_work (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null,
  repository_id      uuid not null,
  calculation_version int not null,
  work_key           text not null,
  github_node_id     text not null,
  display_login      text not null,
  is_bot             boolean not null default false,
  first_seen_at      timestamptz,
  last_seen_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint ownership_contributor_build_work_repo_tenant
    foreign key (repository_id, user_id)
    references public.repositories (id, user_id)
    on delete cascade,

  constraint ownership_contributor_build_work_version
    check (calculation_version > 0),

  -- synthetic buckets ('unlinked'/'other') carry no identity and must
  -- never be staged — only real contributor keys appear here.
  constraint ownership_contributor_build_work_key
    check (work_key ~ '^[0-9a-f]{64}$'),

  constraint ownership_contributor_build_work_seen
    check (first_seen_at is null or last_seen_at is null
           or first_seen_at <= last_seen_at),

  unique (repository_id, calculation_version, work_key)
);

-- (repository_id, ...) is the unique's leading column — no extra index.

-- ── 6. RLS + grants — same model as 012 ─────────────────────────────────
-- scope_versions is RETAINED (CORE backup class); both work relations are
-- EPHEMERAL. All three: RLS enabled, zero browser/user policies,
-- service_role DML only.

alter table public.ownership_scope_versions           enable row level security;
alter table public.ownership_history_work             enable row level security;
alter table public.ownership_contributor_build_work   enable row level security;

revoke all on public.ownership_scope_versions         from public, anon, authenticated;
revoke all on public.ownership_history_work           from public, anon, authenticated;
revoke all on public.ownership_contributor_build_work from public, anon, authenticated;

grant select, insert, update, delete on public.ownership_scope_versions         to service_role;
grant select, insert, update, delete on public.ownership_history_work           to service_role;
grant select, insert, update, delete on public.ownership_contributor_build_work to service_role;

-- ── 7. own_checkpoint_page — single-transaction page CAS (§6.1) ─────────
-- The crash-safe exactly-once primitive: page aggregate deltas + durable
-- cursor advance commit together under compare-and-swap on the sync-state
-- row. Any state mismatch → 'stale' with ZERO writes, so a retry after a
-- lost response can never double-apply. SECURITY INVOKER; EXECUTE is
-- service_role-only (same model as the dash_* RPCs).
--
-- history_cursor.current = {scope_id, pass, accumulate_done?, cursor} —
-- 'stale' whenever building_version/phase/scope/pass/cursor disagree.
create or replace function public.own_checkpoint_page(
  p_user uuid,
  p_repository uuid,
  p_version int,
  p_scope uuid,
  p_pass text,
  p_expected_cursor text,
  p_next_cursor text,
  p_deltas jsonb default '[]'::jsonb,
  p_identities jsonb default '[]'::jsonb,
  p_last_page boolean default false
)
returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  st public.ownership_sync_state%rowtype;
  v_cur jsonb;
  v_keys int;
  v_rows int;
  v_represented text[];
begin
  -- 1. serialize all ownership work for the repo
  select * into st
  from public.ownership_sync_state
  where user_id = p_user and repository_id = p_repository
  for update;

  -- argument shape — invalid calls are caller bugs (fail closed), not
  -- stale replays (which return without writing)
  if p_pass not in ('accumulate', 'resolve') then
    raise exception 'OWNERSHIP_INTERNAL_ERROR';
  end if;
  if p_deltas is not null and jsonb_typeof(p_deltas) <> 'array' then
    raise exception 'OWNERSHIP_INTERNAL_ERROR';
  end if;
  if p_identities is not null and jsonb_typeof(p_identities) <> 'array' then
    raise exception 'OWNERSHIP_INTERNAL_ERROR';
  end if;
  if p_pass = 'accumulate'
     and jsonb_array_length(coalesce(p_identities, '[]'::jsonb)) > 0 then
    raise exception 'OWNERSHIP_INTERNAL_ERROR';
  end if;
  if p_pass = 'resolve'
     and jsonb_array_length(coalesce(p_deltas, '[]'::jsonb)) > 0 then
    raise exception 'OWNERSHIP_INTERNAL_ERROR';
  end if;
  -- one GraphQL page → at most 100 delta/identity rows
  if jsonb_array_length(coalesce(p_deltas, '[]'::jsonb)) > 100
     or jsonb_array_length(coalesce(p_identities, '[]'::jsonb)) > 100 then
    raise exception 'OWNERSHIP_INTERNAL_ERROR';
  end if;

  -- 2. CAS envelope — ANY mismatch: 'stale', no writes
  if not found
     or st.building_version is distinct from p_version
     or st.phase <> 'history'
     or st.history_cursor is null
     or (st.history_cursor #>> '{current,scope_id}')::uuid is distinct from p_scope
     or st.history_cursor #>> '{current,pass}' is distinct from p_pass
     or st.history_cursor #>> '{current,cursor}' is distinct from p_expected_cursor
  then
    return 'stale';
  end if;

  -- the current scope must be a member of the building version
  if not exists (
    select 1 from public.ownership_scope_versions sv
    where sv.scope_id = p_scope and sv.repository_id = p_repository
      and sv.calculation_version = p_version
  ) then
    raise exception 'OWNERSHIP_INTERNAL_ERROR';
  end if;

  -- 3. accumulate: additive counter upsert (CAS ⇒ batch applies ≤ once)
  if p_pass = 'accumulate'
     and jsonb_array_length(coalesce(p_deltas, '[]'::jsonb)) > 0 then
    -- bot classification is attribution state — drift inside the batch,
    -- against earlier build counters, or against staged frozen values
    -- fails closed rather than silently reclassifying
    if exists (
      select 1 from jsonb_array_elements(p_deltas) d
      group by d->>'work_key'
      having count(distinct (d->>'is_bot')::boolean) > 1
    ) then
      raise exception 'OWNERSHIP_INTERNAL_ERROR';
    end if;
    if exists (
      select 1
      from jsonb_array_elements(p_deltas) d
      join public.ownership_history_work w
        on w.repository_id = p_repository and w.calculation_version = p_version
       and w.work_key = d->>'work_key'
      where w.is_bot <> (d->>'is_bot')::boolean
    ) then
      raise exception 'OWNERSHIP_INTERNAL_ERROR';
    end if;
    if exists (
      select 1
      from jsonb_array_elements(p_deltas) d
      join public.ownership_contributor_build_work b
        on b.repository_id = p_repository and b.calculation_version = p_version
       and b.work_key = d->>'work_key'
      where b.is_bot <> (d->>'is_bot')::boolean
    ) then
      raise exception 'OWNERSHIP_INTERNAL_ERROR';
    end if;

    insert into public.ownership_history_work
      (user_id, repository_id, scope_id, calculation_version, period_start,
       work_key, is_bot, touch_commits, first_seen_at, last_seen_at)
    select p_user, p_repository, p_scope, p_version,
           (d->>'period_start')::timestamptz,
           d->>'work_key',
           (d->>'is_bot')::boolean,
           (d->>'touches')::int,
           (d->>'first_seen_at')::timestamptz,
           (d->>'last_seen_at')::timestamptz
    from jsonb_array_elements(p_deltas) d
    on conflict (scope_id, calculation_version, period_start, work_key)
    do update set
      touch_commits = public.ownership_history_work.touch_commits
                      + excluded.touch_commits,
      first_seen_at = least(public.ownership_history_work.first_seen_at,
                            excluded.first_seen_at),
      last_seen_at  = greatest(public.ownership_history_work.last_seen_at,
                               excluded.last_seen_at),
      updated_at = now();

    -- §7 bounds, enforced inside the same transaction
    select count(distinct work_key), count(*) into v_keys, v_rows
    from public.ownership_history_work
    where scope_id = p_scope and calculation_version = p_version;
    if v_keys > 10000 or v_rows > 100000 then
      raise exception 'OWNERSHIP_INTERNAL_ERROR';
    end if;
  end if;

  -- 4. resolve: stage represented-key identities — frozen is_bot only.
  -- Identity persistence is authorized ONLY by deterministic
  -- represented-set membership (§6.4 durable-identity minimization):
  -- pass-1 counter existence is NOT sufficient. The set is the canonical
  -- reducer's rule (lib/ownership/history-reducer.mjs,
  -- TOP_LINKED_PER_PERIOD = 25) made durable: per period, rank linked
  -- work_keys by touch_commits DESC, work_key ASC ('unlinked' never
  -- ranks); a key is represented iff it lands in the Top-25 of at least
  -- one period. Overflow-only contributors fold into synthetic 'other'
  -- and their identity fields may never reach persisted state, so a
  -- non-represented submission is ignored BEFORE any pass-2 check or
  -- write — its attribution metrics are already frozen by pass 1.
  if p_pass = 'resolve'
     and jsonb_array_length(coalesce(p_identities, '[]'::jsonb)) > 0 then
    select array_agg(work_key) into v_represented
    from (
      select distinct work_key
      from (
        select work_key,
               row_number() over (
                 partition by period_start
                 order by touch_commits desc, work_key asc
               ) as rnk
        from public.ownership_history_work
        where scope_id = p_scope and calculation_version = p_version
          and work_key <> 'unlinked'
      ) ranked
      where rnk <= 25
    ) rep;

    -- a conflicting stored node id for the same REPRESENTED work_key is
    -- impossible by construction and fails closed if ever seen (within
    -- the batch or against stored staging)
    if exists (
      select 1 from jsonb_array_elements(p_identities) i
      where i->>'work_key' = any(v_represented)
      group by i->>'work_key'
      having count(distinct i->>'github_node_id') > 1
    ) then
      raise exception 'OWNERSHIP_INTERNAL_ERROR';
    end if;
    if exists (
      select 1
      from jsonb_array_elements(p_identities) i
      join public.ownership_contributor_build_work b
        on b.repository_id = p_repository and b.calculation_version = p_version
       and b.work_key = i->>'work_key'
      where i->>'work_key' = any(v_represented)
        and b.github_node_id <> i->>'github_node_id'
    ) then
      raise exception 'OWNERSHIP_INTERNAL_ERROR';
    end if;
    -- observed_is_bot must equal the frozen build value: the staged row
    -- when the key was already represented by a committed scope, else the
    -- current scope's pass-1 counters — and the two must already agree.
    -- checks apply only to represented keys; anything else is ignored.
    if exists (
      select 1
      from jsonb_array_elements(p_identities) i
      join public.ownership_contributor_build_work b
        on b.repository_id = p_repository and b.calculation_version = p_version
       and b.work_key = i->>'work_key'
      join public.ownership_history_work w
        on w.scope_id = p_scope and w.calculation_version = p_version
       and w.work_key = i->>'work_key'
      where i->>'work_key' = any(v_represented)
        and w.is_bot <> b.is_bot
    ) then
      raise exception 'OWNERSHIP_INTERNAL_ERROR';
    end if;
    if exists (
      select 1
      from jsonb_array_elements(p_identities) i
      left join public.ownership_contributor_build_work b
        on b.repository_id = p_repository and b.calculation_version = p_version
       and b.work_key = i->>'work_key'
      left join (
        select distinct work_key, is_bot
        from public.ownership_history_work
        where scope_id = p_scope and calculation_version = p_version
      ) f on f.work_key = i->>'work_key'
      where i->>'work_key' = any(v_represented)
        and (i->>'observed_is_bot')::boolean
            is distinct from coalesce(b.is_bot, f.is_bot)
    ) then
      raise exception 'OWNERSHIP_INTERNAL_ERROR';
    end if;

    -- staging is the represented set ONLY: represented ⊆ this scope's
    -- pass-1 counters, so coalesce(b.is_bot, f.is_bot) is never null for
    -- a member — overflow-only and pass-2-only keys never stage.
    insert into public.ownership_contributor_build_work
      (user_id, repository_id, calculation_version, work_key,
       github_node_id, display_login, is_bot)
    select p_user, p_repository, p_version,
           i->>'work_key', i->>'github_node_id', i->>'display_login',
           coalesce(b.is_bot, f.is_bot)
    from jsonb_array_elements(p_identities) i
    left join public.ownership_contributor_build_work b
      on b.repository_id = p_repository and b.calculation_version = p_version
     and b.work_key = i->>'work_key'
    left join (
      select distinct work_key, is_bot
      from public.ownership_history_work
      where scope_id = p_scope and calculation_version = p_version
    ) f on f.work_key = i->>'work_key'
    where i->>'work_key' = any(v_represented)
    on conflict (repository_id, calculation_version, work_key)
    do update set
      display_login = excluded.display_login,
      updated_at = now();

    select count(*) into v_rows
    from public.ownership_contributor_build_work
    where repository_id = p_repository and calculation_version = p_version;
    if v_rows > 10000 then
      raise exception 'OWNERSHIP_INTERNAL_ERROR';
    end if;
  end if;

  -- 5. cursor advance — same transaction as the writes above
  -- (to_jsonb(NULL) is SQL NULL, which would null the whole jsonb_set
  -- result — coalesce to JSON null for a clean durable cursor state)
  v_cur := jsonb_set(st.history_cursor -> 'current', '{cursor}',
                     coalesce(to_jsonb(p_next_cursor), 'null'::jsonb), true);
  if p_last_page then
    if p_pass = 'accumulate' then
      -- frozen pass done: flip to resolve at a fresh cursor
      v_cur := v_cur
               || '{"pass":"resolve","accumulate_done":true,"cursor":null}'::jsonb;
    else
      v_cur := v_cur || '{"resolve_done":true}'::jsonb;
    end if;
  end if;

  update public.ownership_sync_state
  set history_cursor = jsonb_set(st.history_cursor, '{current}', v_cur),
      updated_at = now()
  where user_id = p_user and repository_id = p_repository;

  return 'applied';
end
$$;

-- ── 8. own_restart_scope — committed-V-provenance staging cleanup (§5.3) ─
-- Build-level staging has no scope provenance, so a scope restarting at a
-- fresh ACCUMULATE cleans by COMMITTED-V provenance: staged keys whose
-- contributor is referenced by at least one committed V snapshot are
-- preserved; everything else (keys staged only by the failed attempt —
-- brand-new contributors and existing active-N contributors alike) is
-- removed. The retained contributor row itself is never deleted here.
create or replace function public.own_restart_scope(
  p_user uuid,
  p_repository uuid,
  p_version int,
  p_scope uuid
)
returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  st public.ownership_sync_state%rowtype;
  v_cur jsonb;
begin
  select * into st
  from public.ownership_sync_state
  where user_id = p_user and repository_id = p_repository
  for update;

  if not found
     or st.building_version is distinct from p_version
     or st.phase <> 'history'
     or st.history_cursor is null
     or (st.history_cursor #>> '{current,scope_id}')::uuid is distinct from p_scope
  then
    return 'stale';
  end if;

  -- 1. reset the current scope's counter state
  delete from public.ownership_history_work
  where scope_id = p_scope and calculation_version = p_version;

  -- 2. staged keys with no committed-V snapshot reference are removed
  delete from public.ownership_contributor_build_work bw
  where bw.repository_id = p_repository and bw.calculation_version = p_version
    and not exists (
      select 1
      from public.ownership_contributors c
      join public.ownership_snapshots s
        on s.contributor_id = c.id and s.repository_id = c.repository_id
      where c.repository_id = p_repository
        and c.contributor_key = bw.work_key
        and s.calculation_version = p_version
    );

  -- 3. fresh ACCUMULATE cursor for the current scope
  v_cur := jsonb_build_object(
             'scope_id', p_scope::text,
             'pass', 'accumulate',
             'cursor', null);
  update public.ownership_sync_state
  set history_cursor = jsonb_set(st.history_cursor, '{current}', v_cur),
      updated_at = now()
  where user_id = p_user and repository_id = p_repository;

  return 'restarted';
end
$$;

-- ── 9. own_promote_build — exact-set promotion + atomic flip (§5.7) ─────
-- Validates the promotion invariant BEFORE any shared metadata write:
-- the staged linked key set must equal the set of distinct linked
-- contributor keys represented by building-V snapshots — synthetic
-- 'unlinked'/'other' buckets are outside both sides (they cannot enter
-- staging and are not linked identity rows). Any asymmetry or bound
-- breach fails closed; nothing is applied.
create or replace function public.own_promote_build(
  p_user uuid,
  p_repository uuid,
  p_version int
)
returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  st public.ownership_sync_state%rowtype;
begin
  select * into st
  from public.ownership_sync_state
  where user_id = p_user and repository_id = p_repository
  for update;

  if not found or st.building_version is distinct from p_version then
    return 'stale';
  end if;

  -- pending work must be drained and accumulation state consumed
  if st.pending_scopes is not null and st.pending_scopes <> '[]'::jsonb then
    raise exception 'OWNERSHIP_INTERNAL_ERROR';
  end if;
  if exists (
    select 1 from public.ownership_history_work
    where repository_id = p_repository and calculation_version = p_version
  ) then
    raise exception 'OWNERSHIP_INTERNAL_ERROR';
  end if;

  -- cardinality bounds: ≤500 directory memberships per version, ≤10,000
  -- staged rows per build
  if (
    select count(*)
    from public.ownership_scope_versions sv
    join public.ownership_scopes sc
      on sc.id = sv.scope_id and sc.repository_id = sv.repository_id
    where sv.repository_id = p_repository
      and sv.calculation_version = p_version
      and sc.scope_type = 'dir'
  ) > 500 then
    raise exception 'OWNERSHIP_INTERNAL_ERROR';
  end if;
  if (
    select count(*) from public.ownership_contributor_build_work
    where repository_id = p_repository and calculation_version = p_version
  ) > 10000 then
    raise exception 'OWNERSHIP_INTERNAL_ERROR';
  end if;

  -- exact-set invariant, both directions:
  --   extra: a staged key no committed V snapshot represents
  if exists (
    select 1 from public.ownership_contributor_build_work bw
    where bw.repository_id = p_repository and bw.calculation_version = p_version
      and not exists (
        select 1
        from public.ownership_contributors c
        join public.ownership_snapshots s
          on s.contributor_id = c.id and s.repository_id = c.repository_id
        where c.repository_id = p_repository
          and c.contributor_key = bw.work_key
          and s.calculation_version = p_version
      )
  ) then
    raise exception 'OWNERSHIP_INTERNAL_ERROR';
  end if;
  --   missing: a linked contributor key represented in V snapshots with
  --   no staged build-work row
  if exists (
    select 1
    from public.ownership_contributors c
    join public.ownership_snapshots s
      on s.contributor_id = c.id and s.repository_id = c.repository_id
    where c.repository_id = p_repository
      and c.identity_kind = 'linked'
      and s.calculation_version = p_version
      and not exists (
        select 1 from public.ownership_contributor_build_work bw
        where bw.repository_id = p_repository
          and bw.calculation_version = p_version
          and bw.work_key = c.contributor_key
      )
  ) then
    raise exception 'OWNERSHIP_INTERNAL_ERROR';
  end if;

  -- same work_key must carry the same node id — mismatch fails closed
  if exists (
    select 1
    from public.ownership_contributor_build_work bw
    join public.ownership_contributors c
      on c.repository_id = bw.repository_id
     and c.contributor_key = bw.work_key
    where bw.repository_id = p_repository
      and bw.calculation_version = p_version
      and c.github_node_id is distinct from bw.github_node_id
  ) then
    raise exception 'OWNERSHIP_INTERNAL_ERROR';
  end if;

  -- apply staged metadata to retained rows — exactly the validated set
  update public.ownership_contributors c
  set github_node_id = bw.github_node_id,
      display_login = bw.display_login,
      is_bot = bw.is_bot,
      first_seen_at = bw.first_seen_at,
      last_seen_at = bw.last_seen_at,
      updated_at = now()
  from public.ownership_contributor_build_work bw
  where bw.repository_id = p_repository
    and bw.calculation_version = p_version
    and c.repository_id = bw.repository_id
    and c.contributor_key = bw.work_key;

  -- the metadata application and the version flip commit together
  update public.ownership_sync_state
  set active_version = p_version,
      building_version = null,
      phase = 'done',
      error = null,
      history_cursor = null,
      pending_scopes = null,
      updated_at = now()
  where user_id = p_user and repository_id = p_repository;

  delete from public.ownership_contributor_build_work
  where repository_id = p_repository and calculation_version = p_version;

  return 'promoted';
end
$$;

-- ── 10. own_abandon_build — THE canonical build cleanup (§5.6) ──────────
-- The ONE semantic abandon operation: stale sweep, restore reconciliation,
-- operator abort, and invalid-state recovery all route here. Deletes the
-- building version's snapshots FIRST, then membership, then ephemeral
-- state, then prunes contributors/scopes referenced by nothing retained —
-- the ordering is required by the NO ACTION foreign keys.
create or replace function public.own_abandon_build(
  p_user uuid,
  p_repository uuid,
  p_version int
)
returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  st public.ownership_sync_state%rowtype;
begin
  select * into st
  from public.ownership_sync_state
  where user_id = p_user and repository_id = p_repository
  for update;

  if not found or st.building_version is distinct from p_version then
    return 'stale';
  end if;

  -- legal order under the NO ACTION FKs: snapshots -> membership -> work
  delete from public.ownership_snapshots
  where repository_id = p_repository and calculation_version = p_version;
  delete from public.ownership_scope_versions
  where repository_id = p_repository and calculation_version = p_version;
  delete from public.ownership_history_work
  where repository_id = p_repository and calculation_version = p_version;
  delete from public.ownership_contributor_build_work
  where repository_id = p_repository and calculation_version = p_version;

  -- anti-join prune: contributors referenced by zero snapshots across ALL
  -- versions — N-referenced and synthetic rows always survive
  delete from public.ownership_contributors c
  where c.repository_id = p_repository
    and not exists (
      select 1 from public.ownership_snapshots s
      where s.contributor_id = c.id and s.repository_id = c.repository_id
    );

  -- base scopes referenced by no membership AND no snapshot — the NO
  -- ACTION FKs make this delete impossible while either still references
  delete from public.ownership_scopes sc
  where sc.repository_id = p_repository
    and not exists (
      select 1 from public.ownership_scope_versions sv
      where sv.scope_id = sc.id and sv.repository_id = sc.repository_id
    )
    and not exists (
      select 1 from public.ownership_snapshots s
      where s.scope_id = sc.id and s.repository_id = sc.repository_id
    );

  -- clear build state; active_version is never touched
  update public.ownership_sync_state
  set building_version = null,
      history_cursor = null,
      pending_scopes = null,
      phase = case when active_version is not null then 'done' else 'pending' end,
      error = null,
      updated_at = now()
  where user_id = p_user and repository_id = p_repository;

  return 'abandoned';
end
$$;

-- ── 11a. own_build_preflight — §5.6c retired-version lifecycle gate ─────
-- Fresh-build preflight: under the sync-row lock, a non-null
-- building_version routes to resume/abandon ('blocked'); otherwise every
-- retired version (snapshots/membership not active_version) is garbage-
-- collected in the legal order — snapshots first, membership second,
-- then the same anti-join prunes as abandon — and the retired set is
-- re-verified empty inside the same transaction. Idempotent: a failed
-- attempt commits nothing, active keeps serving, retry is safe. This is
-- the GC step only — pinning a new revision requires a GitHub probe the
-- caller performs outside this transaction, so initialization is the
-- separate gated primitive below.
create or replace function public.own_build_preflight(
  p_user uuid,
  p_repository uuid
)
returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  st public.ownership_sync_state%rowtype;
  v_left int;
begin
  select * into st
  from public.ownership_sync_state
  where user_id = p_user and repository_id = p_repository
  for update;

  if not found then
    return 'stale';
  end if;
  if st.building_version is not null then
    return 'blocked';
  end if;

  -- retired versions: snapshots first, membership second
  delete from public.ownership_snapshots s
  where s.repository_id = p_repository
    and (st.active_version is null
         or s.calculation_version <> st.active_version);
  delete from public.ownership_scope_versions sv
  where sv.repository_id = p_repository
    and (st.active_version is null
         or sv.calculation_version <> st.active_version);

  -- then the same anti-join prunes as abandon
  delete from public.ownership_contributors c
  where c.repository_id = p_repository
    and not exists (
      select 1 from public.ownership_snapshots s
      where s.contributor_id = c.id and s.repository_id = c.repository_id
    );
  delete from public.ownership_scopes sc
  where sc.repository_id = p_repository
    and not exists (
      select 1 from public.ownership_scope_versions sv
      where sv.scope_id = sc.id and sv.repository_id = sc.repository_id
    )
    and not exists (
      select 1 from public.ownership_snapshots s
      where s.scope_id = sc.id and s.repository_id = sc.repository_id
    );

  -- the gate: no retired-version rows may remain — verified, not assumed
  select count(*) into v_left
  from (
    select calculation_version from public.ownership_snapshots
    where repository_id = p_repository
    union
    select calculation_version from public.ownership_scope_versions
    where repository_id = p_repository
  ) v
  where st.active_version is null
     or v.calculation_version <> st.active_version;
  if v_left > 0 then
    raise exception 'OWNERSHIP_INTERNAL_ERROR';
  end if;

  return 'ready';
end
$$;

-- ── 11b. own_build_init — gated build initialization (§5.6c) ────────────
-- A fresh build may initialize ONLY when the lifecycle invariant already
-- holds at request time: building_version null AND zero retired-version
-- rows. When retired rows are present the answer is 'blocked' —
-- building_version stays null; the caller runs own_build_preflight's GC
-- first and retries (the gate re-runs on every build-start attempt). The
-- pin is supplied by the caller's GitHub probe — never fetched here.
create or replace function public.own_build_init(
  p_user uuid,
  p_repository uuid,
  p_new_version int,
  p_pinned_oid text
)
returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  st public.ownership_sync_state%rowtype;
  v_retired int;
begin
  select * into st
  from public.ownership_sync_state
  where user_id = p_user and repository_id = p_repository
  for update;

  if not found then
    return 'stale';
  end if;
  if st.building_version is not null then
    return 'blocked';
  end if;

  -- gate: any retired-version row means no third version may initialize —
  -- building_version stays null; the GC preflight runs first
  select count(*) into v_retired
  from (
    select calculation_version from public.ownership_snapshots
    where repository_id = p_repository
    union
    select calculation_version from public.ownership_scope_versions
    where repository_id = p_repository
  ) v
  where st.active_version is null
     or v.calculation_version <> st.active_version;
  if v_retired > 0 then
    return 'blocked';
  end if;

  if p_new_version is null or p_new_version <= 0
     or p_new_version = st.active_version then
    raise exception 'OWNERSHIP_INTERNAL_ERROR';
  end if;
  if p_pinned_oid is null or p_pinned_oid !~ '^[0-9a-f]{40}$' then
    raise exception 'OWNERSHIP_INTERNAL_ERROR';
  end if;

  update public.ownership_sync_state
  set building_version = p_new_version,
      phase = 'history',
      error = null,
      history_cursor = jsonb_build_object(
        'pinned_oid', p_pinned_oid,
        'build_started_at', now(),
        'current', null),
      pending_scopes = null,
      updated_at = now()
  where user_id = p_user and repository_id = p_repository;

  return 'initialized';
end
$$;

-- ── 12. own_sweep_stale_work — orphan cleanup + abandon routing (§7) ────
-- Bare-deletes orphan work rows ONLY when no build is live — a build
-- never gets cleaned piecemeal. A genuinely stale live build (no
-- checkpoint activity, no valid lease, sync row idle past the window) is
-- routed through the canonical abandon so V's snapshots/contributors/
-- membership are cleaned in the same legal order.
create or replace function public.own_sweep_stale_work(
  p_user uuid,
  p_repository uuid,
  p_stale_before timestamptz default now() - interval '14 days'
)
returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  st public.ownership_sync_state%rowtype;
begin
  select * into st
  from public.ownership_sync_state
  where user_id = p_user and repository_id = p_repository
  for update;

  if not found or st.building_version is null then
    -- orphan rows only (leftovers of an already-cleared build or of a
    -- sync row that no longer exists) — no build semantics to preserve
    delete from public.ownership_history_work
    where repository_id = p_repository;
    delete from public.ownership_contributor_build_work
    where repository_id = p_repository;
    return 'swept-orphans';
  end if;

  -- stale live build: no activity on the sync row or the work rows inside
  -- the window, and no valid lease
  if st.updated_at < p_stale_before
     and (
       (st.history_cursor #>> '{lease,expires}')::timestamptz is null
       or (st.history_cursor #>> '{lease,expires}')::timestamptz < now()
     )
     and not exists (
       select 1 from public.ownership_history_work w
       where w.repository_id = p_repository and w.updated_at >= p_stale_before
     )
     and not exists (
       select 1 from public.ownership_contributor_build_work b
       where b.repository_id = p_repository and b.updated_at >= p_stale_before
     )
  then
    return public.own_abandon_build(p_user, p_repository, st.building_version);
  end if;

  return 'active';
end
$$;

-- Functions default to EXECUTE for PUBLIC — revoke everywhere, then grant
-- the backend role only (007/012 pattern). All are SECURITY INVOKER.
revoke all on function public.own_checkpoint_page(uuid, uuid, int, uuid, text, text, text, jsonb, jsonb, boolean) from public, anon, authenticated;
revoke all on function public.own_restart_scope(uuid, uuid, int, uuid)      from public, anon, authenticated;
revoke all on function public.own_promote_build(uuid, uuid, int)            from public, anon, authenticated;
revoke all on function public.own_abandon_build(uuid, uuid, int)            from public, anon, authenticated;
revoke all on function public.own_build_preflight(uuid, uuid)               from public, anon, authenticated;
revoke all on function public.own_build_init(uuid, uuid, int, text)         from public, anon, authenticated;
revoke all on function public.own_sweep_stale_work(uuid, uuid, timestamptz) from public, anon, authenticated;

grant execute on function public.own_checkpoint_page(uuid, uuid, int, uuid, text, text, text, jsonb, jsonb, boolean) to service_role;
grant execute on function public.own_restart_scope(uuid, uuid, int, uuid)      to service_role;
grant execute on function public.own_promote_build(uuid, uuid, int)            to service_role;
grant execute on function public.own_abandon_build(uuid, uuid, int)            to service_role;
grant execute on function public.own_build_preflight(uuid, uuid)               to service_role;
grant execute on function public.own_build_init(uuid, uuid, int, text)         to service_role;
grant execute on function public.own_sweep_stale_work(uuid, uuid, timestamptz) to service_role;

-- ── 13. dash_ownership_scopes — active-version membership (§5.9) ────────
-- Amended for version isolation: scopes are enumerated through
-- ownership_scope_versions at active_version — N+1-only scopes cannot
-- appear, N exclusion state cannot move, and excluded/exclusion state now
-- comes from the versioned membership row (the base row's columns are
-- non-authoritative legacy after this migration). Same signature, same
-- SECURITY INVOKER model, same grants.
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
  select sc.scope_path_hash, sc.scope_type, sc.display_path, sc.depth, sv.excluded,
         t.human_contributor_count, t.recent_human_maintainer_count,
         t.top_human_contributor_share, t.total_surviving_lines,
         t.unlinked_surviving_line_share
  from public.ownership_scopes sc
  join public.ownership_sync_state st
    on st.repository_id = sc.repository_id and st.user_id = sc.user_id
  join public.ownership_scope_versions sv
    on sv.scope_id = sc.id and sv.repository_id = sc.repository_id
   and sv.user_id = sc.user_id
   and sv.calculation_version = st.active_version
  left join public.ownership_snapshots t
    on t.scope_id = sc.id and t.repository_id = sc.repository_id
   and t.contributor_id is null and t.period_granularity = 'head'
   and t.calculation_version = st.active_version
  where sc.user_id = p_user
    and sc.repository_id = p_repository
    and st.active_version is not null
  order by sc.depth, sc.display_path
$$;

revoke all on function public.dash_ownership_scopes(uuid, uuid) from public, anon, authenticated;
grant execute on function public.dash_ownership_scopes(uuid, uuid) to service_role;
