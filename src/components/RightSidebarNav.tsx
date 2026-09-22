import { PAGES, PAGE_SECTIONS, jumpToAnchor, useActiveAnchor, type PageId } from '../pages';

/* NAV.06 — BLUEPRINT CALLOUT (SPEC). Page-scoped anchor index: tracks the
   real section ids of the ACTIVE page (Overview's four registers, or the
   internal blocks of Activity/Code) and smooth-scrolls to them — these
   are anchors inside one page, not routes: no remount, no preloader, no
   M12 replay. Page navigation itself lives in the header. */
export function RightSidebarNav({ page }: { page: PageId }) {
  const anchors = PAGE_SECTIONS[page];
  const active = useActiveAnchor(anchors);
  const activeIdx = anchors.findIndex((a) => a.id === active);
  const pageName = PAGES.find((p) => p.id === page)?.name ?? '';
  const railFrac = anchors.length ? Math.max(0, activeIdx) / anchors.length : 0;

  return (
    <aside
      aria-label="Section navigation"
      className="fixed right-4 top-1/2 -translate-y-1/2 z-40 hidden min-[1600px]:block"
    >
      <div className="relative border border-dashed border-neutral-800 px-3 py-3 bg-black/40 backdrop-blur-sm">
        {/* left progression rail — fills top→bottom as the page is read */}
        <span aria-hidden className="absolute left-0 top-0 bottom-0 w-px bg-neutral-800">
          <span
            className="block w-px bg-[#d6ff3e] transition-all duration-300"
            style={{ height: `${Math.round(railFrac * 100)}%` }}
          />
        </span>
        <span className="absolute -top-px -left-px w-2.5 h-2.5 border-t border-l border-[#d6ff3e]" />
        <span className="absolute -top-px -right-px w-2.5 h-2.5 border-t border-r border-[#d6ff3e]" />
        <span className="absolute -bottom-px -left-px w-2.5 h-2.5 border-b border-l border-[#d6ff3e]" />
        <span className="absolute -bottom-px -right-px w-2.5 h-2.5 border-b border-r border-[#d6ff3e]" />
        <div className="flex items-center justify-between mb-3">
          <span className="mono-tag text-[9px] text-neutral-600 tracking-[0.25em]">
            ◤ {pageName} <span className="text-neutral-700">· JUMP TO</span>
          </span>
          <span className="w-1.5 h-1.5 rounded-full bg-[#d6ff3e] pulse-dot" />
        </div>
        <div className="space-y-[5px]">
          {anchors.map((a, i) => {
            const on = active === a.id;
            const passed = activeIdx >= 0 && i < activeIdx;
            return (
              <button
                key={a.id}
                type="button"
                aria-current={on ? 'location' : undefined}
                onClick={() => jumpToAnchor(a.id)}
                className="group w-full flex items-center gap-2 justify-end"
              >
                <span className={`mono-tag text-[7px] transition-colors ${on ? 'text-[#d6ff3e]' : 'text-neutral-700'}`}>
                  [{String(i + 1).padStart(2, '0')}]
                </span>
                <span
                  className={`mono-tag text-[10px] transition-colors duration-150 ${
                    on ? 'text-[#d6ff3e] font-semibold' : 'text-neutral-400 group-hover:text-neutral-100'
                  }`}
                >
                  {a.name}
                </span>
                <span className="relative flex items-center">
                  <span
                    className={`h-px transition-all duration-300 ${
                      on
                        ? 'w-6 bg-[#d6ff3e]'
                        : passed
                          ? 'w-4 bg-neutral-500'
                          : 'w-4 bg-neutral-700 border-t border-dashed border-neutral-700 group-hover:w-6 group-hover:bg-neutral-500'
                    }`}
                  />
                  <span
                    className={`w-[7px] h-[7px] rotate-45 border transition-all duration-300 ${
                      on
                        ? 'bg-[#d6ff3e] border-[#d6ff3e] shadow-[0_0_8px_rgba(214,255,62,0.7)]'
                        : passed
                          ? 'bg-neutral-600 border-neutral-600'
                          : 'bg-transparent border-neutral-700 group-hover:border-neutral-300'
                    }`}
                  />
                </span>
              </button>
            );
          })}
        </div>
        <div className="mt-3 pt-2 border-t border-dashed border-neutral-800 mono-tag text-[7px] text-neutral-600 tabular-nums">
          CAL.MARK · {anchors[activeIdx]?.name ?? '—'} · {String(activeIdx + 1).padStart(2, '0')}/{String(anchors.length).padStart(2, '0')}
        </div>
      </div>
    </aside>
  );
}
