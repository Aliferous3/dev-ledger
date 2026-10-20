/* Desktop API transport — a narrow fetch shim installed before the app
   boots. Inside the Tauri webview:

   - /api/* requests are rewritten to the hosted origin and executed
     through tauri-plugin-http (Rust reqwest). That keeps ALL API
     traffic out of the webview's CORS regime — the server needs ZERO
     CORS headers and its browser-only posture is unchanged.
   - Every /api/* call carries `Authorization: Bearer <token>` plus the
     configured `Origin` header — the same-origin CSRF guard keeps
     passing unchanged and nothing ambient is ever sent (no cookies).
   - The desktop bearer is attached ONLY to /api/* requests. /rly/* —
     the hosted relay that Vercel rewrites to PostHog — external URLs,
     bundled assets and every other path go to plain window.fetch
     untouched. A Dev Ledger credential must never reach a third-party
     analytics destination, so /rly/* is not routed through this shim
     at all. Desktop analytics is disabled (see main.tsx): if any code
     path ever emits a /rly/* call on desktop it hits the bundled app
     origin unauthenticated and fails harmlessly — it can never carry
     the token.

   The shim is the ONLY desktop-aware part of the data path: every
   existing call site keeps using relative URLs and unchanged fetch(). */

import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { API_BASE } from './runtime.ts';
import { currentToken } from './keys.ts';

function toHeaderEntries(h: HeadersInit | undefined): [string, string][] {
  if (!h) return [];
  if (h instanceof Headers) return [...h.entries()];
  if (Array.isArray(h)) return h.map(([k, v]) => [String(k), String(v)]);
  return Object.entries(h).map(([k, v]) => [String(k), String(v)]);
}

// The ONLY path family that may ride the native transport and carry a
// desktop bearer. Never extend this to /rly/ (the PostHog analytics
// relay), external URLs, or any other route — the token is a Dev Ledger
// credential, not an ambient header. test/desktop-transport.test.mjs
// pins this boundary.
export function isApiPath(url: string): boolean {
  return url.startsWith('/api/');
}

// Headers for an /api/* request: hosted Origin for the CSRF guard plus
// the desktop bearer. Callers may never inject a credential — the
// bearer header is owned by this shim alone.
export function apiHeaders(init?: HeadersInit): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [k, v] of toHeaderEntries(init)) {
    if (k.toLowerCase() !== 'authorization') headers[k] = v;
  }
  headers['Origin'] = API_BASE;
  const token = currentToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

export function installTransport(): void {
  const nativeFetch = window.fetch.bind(window);

  window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    // Only /api/* rides the native transport + bearer. Every other
    // input — /rly/*, absolute external URLs, bundled assets — passes
    // to window.fetch verbatim: no headers added, no credential.
    if (!isApiPath(url)) {
      return nativeFetch(input, init);
    }

    const target = `${API_BASE}${url}`;
    // plugin-http runs in Rust (reqwest): no cookies, no ambient
    // credentials — apiHeaders() is the entire auth context.
    return tauriFetch(target, {
      method: init?.method ?? 'GET',
      headers: apiHeaders(init?.headers),
      body: init?.body as never,
    });
  };
}
