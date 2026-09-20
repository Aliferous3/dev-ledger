-- workShape analytics: all-time per-repository monthly activity and a global
-- span summary, derived from stored commits. Read-only views — no behavior
-- change to sync or ingestion. Used by the Overview's "shape of work" region.

create or replace view dash_repo_monthly as
select
  user_id,
  repository_id,
  date_trunc('month', committed_at)::date as month,
  count(*)::int as commits,
  coalesce(sum(additions), 0)::bigint as added,
  coalesce(sum(deletions), 0)::bigint as deleted,
  count(distinct committed_at::date)::int as active_days
from commits
group by user_id, repository_id, date_trunc('month', committed_at)::date;

create or replace view dash_span as
select
  user_id,
  min(committed_at::date) as first_active,
  max(committed_at::date) as last_active,
  count(distinct committed_at::date)::int as active_days,
  count(*)::bigint as total_commits,
  coalesce(sum(additions), 0)::bigint as total_added,
  coalesce(sum(deletions), 0)::bigint as total_deleted
from commits
group by user_id;

grant select on dash_repo_monthly to service_role;
grant select on dash_span to service_role;
