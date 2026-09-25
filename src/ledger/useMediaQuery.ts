import { useSyncExternalStore } from 'react';

/* Narrow-viewport breakpoint — matches Tailwind `sm:` (< 640px). */
export const MQ_NARROW = '(max-width: 639.98px)';

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(query);
      m.addEventListener('change', cb);
      return () => m.removeEventListener('change', cb);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

export function useIsNarrow(): boolean {
  return useMediaQuery(MQ_NARROW);
}
