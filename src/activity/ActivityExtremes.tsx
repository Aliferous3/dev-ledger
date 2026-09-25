import { m12Delay, registerM12 } from '../ledger/m12';
import { NumCompact, NumGrouped } from '../ledger/Num';

export interface ExtremeRow {
  id: string;
  label: string;
  /** raw value — 'grouped' (1,747) or 'compact' (1.7K) rendering */
  valueNum: number;
  valueFmt: 'grouped' | 'compact';
  date: string;
  detail: string;
}

/* Extremes specification table — lifted verbatim from ActivityBlueprint
   (Design 03). Rows are real aggregates computed in ActivityPage. */
export function ActivityExtremes({ rows }: { rows: ExtremeRow[] }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 mono-tag text-[10px] text-neutral-400">
        <span>EXTREMES SPECIFICATION TABLE</span>
        <span className="text-[#d6ff3e] inline-flex gap-1"><NumGrouped value={rows.length} /> REGISTERED PEAKS</span>
      </div>

      <div className="border border-neutral-800 divide-y divide-neutral-900 bg-black/40">
        {rows.map((ex, i) => (
          <div
            key={ex.id}
            ref={registerM12}
            className="m12 grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5 px-3 py-2.5 sm:flex sm:flex-wrap sm:items-center sm:justify-between sm:gap-4 sm:px-4 sm:py-3 hover:bg-neutral-900/30 transition-colors"
            style={m12Delay(i)}
          >
            <div className="mono-tag text-[10px] text-neutral-400 min-w-0 self-center sm:min-w-[200px] max-sm:col-start-1 max-sm:row-start-1">
              {ex.label}
            </div>
            <div className="mono-tag text-[9px] text-[#d6ff3e] self-center sm:w-28 max-sm:col-start-1 max-sm:row-start-2">
              {ex.date}
            </div>
            <div className="font-editorial text-2xl sm:text-3xl text-neutral-100 sm:w-24 text-right tabular-nums inline-flex justify-end self-center max-sm:col-start-2 max-sm:row-start-1">
              {ex.valueFmt === 'compact' ? <NumCompact value={ex.valueNum} /> : <NumGrouped value={ex.valueNum} />}
            </div>
            <div className="mono-tag text-[9px] text-neutral-500 self-center sm:flex-1 text-right truncate max-sm:col-start-2 max-sm:row-start-2">
              {ex.detail}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
