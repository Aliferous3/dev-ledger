/* Desktop credential storage — the bearer token lives in the OS keychain
   (Windows Credential Manager, macOS Keychain, Secret Service on Linux)
   via Rust commands, never in localStorage, cookies, or files.

   Persistence follows the "keep me signed in" checkbox captured at login:

   - Checked (persistent: true) — the token is written to the OS keychain
     and restored on the next launch.
   - Unchecked (persistent: false) — the token lives in memory only for
     the running app session and the OS keychain entry is deleted, so no
     stale credential can resurrect on restart. The user signs in again
     next launch.

   If the keychain is unavailable (headless Linux without a secrets
   daemon, sandboxed dev shell) a persistent login degrades to the same
   memory-only behavior as an unchecked login — nothing falls back to
   persistent JS storage. */

import { invoke } from '@tauri-apps/api/core';

const TOKEN_KEY = 'desktop-token';

let memoryToken: string | null = null;
let warned = false;

function warnOnce(err: unknown) {
  if (warned) return;
  warned = true;
  console.warn(
    'desktop: OS keychain unavailable — token kept in memory for this session only',
    err instanceof Error ? err.message : err,
  );
}

// persistent=true → OS keychain (+ memory cache for the synchronous
// transport). persistent=false → memory only, and any previously stored
// keychain credential is removed so a past "remembered" login cannot
// leak into an unchecked session.
export async function storeToken(token: string, opts: { persistent?: boolean } = {}): Promise<void> {
  memoryToken = token;
  const persistent = opts.persistent !== false;
  try {
    if (persistent) {
      await invoke('keyring_set', { key: TOKEN_KEY, value: token });
    } else {
      await invoke('keyring_delete', { key: TOKEN_KEY });
    }
  } catch (err) {
    warnOnce(err);
  }
}

export async function loadToken(): Promise<string | null> {
  try {
    const t = await invoke<string | null>('keyring_get', { key: TOKEN_KEY });
    if (typeof t === 'string' && t) {
      memoryToken = t;
      return t;
    }
  } catch (err) {
    warnOnce(err);
  }
  return memoryToken;
}

export async function clearToken(): Promise<void> {
  memoryToken = null;
  try {
    await invoke('keyring_delete', { key: TOKEN_KEY });
  } catch (err) {
    warnOnce(err);
  }
}

// The transport shim reads synchronously on every request — the async
// keychain load resolves once at init and caches here.
export function currentToken(): string | null {
  return memoryToken;
}
