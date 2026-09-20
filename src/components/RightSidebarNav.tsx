import { useEffect, useState } from 'react';

const SECTIONS = [
  { id: 'section-01', label: '01 MEASURE' },
  { id: 'section-02', label: '02 FIELD' },
  { id: 'section-03', label: '03 INDEX' },
  { id: 'section-04', label: '04 ARCHIVE' },
];

export function RightSidebarNav() {
  const [active, setActive] = useState('section-01');

  useEffect(() => {
    const handleScroll = () => {
      const scrollY = window.scrollY + 200;
      for (let i = SECTIONS.length - 1; i >= 0; i--) {
        const el = document.getElementById(SECTIONS[i].id);
        if (el && el.offsetTop <= scrollY) {
          setActive(SECTIONS[i].id);
          break;
        }
      }
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollTo = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <aside
      aria-label="Section navigation"
      className="fixed right-6 top-1/2 -translate-y-1/2 z-40 hidden xl:flex flex-col items-end gap-2 text-[10px] mono-tag"
    >
      <div className="text-[9px] text-neutral-600 mb-1 pr-1 tracking-widest">// NAV</div>
      {SECTIONS.map((sec) => {
        const isActive = active === sec.id;
        return (
          <button
            key={sec.id}
            onClick={() => scrollTo(sec.id)}
            className={`group flex items-center gap-2 py-1 transition-all duration-200 ${
              isActive
                ? 'text-[#d6ff3e] font-medium'
                : 'text-neutral-500 hover:text-neutral-300'
            }`}
          >
            <span className="tracking-wider">{sec.label}</span>
            <span
              className={`h-[1px] transition-all duration-300 ${
                isActive ? 'w-6 bg-[#d6ff3e]' : 'w-3 bg-neutral-700 group-hover:w-4 group-hover:bg-neutral-500'
              }`}
            />
          </button>
        );
      })}
    </aside>
  );
}
