import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
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

test('built production artifact contains zero fixture identifiers', () => {
  const dist = path.join(ROOT, 'dist', 'index.html');
  if (!existsSync(dist)) {
    // build hasn't run in this environment — the scan is enforced by CI
    // and by `npm run build` + test locally; skip rather than fake a pass.
    return;
  }
  const html = readFileSync(dist, 'utf8');
  for (const id of [...FORBIDDEN_IDENTIFIERS, ...FICTIONAL_FIXTURE_NAMES]) {
    assert.ok(!html.includes(id), `dist/index.html contains "${id}"`);
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
  assert.match(live, /: emptyStore\(period, syncNow, pumpingState\)/);
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
