import { SECTIONS, sectionLabel, useActiveSection } from '../sections';

export function RightSidebarNav({
  navigate,
}: {
  navigate: (id: string, label: string) => void;
}) {
  const active = useActiveSection();

  return (
    <aside
      aria-label="Section navigation"
      className="fixed right-6 top-1/2 -translate-y-1/2 z-40 hidden xl:flex flex-col items-end gap-2 text-[10px] mono-tag"
    >
      <div className="text-[9px] text-neutral-600 mb-1 pr-1 tracking-widest">// NAV</div>
      {SECTIONS.map((sec) => {
        const label = sectionLabel(sec);
        const isActive = active === sec.id;
        return (
          <button
            key={sec.id}
            onClick={() => navigate(sec.id, label)}
            className={`group flex items-center gap-2 py-1 transition-all duration-200 ${
              isActive
                ? 'text-[#d6ff3e] font-medium'
                : 'text-neutral-500 hover:text-neutral-300'
            }`}
          >
            <span className="tracking-wider">{label}</span>
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
