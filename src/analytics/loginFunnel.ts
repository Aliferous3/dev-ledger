/* Login-funnel bridge for analytics.

   PostHog runs with memory-only persistence, so the anonymous id cannot
   carry context across the GitHub OAuth redirect. This sessionStorage key
   carries the only signal that exists: a one-shot flag that a GitHub login
   was actually initiated this tab session — so github_login_succeeded fires
   only for fresh logins, not remembered sessions landing on '/'.

   Stored value is the literal '1' — no URLs, referrer data, OAuth state,
   tokens, or user data ever pass through this channel. sessionStorage is
   same-tab and dies with it. */

const LOGIN_PENDING_KEY = 'dl_login_pending';

const canStore = () => {
  try {
    return typeof window !== 'undefined' && !!window.sessionStorage;
  } catch {
    return false;
  }
};

// Set just before navigating to /api/auth/login so the post-OAuth return
// can distinguish a fresh login from a remembered session landing on '/'.
export function markLoginPending(): void {
  if (!canStore()) return;
  try {
    sessionStorage.setItem(LOGIN_PENDING_KEY, '1');
  } catch {
    /* storage disabled */
  }
}

// One-shot read: returns true exactly once per initiated login.
export function consumeLoginPending(): boolean {
  if (!canStore()) return false;
  try {
    const pending = sessionStorage.getItem(LOGIN_PENDING_KEY) === '1';
    if (pending) sessionStorage.removeItem(LOGIN_PENDING_KEY);
    return pending;
  } catch {
    return false;
  }
}
