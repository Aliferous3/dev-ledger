/* Google Analytics 4 acquisition-analytics facade — the typed, app-facing
   half of the GA4 integration. All validation/sanitization lives in
   ga4Model.mjs so it can be unit-tested directly; this module only owns the
   gtag.js lifecycle and the typed capture entry points.

   Contract (enforced by the model + this file):
   - page_view, login_start, login and select_content only — nothing else;
   - send_page_view stays false: every page_view is manual and sanitized
     (origin + normalized pathname — never location.href, never query/hash);
   - the only query data ever read is the five utm_* campaign fields;
   - official telemetry is emitted only on devledger.site (localhost runs in
     debug mode); a fork on another hostname emits nothing;
   - no measurement ID, blocked gtag.js, or any failure → silent no-op;
   - no User-ID, no identify-equivalent, no Google Signals/ads features. */

import {
  ga4CampaignFields,
  ga4PagePath,
  ga4PageViewParams,
  isGA4DebugHost,
  isGA4ProductionHost,
  isValidMeasurementId,
  validateGA4Event,
} from './ga4Model.mjs';

export {
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
} from './ga4Model.mjs';

export type GA4EventName = 'login_start' | 'login' | 'select_content';

export interface GA4EventProps {
  login_start: { method: 'github' };
  login: { method: 'github' };
  select_content: { content_type: 'product_cta'; item_id: string };
}

type Gtag = (...args: unknown[]) => void;

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: Gtag;
  }
}

const GTAG_SCRIPT_ORIGIN = 'https://www.googletagmanager.com';

let initStarted = false;
let enabled = false;
let lastPagePath: string | null = null;

function measurementId(): string | null {
  const id = import.meta.env.VITE_GA_MEASUREMENT_ID;
  return isValidMeasurementId(id) ? id : null;
}

function gtag(): Gtag | null {
  return typeof window !== 'undefined' && typeof window.gtag === 'function'
    ? window.gtag
    : null;
}

// Initializes gtag.js once: defines dataLayer/gtag (events queue safely even
// before the script arrives), configures the stream with automatic
// page_view measurement OFF, then injects the async tag. Never throws —
// analytics must never break the app. main.tsx calls this once at boot.
export function initGoogleAnalytics(): void {
  if (initStarted || typeof window === 'undefined') return;
  initStarted = true;
  const id = measurementId();
  const host = window.location.host;
  if (!id || (!isGA4ProductionHost(host) && !isGA4DebugHost(host))) return;
  try {
    window.dataLayer = window.dataLayer || [];
    window.gtag = function gtagShim(...args: unknown[]) {
      window.dataLayer!.push(args);
    };
    window.gtag('js', new Date());
    window.gtag('config', id, {
      send_page_view: false,
      debug_mode: isGA4DebugHost(host),
      // Ads/identity features stay off — acquisition reporting only.
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
    });
    const script = document.createElement('script');
    script.async = true;
    script.src = `${GTAG_SCRIPT_ORIGIN}/gtag/js?id=${encodeURIComponent(id)}`;
    document.head.appendChild(script);
    enabled = true;
  } catch {
    enabled = false;
  }
}

// The only sanctioned way to emit a GA4 event. Validation runs first; an
// invalid name or property bag is dropped silently.
export function captureGoogleEvent<E extends GA4EventName>(
  name: E,
  props: GA4EventProps[E],
): void {
  const clean = validateGA4Event(name, props as Record<string, unknown>);
  const fn = gtag();
  if (!clean || !enabled || !fn) return;
  try {
    fn('event', name, clean);
  } catch {
    /* analytics is best-effort — never surface to the app */
  }
}

// Manual sanitized page_view — the caller never supplies URL data. The
// pathname is normalized (trailing slashes collapse, query/hash discarded)
// and deduped so StrictMode remounts and hash/query-only history entries
// cannot double-count. Recognized utm_* fields are lifted into GA4's
// documented campaign_* dimensions via gtag('set'); page_location itself
// stays clean.
export function captureGooglePageview(): void {
  const fn = gtag();
  if (!enabled || !fn || typeof window === 'undefined') return;
  const pathname = ga4PagePath(window.location.pathname);
  if (pathname === lastPagePath) return;
  lastPagePath = pathname;
  try {
    const campaign = ga4CampaignFields(window.location.search);
    if (campaign) fn('set', campaign);
    fn('event', 'page_view', ga4PageViewParams(window.location, document.title));
  } catch {
    /* analytics is best-effort — never surface to the app */
  }
}
