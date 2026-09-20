import { useEffect, useState } from 'react';

// Canonical major-view registry — drives the Keypad header, the right
// rail, and numeric keyboard shortcuts. One source so they never disagree.
export const SECTIONS = [
  { id: 'section-01', num: '01', name: 'MEASURE' },
  { id: 'section-02', num: '02', name: 'FIELD' },
  { id: 'section-03', num: '03', name: 'INDEX' },
  { id: 'section-04', num: '04', name: 'ARCHIVE' },
  { id: 'section-05', num: '05', name: 'ACTIVITY' },
  { id: 'section-06', num: '06', name: 'CODE' },
] as const;

export type SectionDef = (typeof SECTIONS)[number];

export function sectionLabel(s: SectionDef) {
  return `${s.num} ${s.name}`;
}

/* Scroll-spy: the section nearest the top of the viewport is "active".
   Shared by the keypad's active cell and the right rail's marker. */
export function useActiveSection(): string {
  const [active, setActive] = useState<string>(SECTIONS[0].id);
  useEffect(() => {
    const handleScroll = () => {
      const scrollY = window.scrollY + 200;
      let current: string = SECTIONS[0].id;
      for (const s of SECTIONS) {
        const el = document.getElementById(s.id);
        if (el && el.offsetTop <= scrollY) current = s.id;
      }
      setActive(current);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);
  return active;
}
