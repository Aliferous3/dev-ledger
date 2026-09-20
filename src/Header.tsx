import { tabs, dates } from './data';
import { useState } from 'react';

export function Header({ activeTab }: { activeTab?: string }) {
  const [tab, setTab] = useState(activeTab ?? 'GROWTH');
  return (
    <div className="space-y-8">
      {/* Meta row */}
      <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-2 text-[11px] mono-tag text-neutral-500">
        <span className="text-neutral-300">
          {dates[0]} <span className="mx-2 text-neutral-600">—</span> {dates[dates.length - 1]}
        </span>
        <span className="hidden sm:inline text-neutral-700">·</span>
        <span>Source Bytes <span className="ml-2 text-neutral-200">10.0 MB</span></span>
        <span className="hidden sm:inline text-neutral-700">·</span>
        <span>7 Repositories</span>
        <span className="hidden sm:inline text-neutral-700">·</span>
        <span>TypeScript</span>
      </div>

      {/* Tabs */}
      <div className="flex justify-center">
        <div className="flex items-center gap-10 text-[11px] mono-tag">
          {tabs.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`relative pb-1 transition-colors duration-300 ${
                tab === t ? 'text-neutral-200' : 'text-neutral-500 hover:text-neutral-300'
              } tab-underline ${tab === t ? 'active' : ''}`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}