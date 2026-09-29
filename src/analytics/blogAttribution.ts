/* Blog → login attribution bridge.

   PostHog runs with memory-only persistence, so the anonymous id cannot
   carry context across a blog page → app navigation. These two
   sessionStorage keys carry the only attribution value that exists: the
   slug of the last blog article the visitor read, and a one-shot flag that
   a GitHub login was actually initiated this tab session.

   Stored values are limited to a known article slug and the literal '1' —
   no URLs, referrer data, OAuth state, tokens, or user data ever pass
   through this channel. sessionStorage is same-tab and dies with it. */

import { BLOG_ARTICLE_SLUGS } from './posthogModel.mjs';

const BLOG_REF_KEY = 'dl_blog_ref';
const LOGIN_PENDING_KEY = 'dl_login_pending';

export type BlogAttribution = { surface: 'blog'; origin_slug: string } | { surface: 'direct'; origin_slug: 'none' };

const canStore = () => {
  try {
    return typeof window !== 'undefined' && !!window.sessionStorage;
  } catch {
    return false;
  }
};

// Written by the blog pages when an article is viewed. Last article wins.
export function markBlogAttribution(slug: string): void {
  if (!canStore() || !BLOG_ARTICLE_SLUGS.includes(slug)) return;
  try {
    sessionStorage.setItem(BLOG_REF_KEY, slug);
  } catch {
    /* storage disabled — attribution is best-effort */
  }
}

// Read the stored blog attribution. Anything that is not a known article
// slug is discarded — the stored value is never trusted blindly.
export function readBlogAttribution(): BlogAttribution {
  if (!canStore()) return { surface: 'direct', origin_slug: 'none' };
  try {
    const slug = sessionStorage.getItem(BLOG_REF_KEY);
    if (slug && BLOG_ARTICLE_SLUGS.includes(slug)) {
      return { surface: 'blog', origin_slug: slug };
    }
  } catch {
    /* storage disabled */
  }
  return { surface: 'direct', origin_slug: 'none' };
}

export function clearBlogAttribution(): void {
  if (!canStore()) return;
  try {
    sessionStorage.removeItem(BLOG_REF_KEY);
  } catch {
    /* storage disabled */
  }
}

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
