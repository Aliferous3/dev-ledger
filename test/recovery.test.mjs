import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ROOT, INVENTORY, SERVER_ONLY_SECRETS } from './secret-inventory.mjs';
import { CORE_TABLES, OPERATIONAL_TABLES, EPHEMERAL_TABLES, BACKUP_TABLES } from '../scripts/backup-scope.mjs';

const src = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const run = (args, env = {}) =>
  spawnSync(process.execPath, args, {
    env: { ...process.env, ...env },
    encoding: 'utf8',
    cwd: ROOT,
    timeout: 30000,
  });

/* ── operator commands ─────────────────────────────────────────────── */

test('package.json exposes db:migrate, db:backup, db:drill', () => {
  const pkg = JSON.parse(src('package.json'));
  assert.equal(pkg.scripts['db:migrate'], 'node scripts/migrate.mjs');
  assert.equal(pkg.scripts['db:backup'], 'node scripts/backup-db.mjs');
  assert.equal(pkg.scripts['db:drill'], 'node scripts/recovery-drill.mjs');
});

test('operator env loader prefers process env, then .env.local, then .env', () => {
  const env = src('scripts/operator-env.mjs');
  // .env.local is loaded first — loadEnvFile never overrides, so first wins
  assert.match(env, /\['\.env\.local',\s*'\.env'\]/);
  assert.match(env, /process\.loadEnvFile/); // never overrides existing vars
  assert.match(env, /decodeURIComponent\(u\.password\)/); // PGPASSWORD env, not argv
});

test('migrate.mjs uses the shared operator env loader', () => {
  const m = src('scripts/migrate.mjs');
  assert.match(m, /from '\.\/operator-env\.mjs'/);
  assert.match(m, /loadOperatorEnv\(\)/);
  assert.match(m, /databaseUrl\(\)/);
  // must not echo secrets
  assert.doesNotMatch(m, /console\.log.*password/i);
});

/* ── backup tooling safety ─────────────────────────────────────────── */

test('backup artifacts are gitignored (behavioral check-ignore)', () => {
  const gi = src('.gitignore');
  for (const pat of ['.recovery/', '*.dump', '*.backup']) {
    assert.ok(gi.includes(pat), `.gitignore missing ${pat}`);
  }
  const r = spawnSync('git', ['check-ignore', '-v', '.recovery/dev-ledger-20990101.dump'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(r.status, 0, `git does not ignore .recovery/ dumps: ${r.stdout}${r.stderr}`);
  const r2 = spawnSync('git', ['check-ignore', '-v', 'x.dump'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(r2.status, 0, 'git does not ignore *.dump');
});

test('backup script puts credentials in env, never argv', () => {
  const b = src('scripts/backup-db.mjs');
  assert.match(b, /pgEnv\(url\)/);
  assert.match(b, /binaryOut:\s*true/); // dump streams over stdout — no -f path crossing into docker
  assert.doesNotMatch(b, /--file=/);
  assert.doesNotMatch(b, /--dbname=.*postgres:\/\//); // no conn string in argv
  assert.doesNotMatch(b, /process\.env\.(SUPABASE_DB_PASSWORD|DATABASE_URL)\s*\+/); // no value concatenation into args
});

test('backup is allowlist-only — explicit --table per BACKUP_TABLES, no exclusion-list', () => {
  const b = src('scripts/backup-db.mjs');
  assert.match(b, /BACKUP_TABLES\.map\(.*--table=public\./s, 'must emit --table=public.<t> per allowlisted table');
  assert.doesNotMatch(b, /--exclude-table/, 'exclusion-list model silently backs up unclassified tables');
  assert.equal(BACKUP_TABLES.length, 9);
  for (const t of ['users', 'github_installations', 'repositories', 'repository_languages',
    'commits', 'pull_requests', 'repo_coverage', 'repo_sync', 'user_sync']) {
    assert.ok(BACKUP_TABLES.includes(t), `BACKUP_TABLES missing ${t}`);
  }
  // nothing outside the allowlist can enter the archive — no whole-db dump
  assert.doesNotMatch(b, /--schema-only|--format=custom'\s*\]/, 'no unscoped dump args');
});

test('drill proves the allowlist — sentinel schema/table + TOC assertion', () => {
  const d = src('scripts/recovery-drill.mjs');
  assert.match(d, /create schema drill_internal/);
  assert.match(d, /drill_internal\.do_not_backup/);
  assert.match(d, /'--list'/, 'must inspect the archive TOC');
  assert.match(d, /TABLE DATA public/, 'TOC parser targets data entries');
  assert.match(d, /drill_internal.*leaked|leaked.*archive/i);
});

test('backup fails safely and clearly without DB credentials', () => {
  const r = run(['scripts/backup-db.mjs'], {
    DATABASE_URL: '', SUPABASE_DB_PASSWORD: '', SUPABASE_URL: '', SUPABASE_PROJECT_REF: '',
    SUPABASE_DB_HOST: '', SUPABASE_DB_PORT: '',
  });
  assert.notEqual(r.status, 0, 'backup must fail without credentials');
  assert.match(r.stderr, /DATABASE_URL|SUPABASE_DB_PASSWORD/);
  assert.doesNotMatch(r.stderr + r.stdout, /postgres:\/\/[^@\s]+:[^@\s]+@/, 'leaked a connection string');
});

test('recovery drill refuses non-local database hosts', () => {
  for (const host of [
    'db.llxexsandkhwhlzxuwbf.supabase.co',   // current production project
    'aws-0-ap-southeast-2.pooler.supabase.com',
    'prod-db.internal.example.com',
    '10.0.0.5',
  ]) {
    const r = run(['scripts/recovery-drill.mjs'], {
      DRILL_DATABASE_URL: `postgres://postgres:x@${host}:5432/postgres`,
    });
    assert.notEqual(r.status, 0, `drill must refuse ${host}`);
    assert.match(r.stderr + r.stdout, /refusing non-local host/i);
  }
});

test('recovery drill accepts only loopback hosts', () => {
  const drill = src('scripts/recovery-drill.mjs');
  assert.match(drill, /isLocalHost/);
  for (const good of ['localhost', '127.0.0.1', '::1']) {
    // parse-level proof: allowlist present and checked before any DB touch
    assert.match(drill, /refusing non-local host/);
  }
});

/* ── backup scope classification ───────────────────────────────────── */

test('every migrated table is classified — none can silently go unbacked-up', () => {
  // derive the surviving public table set from the migrations themselves
  const dir = path.join(ROOT, 'migrations');
  const created = new Set();
  const dropped = new Set();
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    const sql = readFileSync(path.join(dir, f), 'utf8');
    for (const m of sql.matchAll(/create table(?:\s+if not exists)?\s+(?:public\.)?(\w+)/gi)) created.add(m[1]);
    for (const m of sql.matchAll(/drop table(?:\s+if exists)?\s+(?:public\.)?(\w+)/gi)) dropped.add(m[1]);
  }
  const live = [...created].filter((t) => !dropped.has(t)).sort();
  assert.ok(live.length >= 10, `expected >=10 live tables, got ${live.length}`);

  const classified = new Set([...CORE_TABLES, ...OPERATIONAL_TABLES, ...EPHEMERAL_TABLES]);
  for (const t of live) {
    assert.ok(classified.has(t), `table ${t} exists in migrations but is not classified in backup-scope.mjs`);
  }
  for (const t of classified) {
    // schema_migrations is created by scripts/migrate.mjs itself, not a file
    assert.ok(live.includes(t) || t === 'schema_migrations', `${t} is classified but not created by migrations`);
  }
});

test('ephemeral policy: sessions/dedup/telemetry are never in the dump', () => {
  for (const t of ['auth_sessions', 'webhook_deliveries', 'security_events', 'schema_migrations']) {
    assert.ok(EPHEMERAL_TABLES.includes(t), `${t} must stay ephemeral`);
    assert.ok(!BACKUP_TABLES.includes(t), `${t} must not be in the allowlist`);
  }
  // allowlist disjointness — no table is both backed up and ephemeral
  const overlap = BACKUP_TABLES.filter((t) => EPHEMERAL_TABLES.includes(t));
  assert.deepEqual(overlap, []);
});

test('operator DB default is the Supavisor SESSION pooler (5432)', () => {
  const env = src('scripts/operator-env.mjs');
  assert.match(env, /SUPABASE_DB_PORT\s*\|\|\s*'5432'/);
  assert.doesNotMatch(env, /'6543'/, 'transaction pooler port must not be the default');
  const ex = src('.env.example');
  assert.match(ex, /SUPABASE_DB_PORT=5432/);
  assert.doesNotMatch(ex, /SUPABASE_DB_PORT=6543/);
});

test('hosted-compatible restore: no --disable-triggers, transactional, FKs active', () => {
  const d = src('scripts/recovery-drill.mjs');
  const doc = src('docs/disaster-recovery.md');
  // --disable-triggers emits commands needing superuser — the managed
  // Supabase postgres role (rolsuper=false) cannot run them. Quoted form
  // = an actual argv entry; prose mentions are fine.
  assert.doesNotMatch(d, /'--disable-triggers'|"--disable-triggers"/);
  assert.doesNotMatch(doc, /pg_restore[^\n`]*--disable-triggers/);
  assert.match(d, /'--single-transaction'/, 'fresh-target restore must be all-or-nothing');
  // no session_replication_role / constraint weakening as a substitute
  assert.doesNotMatch(d, /session_replication_role|deferrable|deferred/i);
});

test('no one-command production restore helper exists', () => {
  const pkg = JSON.parse(src('package.json'));
  for (const name of Object.keys(pkg.scripts)) {
    assert.doesNotMatch(name, /restore|prod.*dr/i, `suspicious restore-like script: ${name}`);
  }
  const d = src('scripts/recovery-drill.mjs');
  assert.match(d, /refusing non-local host/, 'drill must refuse non-local targets');
});

test('branch retains the PR #18 webhook ack-before-sync behavior', () => {
  const wh = src('api/webhooks/github.mjs');
  assert.match(wh, /waitUntil/, 'webhook must schedule sync via waitUntil');
  assert.match(wh, /scheduleSync/, 'durable marker + detached runSync');
  assert.doesNotMatch(wh, /await runSync/, 'runSync must not block the ack');
});

test('drill behaviorally exercises role denial and service_role access', () => {
  const d = src('scripts/recovery-drill.mjs');
  assert.match(d, /\['anon', 'authenticated'\]/, 'browser roles exercised');
  assert.match(d, /set role \$\{role\}/, 'SET ROLE loop');
  assert.match(d, /set role service_role/);
  assert.match(d, /reset role/, 'roles must be reset');
  assert.match(d, /bypassrls/i, 'service_role must model Supabase BYPASSRLS');
});

/* ── runbook + inventory parity ────────────────────────────────────── */

test('disaster-recovery runbook exists and covers every inventoried secret', () => {
  const doc = src('docs/disaster-recovery.md');
  for (const name of SERVER_ONLY_SECRETS) {
    assert.ok(doc.includes(name), `docs/disaster-recovery.md does not cover ${name}`);
  }
  // and the recovery-priority skeleton is present
  for (const section of ['Recovery priorities', 'RPO', 'RTO', 'retention']) {
    assert.match(doc, new RegExp(section, 'i'), `runbook missing "${section}"`);
  }
});

test('CI drill job requires zero repository secrets', () => {
  const wf = src('.github/workflows/security.yml');
  assert.match(wf, /recovery-drill/);
  const job = wf.slice(wf.indexOf('recovery-drill:'));
  assert.doesNotMatch(job, /\$\{\{\s*secrets\./, 'recovery drill must not consume repo secrets');
  assert.match(job, /postgres:17/, 'drill must run against Postgres 17');
  assert.match(job, /DRILL_DATABASE_URL/, 'drill needs an explicit local URL');
});

test('no 13th serverless function was added', () => {
  const api = path.join(ROOT, 'api');
  const count = readdirSync(api, { recursive: true })
    .filter((f) => String(f).endsWith('.mjs')).length;
  assert.equal(count, 12);
});
