import { fmt } from '../codeData';

export interface CodeTotals {
  sourceBytes: string;
  linesAdded: number;
  linesDeleted: number;
  netLines: number;
  totalChurn: string;
}

/* Section header — Attachment 1 composition (lime eyebrow, serif title)
   with the spec-variant totals row from CodeShared.CodeTotals. */
export function CodeHeader({ totals, langCount }: { totals: CodeTotals; langCount: number }) {
  const items = [
    { k: 'SOURCE BYTES', v: totals.sourceBytes },
    { k: 'LINES ADDED', v: fmt(totals.linesAdded) },
    { k: 'LINES DELETED', v: fmt(totals.linesDeleted) },
    { k: 'NET LINES', v: fmt(totals.netLines) },
    { k: 'TOTAL CHURN', v: totals.totalChurn },
  ];

  return (
    <div className="border-b border-neutral-900 pb-6 space-y-6">
      <div>
        <div className="mono-tag text-[10px] text-[#d6ff3e]">
          [06] CODE<span className="cursor-blink">_</span>
          <span className="text-neutral-500"> // MOSAIC · AREA = BYTES</span>
        </div>
        <h2 className="font-editorial text-4xl sm:text-5xl text-neutral-100 mt-2">Source Composition</h2>
        <div className="mono-tag text-[9px] text-neutral-500 mt-1">
          WORKING-TREE SNAPSHOT · {langCount} LANGUAGES · LINE DELTAS TRACKED PER PERIOD
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 border-t border-neutral-900">
        {items.map((t, i) => (
          <div key={t.k} className={`relative py-4 px-4 group ${i > 0 ? 'md:border-l md:border-neutral-900' : ''}`}>
            <span className="absolute top-2 left-2 w-1.5 h-1.5 border-t border-l border-[#d6ff3e]/60" />
            <div className="mono-tag text-[8px] text-neutral-500 group-hover:text-[#d6ff3e] transition-colors">
              {t.k}
            </div>
            <div className="font-editorial text-3xl text-neutral-100 mt-1 tabular-nums group-hover:text-[#d6ff3e] transition-colors">
              {t.v}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
