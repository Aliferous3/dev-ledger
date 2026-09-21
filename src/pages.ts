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
      setPage(pageFromPath(window.location.pathname));
      window.scrollTo(0, 0);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = useCallback(
    (next: PageId) => {
      if (next === page) return;
      history.pushState({ page: next }, '', pathForPage(next));
      window.scrollTo(0, 0);
      setPage(next);
    },
    [page],
  );

  return { page, navigate };
}

/* Within-page anchor index for the right rail: the rail tracks real
   section ids on the active page and scrolls to them. */
export const PAGE_SECTIONS: Record<PageId, { id: string; name: string }[]> = {
  overview: [
    { id: 'section-01', name: 'MEASURE' },
    { id: 'section-02', name: 'FIELD' },
    { id: 'section-03', name: 'INDEX' },
    { id: 'section-04', name: 'ARCHIVE' },
  ],
  activity: [
    { id: 'activity-header', name: 'SIGNAL' },
    { id: 'activity-extremes', name: 'EXTREMES' },
    { id: 'activity-radar', name: 'RADAR' },
    { id: 'activity-rhythm', name: 'RHYTHM' },
    { id: 'activity-charts', name: 'CHARTS' },
    { id: 'activity-milestones', name: 'MILESTONES' },
  ],
  code: [
    { id: 'code-header', name: 'SOURCE' },
    { id: 'code-treemap', name: 'LANGUAGES' },
    { id: 'code-growth', name: 'GROWTH' },
    { id: 'code-projects', name: 'PROJECTS' },
    { id: 'code-intel', name: 'INTEL' },
    { id: 'code-churn', name: 'CHURN' },
  ],
};

/* Scroll-spy scoped to a page's anchors — same semantics as the old
   six-section spy: the section nearest the top of the viewport is active. */
export function useActiveAnchor(anchors: { id: string; name: string }[]): string {
  const [active, setActive] = useState<string>(anchors[0]?.id ?? '');
  const key = anchors.map((a) => a.id).join(',');
  useEffect(() => {
    const list = key.split(',').filter(Boolean);
    const handleScroll = () => {
      const scrollY = window.scrollY + 200;
      let current: string = list[0] ?? '';
      for (const id of list) {
        const el = document.getElementById(id);
        if (el && el.offsetTop <= scrollY) current = id;
      }
      setActive(current);
    };
    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [key]);
  return active;
}
