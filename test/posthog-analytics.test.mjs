import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ANALYTICS_RANGES,
  DENIED_EVENT_PROPERTIES,
  PAGEVIEW_PROPERTIES,
  isPublicAnalyticsHost,
  sanitizePathname,
  sanitizeReferringDomain,
  sanitizedPageviewProps,
  EVENT_PROPERTIES,
  FEEDBACK_EVENT_TYPES,
  POSTHOG_INIT_OPTIONS,
  PROXY_PATH,
  REQUIRED_SDK_EVENT_PROPERTIES,
  SYNC_FAIL_REASONS,
  SYNC_TRIGGERS,
  mapSyncFailReason,
  resolveAnalyticsHost,
  scrubEventProperties,
  syncFailReasonFromHttp,
  validateAnalyticsEvent,
} from '../src/analytics/posthogModel.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

function allSourceFiles(dir = path.join(ROOT, 'src'), acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) allSourceFiles(p, acc);
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(e.name)) acc.push(p);
  }
  return acc;
}

/* ── 1. The event-name allowlist is exact ── */

test('the analytics event allowlist is exactly the specified event set', () => {
  assert.deepEqual(SYNC_TRIGGERS, ['manual', 'automatic']);
  assert.deepEqual(SYNC_FAIL_REASONS, ['network', 'rate_limited', 'revoked', 'server', 'unknown']);
  assert.deepEqual(FEEDBACK_EVENT_TYPES, ['BUG', 'FEATURE', 'FEEDBACK']);
  assert.deepEqual(Object.keys(EVENT_PROPERTIES).sort(), [
    'delete_data_completed',
    'feedback_submitted',
    'github_login_started',
    'github_login_succeeded',
    'range_changed',
    'share_downloaded',
    'share_opened',
    'sync_completed',
    'sync_failed',
    'sync_started',
  ]);
});

test('login events carry no properties at all', () => {
  for (const name of ['github_login_started', 'github_login_succeeded']) {
    assert.deepEqual(validateAnalyticsEvent(name, {}), {});
    assert.equal(validateAnalyticsEvent(name, { surface: 'blog' }), null);
    assert.equal(validateAnalyticsEvent(name, { origin_slug: 'none' }), null);
    assert.equal(validateAnalyticsEvent(name, { referrer: 'x' }), null);
  }
});

test('arbitrary event names cannot be emitted', () => {
  for (const name of [
    'pageview',
    'sync_start',
    'login',
    '$identify',
    'custom_event',
    'SYNC_STARTED',
    '',
    'delete_data',
  ]) {
    assert.equal(validateAnalyticsEvent(name, {}), null, `${name} must not validate`);
  }
});

/* ── 2. Each event accepts only its allowed properties ── */

test('sync events accept only trigger enum values', () => {
  for (const name of ['sync_started', 'sync_completed']) {
    assert.deepEqual(validateAnalyticsEvent(name, { trigger: 'manual' }), { trigger: 'manual' });
    assert.deepEqual(validateAnalyticsEvent(name, { trigger: 'automatic' }), { trigger: 'automatic' });
    assert.equal(validateAnalyticsEvent(name, { trigger: 'cron' }), null);
    assert.equal(validateAnalyticsEvent(name, {}), null);
    assert.equal(validateAnalyticsEvent(name, { trigger: 'manual', repo: 'x' }), null);
  }
});

test('sync_failed requires the reason enum — arbitrary reasons rejected', () => {
  assert.deepEqual(
    validateAnalyticsEvent('sync_failed', { trigger: 'manual', reason: 'network' }),
    { trigger: 'manual', reason: 'network' },
  );
  assert.equal(
    validateAnalyticsEvent('sync_failed', { trigger: 'manual' }),
    null,
    'missing reason must fail',
  );
  assert.equal(
    validateAnalyticsEvent('sync_failed', { trigger: 'manual', reason: 'ETIMEDOUT' }),
    null,
    'raw error strings must not pass',
  );
  assert.equal(
    validateAnalyticsEvent('sync_failed', { trigger: 'manual', reason: 'server', error: 'boom' }),
    null,
    'extra keys must fail',
  );
});

test('range/share events accept only the range enum', () => {
  for (const name of ['range_changed', 'share_opened', 'share_downloaded']) {
    for (const range of ANALYTICS_RANGES) {
      assert.deepEqual(validateAnalyticsEvent(name, { range }), { range });
    }
    assert.equal(validateAnalyticsEvent(name, { range: '6M' }), null);
    assert.equal(validateAnalyticsEvent(name, { range: '90D', from: '2026-01-01' }), null);
  }
});

test('feedback_submitted carries type only — no text/screenshot/context keys', () => {
  for (const type of FEEDBACK_EVENT_TYPES) {
    assert.deepEqual(validateAnalyticsEvent('feedback_submitted', { type }), { type });
  }
  for (const bad of [
    { type: 'BUG', title: 'x' },
    { type: 'BUG', description: 'x' },
    { type: 'BUG', screenshot: 'AAAA' },
    { type: 'BUG', page: 'OVERVIEW' },
    { type: 'BUG', range: '90D' },
    { type: 'BUG', build: 'V1.3.0' },
    { type: 'BUG', username: 'u' },
    { type: 'IDEA' },
  ]) {
    assert.equal(validateAnalyticsEvent('feedback_submitted', bad), null, JSON.stringify(bad));
  }
});

test('delete_data_completed carries no properties at all', () => {
  assert.deepEqual(validateAnalyticsEvent('delete_data_completed', {}), {});
  assert.equal(validateAnalyticsEvent('delete_data_completed', { user: 'x' }), null);
});

/* ── 3. No GitHub/content/identity field can exist in any schema ── */

test('no schema property name can carry identifying or content data', () => {
  const forbidden = [
    /repo/i, /owner/i, /sha/i, /commit/i, /message/i, /source/i, /code/i,
    /pull/i, /title/i, /login/i, /user/i, /name/i, /email/i, /avatar/i,
    /github/i, /install/i, /error/i, /text/i, /screenshot/i, /url/i,
    /query/i, /date/i, /from/i, /to/i, /start/i, /end/i, /desc/i, /page/i,
    /build/i, /context/i,
  ];
  for (const [event, schema] of Object.entries(EVENT_PROPERTIES)) {
    for (const key of Object.keys(schema)) {
      for (const re of forbidden) {
        assert.ok(!re.test(key), `${event}.${key} matches forbidden pattern ${re}`);
      }
    }
  }
});

test('CUSTOM range emits no dates — schema has only the range key', () => {
  assert.deepEqual(Object.keys(EVENT_PROPERTIES.range_changed), ['range']);
  const clean = validateAnalyticsEvent('range_changed', { range: 'CUSTOM' });
  assert.deepEqual(clean, { range: 'CUSTOM' });
  assert.ok(!('start' in clean) && !('end' in clean) && !('from' in clean));
});

/* ── 4. Failure categorization ── */

test('sync statuses map into the fixed reason enum', () => {
  assert.equal(mapSyncFailReason('rate_limited'), 'rate_limited');
  assert.equal(mapSyncFailReason('revoked'), 'revoked');
  assert.equal(mapSyncFailReason('error'), 'server');
  assert.equal(mapSyncFailReason('syncing'), 'unknown');
  assert.equal(mapSyncFailReason('complete'), 'unknown');
  assert.equal(mapSyncFailReason(undefined), 'unknown');
  assert.equal(mapSyncFailReason('ECONNRESET: some raw detail'), 'unknown');
  for (const s of ['rate_limited', 'revoked', 'error', 'anything-else']) {
    assert.ok(SYNC_FAIL_REASONS.includes(mapSyncFailReason(s)));
  }
});

test('HTTP failures map into the fixed reason enum', () => {
  assert.equal(syncFailReasonFromHttp(429), 'rate_limited');
  assert.equal(syncFailReasonFromHttp(401), 'revoked');
  assert.equal(syncFailReasonFromHttp(403), 'revoked');
  assert.equal(syncFailReasonFromHttp(500), 'server');
  assert.equal(syncFailReasonFromHttp(502), 'server');
  assert.equal(syncFailReasonFromHttp(400), 'unknown');
  assert.equal(syncFailReasonFromHttp(undefined), 'unknown');
});

/* ── 5. First-party host resolution ── */

test('analytics host is always same-origin — external URLs are refused', () => {
  assert.equal(resolveAnalyticsHost(undefined, 'https://app.example'), PROXY_PATH);
  assert.equal(resolveAnalyticsHost('/rly', 'https://app.example'), '/rly');
  assert.equal(resolveAnalyticsHost('/rly/', 'https://app.example'), '/rly');
  assert.equal(
    resolveAnalyticsHost('https://app.example/rly', 'https://app.example'),
    '/rly',
    'same-origin absolute URL resolves to its path',
  );
  assert.equal(
    resolveAnalyticsHost('https://eu.i.posthog.com', 'https://app.example'),
    PROXY_PATH,
    'a direct posthog host must be refused',
  );
  assert.equal(
    resolveAnalyticsHost('https://evil.example/x', 'https://app.example'),
    PROXY_PATH,
    'any external origin must be refused',
  );
  assert.equal(PROXY_PATH, '/rly');
});

/* ── 6. Property scrubbing ── */

test('before_send strips private extras but preserves SDK ingestion fields', () => {
  assert.deepEqual(REQUIRED_SDK_EVENT_PROPERTIES, ['token', 'distinct_id']);
  const dirty = {
    trigger: 'manual',
    token: 'phc_public_project_token',
    distinct_id: 'anonymous-sdk-id',
    $current_url: 'https://app.example/?secret=1',
    $pathname: '/',
    $referrer: 'https://ref.example/?q=2',
    utm_source: 'newsletter',
    gclid: 'abc',
    // SDK-derived session-entry/initial campaign variants — generated as
    // $session_entry_${param}, including for query params we never listed.
    $session_entry_utm_source: 'DO_NOT_SEND',
    $session_entry_utm_campaign: 'SECRET',
    $session_entry_gclid: 'click-id',
    $initial_utm_medium: 'cpc',
    $initial_fbclid: 'fb-click',
    $session_entry_custom_param: 'unlisted variant',
    $browser: 'Chrome',
    stray_key: 'must be dropped',
  };
  const clean = scrubEventProperties('sync_started', dirty);
  for (const key of DENIED_EVENT_PROPERTIES) {
    assert.ok(!(key in clean), `${key} survived scrubbing`);
  }
  assert.equal(clean.$session_entry_utm_source, undefined, 'session-entry UTM leaked');
  assert.equal(clean.$session_entry_utm_campaign, undefined, 'session-entry campaign leaked');
  assert.equal(clean.$session_entry_gclid, undefined, 'session-entry click id leaked');
  assert.equal(clean.$initial_utm_medium, undefined, 'initial UTM leaked');
  assert.equal(clean.$initial_fbclid, undefined, 'initial click id leaked');
  assert.equal(clean.$session_entry_custom_param, undefined, 'unlisted session-entry variant leaked');
  assert.equal(clean.stray_key, undefined, 'non-schema custom key survived');
  assert.equal(clean.trigger, 'manual');
  assert.equal(clean.token, 'phc_public_project_token', 'SDK project token was stripped');
  assert.equal(clean.distinct_id, 'anonymous-sdk-id', 'SDK anonymous distinct id was stripped');
  assert.equal(clean.$browser, 'Chrome', 'neutral SDK props stay');
});

/* ── 7. Init options keep every automatic collector off ── */

test('PostHog init explicitly disables all automatic collection', () => {
  const expected = {
    autocapture: false,
    rageclick: false,
    capture_pageview: false,
    capture_pageleave: false,
    disable_session_recording: true,
    disable_surveys: true,
    enable_heatmaps: false,
    capture_dead_clicks: false,
    capture_performance: false,
    capture_exceptions: false,
    person_profiles: 'never',
    persistence: 'memory',
    advanced_disable_flags: true,
  };
  assert.deepEqual(POSTHOG_INIT_OPTIONS, expected);
});

test('init wires api_host, property_denylist and before_send from the model', () => {
  const facade = src('src/analytics/posthog.ts');
  assert.match(facade, /api_host: apiHost/);
  assert.match(facade, /property_denylist: \[\.\.\.DENIED_EVENT_PROPERTIES\]/);
  assert.match(facade, /before_send:/);
  assert.match(facade, /scrubEventProperties\([\s\S]*?event\.event[\s\S]*?event\.properties/);
  assert.match(facade, /\.\.\.\s*\(?\s*POSTHOG_INIT_OPTIONS/);
  assert.match(facade, /import\.meta\.env\.VITE_POSTHOG_PROJECT_TOKEN/);
});

/* ── 8. No identity calls anywhere in production source ── */

test('posthog.identify() does not exist anywhere in src/', () => {
  for (const f of allSourceFiles()) {
    const content = readFileSync(f, 'utf8');
    const rel = path.relative(ROOT, f).replace(/\\/g, '/');
    assert.doesNotMatch(
      content,
      /\.identify\s*\(|identify\s*\(\s*['"`]/,
      `${rel} contains an identify call`,
    );
  }
});

/* ── 9. Callers only use the typed wrapper ── */

test('event wiring emits only through captureEvent at the right transitions', () => {
  const live = src('src/store/live.ts');
  assert.match(live, /captureEvent\('sync_started'/);
  assert.match(live, /captureEvent\('sync_completed'/);
  assert.match(live, /captureEvent\('sync_failed'/);
  assert.doesNotMatch(live, /captureEvent\('sync_failed'[^)]*err/i, 'no raw error forwarded');
  const app = src('src/App.tsx');
  assert.match(app, /captureEvent\('range_changed'/);
  assert.match(app, /captureEvent\('share_opened'/);
  const share = src('src/share/ShareModal.tsx');
  assert.match(share, /captureEvent\('share_downloaded'/);
  const fb = src('src/feedback/FeedbackDrawer.tsx');
  assert.match(fb, /captureEvent\('feedback_submitted', \{ type: type as FeedbackEventType \}\)/);
  assert.doesNotMatch(
    fb,
    /captureEvent\('feedback_submitted'[^)]*(title|description|screenshot|page|build)/i,
    'feedback analytics must not carry text/screenshot/context',
  );
  const menu = src('src/components/AccountMenu.tsx');
  assert.match(menu, /captureEvent\('delete_data_completed', \{\}/);
  // Login funnel: the button emits login_started and sets the one-shot
  // pending flag; the post-OAuth boot emits login_succeeded once. No auth
  // logic is altered — read-only flags.
  const shared = src('src/ledger/shared.tsx');
  assert.match(shared, /captureEvent\('github_login_started', \{\}\)/);
  assert.match(shared, /markLoginPending\(\)/);
  const gate = src('src/main.tsx');
  assert.match(gate, /consumeLoginPending\(\)/);
  assert.match(gate, /captureEvent\("github_login_succeeded", \{\}\)/);
  // The sessionStorage bridge may only ever carry the literal '1' flag.
  const funnel = src('src/analytics/loginFunnel.ts');
  assert.doesNotMatch(funnel, /localStorage|document\.cookie|fetch\(/);
});

/* ── 10. CSP stays strict; proxy is same-origin ── */

test('CSP is unchanged: no posthog origin, connect-src stays self', () => {
  const v = JSON.parse(src('vercel.json'));
  const csp = v.headers.flatMap((h) => h.headers).find((h) => h.key === 'Content-Security-Policy')?.value || '';
  assert.ok(csp.includes("connect-src 'self'"), 'connect-src must stay same-origin only');
  assert.ok(csp.includes("script-src 'self'"), 'script-src must stay same-origin only');
  assert.ok(!/posthog/i.test(csp), 'CSP must not name a posthog origin');
  assert.ok(!csp.includes("'unsafe-inline'") && !csp.includes("'unsafe-eval'"));
  assert.ok(!/\*\./.test(csp), 'no wildcard origins');
});

test('the analytics proxy is same-origin and preserves PostHog ingest trailing slashes', () => {
  const v = JSON.parse(src('vercel.json'));
  const exactE = v.rewrites.find((r) => r.source === '/rly/e/');
  const exactV0 = v.rewrites.find((r) => r.source === '/rly/i/v0/e/');
  const fallback = v.rewrites.find((r) => r.source === '/rly/:path*');
  assert.deepEqual(exactE, {
    source: '/rly/e/',
    destination: 'https://eu.i.posthog.com/e/',
  });
  assert.deepEqual(exactV0, {
    source: '/rly/i/v0/e/',
    destination: 'https://eu.i.posthog.com/i/v0/e/',
  });
  assert.deepEqual(fallback, {
    source: '/rly/:path*',
    destination: 'https://eu.i.posthog.com/:path*',
  });
  // The proxy path must not carry obvious tracker naming.
  assert.ok(!/analytics|tracking|telemetry|posthog/i.test(PROXY_PATH));
});

/* ── 11. Facade stays a facade — no SDK capture calls outside the wrapper ── */

test('no file imports posthog-js directly except the wrapper', () => {
  for (const f of allSourceFiles()) {
    const rel = path.relative(ROOT, f).replace(/\\/g, '/');
    const content = readFileSync(f, 'utf8');
    if (rel === 'src/analytics/posthog.ts') {
      assert.match(content, /import\('posthog-js'\)/, 'wrapper must lazy-import posthog-js');
      continue;
    }
    assert.doesNotMatch(
      content,
      /import\s*\(?\s*['"]posthog-js['"]/,
      `${rel} must not import posthog-js directly`,
    );
    assert.doesNotMatch(content, /posthog\.capture\s*\(/, `${rel} must not call posthog.capture`);
  }
});

test('captureEvent validates before sending and never throws without a client', () => {
  const facade = src('src/analytics/posthog.ts');
  assert.match(facade, /validateAnalyticsEvent\(name, props/);
  assert.match(facade, /if \(!clean \|\| !client\) return/);
  // init once-guard + browser guard + token guard
  assert.match(facade, /if \(initStarted \|\| typeof window === 'undefined'\) return/);
  assert.match(facade, /if \(!token\) return/);
  // no session recording or replay code paths in our source
  assert.doesNotMatch(facade, /sessionRecording|startSessionRecording/i);
});

/* ── Sanitized manual $pageview ── */

test('$pageview is not a caller-emittable custom event', () => {
  assert.ok(!('$pageview' in EVENT_PROPERTIES), '$pageview must not join the custom allowlist');
  assert.equal(validateAnalyticsEvent('$pageview', {}), null);
  assert.equal(validateAnalyticsEvent('$pageview', { $current_url: 'x' }), null);
  const facade = src('src/analytics/posthog.ts');
  assert.match(facade, /client\.capture\('\$pageview'\)/, 'pageview emits with zero caller properties');
  assert.match(facade, /export function capturePageview\(\)/, 'dedicated pageview entry point');
});

test('sanitizePathname strips query, fragment and trailing slashes', () => {
  assert.equal(sanitizePathname('/blog/foo'), '/blog/foo');
  assert.equal(sanitizePathname('/blog/foo/'), '/blog/foo');
  assert.equal(sanitizePathname('/blog/'), '/blog');
  assert.equal(sanitizePathname('/'), '/');
  assert.equal(sanitizePathname('/overview'), '/overview');
  // pathname input never carries ?/# — but hostile input is refused anyway
  assert.equal(sanitizePathname('/blog/foo?token=SECRET'), '/');
  assert.equal(sanitizePathname('/x#frag'), '/');
  assert.equal(sanitizePathname('/bad path'), '/');
  assert.equal(sanitizePathname('/%2e%2e/'), '/');
  assert.equal(sanitizePathname('https://evil.example/x'), '/');
  assert.equal(sanitizePathname(''), '/');
  assert.equal(sanitizePathname(undefined), '/');
});

test('sanitizedPageviewProps produces the exact allowed shape', () => {
  const loc = {
    origin: 'https://devledger.site',
    host: 'devledger.site',
    pathname: '/blog/what-is-code-churn',
  };
  assert.deepEqual(sanitizedPageviewProps(loc, ''), {
    $current_url: 'https://devledger.site/blog/what-is-code-churn',
    $pathname: '/blog/what-is-code-churn',
    $host: 'devledger.site',
    $referring_domain: '',
  });
  // A hostile referrer reduces to a bare domain, never a URL.
  const withRef = sanitizedPageviewProps(loc, 'https://google.com/a/path?user=x&campaign=y');
  assert.equal(withRef.$referring_domain, 'google.com');
  const keys = Object.keys(withRef).sort();
  assert.deepEqual(keys, [...PAGEVIEW_PROPERTIES].sort());
});

test('referrer never leaks path/query — self-referral yields empty domain', () => {
  assert.equal(sanitizeReferringDomain('https://github.com/Aliferous3/dev-ledger', 'devledger.site'), 'github.com');
  assert.equal(sanitizeReferringDomain('https://devledger.site/blog', 'devledger.site'), '');
  assert.equal(sanitizeReferringDomain('not a url', 'devledger.site'), '');
  assert.equal(sanitizeReferringDomain('', 'devledger.site'), '');
});

test('internal origins never emit pageviews', () => {
  assert.equal(isPublicAnalyticsHost('devledger.site'), true);
  assert.equal(isPublicAnalyticsHost('dev-ledger-site.vercel.app'), false);
  assert.equal(isPublicAnalyticsHost('dev-ledger-abc123.vercel.app'), false);
  assert.equal(isPublicAnalyticsHost('localhost:4173'), true);
  assert.equal(isPublicAnalyticsHost('localhost'), true);
  assert.equal(isPublicAnalyticsHost('127.0.0.1:5173'), true);
});

test('before_send $pageview path re-attaches only sanitized props after denylist', () => {
  // Simulates the pipeline: denylist already removed the SDK's raw fields;
  // before_send merges caller leftovers through the scrubber and attaches
  // the recomputed sanitized set.
  const dirty = {
    token: 'phc_x',
    distinct_id: 'anon',
    $session_id: 's',
    stray: 'dropped',
  };
  const clean = scrubEventProperties('$pageview', dirty, {
    $current_url: 'https://devledger.site/security',
    $pathname: '/security',
    $host: 'devledger.site',
    $referring_domain: 'google.com',
  });
  assert.deepEqual(clean, {
    token: 'phc_x',
    distinct_id: 'anon',
    $session_id: 's',
    $current_url: 'https://devledger.site/security',
    $pathname: '/security',
    $host: 'devledger.site',
    $referring_domain: 'google.com',
  });
});

test('facade dedupes pageviews and gates on the public host', () => {
  const facade = src('src/analytics/posthog.ts');
  assert.match(facade, /lastPageviewPath/);
  assert.match(facade, /pathname === lastPageviewPath/);
  assert.match(facade, /isPublicAnalyticsHost\(window\.location\.host\)/);
  assert.match(facade, /sanitizedPageviewProps\(window\.location, document\.referrer\)/);
  assert.doesNotMatch(facade, /location\.href/, 'never reads location.href');
});

test('pageview wiring: boot emit once, route changes and popstate covered', () => {
  const main = src('src/main.tsx');
  assert.match(main, /initAnalytics\(\)\.then\(\(\) => capturePageview\(\)\)/);
  const pages = src('src/pages.ts');
  // navigate + popstate each emit — dedup in capturePageview collapses
  // same-path repeats (StrictMode, hash/range-only history entries).
  assert.match(pages, /capturePageview\(\)/);
  assert.ok((pages.match(/capturePageview\(\)/g) || []).length >= 2);
});

test('the built artifact would not contact posthog hosts directly', () => {
  // No posthog host literal anywhere in src/ — the only allowed reference
  // is the proxy destination in vercel.json.
  for (const f of allSourceFiles()) {
    const rel = path.relative(ROOT, f).replace(/\\/g, '/');
    const content = readFileSync(f, 'utf8');
    assert.ok(
      !/posthog\.com/i.test(content),
      `${rel} references a posthog host — browser traffic must stay same-origin`,
    );
  }
  assert.ok(existsSync(path.join(ROOT, 'vercel.json')));
});
