import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* Security #23 — the public Security & Privacy trust record makes factual
   claims about the product. These tests guard the UNDERLYING facts (schema,
   routing, token handling, function count) so the page can't drift from the
   implementation it describes. */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const PAGE = 'src/security/SecurityPrivacyPage.tsx';

// ── Routing: /security is public, /privacy canonicalizes ────────────────────

test('vercel.json serves /security and redirects /privacy → /security', () => {
  const v = JSON.parse(src('vercel.json'));
  assert.ok(
    v.rewrites?.some((r) => r.source === '/security' && r.destination === '/index.html'),
    '/security must rewrite to index.html for direct loads',
  );
  assert.ok(
    v.redirects?.some((r) => r.source === '/privacy' && r.destination === '/security' && r.permanent === true),
    '/privacy must permanently redirect to /security',
  );
});

test('authenticated PAGES registry stays exactly three destinations', () => {
  const pages = src('src/pages.ts');
  const ids = [...pages.matchAll(/id:\s*'([a-z]+)'/g)].map((m) => m[1]);
  assert.deepEqual(ids, ['overview', 'activity', 'code']);
  assert.ok(!/id:\s*'security'/.test(pages), 'security must not join PAGES');
});

test('public route layer renders /security without the auth gate', () => {
  const main = src('src/main.tsx');
  assert.match(main, /import\s*\{\s*SecurityPrivacyPage\s*\}/);
  // The public layer must handle the path itself (before Gate auth work).
  assert.match(main, /p === ['"]\/security['"]/, '/security must be matched in the public layer');
  assert.match(main, /p === ['"]\/privacy['"]/, '/privacy must be canonicalized in the public layer');
});

// ── The page itself: static, no API dependency, no secrets, no overclaims ───

test('security page is static and requires no dashboard/API data', () => {
  const page = src(PAGE);
  assert.ok(!page.includes('fetch('), 'page must not call the API');
  assert.ok(!page.includes('store/live'), 'page must not import the dashboard store');
  // No live API references in code — the header comment may name /api/user.
  const code = page.split('\n').filter((l) => !l.trim().startsWith('//') && !l.startsWith('/*')).join('\n');
  assert.ok(!/['"]\/api\//.test(code), 'page code must not reference API routes');
});

test('security page contains no secrets or infrastructure identifiers', () => {
  const page = src(PAGE);
  const forbidden = [
    'SESSION_SECRET', 'SERVICE_ROLE', 'DATABASE_URL', 'SUPABASE_DB_PASSWORD',
    'GITHUB_APP_PRIVATE_KEY', 'GITHUB_CLIENT_SECRET', 'GITHUB_WEBHOOK_SECRET',
    'CRON_SECRET', 'SECURITY_EVENT_HASH_KEY', 'PGPASSWORD',
    'supabase.co', 'vercel.app',
  ];
  for (const needle of forbidden) {
    assert.ok(!page.includes(needle), `page must not contain ${needle}`);
  }
});

test('security page makes no unsupported certification or absolute claims', () => {
  const page = src(PAGE);
  const overclaims = [
    /SOC[\s-]?2/i, /ISO[\s-]?27001/i, /\bGDPR\b/i, /\bCCPA\b/i, /\bHIPAA\b/i,
    /PCI[\s-]?DSS/i, /zero[\s-]?knowledge/i, /military[\s-]?grade/i,
    /bank[\s-]?grade/i, /fully[\s-]?secure/i, /end[\s-]?to[\s-]?end[\s-]?encrypted/i,
    /encrypted[\s-]?at[\s-]?rest/i, /impossible[\s-]?to[\s-]?breach/i,
    /\banonymous\b/i, /\bcertified\b/i, /\baudited\b/i, /\bunhackable\b/i,
  ];
  for (const re of overclaims) {
    assert.ok(!re.test(page), `page must not contain overclaim ${re}`);
  }
});

// ── Discoverability links ───────────────────────────────────────────────────

test('login screen and authenticated footer link to /security', () => {
  assert.ok(src('src/ledger/LoginScreen.tsx').includes('href="/security"'),
    'login screen must link to /security');
  assert.ok(src('src/App.tsx').includes('href="/security"'),
    'authenticated footer must link to /security');
});

// ── No new function: Vercel Hobby budget stays at exactly 12 ────────────────

test('function count stays exactly 12 — no api route for the page', () => {
  const apiDir = path.join(ROOT, 'api');
  const fns = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.mjs')) fns.push(p);
    }
  })(apiDir);
  assert.equal(fns.length, 12);
  assert.ok(!fs.existsSync(path.join(apiDir, 'security.mjs')), 'no api/security endpoint');
  assert.ok(!fs.existsSync(path.join(apiDir, 'privacy.mjs')), 'no api/privacy endpoint');
});

// ── Data minimization: the "does not store" claims are structurally true ────

test('commits.message and pull_requests.title stay dropped by migrations', () => {
  const m8 = src('migrations/008_data_minimization.sql');
  assert.match(m8, /alter table public\.commits[\s\S]*?drop column if exists message/i);
  assert.match(m8, /alter table public\.pull_requests[\s\S]*?drop column if exists title/i);
  // No later migration may re-add them.
  const m9 = src('migrations/009_security_events.sql');
  assert.ok(!/commits[^;]*add column[^;]*message/i.test(m9));
  assert.ok(!/pull_requests[^;]*add column[^;]*title/i.test(m9));
});

test('users table has no email column across all migrations', () => {
  const dir = path.join(ROOT, 'migrations');
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.sql'))) {
    const sql = src(`migrations/${f}`);
    assert.ok(!/\bemail\b/i.test(sql), `${f} must not reference an email column`);
  }
});

test('sync writes no commit message or PR title fields', () => {
  const sync = src('lib/sync.mjs');
  assert.ok(!/[{,\s]message\s*:/.test(sync), 'sync must not write a message field');
  assert.ok(!/[{,\s]title\s*:/.test(sync), 'sync must not write a title field');
});

test('webhook persists delivery id + event only — no payload storage', () => {
  const wh = src('api/webhooks/github.mjs');
  assert.match(wh, /insert\(\{\s*delivery_id:\s*String\(deliveryId\),\s*event:/);
  assert.ok(!/webhook_deliveries[\s\S]{0,400}insert[\s\S]{0,200}payload/.test(wh),
    'webhook dedup insert must not store the payload');
});

// ── Tokens are transient ────────────────────────────────────────────────────

test('OAuth access token is used transiently, never persisted', () => {
  const cb = src('api/auth/callback.mjs');
  const lines = cb.split('\n').filter((l) => l.includes('access_token'));
  // The token may only appear in the exchange endpoint URL, the response
  // check, and the Octokit binding — never inside a db insert/upsert payload.
  for (const l of lines) {
    assert.match(l, /tokenData|getUserOctokit|oauth\/access_token/, `unexpected access_token use: ${l.trim()}`);
  }
  assert.ok(!/(insert|upsert)\s*\([^)]*access_token/.test(cb),
    'access_token must not be written to the database');
});

test('installation tokens are minted on demand, never persisted', () => {
  const gh = src('lib/github.mjs');
  assert.match(gh, /type:\s*'installation'/);
  assert.ok(!/supabase|\.from\(|insert|upsert/i.test(gh),
    'token-minting module must not touch the database');
});

// ── Session claims ──────────────────────────────────────────────────────────

test('session model claims hold: HttpOnly, SameSite=Lax, lease, 30d persistent', () => {
  const cfg = src('lib/config.mjs');
  assert.match(cfg, /sameSite:\s*'lax'/);
  assert.match(cfg, /httpOnly:\s*true/);
  assert.match(cfg, /persistentTtl\s*=\s*60 \* 60 \* 24 \* 30/);
  assert.match(cfg, /SESSION_LEASE_MINUTES/);
});

// ── CSP stays strict — the page adds no weakening ───────────────────────────

test('CSP unchanged by this tranche: no unsafe-inline, no new origins', () => {
  const v = JSON.parse(src('vercel.json'));
  const csp = v.headers.flatMap((h) => h.headers).find((h) => h.key === 'Content-Security-Policy')?.value || '';
  assert.ok(!csp.includes("'unsafe-inline'"));
  assert.ok(!csp.includes("'unsafe-eval'"));
  // No external style/script origins — only 'self' and the pinned hash.
  const styleSrc = csp.split(';').find((d) => d.trim().startsWith('style-src ')) || '';
  assert.ok(!/https?:/.test(styleSrc), 'style-src must not gain external origins');
});
