/* Desktop integration barrel — one install call before the app boots.

   Order matters: the transport shim goes in FIRST so every /api/* fetch
   the app makes (including the auth gate's /api/user probe) rides the
   native HTTP bridge with the bearer token; initDesktopAuth then loads
   the keychain credential and arms the deep-link listener. */

import { isDesktop } from './runtime';
import { installTransport } from './transport';
import { installLinkHandling } from './links';
import { installShortcuts } from './shortcuts';
import { initDesktopAuth } from './auth';

export { isDesktop, API_BASE, DESKTOP_SCHEME } from './runtime';
export { openExternalUrl } from './links';
export { startDesktopLogin, desktopLogout, onDesktopAuthNotice, onDesktopAuthCompleted } from './auth';

export async function initDesktop(): Promise<void> {
  if (!isDesktop()) return;
  installTransport();
  installLinkHandling();
  installShortcuts();
  // A failed deep-link listener must never brick the auth gate — the app
  // still works for already-authenticated sessions.
  await initDesktopAuth().catch(() => {});
}
