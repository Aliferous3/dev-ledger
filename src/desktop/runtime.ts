/* Desktop runtime detection + the hosted API origin.
   The desktop build bundles the SAME frontend — runtime detection (the
   injected __TAURI_INTERNALS__ bridge), never a separate code path
   selected at build time, so the bundle behaves identically in a browser
   and only activates desktop plumbing inside the Tauri webview. */

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

export function isDesktop(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

// The hosted deployment remains the canonical backend. The desktop app
// never embeds API credentials — it talks to the public origin with a
// per-user bearer token it obtained through the OAuth handoff.
// VITE_DESKTOP_API_BASE exists for desktop development against `vercel dev`
// (e.g. http://localhost:3000); production builds leave it unset.
export const API_BASE: string = (
  import.meta.env.VITE_DESKTOP_API_BASE || 'https://devledger.site'
).replace(/\/+$/, '');

// Custom URI scheme the installers register (see lib/desktop-auth.mjs,
// src-tauri/tauri.conf.json and distribution/flatpak). Keep aligned —
// a mismatch silently breaks the login handoff.
export const DESKTOP_SCHEME = 'dev-ledger';
