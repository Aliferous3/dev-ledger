-- 003 — grants for the API roles used by supabase-js (service key).
-- Tables are created by the postgres migration role; API roles need
-- explicit privileges — RLS bypass does not imply privileges.
-- schema_migrations is deliberately excluded (operator-only ledger).

grant usage on schema public to service_role;

grant select, insert, update, delete on
  users, github_installations, repositories, repository_languages,
  commits, pull_requests, repo_sync, user_sync
to service_role;

-- tables created by future migrations get the same grants
alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;
