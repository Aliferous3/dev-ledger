/* Native link handling — the bundled frontend's relative links fall into
   three classes:

   1. In-app routes (/privacy, /terms, /security, /, ?range=…) — handled
      by the webview's own history, untouched.
   2. Marketing/content routes (/blog, /tools, /answers, /guides, /glossary,
      /comparisons, /site-assets, /rss.xml, /sitemap*) — on the web these
      rewrite to the dev-ledger-site deployment; bundled locally they
      would 404, so they open in the system browser.
   3. Absolute http(s) links (github.com profile/settings/installations,
      external docs) — always the system browser, never webview
      navigation.

   /api/auth/login links (RECONNECT GITHUB) route through the desktop
   login flow so the handoff returns to the app. */

import { openUrl } from '@tauri-apps/plugin-opener';
import { API_BASE, isDesktop } from './runtime';
import { startDesktopLogin } from './auth';

const CONTENT_PREFIXES = [
  '/blog',
  '/tools',
  '/answers',
  '/guides',
  '/glossary',
  '/comparisons',
  '/site-assets',
  '/rss.xml',
  '/sitemap',
  '/llms.txt',
];

// The ONE sanctioned way to send the user to an external URL. On the web
// it is a normal new-tab open; in the desktop shell it MUST go through the
// opener plugin so the system browser handles it — the Tauri webview is
// never allowed to navigate to an external origin.
export function openExternalUrl(url: string): void {
  if (isDesktop()) {
    void openUrl(url).catch(() => {});
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

export function installLinkHandling(): void {
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0) return;
    const anchor = (e.target as HTMLElement | null)?.closest?.('a[href]');
    const href = anchor?.getAttribute('href');
    if (!href) return;

    if (href.startsWith('/api/auth/login')) {
      e.preventDefault();
      startDesktopLogin(false);
      return;
    }
    if (/^https?:\/\//i.test(href)) {
      e.preventDefault();
      openExternalUrl(href);
      return;
    }
    if (CONTENT_PREFIXES.some((p) => href === p || href.startsWith(`${p}/`))) {
      e.preventDefault();
      openExternalUrl(`${API_BASE}${href}`);
    }
  });
}
