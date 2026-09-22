import { NumCompact, NumPct } from '../ledger/Num';

export interface IntelMetric {
  label: string;
  /** raw value — null renders the '—' no-data mark, never a fake 0 */
  valueNum: number | null;
  valueFmt: 'pct' | 'compact';
  sub: string;
  pct: number; // bar fill 0-100
}

/* CODE INTELLIGENCE — the four spec cards from CodeBlueprint (CODE.04):
   lime corner brackets, C-0N tags, serif value, mono subline. */
export function CodeIntelligence({ metrics }: { metrics: IntelMetric[] }) {
  return (
    <div className="space-y-4">
      <div className="mono-tag text-[10px] text-neutral-400">CODE INTELLIGENCE</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {metrics.map((m, i) => (
          <div key={m.label} className="relative border border-neutral-800 p-4 bg-neutral-950/40">
            <span className="absolute top-0 left-0 w-2 h-2 border-t border-l border-[#d6ff3e]" />
            <span className="absolute bottom-0 right-0 w-2 h-2 border-b border-r border-[#d6ff3e]" />
            <div className="flex justify-between mono-tag text-[8px] text-neutral-500">
              <span>{m.label}</span>
              <span className="text-[#d6ff3e]">C-0{i + 1}</span>
            </div>
            <div className="font-editorial text-4xl text-neutral-100 mt-2 tabular-nums">
              {m.valueNum === null ? (
                '—'
              ) : m.valueFmt === 'pct' ? (
                <NumPct value={m.valueNum} />
              ) : (
                <NumCompact value={m.valueNum} />
              )}
            </div>
            <div className="mono-tag text-[8px] text-neutral-600 mt-1 truncate" title={m.sub}>
              {m.sub}
            </div>
            <div className="h-1 bg-neutral-900 mt-3 overflow-hidden">
              <div
                className="h-full bg-[#d6ff3e] transition-all duration-700"
                style={{ width: `${Math.min(100, Math.max(0, m.pct))}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
