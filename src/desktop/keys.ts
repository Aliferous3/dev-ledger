/* Desktop credential storage — the bearer token lives in the OS keychain
   (Windows Credential Manager, macOS Keychain, Secret Service on Linux)
   via Rust commands, never in localStorage, cookies, or files.

   If the keychain is unavailable (headless Linux without a secrets
   daemon, sandboxed dev shell) the token degrades to an in-memory copy —
   the session works until the app exits and the user simply signs in
   again. Nothing falls back to persistent JS storage. */

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

export async function storeToken(token: string): Promise<void> {
  memoryToken = token;
  try {
    await invoke('keyring_set', { key: TOKEN_KEY, value: token });
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
