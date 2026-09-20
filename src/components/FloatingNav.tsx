import React, { useEffect, useState } from 'react';

export const FloatingNav: React.FC = () => {
  const [activeId, setActiveId] = useState<string>('measure');

  const navItems = [
    { id: 'measure', label: '01 MEASURE' },
    { id: 'field', label: '02 FIELD' },
    { id: 'index', label: '03 INDEX' },
    { id: 'archive', label: '04 ARCHIVE' },
  ];

  useEffect(() => {
    const handleScroll = () => {
      const scrollPos = window.scrollY + 250;
      for (let i = navItems.length - 1; i >= 0; i--) {
        const el = document.getElementById(navItems[i].id);
        if (el && el.offsetTop <= scrollPos) {
          setActiveId(navItems[i].id);
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
    <nav className="fixed right-6 md:right-10 top-1/2 -translate-y-1/2 z-40 hidden lg:flex flex-col items-end gap-3 pointer-events-auto select-none">
      {navItems.map((item) => {
        const isActive = activeId === item.id;
        return (
          <button
            key={item.id}
            onClick={() => scrollTo(item.id)}
            className={`group flex items-center gap-2 text-[10px] font-mono tracking-widest transition-all cursor-pointer ${
              isActive ? 'text-[#f5f5f5] font-bold' : 'text-[#444444] hover:text-[#888888]'
            }`}
          >
            <span className={isActive ? 'text-[#d6ff3e]' : 'text-inherit'}>
              {item.label}
            </span>
            <span
              className={`inline-block transition-all ${
                isActive
                  ? 'w-6 h-[1.5px] bg-[#d6ff3e] shadow-sm shadow-[#d6ff3e]'
                  : 'w-3 h-px bg-[#333333] group-hover:w-4 group-hover:bg-[#666666]'
              }`}
            />
          </button>
        );
      })}
    </nav>
  );
};
