/* Product analytics model — the pure, testable core of the PostHog
   integration. The typed facade lives in posthog.ts.

   Hard rules enforced here, in one place:

   1. Only the event names in EVENT_PROPERTIES may be emitted, and each may
      carry ONLY the properties its schema lists — arbitrary names and
      arbitrary property bags fail validation and are never sent.
   2. No GitHub-derived or user-entered data may ever appear in a payload:
      no repo/owner names, SHAs, commit messages, PR titles, login, email,
      avatar, GitHub or installation IDs, error strings, feedback text,
      screenshots, or URL query contents.
   3. Analytics is un-identified: the SDK's identify() API is never called and
      persistence is memory-only, so no analytics cookie or durable id is
      stored by this integration.
   4. Every automatic collector stays OFF (see POSTHOG_INIT_OPTIONS) and all
      traffic goes to the first-party reverse proxy at PROXY_PATH — the
      browser never contacts a posthog host directly, so the strict
      `connect-src 'self'` CSP is sufficient.
   5. With no project token configured, or in tests, the client is never
      created and every call is a silent no-op. */

// ── The exact event/property allowlist ─────────────────────────────────────

export const SYNC_TRIGGERS = ['manual', 'automatic'];

export const SYNC_FAIL_REASONS = [
  'network',
  'rate_limited',
  'revoked',
  'server',
  'unknown',
];

export const ANALYTICS_RANGES = [
  '7D',
  '30D',
  '90D',
  'YTD',
  '1Y',
  'ALL',
  'CUSTOM',
];

export const FEEDBACK_EVENT_TYPES = ['BUG', 'FEATURE', 'FEEDBACK'];

// event name -> property name -> allowed values. {} means no properties.
export const EVENT_PROPERTIES = {
  sync_started: { trigger: SYNC_TRIGGERS },
  sync_completed: { trigger: SYNC_TRIGGERS },
  sync_failed: { trigger: SYNC_TRIGGERS, reason: SYNC_FAIL_REASONS },
  range_changed: { range: ANALYTICS_RANGES },
  share_opened: { range: ANALYTICS_RANGES },
  share_downloaded: { range: ANALYTICS_RANGES },
  feedback_submitted: { type: FEEDBACK_EVENT_TYPES },
  delete_data_completed: {},
  github_login_started: {},
  github_login_succeeded: {},
};

// ── Validation ─────────────────────────────────────────────────────────────

// Returns the event's sanitized property object, or null when the event or
// any property is outside the allowlist. Exact key-set match: missing and
// extra keys both fail. All allowed values are string enums — anything else
// (objects, numbers, raw strings) is rejected.
export function validateAnalyticsEvent(name, props) {
  const schema = EVENT_PROPERTIES[name];
  if (!schema || !props || typeof props !== 'object') return null;
  const allowed = Object.keys(schema);
  const keys = Object.keys(props);
  if (keys.length !== allowed.length || !keys.every((k) => allowed.includes(k))) {
    return null;
  }
  const clean = {};
  for (const [key, values] of Object.entries(schema)) {
    const value = props[key];
    if (typeof value !== 'string' || !values.includes(value)) return null;
    clean[key] = value;
  }
  return clean;
}

// Map a terminal sync status to the fixed failure category. Raw backend
// detail never crosses this boundary.
export function mapSyncFailReason(status) {
  if (status === 'rate_limited') return 'rate_limited';
  if (status === 'revoked') return 'revoked';
  if (status === 'error') return 'server';
  return 'unknown';
}

// Map a failed /api/sync HTTP response to the fixed failure category. A
// thrown fetch (no response) is handled by the caller as 'network'.
export function syncFailReasonFromHttp(status) {
  if (status === 429) return 'rate_limited';
  if (status === 401 || status === 403) return 'revoked';
  if (typeof status === 'number' && status >= 500) return 'server';
  return 'unknown';
}

// ── First-party host resolution ────────────────────────────────────────────

// Same-origin reverse-proxied ingestion path — intentionally not named
// after analytics/tracking (see vercel.json rewrites).
export const PROXY_PATH = '/rly';

// The SDK may only ever send to this origin. A configured host is honored
// only when it is a root-relative path or an absolute URL on the app's own
// origin; anything else falls back to the proxy path so a misconfigured
// external URL can never receive event traffic.
export function resolveAnalyticsHost(configured, origin) {
  if (!configured) return PROXY_PATH;
  const trimmed = String(configured).trim().replace(/\/+$/, '');
  if (trimmed.startsWith('/')) return trimmed || PROXY_PATH;
  try {
    const url = new URL(trimmed);
    if (url.origin === origin) return url.pathname.replace(/\/+$/, '') || PROXY_PATH;
  } catch {
    /* not a URL — fall through */
  }
  return PROXY_PATH;
}

// ── Property scrubbing ─────────────────────────────────────────────────────

// SDK-assembled properties derived from URLs, query strings, referrers and
// click/campaign ids — none of these may leave the browser. Applied by
// property_denylist at capture assembly AND re-checked in before_send.
export const DENIED_EVENT_PROPERTIES = [
  '$current_url',
  '$pathname',
  '$host',
  '$prev_pageview_pathname',
  '$external_click_url',
  '$referrer',
  '$referring_domain',
  '$search_engine',
  '$session_entry_url',
  '$session_entry_pathname',
  '$session_entry_host',
  '$session_entry_referrer',
  '$session_entry_referring_domain',
  '$initial_current_url',
  '$initial_pathname',
  '$initial_host',
  '$initial_referrer',
  '$initial_referring_domain',
  '$initial_campaign_params',
  '$initial_referrer_info',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'campaign_params',
  'gclid',
  'fbclid',
  'msclkid',
  'ttclid',
  'twclid',
  'igshid',
  'li_fat_id',
  'mc_cid',
  'dclid',
  'wbraid',
  'gbraid',
];

// posthog-js places these two transport-critical fields inside the event's
// properties object before before_send runs. They are not caller-controlled:
// token is the public project token already present in the browser bundle,
// while distinct_id is the SDK's anonymous identifier. Removing either can
// make an otherwise valid event impossible to ingest.
export const REQUIRED_SDK_EVENT_PROPERTIES = ['token', 'distinct_id'];

// before_send: remove every URL/query/campaign-derived property and any
// non-$ key outside the emitting event's own schema, while preserving the
// transport-critical SDK fields above. This keeps the privacy allowlist
// narrow without corrupting the event envelope that PostHog must ingest.
export function scrubEventProperties(eventName, properties) {
  const schema = EVENT_PROPERTIES[eventName];
  const allowedCustom = schema ? new Set(Object.keys(schema)) : new Set();
  const requiredSdk = new Set(REQUIRED_SDK_EVENT_PROPERTIES);
  const clean = {};
  for (const [key, value] of Object.entries(properties || {})) {
    if (DENIED_EVENT_PROPERTIES.includes(key)) continue;
    if (!key.startsWith('$') && !allowedCustom.has(key) && !requiredSdk.has(key)) continue;
    clean[key] = value;
  }
  return clean;
}
// ── SDK initialization options ─────────────────────────────────────────────

// Every automatic collector explicitly OFF — custom allowlisted events only.
// Property names are the exact posthog-js option names for the installed
// SDK; tests assert this object stays complete.
export const POSTHOG_INIT_OPTIONS = {
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
