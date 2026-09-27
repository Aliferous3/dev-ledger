/* Product analytics facade — the typed, React/app-facing half of the
   PostHog integration. All validation and scrubbing logic lives in
   posthogModel.mjs so it can be unit-tested directly; this module only
   owns the lazy SDK lifecycle and the typed capture entry point.

   Contract (enforced by the model + this file):
   - exact event/property allowlist only — arbitrary payloads are dropped;
   - the SDK's identify() API is never called — events stay un-identified;
   - every automatic collector is disabled via POSTHOG_INIT_OPTIONS;
   - all traffic goes to the same-origin /rly proxy — never a posthog host;
   - no configured token (or any failure) → silent no-op, never throws. */

import type { CaptureResult, PostHogConfig } from 'posthog-js';
import {
  DENIED_EVENT_PROPERTIES,
  POSTHOG_INIT_OPTIONS,
  resolveAnalyticsHost,
  scrubEventProperties,
  validateAnalyticsEvent,
} from './posthogModel.mjs';

export {
  ANALYTICS_RANGES,
  DENIED_EVENT_PROPERTIES,
  EVENT_PROPERTIES,
  FEEDBACK_EVENT_TYPES,
  POSTHOG_INIT_OPTIONS,
  PROXY_PATH,
  SYNC_FAIL_REASONS,
  SYNC_TRIGGERS,
  mapSyncFailReason,
  resolveAnalyticsHost,
  scrubEventProperties,
  syncFailReasonFromHttp,
  validateAnalyticsEvent,
} from './posthogModel.mjs';

export type SyncTrigger = 'manual' | 'automatic';
export type SyncFailReason = 'network' | 'rate_limited' | 'revoked' | 'server' | 'unknown';
export type AnalyticsRange = '7D' | '30D' | '90D' | 'YTD' | '1Y' | 'ALL' | 'CUSTOM';
export type FeedbackEventType = 'BUG' | 'FEATURE' | 'FEEDBACK';

// The exact emit-table — mirrors EVENT_PROPERTIES in posthogModel.mjs;
// the model is the runtime guard, this union is the compile-time one.
export type AnalyticsEventName =
  | 'sync_started'
  | 'sync_completed'
  | 'sync_failed'
  | 'range_changed'
  | 'share_opened'
  | 'share_downloaded'
  | 'feedback_submitted'
  | 'delete_data_completed';

export interface AnalyticsEventProps {
  sync_started: { trigger: SyncTrigger };
  sync_completed: { trigger: SyncTrigger };
  sync_failed: { trigger: SyncTrigger; reason: SyncFailReason };
  range_changed: { range: AnalyticsRange };
  share_opened: { range: AnalyticsRange };
  share_downloaded: { range: AnalyticsRange };
  feedback_submitted: { type: FeedbackEventType };
  delete_data_completed: Record<string, never>;
}

type PostHogClient = {
  init: (token: string, options: Record<string, unknown>) => void;
  capture: (
    event: string,
    properties?: Record<string, unknown>,
    options?: Record<string, unknown>,
  ) => unknown;
};

let client: PostHogClient | null = null;
let initStarted = false;

// Initializes the SDK once, in the browser only, and only when a public
// project token is configured. posthog-js is imported lazily so it stays
// out of the critical bundle and never loads in tests. Never throws —
// analytics must never break the app. main.tsx calls this once at boot.
export async function initAnalytics(): Promise<void> {
  if (initStarted || typeof window === 'undefined') return;
  initStarted = true;
  const token = import.meta.env.VITE_POSTHOG_PROJECT_TOKEN;
  if (!token) return;
  try {
    const { default: posthog } = await import('posthog-js');
    const apiHost = resolveAnalyticsHost(
      import.meta.env.VITE_POSTHOG_HOST,
      window.location.origin,
    );
    posthog.init(token, {
      api_host: apiHost,
      // The literal union values are plain strings in the .mjs model;
      // the cast narrows them to the SDK's option unions.
      ...(POSTHOG_INIT_OPTIONS as Partial<PostHogConfig>),
      property_denylist: [...DENIED_EVENT_PROPERTIES],
      before_send: (event: CaptureResult | null) => {
        if (!event || !event.properties || typeof event.event !== 'string') return event;
        event.properties = scrubEventProperties(event.event, event.properties);
        return event;
      },
    });
    client = posthog as unknown as PostHogClient;
  } catch {
    client = null;
  }
}

// The only sanctioned way to emit an event. Validation runs before
// capture; an invalid name or property bag is dropped silently. options
// lets a caller request an immediate/beacon-friendly send for a
// pre-teardown event (delete_data_completed before navigation).
export function captureEvent<E extends AnalyticsEventName>(
  name: E,
  props: AnalyticsEventProps[E],
  options?: { send_instantly?: boolean },
): void {
  const clean = validateAnalyticsEvent(name, props as Record<string, unknown>);
  if (!clean || !client) return;
  try {
    client.capture(name, clean, options);
  } catch {
    /* analytics is best-effort — never surface to the app */
  }
}
