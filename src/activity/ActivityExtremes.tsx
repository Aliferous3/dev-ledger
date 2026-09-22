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
      <div className="flex items-center justify-between mono-tag text-[10px] text-neutral-400">
        <span>EXTREMES SPECIFICATION TABLE</span>
        <span className="text-[#d6ff3e] inline-flex gap-1"><NumGrouped value={rows.length} /> REGISTERED PEAKS</span>
      </div>

      <div className="border border-neutral-800 divide-y divide-neutral-900 bg-black/40">
        {rows.map((ex, i) => (
          <div
            key={ex.id}
            ref={registerM12}
            className="m12 px-4 py-3 flex flex-wrap items-center justify-between gap-4 hover:bg-neutral-900/30 transition-colors"
            style={m12Delay(i)}
          >
            <div className="mono-tag text-[10px] text-neutral-400 min-w-[200px]">{ex.label}</div>
            <div className="mono-tag text-[9px] text-[#d6ff3e] w-28">{ex.date}</div>
            <div className="font-editorial text-3xl text-neutral-100 w-24 text-right tabular-nums inline-flex justify-end">
              {ex.valueFmt === 'compact' ? <NumCompact value={ex.valueNum} /> : <NumGrouped value={ex.valueNum} />}
            </div>
            <div className="mono-tag text-[9px] text-neutral-500 flex-1 text-right truncate">
              {ex.detail}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
