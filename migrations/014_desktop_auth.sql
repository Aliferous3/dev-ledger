-- 014 — desktop authentication handoff (Tauri app).
--
-- The desktop app signs in through the SAME GitHub OAuth flow in the
-- system browser; it never sees credentials. After OAuth completes, the
-- callback hands the session off to the app through a dev-ledger:// deep
-- link carrying a single-use code, which the app exchanges for an opaque
-- bearer token bound to a dedicated server-side session.
--
--   desktop_auth_codes — one-time handoff codes (single-use, ~2 min TTL)
--   desktop_tokens     — long-lived API bearer tokens, stored hashed only
--
-- `challenge` binds each code to the app instance that minted the flow:
-- the app sends sha256(verifier) with the login request, the sealed session
-- carries it to the handoff, and the exchange must present the verifier.
-- A dev-ledger:// URL intercepted by a hostile scheme-handler is then
-- useless — it leaks flow+code but not the verifier (PKCE discipline).
--
-- Both tables bind to auth_sessions.sid so the existing revocation
-- machinery (logout, DELETE MY DATA, kill-all) kills desktop access with
-- the rest of the account; users-row deletion cascades everything.
--
-- Access model (same threat model as 007/010): browsers must never read or
-- write these tables — RLS enabled with ZERO policies, anon/authenticated
-- hold no privileges. The only data path is the service_role key through
-- the authenticated API.

create table if not exists public.desktop_auth_codes (
  code_hash   text primary key,
  flow        uuid not null,
  challenge   text not null,
  user_id     uuid not null references public.users(id) on delete cascade,
  session_sid text not null references public.auth_sessions(sid) on delete cascade,
  expires_at  timestamptz not null,
  consumed_at timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists desktop_auth_codes_user
  on public.desktop_auth_codes (user_id);
create index if not exists desktop_auth_codes_expires
  on public.desktop_auth_codes (expires_at) where consumed_at is null;

alter table public.desktop_auth_codes enable row level security;

revoke all on public.desktop_auth_codes from public, anon, authenticated;
revoke all on public.desktop_auth_codes from service_role;
-- Consume is an UPDATE (consumed_at + RETURNING), so update is required;
-- Postgres serializes the row lock and re-evaluates the filter, which is
-- what makes the code atomically single-use.
grant select, insert, update, delete on public.desktop_auth_codes to service_role;

create table if not exists public.desktop_tokens (
  token_hash   text primary key,
  user_id      uuid not null references public.users(id) on delete cascade,
  session_sid  text not null references public.auth_sessions(sid) on delete cascade,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  last_used_at timestamptz
);

create index if not exists desktop_tokens_user
  on public.desktop_tokens (user_id);
create index if not exists desktop_tokens_expires
  on public.desktop_tokens (expires_at);

alter table public.desktop_tokens enable row level security;

revoke all on public.desktop_tokens from public, anon, authenticated;
revoke all on public.desktop_tokens from service_role;
-- Plaintext tokens are never stored — only their SHA-256 hash, so a read
-- of this table (or its backups) yields nothing replayable.
grant select, insert, update, delete on public.desktop_tokens to service_role;
