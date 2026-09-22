import { useState } from 'react';
import { NumGrouped } from '../ledger/Num';

export interface Milestone {
  id: string;
  date: string;
  title: string;
  desc: string;
}

export interface MonthRank {
  rank: number;
  commits: number;
  date: string;
}

/* Milestones (border-left interaction from ActivityCharts.MilestonesList)
   beside ACTIVE_MONTHS_TOP (ranked serif months from ActivityTerminal). */
export function ActivityMilestones({
  milestones,
  months,
}: {
  milestones: Milestone[];
  months: MonthRank[];
}) {
  const [active, setActive] = useState<string | null>(null);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pt-6 border-t border-neutral-900">
      <div className="space-y-4">
        <div className="flex items-center gap-2 mono-tag text-[10px] text-neutral-400">
          <span>MILESTONES</span>
          <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border border-neutral-700 text-[8px] text-neutral-500">
            i
          </span>
        </div>

        <div className="space-y-2.5">
          {milestones.map((m) => {
            const isSelected = active === m.id;
            return (
              <button
                key={m.id}
                type="button"
                title={m.desc}
                onClick={() => setActive(isSelected ? null : m.id)}
                className={`w-full flex items-baseline gap-6 py-1.5 px-2 cursor-pointer transition-all duration-200 border-l-2 text-left ${
                  isSelected ? 'border-[#d6ff3e] bg-[#d6ff3e]/[0.04]' : 'border-neutral-800 hover:border-neutral-500'
                }`}
              >
                <span className="mono-tag text-[10px] text-neutral-500 w-24 tabular-nums">{m.date}</span>
                <span
                  className={`mono-tag text-[11px] transition-colors ${
                    isSelected ? 'text-[#d6ff3e]' : 'text-neutral-200 hover:text-white'
                  }`}
                >
                  {m.title}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-4">
        <div className="mono-tag text-[10px] text-neutral-400">ACTIVE_MONTHS_TOP</div>
        <div className="space-y-2">
          {months.map((m) => (
            <div
              key={m.date}
              className="flex items-center justify-between border-b border-neutral-900 py-1.5 mono-tag text-[10px]"
            >
              <span className="text-neutral-500">
                RANK 0{m.rank} // {m.date}
              </span>
              <span className="font-editorial text-2xl text-neutral-100 tabular-nums inline-flex"><NumGrouped value={m.commits} /></span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
