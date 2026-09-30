-- 011 — persistence minimization hardening (forward-only; idempotent).
--
-- Deploy application code that no longer writes these columns BEFORE
-- applying this migration (same order discipline as 008):
--
--   commits.author_user_id / commits.author_login
--       Stored commit rows are restricted to the signed-in user — the author
--       columns duplicated user_id information. GitHub author identity is
--       still verified transiently during ingestion (isAttributedCommit);
--       it is simply no longer persisted.
--
--   commits.authored_at / commits.files_changed / commits.is_merge
--       Write-only fields: no dashboard function, view, API response, share
--       card, or UI reads them. committed_at is the canonical timestamp.
--
--   pull_requests.author_user_id / author_login / number / closed_at
--       Same reasoning — PR rows are restricted to the signed-in user, the
--       dashboard reads only state/created_at/merged_at, and github_pr_id is
--       the dedup key. PR numbers are never displayed or linked.
--
--   Sync error fields (user_sync.error, repo_sync.error)
--       now carry closed taxonomy codes only. Any legacy free-text value is
--       rewritten to the matching code or SYNC_INTERNAL_ERROR — raw provider
--       exception text is never retained.
--
--   auth_sessions revocation residue
--       revoke = row deletion now; purge legacy revoked/expired rows so no
--       dead session record accumulates. revoked_at stays as a defensive
--       filter column (nothing writes it anymore).

alter table public.commits
  drop column if exists author_user_id,
  drop column if exists author_login,
  drop column if exists authored_at,
  drop column if exists files_changed,
  drop column if exists is_merge;

alter table public.pull_requests
  drop column if exists author_user_id,
  drop column if exists author_login,
  drop column if exists number,
  drop column if exists closed_at;

-- Legacy free-text error values → closed codes. Recognized phrasing maps to
-- its code; anything else (including arbitrary provider text) collapses to
-- SYNC_INTERNAL_ERROR rather than being carried forward.
update public.user_sync set error = 'GITHUB_RATE_LIMIT'
  where error is not null and error ilike '%rate limit%';
update public.repo_sync set error = 'GITHUB_RATE_LIMIT'
  where error is not null and error ilike '%rate limit%';

update public.user_sync set error = 'GITHUB_ACCESS_REVOKED'
  where error is not null and error ilike '%revok%';
update public.repo_sync set error = 'GITHUB_ACCESS_REVOKED'
  where error is not null and error ilike '%revok%';

update public.user_sync set error = 'SYNC_INTERNAL_ERROR'
  where error is not null
    and error not in ('GITHUB_RATE_LIMIT', 'GITHUB_ACCESS_REVOKED',
                      'SYNC_HISTORY_FAILED', 'SYNC_PULLS_FAILED',
                      'SYNC_INTERNAL_ERROR');
update public.repo_sync set error = 'SYNC_INTERNAL_ERROR'
  where error is not null
    and error not in ('GITHUB_RATE_LIMIT', 'GITHUB_ACCESS_REVOKED',
                      'SYNC_HISTORY_FAILED', 'SYNC_PULLS_FAILED',
                      'SYNC_INTERNAL_ERROR');

-- Dead session records retain nothing useful: revoked rows are legacy
-- (revocation deletes now) and expired rows can never authenticate again.
delete from public.auth_sessions
  where revoked_at is not null or expires_at < now();
