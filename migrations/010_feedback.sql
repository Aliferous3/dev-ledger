-- 010 — feedback: user-submitted records from the System Drawer
-- (POST /api/feedback). Carries only what the drawer collects: type,
-- title, optional description, an optional verified screenshot, and the
-- automatic context (page / selected range / build). Ownership is the
-- internal user id only — no contact address is collected or stored.
--
-- Deletion: user_id cascades with the users row, so DELETE MY DATA removes
-- feedback records with the rest of the account — no retained submissions.
--
-- Access model (same threat model as 007/009): browsers must never read or
-- write this table — RLS enabled with ZERO policies, anon/authenticated
-- hold no privileges. The only data path is the server-side service_role
-- key through the authenticated API.

create table if not exists public.feedback (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.users(id) on delete cascade,
  type            text not null check (type in ('BUG', 'FEATURE', 'FEEDBACK')),
  title           text not null check (char_length(title) between 1 and 200),
  description     text check (description is null or char_length(description) <= 4000),
  screenshot      bytea check (screenshot is null or octet_length(screenshot) <= 1000000),
  screenshot_mime text check (screenshot_mime is null or screenshot_mime in ('image/png', 'image/jpeg', 'image/webp')),
  screenshot_name text check (screenshot_name is null or char_length(screenshot_name) <= 160),
  page            text check (page is null or char_length(page) <= 80),
  selected_range  text check (selected_range is null or char_length(selected_range) <= 80),
  build           text check (build is null or char_length(build) <= 80),
  created_at      timestamptz not null default now()
);

create index if not exists feedback_user_time
  on public.feedback (user_id, created_at);

alter table public.feedback enable row level security;

revoke all on public.feedback from public, anon, authenticated;

-- Supabase default privileges would otherwise hand service_role the full
-- privilege set on new tables (update/truncate/references/trigger).
-- Revoke everything first, then grant only what the API needs — a fresh
-- environment must produce least-privilege, not defaults.
revoke all on public.feedback from service_role;
grant select, insert, delete on public.feedback to service_role;
