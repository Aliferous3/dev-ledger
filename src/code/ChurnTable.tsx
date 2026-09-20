import { fmtCompact } from '../codeData';

export interface ChurnRow {
  rank: string;
  name: string;
  churn: number;
}

/* SOURCE CHURN TABLE — the ranked rows + proportional lime bars from
   CodeBlueprint's bottom section. Row count drives the right-hand label. */
export function ChurnTable({ rows }: { rows: ChurnRow[] }) {
  const max = Math.max(...rows.map((r) => r.churn), 1);
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mono-tag text-[10px] text-neutral-400">
        <span>SOURCE CHURN TABLE</span>
        <span className="text-neutral-600">{rows.length} CHURN SOURCES</span>
      </div>
      <div className="border border-neutral-800 divide-y divide-neutral-900 bg-black/40">
        {rows.map((p) => (
          <div
            key={p.name}
            className="px-4 py-2.5 flex items-center justify-between gap-4 hover:bg-neutral-900/30 transition-colors group"
          >
            <span className="mono-tag text-[9px] text-neutral-600 w-6 group-hover:text-[#d6ff3e] transition-colors">
              {p.rank}
            </span>
            <span className="mono-tag text-[10px] text-neutral-300 flex-1 truncate group-hover:text-[#d6ff3e] transition-colors">
              {p.name}
            </span>
            <div className="w-32 h-[3px] bg-neutral-900 overflow-hidden hidden sm:block">
              <div
                className="h-full bg-[#d6ff3e] transition-all duration-700"
                style={{ width: `${Math.max(0.8, (p.churn / max) * 100)}%` }}
              />
            </div>
            <span className="font-editorial text-lg text-neutral-100 w-16 text-right tabular-nums">
              {fmtCompact(p.churn)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
