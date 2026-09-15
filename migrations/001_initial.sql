create table users (
  id uuid primary key default gen_random_uuid(),
  github_user_id bigint not null unique,
  github_login text not null,
  github_node_id text,
  avatar_url text,
  display_name text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table github_installations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  installation_id bigint not null,
  account_id bigint,
  account_login text,
  account_type text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (user_id, installation_id)
);

create table repositories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  github_repo_id bigint not null,
  owner_login text not null,
  name text not null,
  full_name text not null,
  private boolean default false,
  default_branch text,
  primary_language text,
  archived boolean default false,
  fork boolean default false,
  first_seen_at timestamptz default now(),
  last_synced_at timestamptz,
  unique (user_id, github_repo_id)
);

create table repository_languages (
  id uuid primary key default gen_random_uuid(),
  repository_id uuid not null references repositories(id) on delete cascade,
  language text not null,
  bytes bigint not null default 0
);

create table commits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  repository_id uuid references repositories(id) on delete set null,
  github_sha text not null,
  author_user_id bigint,
  author_login text,
  committed_at timestamptz not null,
  additions bigint default 0,
  deletions bigint default 0,
  files_changed int default 0,
  message text,
  unique (user_id, github_sha)
);

create table pull_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  repository_id uuid references repositories(id) on delete set null,
  github_pr_id bigint not null,
  number int not null,
  author_user_id bigint,
  author_login text,
  state text not null default 'open',
  created_at timestamptz not null,
  merged_at timestamptz,
  title text,
  unique (user_id, github_pr_id)
);

create table daily_activity (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  date date not null,
  commits int default 0,
  additions bigint default 0,
  deletions bigint default 0,
  churn bigint default 0,
  unique (user_id, date)
);

create table sync_state (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  repository_id uuid references repositories(id) on delete cascade,
  last_sha text,
  last_synced_at timestamptz,
  status text default 'pending',
  error text,
  unique (user_id, repository_id)
);
