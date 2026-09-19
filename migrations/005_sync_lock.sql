-- 005 — real per-user sync lock.
--
-- Previously "is a slice in flight?" was inferred from user_sync.updated_at
-- being <60s old. Two failure modes resulted:
--
--   1. The OAuth/setup callback writes status='syncing' as a kick marker.
--      That made the first POST /api/sync wait ~60s before real work began.
--   2. Worse: api/sync fired its waitUntil resume continuation on EVERY
--      lock-hit response — so each 1.5s pump poll spawned another concurrent
--      runSync. Cold bootstraps (post-delete) ran dozens of duplicate slices,
--      re-walking identical history pages until secondary rate limits stalled
--      the account for minutes.
--
-- locked_at is a proper ownership claim: acquired atomically via a
-- conditional update, released on every exit path, and considered abandoned
-- after LOCK_STALE_MS so a dead slice can be taken over.
alter table user_sync add column if not exists locked_at timestamptz;

-- lets the cron continuation find abandoned-but-locked rows cheaply
create index if not exists user_sync_status_locked on user_sync (status, locked_at);
