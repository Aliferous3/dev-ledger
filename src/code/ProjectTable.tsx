import { useState } from 'react';
import { m12Delay, registerM12 } from '../ledger/m12';
import { NumBytes, NumCompact } from '../ledger/Num';

export interface ProjectRow {
  name: string;
  bytes: number;
  churn: number;
}

/* Project ranking with the BY BYTES / BY CHURN metric switch from
   CodeBento (CODE.05), restyled to the Attachment-3 row treatment.
   Local metric tabs — not a date-range control. */
export function ProjectTable({ projects }: { projects: ProjectRow[] }) {
  const [tab, setTab] = useState<'bytes' | 'churn'>('bytes');

  const rows = [...projects].sort((a, b) =>
    tab === 'bytes' ? b.bytes - a.bytes : b.churn - a.churn,
  );
  const max = Math.max(...rows.map((r) => (tab === 'bytes' ? r.bytes : r.churn)), 1);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 mono-tag text-[10px] text-neutral-400">
        <span>SOURCE {tab === 'bytes' ? 'BYTES' : 'CHURN'} BY PROJECT</span>
        <div className="flex items-center gap-2" role="group" aria-label="Rank projects by">
          {(['bytes', 'churn'] as const).map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={tab === t}
              onClick={() => setTab(t)}
              className={`mono-tag text-[9px] px-3 py-1.5 border transition-all ${
                tab === t
                  ? 'bg-[#d6ff3e] text-black border-[#d6ff3e] font-semibold'
                  : 'border-neutral-800 text-neutral-400 hover:text-neutral-200'
              }`}
            >
              BY {t.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <div className="divide-y divide-neutral-900">
        {rows.map((p, i) => {
          const v = tab === 'bytes' ? p.bytes : p.churn;
          const share = Math.max(0, (v / max) * 100);
          return (
            <div
              key={p.name}
              ref={registerM12}
              className="m12 flex items-center justify-between py-2 sm:py-3 group cursor-default relative"
              style={m12Delay(i)}
            >
              <div className="flex items-center gap-4 min-w-0">
                <span className="mono-tag text-[9px] text-neutral-600 group-hover:text-[#d6ff3e] transition-colors">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span className="text-[15px] text-neutral-200 group-hover:text-[#d6ff3e] transition-colors truncate">
                  {p.name}
                </span>
              </div>
              <span className="font-editorial text-lg text-neutral-100 group-hover:text-[#d6ff3e] transition-colors tabular-nums inline-flex justify-end">
                {tab === 'bytes' ? <NumBytes value={v} /> : <NumCompact value={v} />}
              </span>
              <span
                className="absolute bottom-0 left-0 h-px bg-[#d6ff3e]/70 transition-all duration-500"
                style={{ width: `${share}%`, opacity: share > 0 ? 0.5 : 0 }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
