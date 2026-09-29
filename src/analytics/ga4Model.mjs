/* Google Analytics 4 acquisition-analytics model — the pure, testable core.
   The typed facade lives in ga4.ts.

   GA4 is the acquisition/marketing layer only (traffic sources, landing
   pages, campaigns, login funnel). Product behavior stays in PostHog; the
   two integrations are deliberately independent — this module shares the
   PostHog model's philosophy but none of its code.

   Hard rules enforced here, in one place:

   1. Only the event names in GA4_EVENT_PROPERTIES may be emitted, each with
      ONLY the properties its schema lists.
   2. page_view is never caller-constructed — the facade derives a sanitized
      page_location itself (origin + normalized pathname; query and fragment
      are always discarded).
   3. The only query parameters ever read are the five documented utm_*
      campaign fields, mapped to GA4's campaign_* dimensions after strict
      value sanitization. Arbitrary query params (token, code, state, ...)
      can never become event or campaign data.
   4. Official telemetry is emitted only on the canonical production host —
      a fork carrying a configured measurement ID to another hostname emits
      nothing. Localhost runs in GA4 debug mode only.
   5. No measurement ID configured → every entry point is a silent no-op. */

// ── Event allowlist ───────────────────────────────────────────────────────

// Keep GA4 tiny: page_view (manual) + the acquisition funnel
// (CTA → login start → login). Nothing from the PostHog product taxonomy.
export const GA4_EVENT_PROPERTIES = {
  // Google recommended `login` event — method only, never any identity.
  login: { method: ['github'] },
  // Funnel step: the GitHub OAuth button was activated.
  login_start: { method: ['github'] },
  // Google recommended `select_content` — used for the blog/product CTA.
  // item_id carries a slug-like identifier only (validated below).
  select_content: { content_type: ['product_cta'], item_id: null },
};

// Slug-shaped item identifiers (article slug, cta id). No free text.
const ITEM_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,99}$/;

// Returns the event's sanitized property object, or null when the event or
// any property is outside the allowlist. Exact key-set match.
export function validateGA4Event(name, props) {
  const schema = GA4_EVENT_PROPERTIES[name];
  if (!schema || !props || typeof props !== 'object') return null;
  const allowed = Object.keys(schema);
  const keys = Object.keys(props);
  if (keys.length !== allowed.length || !keys.every((k) => allowed.includes(k))) {
    return null;
  }
  const clean = {};
  for (const [key, spec] of Object.entries(schema)) {
    const value = props[key];
    if (typeof value !== 'string') return null;
    if (spec === null) {
      if (!ITEM_ID_PATTERN.test(value)) return null;
    } else if (!spec.includes(value)) {
      return null;
    }
    clean[key] = value;
  }
  return clean;
}

// ── Host gating ───────────────────────────────────────────────────────────

// Official GA4 telemetry exists only on the canonical public origin. Local
// dev hosts may initialize for QA but run with debug_mode so they never
// pollute production reports.
export function isGA4ProductionHost(host) {
  return host === 'devledger.site';
}

export function isGA4DebugHost(host) {
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host.startsWith('localhost:') ||
    host.startsWith('127.0.0.1:')
  );
}

// A measurement ID must look like one before it is ever used — guards a
// malformed or secret-bearing value from being injected into the tag URL.
export function isValidMeasurementId(id) {
  return typeof id === 'string' && /^G-[A-Z0-9]{4,20}$/.test(id);
}

// ── Sanitized page identity ───────────────────────────────────────────────

// Canonical page path: strips trailing slashes to the non-slash canonical
// form, rejects anything that is not a plain path (query/hash/encoding or
// exotic characters collapse to '/') — same canonical convention the
// PostHog integration uses, implemented independently.
export function ga4PagePath(pathname) {
  if (typeof pathname !== 'string' || !pathname.startsWith('/')) return '/';
  if (/[?#]/.test(pathname)) return '/';
  const clean = pathname.replace(/\/+$/, '') || '/';
  if (!/^\/[A-Za-z0-9\-._~/]*$/.test(clean)) return '/';
  return clean;
}

// page_location is rebuilt from origin + sanitized pathname — never
// location.href, so query strings and fragments cannot survive.
export function ga4PageLocation(locationLike) {
  const origin =
    typeof locationLike?.origin === 'string' ? locationLike.origin : '';
  return origin + ga4PagePath(locationLike?.pathname);
}

// Document titles are static editorial strings; sanitized defensively
// (control characters stripped, capped) before they may ride an event.
export function ga4PageTitle(title) {
  if (typeof title !== 'string') return '';
  return title.replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
}

// The complete manual page_view parameter set.
export function ga4PageViewParams(locationLike, title) {
  return {
    page_location: ga4PageLocation(locationLike),
    page_title: ga4PageTitle(title),
  };
}

// ── Campaign (UTM) extraction ─────────────────────────────────────────────

// The only recognized inbound parameters, mapped to GA4's documented
// campaign_* fields. Everything else in the query string is ignored.
export const GA4_UTM_TO_CAMPAIGN_FIELD = {
  utm_source: 'campaign_source',
  utm_medium: 'campaign_medium',
  utm_campaign: 'campaign_name',
  utm_term: 'campaign_term',
  utm_content: 'campaign_content',
};

// Conservative campaign value: slug-ish text only — letters, digits,
// underscore, hyphen, dot and space. Anything else (URL delimiters,
// markup, encodings, scheme-like values, control characters) is rejected.
export function sanitizeCampaignValue(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 100) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9_.\- ]*$/.test(trimmed)) return null;
  return trimmed;
}

// Parse the five utm_* parameters out of a query string into GA4 campaign
// fields. Returns null when nothing valid is present. Unrelated params
// (token, code, state, ...) are never touched.
export function ga4CampaignFields(search) {
  if (typeof search !== 'string' || !search.startsWith('?')) return null;
  let params;
  try {
    params = new URLSearchParams(search);
  } catch {
    return null;
  }
  const fields = {};
  for (const [utm, field] of Object.entries(GA4_UTM_TO_CAMPAIGN_FIELD)) {
    const value = sanitizeCampaignValue(params.get(utm));
    if (value) fields[field] = value;
  }
  return Object.keys(fields).length ? fields : null;
}
