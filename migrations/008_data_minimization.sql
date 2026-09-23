-- 008 — minimize stored GitHub metadata.
--
-- Dev Ledger metrics do not use commit headlines/messages or pull-request
-- titles. These human-authored fields can reveal confidential work context,
-- especially for private repositories, so remove them from persistent storage.
--
-- Deploy application code that no longer writes these columns before applying
-- this migration. The migration is forward-only and idempotent.

alter table public.commits
  drop column if exists message;

alter table public.pull_requests
  drop column if exists title;
