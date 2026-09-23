-- 007 — security hardening (forward-only; does not alter earlier migrations).
--
-- Threat model: Dev Ledger's product auth is iron-session, not Supabase
-- Auth. The ONLY legitimate data path is the server-side service_role key.
-- Every table below is backend-only: browsers must never read them via
-- PostgREST, regardless of what grants Supabase's defaults hand out.
--
--   1. RLS enabled on every user-data table with ZERO policies — a closed
--      second barrier behind the API's explicit user_id scoping.
--      service_role bypasses RLS, so backend behavior is unchanged.
--   2. Explicit REVOKE of table/sequence/function/view privileges from
--      PUBLIC, anon, authenticated — never rely on defaults.
--   3. dash_* functions switched to SECURITY INVOKER and execution locked
--      to service_role: they can no longer read commits for a caller that
--      lacks the underlying privilege, and cannot be invoked by browsers.
--   4. dash_repo_monthly / dash_span views pinned security_invoker so they
--      cannot bypass table-level boundaries.
--   5. auth_sessions — server-side session records for revocation.
--   6. webhook_deliveries — GitHub delivery-id deduplication.
--   7. repositories.disconnected_at — stop-sync-keep-history state.

-- ── 1. Row level security on all backend-only tables ─────────────────────
-- No policies are created: every browser-facing role is denied by default.
-- The service role (which bypasses RLS) is the only access path.

alter table public.users                 enable row level security;
alter table public.github_installations  enable row level security;
alter table public.repositories          enable row level security;
alter table public.repository_languages  enable row level security;
alter table public.commits               enable row level security;
alter table public.pull_requests         enable row level security;
alter table public.repo_sync             enable row level security;
alter table public.user_sync             enable row level security;
alter table public.repo_coverage         enable row level security;

-- ── 2. Revoke implicit privileges from browser/public roles ──────────────
-- Supabase's default privileges grant anon/authenticated broad rights on
-- new public-schema objects. Remove anything already granted and stop
-- future objects created by this migration role from inheriting them.

revoke all on all tables    in schema public from public, anon, authenticated;
revoke all on all sequences in schema public from public, anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

revoke create on schema public from public;
revoke usage on schema public from anon, authenticated;

alter default privileges in schema public
  revoke all on tables    from public, anon, authenticated;
alter default privileges in schema public
  revoke all on sequences from public, anon, authenticated;
alter default privileges in schema public
  revoke all on functions from public, anon, authenticated;

-- ── 3. Dashboard RPCs → SECURITY INVOKER + service_role only ─────────────
-- Previously SECURITY DEFINER + default PUBLIC execute: any holder of the
-- publishable anon key could aggregate arbitrary users' commit history by
-- passing a foreign p_user. As invoker functions they inherit the caller's
-- privileges (service_role reads commits; anon/authenticated cannot), and
-- EXECUTE is granted explicitly to service_role only.

create or replace function public.dash_daily(p_user uuid, p_from date default null, p_to date default null)
returns table(date date, commits bigint, additions bigint, deletions bigint)
language sql stable security invoker set search_path = public as
$$
  select committed_at::date as date,
         count(*)::bigint as commits,
         coalesce(sum(additions), 0)::bigint as additions,
         coalesce(sum(deletions), 0)::bigint as deletions
  from public.commits
  where user_id = p_user
    and (p_from is null or committed_at >= p_from::timestamptz)
    and (p_to is null or committed_at < (p_to::timestamptz + interval '1 day'))
  group by 1
  order by 1
$$;

create or replace function public.dash_repos(p_user uuid, p_from date default null, p_to date default null)
returns table(repository_id uuid, commits bigint, additions bigint, deletions bigint,
              active_days bigint, last_commit_at timestamptz)
language sql stable security invoker set search_path = public as
$$
  select repository_id,
         count(*)::bigint as commits,
         coalesce(sum(additions), 0)::bigint as additions,
         coalesce(sum(deletions), 0)::bigint as deletions,
         count(distinct committed_at::date)::int8 as active_days,
         max(committed_at) as last_commit_at
  from public.commits
  where user_id = p_user
    and repository_id is not null
    and (p_from is null or committed_at >= p_from::timestamptz)
    and (p_to is null or committed_at < (p_to::timestamptz + interval '1 day'))
  group by repository_id
$$;

create or replace function public.dash_rhythm(p_user uuid, p_from date default null, p_to date default null)
returns table(weekday int, hour int, commits bigint)
language sql stable security invoker set search_path = public as
$$
  select extract(dow from committed_at)::int as weekday,
         extract(hour from committed_at)::int as hour,
         count(*)::bigint as commits
  from public.commits
  where user_id = p_user
    and (p_from is null or committed_at >= p_from::timestamptz)
    and (p_to is null or committed_at < (p_to::timestamptz + interval '1 day'))
  group by 1, 2
$$;

revoke all on function public.dash_daily(uuid, date, date)  from public, anon, authenticated;
revoke all on function public.dash_repos(uuid, date, date)  from public, anon, authenticated;
revoke all on function public.dash_rhythm(uuid, date, date) from public, anon, authenticated;

grant execute on function public.dash_daily(uuid, date, date)  to service_role;
grant execute on function public.dash_repos(uuid, date, date)  to service_role;
grant execute on function public.dash_rhythm(uuid, date, date) to service_role;

-- ── 4. Views pinned security_invoker ─────────────────────────────────────
-- Otherwise they execute with the view owner's rights and could route
-- around table-level boundaries.

create or replace view public.dash_repo_monthly
with (security_invoker = on) as
select
  user_id,
  repository_id,
  date_trunc('month', committed_at)::date as month,
  count(*)::int as commits,
  coalesce(sum(additions), 0)::bigint as added,
  coalesce(sum(deletions), 0)::bigint as deleted,
  count(distinct committed_at::date)::int as active_days
from public.commits
group by user_id, repository_id, date_trunc('month', committed_at)::date;

create or replace view public.dash_span
with (security_invoker = on) as
select
  user_id,
  min(committed_at::date) as first_active,
  max(committed_at::date) as last_active,
  count(distinct committed_at::date)::int as active_days,
  count(*)::bigint as total_commits,
  coalesce(sum(additions), 0)::bigint as total_added,
  coalesce(sum(deletions), 0)::bigint as total_deleted
from public.commits
group by user_id;

revoke all on public.dash_repo_monthly from public, anon, authenticated;
revoke all on public.dash_span         from public, anon, authenticated;
grant select on public.dash_repo_monthly to service_role;
grant select on public.dash_span         to service_role;

-- ── 5. auth_sessions — server-side session revocation ────────────────────
-- Every issued session carries a random sid sealed inside the cookie; the
-- API validates it against this table. Deleting/revoking the row kills the
-- session server-side — a stolen persistent cookie dies on revocation,
-- not at its 30-day Max-Age. Rows for deleted users cascade away.

create table if not exists public.auth_sessions (
  sid         text primary key,
  user_id     uuid not null references public.users(id) on delete cascade,
  persistent  boolean not null default false,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  revoked_at  timestamptz
);

create index if not exists auth_sessions_user    on public.auth_sessions (user_id);
create index if not exists auth_sessions_expires on public.auth_sessions (expires_at)
  where revoked_at is null;

alter table public.auth_sessions enable row level security;
grant select, insert, update, delete on public.auth_sessions to service_role;

-- ── 6. webhook_deliveries — replay deduplication ─────────────────────────
-- X-GitHub-Delivery is a unique id per webhook send. Insert-first with the
-- primary key serializing concurrent duplicates; already-seen deliveries
-- are acknowledged as no-ops so GitHub doesn't retry-storm.
-- received_at bounds retention (rows pruned after 30 days by the handler).

create table if not exists public.webhook_deliveries (
  delivery_id text primary key,
  event       text,
  received_at timestamptz not null default now()
);

create index if not exists webhook_deliveries_received
  on public.webhook_deliveries (received_at);

alter table public.webhook_deliveries enable row level security;
grant select, insert, delete on public.webhook_deliveries to service_role;

-- ── 7. repositories.disconnected_at — keep-history disconnect state ──────
-- null = active. Set = sync/webhooks must skip the repo while historical
-- analytics stay queryable. DISCONNECT & DELETE removes the rows entirely.

alter table public.repositories add column if not exists disconnected_at timestamptz;
-- who disconnected it: 'user' (explicit STOP SYNCING, KEEP HISTORY — stays
-- retained until the user resumes or deletes) or 'github' (repo removed
-- from the installation / app uninstalled — auto-reconnects if GitHub
-- grants the repo again during a later discovery).
alter table public.repositories add column if not exists disconnect_source text;

create index if not exists repositories_user_active
  on public.repositories (user_id)
  where disconnected_at is null;
