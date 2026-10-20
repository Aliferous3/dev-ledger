/* Desktop API transport — a narrow fetch shim installed before the app
   boots. Inside the Tauri webview:

   - /api/* and /rly/* requests are rewritten to the hosted origin and
     executed through tauri-plugin-http (Rust reqwest). That keeps ALL API
     traffic out of the webview's CORS regime — the server needs ZERO CORS
     headers and its browser-only posture is unchanged.
   - Every API call carries `Authorization: Bearer <token>` plus the
     configured `Origin` header — the same-origin CSRF guard keeps passing
     unchanged and nothing ambient is ever sent (no cookies).
   - Everything else (bundled assets, tauri:// URLs) goes to native fetch.

   The shim is the ONLY desktop-aware part of the data path: every
   existing call site keeps using relative URLs and unchanged fetch(). */

import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { API_BASE } from './runtime';
import { currentToken } from './keys';

function toHeaderEntries(h: HeadersInit | undefined): [string, string][] {
  if (!h) return [];
  if (h instanceof Headers) return [...h.entries()];
  if (Array.isArray(h)) return h.map(([k, v]) => [String(k), String(v)]);
  return Object.entries(h).map(([k, v]) => [String(k), String(v)]);
}

export function isApiPath(url: string): boolean {
  return url.startsWith('/api/') || url.startsWith('/rly/');
}

export function installTransport(): void {
  const nativeFetch = window.fetch.bind(window);

  window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!isApiPath(url)) {
      return nativeFetch(input, init);
    }

    const headers: Record<string, string> = {};
    for (const [k, v] of toHeaderEntries(init?.headers)) {
      // Callers may never inject a credential — the bearer header is
      // owned by this shim alone.
      if (k.toLowerCase() !== 'authorization') headers[k] = v;
    }
    headers['Origin'] = API_BASE;
    const token = currentToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const target = `${API_BASE}${url}`;
    // plugin-http runs in Rust (reqwest): no cookies, no ambient ambient
    // credentials — the bearer header above is the entire auth context.
    return tauriFetch(target, {
      method: init?.method ?? 'GET',
      headers,
      body: init?.body as never,
    });
  };
}
