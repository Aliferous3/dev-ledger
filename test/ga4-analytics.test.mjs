import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  GA4_EVENT_PROPERTIES,
  GA4_UTM_TO_CAMPAIGN_FIELD,
  ga4CampaignFields,
  ga4PageLocation,
  ga4PagePath,
  ga4PageTitle,
  ga4PageViewParams,
  isGA4DebugHost,
  isGA4ProductionHost,
  isValidMeasurementId,
  sanitizeCampaignValue,
  validateGA4Event,
} from '../src/analytics/ga4Model.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
// Comments legitimately mention forbidden identifiers — negative assertions
// run against code only.
const codeOnly = (rel) =>
  src(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

function allSourceFiles(dir = path.join(ROOT, 'src'), acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) allSourceFiles(p, acc);
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(e.name)) acc.push(p);
  }
  return acc;
}

/* ── 1. Measurement ID is env-configured, never hard-coded ── */

test('no real GA4 measurement ID is hard-coded anywhere in the repo', () => {
  // G-XXXXXXXXXX pattern — docs examples are fine, a real ID is not.
  const scan = (dir) =>
    allSourceFiles(dir).concat(
      ['index.html', 'security.html', 'privacy.html', 'terms.html', 'vercel.json',
        'package.json', '.env.example', 'README.md']
        .map((f) => path.join(ROOT, f))
        .filter(existsSync),
    );
  for (const f of scan(path.join(ROOT, 'src'))) {
    const rel = path.relative(ROOT, f);
    const content = readFileSync(f, 'utf8');
    for (const m of content.matchAll(/\bG-[A-Z0-9]{6,}\b/g)) {
      assert.fail(`${rel} hard-codes a GA4 measurement ID (${m[0]}) — use VITE_GA_MEASUREMENT_ID`);
    }
  }
});

test('measurement ID format is validated before use', () => {
  // synthetic valid IDs only — the real ID must never enter this repo
  assert.equal(isValidMeasurementId('G-EXAMPLE01'), true);
  assert.equal(isValidMeasurementId('G-ABC12345'), true);
  assert.equal(isValidMeasurementId(''), false);
  assert.equal(isValidMeasurementId(undefined), false);
  assert.equal(isValidMeasurementId('UA-12345-1'), false);
  assert.equal(isValidMeasurementId('g-lower'), false);
  assert.equal(isValidMeasurementId('SECRET_KEY=abc'), false);
  assert.equal(isValidMeasurementId('G-TOO;rm -rf'), false);
});

test('facade reads the measurement ID only from VITE_GA_MEASUREMENT_ID', () => {
  const facade = src('src/analytics/ga4.ts');
  assert.match(facade, /import\.meta\.env\.VITE_GA_MEASUREMENT_ID/);
  assert.doesNotMatch(facade, /G-[A-Z0-9]{6,}/, 'facade must not embed a real ID');
});

/* ── 2. Host gating — official telemetry only on the canonical origin ── */

test('GA4 emits only on devledger.site; localhost is debug-only', () => {
  assert.equal(isGA4ProductionHost('devledger.site'), true);
  assert.equal(isGA4ProductionHost('www.devledger.site'), false);
  assert.equal(isGA4ProductionHost('dev-ledger.vercel.app'), false);
  assert.equal(isGA4ProductionHost('dev-ledger-site.vercel.app'), false);
  assert.equal(isGA4ProductionHost('fork-example.com'), false);
  assert.equal(isGA4ProductionHost('localhost:5173'), false);
  assert.equal(isGA4DebugHost('localhost:5173'), true);
  assert.equal(isGA4DebugHost('127.0.0.1:4173'), true);
});

test('facade refuses to initialize without an ID or off the canonical host', () => {
  const facade = src('src/analytics/ga4.ts');
  assert.match(facade, /initStarted/, 'single-initialization guard missing');
  assert.match(facade, /isGA4ProductionHost\(host\) && !isGA4DebugHost\(host\)/, 'host gate missing');
  assert.match(facade, /isGA4ProductionHost|isGA4DebugHost/);
});

/* ── 3. Initialization shape ── */

test('config disables automatic page_view and ads/identity features', () => {
  const facade = src('src/analytics/ga4.ts');
  assert.match(facade, /send_page_view:\s*false/, 'send_page_view must be false');
  assert.match(facade, /allow_google_signals:\s*false/);
  assert.match(facade, /allow_ad_personalization_signals:\s*false/);
  assert.match(facade, /debug_mode: isGA4DebugHost/, 'localhost must run debug_mode');
});

test('dataLayer shim pushes arguments — plain arrays are ignored by gtag.js', () => {
  // gtag.js's command interpreter only processes Arguments objects; a
  // (...args) => push(args) shim silently drops every command.
  const facade = codeOnly('src/analytics/ga4.ts');
  assert.match(facade, /push\(arguments\)/);
  assert.doesNotMatch(facade, /push\(args\)/);
});

test('gtag script loads async from googletagmanager.com only', () => {
  const facade = src('src/analytics/ga4.ts');
  assert.match(facade, /script\.async\s*=\s*true/);
  assert.match(facade, /googletagmanager\.com/);
  assert.match(facade, /\/gtag\/js\?id=/);
  assert.doesNotMatch(facade, /gtm\.js/, 'GTM must not be used');
});

/* ── 4. Page-view sanitization ── */

test('ga4PagePath normalizes to the canonical non-slash form', () => {
  assert.equal(ga4PagePath('/'), '/');
  assert.equal(ga4PagePath('/blog'), '/blog');
  assert.equal(ga4PagePath('/blog/'), '/blog');
  assert.equal(ga4PagePath('/blog/what-is-code-churn'), '/blog/what-is-code-churn');
  assert.equal(ga4PagePath('/blog/what-is-code-churn/'), '/blog/what-is-code-churn');
  assert.equal(ga4PagePath('/blog/what-is-code-churn///'), '/blog/what-is-code-churn');
  // hostile/malformed inputs degrade to '/'
  assert.equal(ga4PagePath('/blog/x?token=SECRET'), '/');
  assert.equal(ga4PagePath('/blog/x#private'), '/');
  assert.equal(ga4PagePath('/blog/%2e%2e'), '/');
  assert.equal(ga4PagePath('blog/foo'), '/');
  assert.equal(ga4PagePath(''), '/');
  assert.equal(ga4PagePath(null), '/');
});

test('page_location never carries query or fragment', () => {
  const loc = { origin: 'https://devledger.site', pathname: '/blog/foo' };
  assert.equal(ga4PageLocation(loc), 'https://devledger.site/blog/foo');
  // pathname containing query-like content is rejected before it can leak
  const dirty = { origin: 'https://devledger.site', pathname: '/blog/foo?token=SECRET#private' };
  assert.equal(ga4PageLocation(dirty), 'https://devledger.site/');
});

test('page_view params are exactly page_location + sanitized page_title', () => {
  const params = ga4PageViewParams(
    { origin: 'https://devledger.site', pathname: '/security' },
    'Security — Dev Ledger',
  );
  assert.deepEqual(Object.keys(params).sort(), ['page_location', 'page_title']);
  assert.equal(params.page_location, 'https://devledger.site/security');
  assert.equal(params.page_title, 'Security — Dev Ledger');
});

test('facade never passes window.location.href to GA4', () => {
  const facade = codeOnly('src/analytics/ga4.ts');
  assert.doesNotMatch(facade, /location\.href/);
});

test('pageview dedupe is pathname-based (StrictMode/hash/query safe)', () => {
  const facade = src('src/analytics/ga4.ts');
  assert.match(facade, /pathname === lastPagePath/, 'pathname dedupe missing');
});

/* ── 5. Event allowlist ── */

test('GA4 event set is exactly the acquisition funnel', () => {
  assert.deepEqual(Object.keys(GA4_EVENT_PROPERTIES).sort(), [
    'login',
    'login_start',
    'select_content',
  ]);
});

test('login events carry method:github only — never identity', () => {
  assert.deepEqual(validateGA4Event('login', { method: 'github' }), { method: 'github' });
  assert.deepEqual(validateGA4Event('login_start', { method: 'github' }), { method: 'github' });
  assert.equal(validateGA4Event('login', { method: 'github', user_id: 'x' }), null);
  assert.equal(validateGA4Event('login', { method: 'github', email: 'a@b.c' }), null);
  assert.equal(validateGA4Event('login', { method: 'google' }), null);
});

test('select_content carries schema-limited params only', () => {
  assert.deepEqual(
    validateGA4Event('select_content', { content_type: 'product_cta', item_id: 'what-is-code-churn' }),
    { content_type: 'product_cta', item_id: 'what-is-code-churn' },
  );
  assert.equal(validateGA4Event('select_content', { content_type: 'product_cta', item_id: 'x?y=1' }), null);
  assert.equal(validateGA4Event('select_content', { content_type: 'banner' }), null);
});

test('arbitrary event names and props are rejected', () => {
  assert.equal(validateGA4Event('sync_started', { trigger: 'manual' }), null);
  assert.equal(validateGA4Event('page_view', {}), null, 'page_view is facade-built only');
  assert.equal(validateGA4Event('anything', {}), null);
});

/* ── 6. UTM campaign extraction ── */

test('recognized utm_* fields map to campaign_* fields', () => {
  assert.deepEqual(Object.keys(GA4_UTM_TO_CAMPAIGN_FIELD).sort(), [
    'utm_campaign',
    'utm_content',
    'utm_medium',
    'utm_source',
    'utm_term',
  ]);
  const fields = ga4CampaignFields(
    '?utm_source=linkedin&utm_medium=social&utm_campaign=launch&utm_term=dev&utm_content=video',
  );
  assert.deepEqual(fields, {
    campaign_source: 'linkedin',
    campaign_medium: 'social',
    campaign_name: 'launch',
    campaign_term: 'dev',
    campaign_content: 'video',
  });
});

test('unrelated and sensitive query params never become campaign fields', () => {
  const fields = ga4CampaignFields('?token=DO_NOT_SEND&code=AUTH&state=OAUTH&utm_source=x');
  assert.deepEqual(fields, { campaign_source: 'x' });
  assert.equal(ga4CampaignFields('?token=DO_NOT_SEND&code=AUTH&state=OAUTH'), null);
  assert.equal(ga4CampaignFields(''), null);
  assert.equal(ga4CampaignFields('not-a-query'), null);
});

test('malformed/token-like campaign values are rejected', () => {
  assert.equal(sanitizeCampaignValue('linkedin'), 'linkedin');
  assert.equal(sanitizeCampaignValue('x'.repeat(101)), null);
  assert.equal(sanitizeCampaignValue('https://evil.example/x'), null);
  assert.equal(sanitizeCampaignValue('javascript:alert(1)'), null);
  assert.equal(sanitizeCampaignValue('a?b'), null);
  assert.equal(sanitizeCampaignValue('a#b'), null);
  assert.equal(sanitizeCampaignValue('a&b'), null);
  assert.equal(sanitizeCampaignValue('a=b'), null);
  assert.equal(sanitizeCampaignValue('a/b'), null);
  assert.equal(sanitizeCampaignValue('a%20b'), null);
  assert.equal(sanitizeCampaignValue('line\nbreak'), null);
  assert.equal(sanitizeCampaignValue(''), null);
  assert.equal(sanitizeCampaignValue(42), null);
  // encoded smuggling through the query string is neutralized by charset rules
  const fields = ga4CampaignFields('?utm_source=%22%3E%3Cscript%3E');
  assert.equal(fields, null);
});

test('facade applies campaign fields via gtag set, not page_location', () => {
  const facade = src('src/analytics/ga4.ts');
  assert.match(facade, /fn\('set', campaign\)/);
  // page_location is built by ga4PageViewParams only
  assert.match(facade, /ga4PageViewParams\(window\.location, document\.title\)/);
});

/* ── 7. Wiring ── */

test('GA4 wiring: boot init + pageview, popstate, navigate, login events', () => {
  const main = src('src/main.tsx');
  assert.match(main, /initGoogleAnalytics\(\)/);
  assert.match(main, /captureGooglePageview\(\)/);
  assert.match(main, /addEventListener\('popstate',[\s\S]*?captureGooglePageview/);
  assert.match(main, /captureGoogleEvent\("login", \{ method: "github" \}\)/);
  const pages = src('src/pages.ts');
  assert.ok((pages.match(/captureGooglePageview\(\)/g) || []).length >= 2,
    'navigate + popstate must each emit a GA4 pageview');
  const shared = src('src/ledger/shared.tsx');
  assert.match(shared, /captureGoogleEvent\('login_start', \{ method: 'github' \}\)/);
});

test('GA4 and PostHog are separate modules — no cross-import', () => {
  assert.doesNotMatch(codeOnly('src/analytics/ga4.ts'), /from ['"].*posthog/,
    'ga4 must not import PostHog code');
  assert.doesNotMatch(codeOnly('src/analytics/ga4Model.mjs'), /posthog/,
    'ga4Model must not reference PostHog');
  assert.doesNotMatch(codeOnly('src/analytics/posthog.ts'), /from ['"].*ga4/,
    'posthog must not import GA4 code');
});

test('no user_id/identify usage in GA4 code', () => {
  const facade = codeOnly('src/analytics/ga4.ts');
  assert.doesNotMatch(facade, /user_id/);
  assert.doesNotMatch(facade, /identify/);
});
