/* Desktop OAuth handoff — mirrors the web login UX with the system
   browser doing all credential work:

   1. The app generates a random flow id and opens
      <API_BASE>/api/auth/login?desktop_flow=<uuid> in the system browser.
   2. The existing GitHub OAuth flow completes unchanged (incl. the
      first-run GitHub App install hop).
   3. The server redirects to dev-ledger://auth?flow=<uuid>&code=<code>,
      delivered to the app by tauri-plugin-deep-link.
   4. The app exchanges the single-use code for a bearer token and stores
      it according to the KEEP ME SIGNED IN checkbox — OS keychain when
      checked (survives restart), memory only when unchecked (the user
      signs in again next launch). Server-side expiry/revocation is
      identical either way.

   The app never sees credentials, OAuth codes, or session cookies —
   only its own flow id and a single-use exchange code. */

import { openUrl } from '@tauri-apps/plugin-opener';
import { getCurrent, onOpenUrl } from '@tauri-apps/plugin-deep-link';
import { invoke } from '@tauri-apps/api/core';
import { API_BASE, DESKTOP_SCHEME } from './runtime';
import { clearToken, loadToken, storeToken } from './keys';

// The pending flow id + PKCE verifier live only in memory: if the app
// restarts mid-login the in-flight handoff is rejected and the user
// simply starts again. The verifier never leaves the app except in the
// exchange POST — the dev-ledger:// URL only ever carries flow+code.
// pendingRemember carries the "keep me signed in" choice across the
// browser round-trip so the exchange can honor it when storing the token.
let pendingFlow: string | null = null;
let pendingVerifier: string | null = null;
let pendingRemember = false;
let noticeHandler: ((msg: string | null) => void) | null = null;
// Deep links may arrive before the React login gate mounts. Keep only a
// non-sensitive status message in memory; never retain URLs, codes or state.
let lastNotice: string | null = null;
let exchangeInProgress = false;

export function onDesktopAuthNotice(cb: (msg: string | null) => void): () => void {
  noticeHandler = cb;
  cb(lastNotice);
  return () => {
    if (noticeHandler === cb) noticeHandler = null;
  };
}

function notice(msg: string | null) {
  lastNotice = msg;
  try {
    noticeHandler?.(msg);
  } catch {
    /* notice delivery is best-effort */
  }
}

export function startDesktopLogin(remember: boolean): void {
  notice(null);
  pendingFlow = crypto.randomUUID();
  pendingRemember = remember;
  // 64 hex chars of CSPRNG entropy — the PKCE verifier. The server only
  // ever sees sha256(verifier), stored inside the code row, so a
  // dev-ledger:// URL grabbed by a hostile scheme-handler cannot be
  // exchanged.
  pendingVerifier = crypto.randomUUID().replace(/-/g, '')
    + crypto.randomUUID().replace(/-/g, '');
  const url = new URL(`${API_BASE}/api/auth/login`);
  url.searchParams.set('desktop_flow', pendingFlow);
  if (remember) url.searchParams.set('remember', '1');
  const verifier = pendingVerifier;
  void invoke<string>('sha256_hex', { input: verifier })
    .then((challenge) => {
      if (pendingVerifier !== verifier) return; // superseded by a new attempt
      url.searchParams.set('desktop_challenge', challenge);
      return openUrl(url.toString());
    })
    .catch(() => {
      pendingFlow = null;
      pendingVerifier = null;
      pendingRemember = false;
      notice('Could not open the system browser — sign-in was not started.');
    });
}

// Parse the complete registered scheme and host. Prefix matching would
// mistakenly accept dev-ledger://auth-foreign, etc. Never log URLs or codes.
export function isAuthDeepLink(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === `${DESKTOP_SCHEME}:`
      && parsed.hostname === 'auth'
      && (parsed.pathname === '' || parsed.pathname === '/')
      && !parsed.username && !parsed.password && !parsed.hash;
  } catch {
    return false;
  }
}

// A harmless probe lets us distinguish native window activation from an
// event that actually reached the JavaScript listener. It never exchanges
// credentials or changes authentication state.
function isDiagnosticLink(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === `${DESKTOP_SCHEME}:`
      && parsed.hostname === 'diagnostic'
      && !parsed.search && !parsed.hash
      && (parsed.pathname === '' || parsed.pathname === '/');
  } catch {
    return false;
  }
}

async function handleAuthUrl(url: string): Promise<void> {
  if (exchangeInProgress) return; // Ignore repeated delivery of the same URL.
  if (!isAuthDeepLink(url)) return;
  const parsed = new URL(url);
  const flows = parsed.searchParams.getAll('flow');
  const codes = parsed.searchParams.getAll('code');
  // Duplicate parameters or an unsolicited link must never reach the API.
  if (flows.length !== 1 || codes.length !== 1 || !codes[0]) {
    notice('An invalid sign-in link was received. Start a new sign-in from Dev Ledger.');
    return;
  }
  const flow = flows[0];
  const code = codes[0];
  // A stale/foreign deep link (old browser attempt, another app's spoof)
  // must never drive an exchange — the flow id is the binding between
  // THIS app instance's login intent and the server's handoff.
  if (!pendingFlow || flow !== pendingFlow || !pendingVerifier) {
    notice('A sign-in link reached Dev Ledger, but does not match an active login. Start again.');
    return;
  }
  const verifier = pendingVerifier;
  const remember = pendingRemember;
  pendingFlow = null;
  pendingVerifier = null;
  pendingRemember = false;
  exchangeInProgress = true;
  notice('Sign-in link received. Completing secure handoff...');
  try {
    // Relative path — routed through the transport shim (plugin-http), so
    // the exchange needs no CORS accommodation on the server.
    const res = await fetch('/api/auth/desktop?op=exchange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ flow, code, verifier }),
    });
    if (!res.ok) {
      notice('Sign-in handoff failed or expired — please try again.');
      return;
    }
    const body = (await res.json()) as { token?: string };
    if (!body?.token) {
      notice('Sign-in handoff failed — the server returned no credential.');
      return;
    }
    // KEEP ME SIGNED IN: checked → OS keychain (restored on next launch);
    // unchecked → memory only for this app session (keychain cleared).
    await storeToken(body.token, { persistent: remember });
    // Authenticated — a reload re-runs the standard boot gate, which now
    // resolves through the bearer token exactly like a cookie session.
    window.location.reload();
  } catch {
    notice('The Dev Ledger service is unreachable — sign-in could not finish.');
  } finally {
    exchangeInProgress = false;
  }
}

// Called once at boot (before the auth gate) — installs the deep-link
// listener and pre-loads the keychain token for the transport shim.
// getCurrent() catches the cold-start case: on Windows/Linux a dev-ledger://
// activation LAUNCHES the app, so the URL arrived before any listener was
// registered.
export async function initDesktopAuth(): Promise<void> {
  await loadToken();
  const accept = (u: string) => {
    if (isDiagnosticLink(u)) {
      notice('Windows protocol link reached the Dev Ledger JavaScript listener.');
      return;
    }
    if (isAuthDeepLink(u)) void handleAuthUrl(u);
  };
  await onOpenUrl((urls) => {
    for (const u of urls) accept(u);
  }).catch(() => {
    notice('The desktop sign-in listener could not start. Restart Dev Ledger.');
  });
  const current = await getCurrent().catch(() => null);
  for (const u of current ?? []) accept(u);
}

// Sign out: revoke the server-side token + session, clear the keychain,
// then land back on the login screen. Mirrors the web logout contract.
export async function desktopLogout(): Promise<boolean> {
  try {
    await fetch('/api/auth/desktop?op=logout', { method: 'POST' });
  } catch {
    /* unreachable — the local credential is still cleared below */
  }
  await clearToken();
  return true;
}
