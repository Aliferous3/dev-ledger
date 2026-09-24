-- 009 — security_events: privacy-preserving security telemetry.
--
-- The API emits a fixed-field record for designated rejections and
-- privileged transitions (CSRF blocks, dead session sids, webhook
-- signature failures, replay dedup, cron auth failures, logout, account
-- deletion). Records carry no raw IP, User-Agent, cookies, bodies, or
-- secrets — actor/source identifiers arrive pre-HMAC'd by the app with a
-- dedicated SECURITY_EVENT_HASH_KEY, so correlation is possible but
-- identification is not.
--
-- Access model (same threat model as 007): browsers must never read this
-- table — RLS enabled with ZERO policies, and anon/authenticated hold no
-- privileges. The only data path is the server-side service_role key.
-- Retention is 30 days, pruned by the existing authenticated cron path
-- (no new endpoint).

create table if not exists public.security_events (
  id          bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  event       text not null,
  severity    text not null,
  route       text,
  method      text,
  status      integer,
  request_id  text,
  reason_code text,
  actor_hash  text,
  source_hash text
);

create index if not exists security_events_occurred
  on public.security_events (occurred_at);
create index if not exists security_events_event_time
  on public.security_events (event, occurred_at);

alter table public.security_events enable row level security;

revoke all on public.security_events from public, anon, authenticated;

-- Supabase default privileges would otherwise hand service_role the full
-- privilege set on new tables (update/truncate/references/trigger).
-- Revoke everything first, then grant only what the telemetry writer
-- needs — a fresh environment must produce least-privilege, not defaults.
revoke all on public.security_events from service_role;
grant select, insert, delete on public.security_events to service_role;
-- identity-column sequence needs explicit usage for service_role inserts;
-- every other role keeps zero sequence privilege.
revoke all on sequence public.security_events_id_seq from public, anon, authenticated;
revoke all on sequence public.security_events_id_seq from service_role;
grant usage on sequence public.security_events_id_seq to service_role;
