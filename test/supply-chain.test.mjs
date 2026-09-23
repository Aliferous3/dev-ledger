import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const load = (rel) => JSON.parse(src(rel));

/* ── server-only env classification (source of truth for the guards) ── */

// Never allowed in browser code, as VITE_* names, or in the bundle.
const SERVER_ONLY_SECRETS = [
  'SESSION_SECRET',
  'GITHUB_CLIENT_SECRET',
  'GITHUB_APP_PRIVATE_KEY',
  'GITHUB_WEBHOOK_SECRET',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_DB_PASSWORD',
  'CRON_SECRET',
  'DATABASE_URL',
  'VERCEL_TOKEN',
];

// Vite built-ins — the only import.meta.env.* a client module may read.
// Deny-by-default: Dev Ledger ships no custom VITE_* variables.
const VITE_BUILTINS = new Set(['DEV', 'PROD', 'MODE', 'SSR', 'BASE_URL']);

function allFiles(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) allFiles(p, acc);
    else acc.push(p);
  }
  return acc;
}
const clientFiles = () =>
  allFiles(path.join(ROOT, 'src')).filter((f) => /\.(ts|tsx|js|jsx|mjs)$/.test(f));

/* ── lockfile integrity + dependency origin policy ── */

test('package-lock.json is committed and lockfileVersion 3', () => {
  assert.ok(existsSync(path.join(ROOT, 'package-lock.json')));
  assert.equal(load('package-lock.json').lockfileVersion, 3);
});

test('every locked package resolves from registry.npmjs.org with integrity', () => {
  const { packages } = load('package-lock.json');
  for (const [name, meta] of Object.entries(packages)) {
    if (!name) continue; // root entry — not a fetched package
    const resolved = meta.resolved || '';
    if (meta.link) {
      assert.fail(`${name}: linked dependency is not allowed (${resolved})`);
    }
    if (resolved === '') continue; // workspace/virtual entries carry no tarball
    assert.ok(
      resolved.startsWith('https://registry.npmjs.org/'),
      `${name} resolved from non-registry origin: ${resolved}`,
    );
    assert.ok(meta.integrity, `${name} has no integrity hash`);
  }
});

test('package.json dependency specs use only registry semver ranges', () => {
  const pkg = load('package.json');
  for (const [group, deps] of [['dependencies', pkg.dependencies], ['devDependencies', pkg.devDependencies]]) {
    for (const [name, spec] of Object.entries(deps || {})) {
      assert.match(
        spec,
        /^(?:\^|~|>=?|<=?|=)?\d/,
        `${group}.${name} uses non-registry spec "${spec}" (file:/git:/http:/link: forbidden)`,
      );
    }
  }
});

/* ── client/server environment separation ── */

test('browser source never touches process.env', () => {
  for (const f of clientFiles()) {
    assert.doesNotMatch(
      readFileSync(f, 'utf8'),
      /\bprocess\.env\b/,
      `${path.relative(ROOT, f)} reads process.env — server env must not enter the client graph`,
    );
  }
});

test('import.meta.env usage is limited to Vite built-ins (deny custom VITE_*)', () => {
  for (const f of clientFiles()) {
    const content = readFileSync(f, 'utf8');
    for (const m of content.matchAll(/import\.meta\.env\.([A-Z_][A-Z0-9_]*)/g)) {
      assert.ok(
        VITE_BUILTINS.has(m[1]),
        `${path.relative(ROOT, f)} reads custom env import.meta.env.${m[1]} — ` +
          'add no VITE_* variables without an explicit security decision',
      );
    }
    assert.doesNotMatch(content, /\bVITE_[A-Z]/, `${path.relative(ROOT, f)} references a VITE_* name`);
  }
});

test('server-only secret names never appear in client-facing source', () => {
  const targets = [...clientFiles(), path.join(ROOT, 'index.html')];
  for (const f of targets) {
    const content = readFileSync(f, 'utf8');
    const rel = path.relative(ROOT, f);
    for (const name of SERVER_ONLY_SECRETS) {
      assert.ok(!content.includes(name), `${rel} references server-only ${name}`);
    }
    assert.doesNotMatch(content, /\bprocess\.env\b/, `${rel} reads process.env`);
  }
});

/* ── CI workflow supply-chain policy ── */

const WORKFLOW = '.github/workflows/security.yml';

test('security workflow exists and is SHA-pinned + least-privilege', () => {
  const wf = src(WORKFLOW);
  // every action reference must pin a full 40-hex commit SHA
  for (const m of wf.matchAll(/uses:\s*([^\s#]+)/g)) {
    const ref = m[1];
    assert.match(
      ref,
      /^[\w./-]+@[0-9a-f]{40}$/,
      `action "${ref}" is not pinned to a full commit SHA`,
    );
  }
  assert.doesNotMatch(wf, /pull_request_target/, 'pull_request_target grants PR code repo privileges');
  assert.match(wf, /permissions:\s*\n\s*contents:\s*read\b/, 'workflow must declare contents: read only');
  assert.doesNotMatch(wf, /contents:\s*write|pull-requests:\s*write|actions:\s*write|id-token:\s*write/);
  // the workflow must not touch repository secrets at all
  assert.doesNotMatch(wf, /\bsecrets\./, 'workflow must not reference secrets');
  assert.doesNotMatch(wf, /\b(printenv|env)\s*$/m, 'no wholesale env dumping');
});

test('CI install uses npm ci --ignore-scripts (never npm install)', () => {
  const wf = src(WORKFLOW);
  assert.match(wf, /npm ci --ignore-scripts/);
  assert.doesNotMatch(wf, /npm install\b/);
  assert.doesNotMatch(wf, /npm ci(?!\s+--ignore-scripts)/, 'npm ci must carry --ignore-scripts');
  assert.doesNotMatch(wf, /audit fix/, 'no npm audit fix in CI — fixes are deliberate');
});

test('CI runs tests, build, and a gated npm audit', () => {
  const wf = src(WORKFLOW);
  assert.match(wf, /run:\s*npm test\b/);
  assert.match(wf, /run:\s*npm run build\b/);
  assert.match(wf, /npm audit --audit-level=(moderate|high|critical)/);
});

test('secret scanning is a checksum-verified pinned binary', () => {
  const wf = src(WORKFLOW);
  assert.match(wf, /gitleaks_\d+\.\d+\.\d+_linux_x64\.tar\.gz/, 'gitleaks version must be pinned');
  assert.match(wf, /echo "[0-9a-f]{64} {2}gitleaks\.tar\.gz"[\s\S]*?sha256sum -c -/,
    'gitleaks tarball must be sha256-verified before extraction');
  assert.match(wf, /gitleaks git /, 'must scan git history, not just the worktree');
  assert.match(wf, /fetch-depth:\s*0/, 'history scan needs a full clone');
  assert.match(wf, /--redact/, 'findings must be redacted in logs');
  assert.doesNotMatch(wf, /curl[^|]*\|\s*(?:bash|sh)\b/, 'no curl-pipe-to-shell');
});

/* ── dependabot ── */

test('dependabot.yml covers npm + github-actions on a weekly schedule', () => {
  const d = src('.github/dependabot.yml');
  assert.match(d, /package-ecosystem:\s*"?npm"?/);
  assert.match(d, /package-ecosystem:\s*"?github-actions"?/);
  assert.match(d, /interval:\s*weekly/);
  // no automerge — updates stay human-reviewed
  assert.doesNotMatch(d, /auto-merge|automerge/i);
});

/* ── local secret hygiene ── */

test('.gitignore covers env files, keys, and Vercel local metadata', () => {
  const gi = src('.gitignore');
  for (const pat of ['.env', '.env.*', '*.pem', '*.key', '.vercel']) {
    assert.ok(gi.includes(pat), `.gitignore missing ${pat}`);
  }
});

test('.env.example contains placeholder values only', () => {
  const ex = src('.env.example');
  for (const line of ex.split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.+)$/);
    if (!m) continue;
    assert.ok(
      /^(https?:\/\/[\w.-]+|[\w.-]+\.supabase\.com|\d+)$/.test(m[2]),
      `.env.example ${m[1]} holds a non-placeholder value`,
    );
  }
});
