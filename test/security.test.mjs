import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { ROOT, SERVER_ONLY_SECRETS } from './secret-inventory.mjs';
const src = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const bare = (rel) => readFileSync(path.join(ROOT, rel), 'utf8').replace(/\/\/[^\n]*/g, '');

/* ── WS1: no user-derived/private fixture data may reach production ── */

// Identifiers observed in the old bundled fixtures (real private repo
// names + the owner's account path prefix). None may appear in source
// fixture modules OR the built artifact.
const FORBIDDEN_IDENTIFIERS = [
  'lexica-aeterna',
  'lexica',
  'Influencer-Tracker',
  'gold-bot',
  'taskbar-kitty',
  'Live-Flight-Radar-Scanner-M5Stack',
  'Aliferous3/', // repo path prefix (the author's public profile link is fine)
];

// The fictional replacements are dev-only too — they must also be absent
// from the production artifact (fixtures are aliased to an inert stub).
const FICTIONAL_FIXTURE_NAMES = [
  'northstar-api',
  'quartz-ui',
  'sample-cli',
  'atlas-worker',
  'demo-dashboard',
  'zephyr-sensor-fw',
  'octo-demo',
];

function allSourceFiles(dir = path.join(ROOT, 'src'), acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) allSourceFiles(p, acc);
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(e.name)) acc.push(p);
  }
  return acc;
}

test('no real/private repo identifiers anywhere in src/', () => {
  for (const f of allSourceFiles()) {
    const content = readFileSync(f, 'utf8');
    for (const id of FORBIDDEN_IDENTIFIERS) {
      assert.ok(
        !content.includes(id),
        `${path.relative(ROOT, f)} still contains private identifier "${id}"`,
      );
    }
  }
});

function allDistFiles(dir = path.join(ROOT, 'dist'), acc = []) {
  if (!existsSync(dir)) return acc;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) allDistFiles(p, acc);
    else acc.push(p);
  }
  return acc;
}

// Artifact scans must inspect a REAL build. On CI (CI=true) a missing dist/
// is a hard failure — the workflow builds before testing — while a local
// pre-build `npm test` may still skip instead of faking a pass.
function distFilesOrSkip() {
  const files = allDistFiles();
  if (!files.length) {
    assert.ok(
      !process.env.CI,
      'dist/ is absent on CI — the artifact scan never inspected a bundle. ' +
        'Run `npm run build` BEFORE `npm test` in the workflow.',
    );
    return null;
  }
  return files;
}

test('built production artifact contains zero fixture identifiers', () => {
  const files = distFilesOrSkip();
  if (!files) return;
  for (const f of files) {
    const content = readFileSync(f, 'utf8');
    const rel = path.relative(ROOT, f).replace(/\\/g, '/');
    for (const id of [...FORBIDDEN_IDENTIFIERS, ...FICTIONAL_FIXTURE_NAMES]) {
      // Public discovery/editorial documents intentionally link to the
      // author's public GitHub repository. Keep the legacy fixture prefix ban
      // everywhere else, especially the authenticated application bundle.
      if (
        id === 'Aliferous3/' &&
        (rel === 'dist/llms.txt' || rel.startsWith('dist/blog/'))
      ) continue;
      assert.ok(!content.includes(id), `${rel} contains "${id}"`);
    }
    // server-side secret env names must never reach the client bundle —
    // the list is derived from security/secret-inventory.json, so a new
    // secret added to the inventory is guarded here automatically
    for (const secret of SERVER_ONLY_SECRETS) {
      assert.ok(!content.includes(secret), `${rel} leaks ${secret}`);
    }
    // high-confidence credential material — a bundle never legitimately
    // contains PEM blocks, GitHub PATs, or JWTs
    assert.doesNotMatch(content, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, `${rel} contains PEM private-key material`);
    assert.doesNotMatch(content, /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}/, `${rel} contains a GitHub token`);
    assert.doesNotMatch(content, /github_pat_[A-Za-z0-9_]{20,}/, `${rel} contains a fine-grained GitHub PAT`);
    assert.doesNotMatch(content, /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/, `${rel} contains a JWT`);
  }
});

test('production build aliases the fixture barrel to the inert stub', () => {
  const vite = src('vite.config.ts');
  assert.match(vite, /command === "build"/);
  assert.match(vite, /fixtures\/stub\.ts/);
  // the stub itself must not import any real fixture module
  const stub = src('src/fixtures/stub.ts');
  assert.doesNotMatch(stub, /from '\.\/(ledgerData|metricsData|field|code|activity)'/);
});

test('fixture rendering is dev-gated — prod failure resolves to empty store', () => {
  const live = bare('src/store/live.ts');
  assert.match(live, /import\.meta\.env\.DEV/);
  assert.match(live, /FIXTURES_ENABLED \? fixtureStore\('1Y'\) : emptyStore/);
  assert.match(live, /: emptyStore\(period, syncNow, pumpingState/);
  // the prod empty store is permanently resolving (skeletons), no telemetry
  assert.match(live, /function emptyStore\(/);
  assert.match(live, /resolving: true/);
});

test('fixture modules live only under src/fixtures/ and never self-import prod data', () => {
  // old fixture module paths are gone
  assert.ok(!existsSync(path.join(ROOT, 'src/ledgerData.ts')), 'src/ledgerData.ts moved to fixtures/')
  assert.ok(!existsSync(path.join(ROOT, 'src/store/metricsData.ts')), 'src/store/metricsData.ts moved to fixtures/')
  // no non-fixture source file may import the fixture modules directly
  for (const f of allSourceFiles()) {
    const rel = path.relative(ROOT, f).replace(/\\/g, '/');
    if (rel.startsWith('src/fixtures/')) continue;
    const content = readFileSync(f, 'utf8');
    for (const m of ['ledgerData', 'metricsData', 'fixtures/field', 'fixtures/code', 'fixtures/activity']) {
      assert.doesNotMatch(content, new RegExp(`from '[^']*${m}`), `${rel} imports fixture module ${m}`);
    }
  }
  // only live.ts may import the barrel
  for (const f of allSourceFiles()) {
    const rel = path.relative(ROOT, f).replace(/\\/g, '/');
    if (rel === 'src/store/live.ts') continue;
    if (rel.startsWith('src/fixtures/')) continue;
    const content = readFileSync(f, 'utf8');
    assert.doesNotMatch(content, /from '\.\.\/fixtures'|from '\.\/fixtures'/, `${rel} imports the fixture barrel`);
  }
});

/* ── WS5: CSP — production script-src must not allow inline JS ── */

test('production CSP has no script-src unsafe-inline', () => {
  const vercel = src('vercel.json');
  const csp = vercel.match(/Content-Security-Policy[\s\S]*?"value": "([^"]+)"/)?.[1];
  assert.ok(csp, 'CSP header missing from vercel.json');
  const scriptSrc = csp.split(';').find((d) => d.trim().startsWith('script-src'));
  assert.ok(scriptSrc, 'script-src directive missing');
  assert.doesNotMatch(scriptSrc, /unsafe-inline/);
  assert.doesNotMatch(scriptSrc, /unsafe-eval/);
  // other invariants preserved
  for (const d of ["object-src 'none'", "base-uri 'self'", "frame-ancestors 'none'", "connect-src 'self'"]) {
    assert.ok(csp.includes(d), `CSP missing ${d}`);
  }
});

test('production CSP style-src is allowlist-strict — no inline styles', async () => {
  const vercel = src('vercel.json');
  const csp = vercel.match(/Content-Security-Policy[\s\S]*?"value": "([^"]+)"/)?.[1];
  assert.ok(csp, 'CSP header missing from vercel.json');
  const dir = (name) => csp.split(';').map((d) => d.trim())
    .find((d) => d === name || d.startsWith(name + ' '));

  // style-src itself: 'self' only — no inline styles anywhere
  const styleSrc = dir('style-src');
  assert.equal(styleSrc, "style-src 'self'", `style-src weakened: ${styleSrc}`);
  // level-3 split: elements come from 'self' plus the single sha256 pin for
  // number-flow's static shadow-root stylesheet (the library's documented
  // CSP path — content is a baked constant, hashed here); attributes never
  assert.equal(
    dir('style-src-elem'),
    "style-src-elem 'self' 'sha256-HR6/MuuYfB8aijiNP5MPm3YOR8WqVmL7UkE3Q8OslTs='",
  );
  assert.equal(dir('style-src-attr'), "style-src-attr 'none'");
  assert.equal(dir('script-src-attr'), "script-src-attr 'none'");
  // no weakening crept in anywhere (img-src data: is intentional — avatars)
  for (const bad of ["'unsafe-inline'", "'unsafe-eval'", "'unsafe-hashes'"]) {
    assert.ok(!csp.includes(bad), `CSP contains ${bad}`);
  }
  assert.doesNotMatch(`${dir('style-src')} ${dir('style-src-elem')}`, /data:|unsafe|\*/);

  // the pinned hash must match the stylesheet the installed number-flow
  // build actually injects — a version bump that changes it fails here
  // instead of silently breaking animations in production
  const { buildStyles } = await import('number-flow/csp');
  const { createHash } = await import('node:crypto');
  const injected = cryptoHashSha256(buildStyles()[2]);
  function cryptoHashSha256(s) { return 'sha256-' + createHash('sha256').update(s).digest('base64'); }
  assert.ok(
    dir('style-src-elem').includes(`'${injected}'`),
    `CSP style-src-elem pin drifted — number-flow now injects ${injected}`,
  );
  // structural invariants
  for (const d of ["default-src 'self'", "object-src 'none'", "base-uri 'self'",
    "frame-ancestors 'none'", "form-action 'self'", "connect-src 'self'",
    'upgrade-insecure-requests']) {
    assert.ok(csp.includes(d), `CSP missing ${d}`);
  }
});

test('no runtime style-injection vectors exist in source', () => {
  for (const f of allSourceFiles()) {
    const content = readFileSync(f, 'utf8');
    const rel = path.relative(ROOT, f).replace(/\\/g, '/');
    assert.doesNotMatch(content, /<style[\s>]/, `${rel} renders a <style> element`);
    assert.doesNotMatch(content, /createElement\(['"]style['"]\)/, `${rel} creates a <style> element`);
    assert.doesNotMatch(content, /\.insertRule\(|adoptedStyleSheets/, `${rel} mutates a stylesheet at runtime`);
    assert.doesNotMatch(content, /setAttribute\(['"]style['"]\)/, `${rel} sets a style attribute`);
    assert.doesNotMatch(content, /\.cssText\s*=/, `${rel} assigns cssText`);
    assert.doesNotMatch(content, /style=["'`]/, `${rel} uses a string style attribute`);
  }
});

test('production dist/index.html has no inline styles or external CSS origins', () => {
  const files = distFilesOrSkip();
  if (!files) return;
  const html = readFileSync(files.find((f) => f.endsWith('index.html')), 'utf8');
  assert.doesNotMatch(html, /<style[\s>]/, 'index.html contains an inline <style>');
  assert.doesNotMatch(html, /\sstyle=["']/, 'index.html contains a style attribute');
  const links = [...html.matchAll(/<link[^>]*rel="stylesheet"[^>]*>/g)].map((m) => m[0]);
  assert.ok(links.length >= 1, 'expected an external stylesheet link');
  for (const l of links) {
    const href = l.match(/href="([^"]+)"/)?.[1];
    assert.match(href, /^\/assets\//, `stylesheet not self-hosted: ${href}`);
  }
});

test('production build emits external hashed JS (no single-file inlining)', () => {
  const vite = src('vite.config.ts');
  assert.doesNotMatch(vite, /viteSingleFile/);
  const files = distFilesOrSkip();
  if (!files) return;
  const html = files.find((f) => f.endsWith('index.html'));
  const htmlText = readFileSync(html, 'utf8');
  assert.doesNotMatch(htmlText, /<script(?![^>]*\bsrc=)[^>]*>[^<\s]/, 'index.html contains an inline script block');
});

/* ── WS9: self-hosted fonts — no Google Fonts in source, artifact, or CSP ── */

test('no Google Fonts references in source or CSP', () => {
  const forbidden = ['fonts.googleapis.com', 'fonts.gstatic.com'];
  for (const f of [path.join(ROOT, 'index.html'), ...allSourceFiles(), path.join(ROOT, 'vercel.json')]) {
    const content = readFileSync(f, 'utf8');
    for (const host of forbidden) {
      assert.ok(!content.includes(host), `${path.relative(ROOT, f)} references ${host}`);
    }
  }
  // fonts are actually bundled via fontsource imports
  const main = src('src/main.tsx');
  assert.match(main, /@fontsource/);
});

test('built production artifact does not contact Google Fonts', () => {
  const files = distFilesOrSkip();
  if (!files) return;
  for (const f of files) {
    const content = readFileSync(f, 'utf8');
    const rel = path.relative(ROOT, f).replace(/\\/g, '/');
    for (const host of ['fonts.googleapis.com', 'fonts.gstatic.com']) {
      assert.ok(!content.includes(host), `${rel} references ${host}`);
    }
  }
});


/* ── WS11: data minimization — do not persist human-authored GitHub text ── */

test('sync does not request or persist commit headlines / PR titles', () => {
  const sync = src('lib/sync.mjs');
  assert.doesNotMatch(sync, /messageHeadline/);
  assert.doesNotMatch(sync, /\bmessage:\s*\(node\./);
  assert.doesNotMatch(sync, /\btitle:\s*\(item\./);
});

test('008 migration drops unused commit message and PR title columns', () => {
  const sql = src('migrations/008_data_minimization.sql');
  assert.match(sql, /alter table public\.commits\s+drop column if exists message/i);
  assert.match(sql, /alter table public\.pull_requests\s+drop column if exists title/i);
});


/* ── Runtime hygiene: bypass Vercel's legacy req.query parser ── */

test('API handlers do not access req.query (DEP0169 workaround)', () => {
  const apiRoot = path.join(ROOT, 'api');
  const files = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(mjs|js)$/.test(e.name)) files.push(p);
    }
  };
  walk(apiRoot);
  for (const f of files) {
    const content = readFileSync(f, 'utf8');
    assert.doesNotMatch(
      content,
      /\breq\.query\b/,
      `${path.relative(ROOT, f)} accesses Vercel req.query and can trigger DEP0169`,
    );
  }
});

test('request query helper uses WHATWG URL parsing', () => {
  const helper = src('lib/request-query.mjs');
  assert.match(helper, /new URL\(/);
  assert.doesNotMatch(helper, /from ['"](?:node:)?url['"]/);
  assert.doesNotMatch(helper, /url\.parse|parseURL/);
});
