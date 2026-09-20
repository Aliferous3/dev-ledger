-- 004 — historical coverage tracking + richer sync progress.
-- repo_coverage records which [covered_from, covered_to) windows of each
-- repository's commit history have been ingested, so the dashboard can
-- distinguish "zero activity" from "history not yet synced".
create table if not exists repo_coverage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  repository_id uuid not null references repositories(id) on delete cascade,
  covered_from timestamptz not null,
  covered_to timestamptz not null,
  -- true when the interval's lower bound reached the repository's first
  -- commit; everything older than covered_from is then known-empty.
  complete boolean not null default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (user_id, repository_id, covered_from)
);

create index if not exists repo_coverage_user_repo on repo_coverage (user_id, repository_id);

-- per-phase counters for the sync progress UI (kept inside user_sync so no
-- extra round-trip is needed)
alter table user_sync add column if not exists detail jsonb;

-- service_role access (same pattern as 003_api_grants)
grant select, insert, update, delete on repo_coverage to service_role;

-- Backfill: repositories whose history walk already finished have complete
-- coverage from their oldest stored commit (or the dawn of time when the repo
-- has no commits — the scan still ran, the range is genuinely empty).
insert into repo_coverage (user_id, repository_id, covered_from, covered_to, complete)
select rs.user_id,
       rs.repository_id,
       coalesce((
         select min(c.committed_at) from commits c
         where c.user_id = rs.user_id and c.repository_id = rs.repository_id
       ), '1970-01-01T00:00:00Z'),
       coalesce(rs.last_synced_at, now()),
       true
from repo_sync rs
where rs.phase = 'done'
on conflict (user_id, repository_id, covered_from) do nothing;
