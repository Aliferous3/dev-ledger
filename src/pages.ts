import { useCallback, useEffect, useState } from 'react';

/* Canonical three-page registry — the entire authenticated app is exactly
   OVERVIEW / ACTIVITY / CODE. Header nav, routing and the right rail all
   derive from this one source. */
export const PAGES = [
  { id: 'overview', num: '01', name: 'OVERVIEW', path: '/' },
  { id: 'activity', num: '02', name: 'ACTIVITY', path: '/activity' },
  { id: 'code', num: '03', name: 'CODE', path: '/code' },
] as const;

export type PageId = (typeof PAGES)[number]['id'];

/* URL → page. '/overview' is accepted as an alias of '/'. Anything unknown
   falls back to overview — never a dead route. */
export function pageFromPath(pathname: string): PageId {
  const p = pathname.replace(/\/+$/, '') || '/';
  if (p === '/activity') return 'activity';
  if (p === '/code') return 'code';
  return 'overview';
}

export function pathForPage(page: PageId): string {
  return PAGES.find((p) => p.id === page)?.path ?? '/';
}

/* History-backed router: pushState on nav, popstate for back/forward,
   scroll reset to top on every page change. Direct loads + refreshes land
   on the right page via pageFromPath + the vercel.json rewrites. */
export function useRoute(): { page: PageId; navigate: (page: PageId) => void } {
  const [page, setPage] = useState<PageId>(() =>
    pageFromPath(window.location.pathname),
  );

  useEffect(() => {
    const onPop = () => {
      const next = pageFromPath(window.location.pathname);
      setPage(next);
      // Section-rail hash jumps land on their anchor; everything else tops.
      const el = window.location.hash
        ? document.getElementById(window.location.hash.slice(1))
        : null;
      if (el) {
        el.scrollIntoView({ behavior: 'instant' as ScrollBehavior });
        return;
      }
      window.scrollTo(0, 0);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = useCallback(
    (next: PageId) => {
      if (next === page) return;
      // Preserve the explicit ?range= selection across page navigation.
      history.pushState({ page: next }, '', pathForPage(next) + window.location.search);
      window.scrollTo(0, 0);
      setPage(next);
    },
    [page],
  );

  return { page, navigate };
}

/* Range selection: the default window is 90D. Canonical URL semantics —
   the default is the clean URL; an explicit non-default selection is
   written as ?range=<preset> so refresh/back preserve the user's choice. */
import type { Period } from './types';

export const DEFAULT_PERIOD: Period = '90D';

const QUERY_TO_PERIOD: Record<string, Period> = {
  '7d': '7D', '30d': '30D', '90d': '90D', ytd: 'YTD', '1y': '1Y', all: 'ALL',
};
const PERIOD_TO_QUERY: Record<Period, string> = {
  '7D': '7d', '30D': '30d', '90D': '90d', YTD: 'ytd', '1Y': '1y', ALL: 'all',
};

// Explicit ?range= wins over the default; unknown/missing → null (caller
// falls back to DEFAULT_PERIOD).
export function periodFromQuery(search: string): Period | null {
  const raw = new URLSearchParams(search).get('range');
  return (raw && QUERY_TO_PERIOD[raw.toLowerCase()]) || null;
}

// ?range= is written only for non-default selections — the default keeps
// the URL canonical and clean.
export function rangeSearch(period: Period): string {
  return period === DEFAULT_PERIOD ? '' : `?range=${PERIOD_TO_QUERY[period]}`;
}

/* Within-page anchor index for the right rail: the rail tracks real
   section ids on the active page and scrolls to them.
   `spy` (optional) names a separate sentinel element used ONLY for
   active-state detection — needed when two logical sections share one
   vertical band (Code's GROWTH/PROJECTS are side-by-side on desktop, so
   their tops cross the reading line together). Clicking still scrolls to
   `id`; the spy element decides when the entry owns the reading line. */
export interface PageAnchor {
  id: string;
  name: string;
  spy?: string;
}

export const PAGE_SECTIONS: Record<PageId, PageAnchor[]> = {
  overview: [
    { id: 'section-01', name: 'MEASURE' },
    { id: 'section-02', name: 'FIELD' },
    { id: 'section-03', name: 'INDEX' },
    { id: 'section-04', name: 'LONGITUDINAL' },
  ],
  activity: [
    { id: 'activity-extremes', name: 'EXTREMES' },
    { id: 'activity-radar', name: 'CIRCADIAN' },
    { id: 'activity-rhythm', name: 'RHYTHM' },
  ],
  code: [
    { id: 'code-header', name: 'COMPOSITION' },
    { id: 'code-treemap', name: 'LANGUAGES' },
    { id: 'code-growth', name: 'GROWTH' },
    // The growth chart and project table sit side-by-side on lg+: the spy
    // sentinel at the chart's bottom means GROWTH owns the reading line
    // while the curve occupies it, and PROJECTS takes over for the
    // remainder of the row — where the table is the live content.
    { id: 'code-projects', name: 'PROJECTS', spy: 'code-projects-spy' },
  ],
};

/* Scroll-spy scoped to a page's anchors. The active section is the last
   one whose top has passed the reading line (35% of viewport height) —
   i.e. the section occupying the primary reading region, not merely the
   last one clicked. Falls back to the first anchor above the fold. */
export function useActiveAnchor(anchors: PageAnchor[]): string {
  const [active, setActive] = useState<string>(anchors[0]?.id ?? '');
  const key = anchors.map((a) => `${a.id}:${a.spy ?? ''}`).join(',');
  useEffect(() => {
    const list = key
      .split(',')
      .filter(Boolean)
      .map((entry) => {
        const [id, spy] = entry.split(':');
        return { id, el: spy || id };
      });
    let raf = 0;
    const handleScroll = () => {
      const readingLine = window.innerHeight * 0.35;
      let current: string = list[0]?.id ?? '';
      for (const { id, el } of list) {
        const node = document.getElementById(el);
        if (!node) continue;
        const top = node.getBoundingClientRect().top;
        if (top <= readingLine) current = id;
      }
      setActive(current);
    };
    const schedule = () => {
      if (!raf)
        raf = requestAnimationFrame(() => {
          raf = 0;
          handleScroll();
        });
    };
    handleScroll();
    window.addEventListener('scroll', schedule, { passive: true });
    return () => {
      window.removeEventListener('scroll', schedule);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [key]);
  return active;
}

/* Jump to a section anchor inside the current page — smooth scroll with
   the sticky-header offset (targets carry scroll-margin via index.css)
   + a hash entry so back/forward retraces section jumps. No remount, no
   preloader. */
export function jumpToAnchor(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ behavior: reduced ? 'instant' : 'smooth', block: 'start' });
  if (window.location.hash !== `#${id}`) {
    // Preserve an explicit ?range= — dropping it would reset the period on
    // back/forward navigation.
    history.pushState({ anchor: id }, '', `${window.location.search}#${id}`);
  }
}
