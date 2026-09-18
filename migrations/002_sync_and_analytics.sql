-- 002 — resumable sync state + SQL aggregation for the dashboard.
-- All aggregation is done in Postgres via security-definer functions so the
-- API never ships raw commit rows to the browser and every query is scoped
-- by the internal user id passed from the authenticated session.

alter table repositories add column if not exists pushed_at timestamptz;
alter table repositories add column if not exists installation_id bigint;
alter table commits add column if not exists authored_at timestamptz;
alter table commits add column if not exists is_merge boolean not null default false;
alter table pull_requests add column if not exists closed_at timestamptz;

-- per-repository resumable sync cursor
drop table if exists sync_state;

create table repo_sync (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  repository_id uuid not null references repositories(id) on delete cascade,
  phase text not null default 'pending', -- pending | commits | done | error
  cursor jsonb,                          -- { endCursor, since }
  last_commit_at timestamptz,
  last_synced_at timestamptz,
  error text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (user_id, repository_id)
);

-- per-user top-level sync status
create table user_sync (
  user_id uuid primary key references users(id) on delete cascade,
  status text not null default 'idle',   -- idle | syncing | complete | error | rate_limited | revoked | needs_install
  phase text,                            -- discover | metadata | commits | pulls | done
  progress numeric not null default 0,   -- 0..1
  repos_total int not null default 0,
  repos_done int not null default 0,
  resume_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  last_synced_at timestamptz,
  error text,
  updated_at timestamptz default now()
);

-- daily_activity is derived, not stored: always consistent with commits.
drop table if exists daily_activity;

create index if not exists commits_user_date on commits (user_id, committed_at);
create index if not exists commits_user_repo on commits (user_id, repository_id);
create index if not exists pull_requests_user_created on pull_requests (user_id, created_at);
create index if not exists pull_requests_user_merged on pull_requests (user_id, merged_at);
create index if not exists repository_languages_repo on repository_languages (repository_id);
create index if not exists repositories_user on repositories (user_id);
create index if not exists repo_sync_user on repo_sync (user_id, phase);

-- Day boundaries are UTC. committed_at is timestamptz; committed_at::date
-- resolves in the database timezone, which is UTC on Supabase by default.

create or replace function dash_daily(p_user uuid, p_from date default null, p_to date default null)
returns table(date date, commits bigint, additions bigint, deletions bigint)
language sql stable security definer set search_path = public as
$$
  select committed_at::date as date,
         count(*)::bigint as commits,
         coalesce(sum(additions), 0)::bigint as additions,
         coalesce(sum(deletions), 0)::bigint as deletions
  from commits
  where user_id = p_user
    and (p_from is null or committed_at >= p_from::timestamptz)
    and (p_to is null or committed_at < (p_to::timestamptz + interval '1 day'))
  group by 1
  order by 1
$$;

create or replace function dash_repos(p_user uuid, p_from date default null, p_to date default null)
returns table(repository_id uuid, commits bigint, additions bigint, deletions bigint,
              active_days bigint, last_commit_at timestamptz)
language sql stable security definer set search_path = public as
$$
  select repository_id,
         count(*)::bigint as commits,
         coalesce(sum(additions), 0)::bigint as additions,
         coalesce(sum(deletions), 0)::bigint as deletions,
         count(distinct committed_at::date)::bigint as active_days,
         max(committed_at) as last_commit_at
  from commits
  where user_id = p_user
    and repository_id is not null
    and (p_from is null or committed_at >= p_from::timestamptz)
    and (p_to is null or committed_at < (p_to::timestamptz + interval '1 day'))
  group by repository_id
$$;

create or replace function dash_rhythm(p_user uuid, p_from date default null, p_to date default null)
returns table(weekday int, hour int, commits bigint)
language sql stable security definer set search_path = public as
$$
  select extract(dow from committed_at)::int as weekday,
         extract(hour from committed_at)::int as hour,
         count(*)::bigint as commits
  from commits
  where user_id = p_user
    and (p_from is null or committed_at >= p_from::timestamptz)
    and (p_to is null or committed_at < (p_to::timestamptz + interval '1 day'))
  group by 1, 2
$$;
