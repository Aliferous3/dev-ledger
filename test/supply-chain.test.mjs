import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { ROOT, SERVER_ONLY_SECRETS } from './secret-inventory.mjs';

const src = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const load = (rel) => JSON.parse(src(rel));

/* ── server-only env classification ── */
// SERVER_ONLY_SECRETS is derived from security/secret-inventory.json by
// test/secret-inventory.mjs — a new secret cannot silently miss this guard.
// Never allowed in browser code, as VITE_* names, or in the bundle.

// Vite built-ins — the only import.meta.env.* a client module may read.
// Deny-by-default: Dev Ledger ships no custom VITE_* variables.
const VITE_BUILTINS = new Set(['DEV', 'PROD', 'MODE', 'SSR', 'BASE_URL']);

// Explicit security decision: the PostHog product-analytics integration
// ships exactly two PUBLIC client configuration values — the PostHog
// project token (a publishable client key by design, not a secret) and
// the same-origin proxy host. Anything else stays denied.
const ALLOWED_PUBLIC_VITE_VARS = new Set([
  'VITE_POSTHOG_PROJECT_TOKEN',
  'VITE_POSTHOG_HOST',
]);

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

test('import.meta.env usage is limited to Vite built-ins + allowlisted public vars', () => {
  for (const f of clientFiles()) {
    const content = readFileSync(f, 'utf8');
    for (const m of content.matchAll(/import\.meta\.env\.([A-Z_][A-Z0-9_]*)/g)) {
      assert.ok(
        VITE_BUILTINS.has(m[1]) || ALLOWED_PUBLIC_VITE_VARS.has(m[1]),
        `${path.relative(ROOT, f)} reads custom env import.meta.env.${m[1]} — ` +
          'add no VITE_* variables without an explicit security decision',
      );
    }
    // The two allowlisted public names are the only VITE_* strings
    // permitted in client source at all.
    const stripped = content.replace(/\bVITE_POSTHOG_PROJECT_TOKEN\b|\bVITE_POSTHOG_HOST\b/g, '');
    assert.doesNotMatch(stripped, /\bVITE_[A-Z]/, `${path.relative(ROOT, f)} references a VITE_* name`);
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

test('every actions/checkout step sets persist-credentials: false', () => {
  const wf = src(WORKFLOW);
  // Split into step blocks (each begins "- uses:" or "- name:") and isolate
  // the checkout steps — the credential must never persist into .git/config
  // where later repository-controlled code (npm test/build) could read it.
  const stepBlocks = wf.split(/\n\s*- (?=uses:|name:)/).slice(1);
  const checkoutSteps = stepBlocks.filter((b) => /uses:\s*actions\/checkout@/.test(b));
  assert.ok(checkoutSteps.length >= 2, 'expected at least the verify + secret-scan checkouts');
  assert.equal(
    checkoutSteps.length,
    (wf.match(/uses:\s*actions\/checkout@/g) || []).length,
    'a checkout step escaped block isolation — recount',
  );
  for (const [i, block] of checkoutSteps.entries()) {
    assert.match(
      block,
      /persist-credentials:\s*false/,
      `checkout step #${i + 1} persists the GITHUB_TOKEN into git config`,
    );
  }
});

test('every security job declares a finite timeout-minutes', () => {
  const wf = src(WORKFLOW);
  const jobsSection = wf.split(/^jobs:/m)[1];
  assert.ok(jobsSection, 'jobs: section missing');
  const jobIds = [...jobsSection.matchAll(/^ {2}([a-zA-Z][\w-]*):$/gm)].map((m) => m[1]);
  assert.ok(jobIds.length >= 2, 'expected verify + secret-scan jobs');
  for (const id of jobIds) {
    const block = jobsSection
      .split(new RegExp(`^  ${id}:$`, 'm'))[1]
      ?.split(/^  [a-zA-Z][\w-]*:$/m)[0] || '';
    assert.match(block, /timeout-minutes:\s*\d+/, `job "${id}" has no timeout-minutes`);
  }
});

test('CI install uses npm ci --ignore-scripts (never npm install)', () => {
  const wf = src(WORKFLOW);
  assert.match(wf, /npm ci --ignore-scripts/);
  assert.doesNotMatch(wf, /npm install\b/);
  assert.doesNotMatch(wf, /npm ci(?!\s+--ignore-scripts)/, 'npm ci must carry --ignore-scripts');
  assert.doesNotMatch(wf, /audit fix/, 'no npm audit fix in CI — fixes are deliberate');
});

test('CI runs tests, build, typecheck, and a gated npm audit', () => {
  const wf = src(WORKFLOW);
  assert.match(wf, /run:\s*npm test\b/);
  assert.match(wf, /run:\s*npm run build\b/);
  assert.match(wf, /run:\s*npm run typecheck\b/, 'workflow must run npm run typecheck');
  assert.match(wf, /npm audit --audit-level=(moderate|high|critical)/);
});

test('typecheck script exists and is strict — no emit, no loosened tsconfig', () => {
  const pkg = load('package.json');
  assert.equal(pkg.scripts.typecheck, 'tsc --noEmit');
  // tsconfig.json permits comments — assert the strict flags textually
  // rather than JSON.parse-ing them out of a comment-stripped file
  const tc = src('tsconfig.json');
  for (const flag of [
    '"strict": true',
    '"noUnusedLocals": true',
    '"noUnusedParameters": true',
    '"noEmit": true',
  ]) {
    assert.ok(tc.includes(flag), `tsconfig must keep ${flag}`);
  }
});

test('CI builds BEFORE testing — the artifact scan must inspect a real dist/', () => {
  const wf = src(WORKFLOW);
  const buildIdx = wf.indexOf('run: npm run build');
  const testIdx = wf.indexOf('run: npm test');
  assert.ok(buildIdx > -1 && testIdx > -1, 'workflow must run both build and test');
  assert.ok(
    buildIdx < testIdx,
    'npm run build must precede npm test — otherwise test/security.test.mjs ' +
      'artifact checks run against a nonexistent dist/ and scan nothing',
  );
  // and the artifact tests themselves must fail closed on CI, not skip
  const secTest = src('test/security.test.mjs');
  assert.match(
    secTest,
    /process\.env\.CI/,
    'artifact checks must fail when dist/ is absent under CI — a silent skip is a silent bypass',
  );
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
