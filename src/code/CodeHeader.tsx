import { NumBytes, NumCompact, NumGrouped } from '../ledger/Num';
import { SkNum } from '../ledger/Skeleton';

export interface CodeTotals {
  sourceBytes: number; // raw bytes — NumBytes resolves the unit
  linesAdded: number;
  linesDeleted: number;
  netLines: number;
  totalChurn: number;
}

/* Section header — Attachment 1 composition (lime eyebrow, serif title)
   with the spec-variant totals row from CodeShared.CodeTotals. All values
   are raw numbers animated by Num on change; while `resolving` the row
   shows size-matched skeleton metrics instead of zeros. */
export function CodeHeader({
  totals,
  langCount,
  resolving = false,
}: {
  totals: CodeTotals;
  langCount: number;
  resolving?: boolean;
}) {
  const items: { k: string; n: number; kind: 'bytes' | 'compact' | 'grouped' }[] = [
    { k: 'SOURCE BYTES', n: totals.sourceBytes, kind: 'bytes' },
    { k: 'LINES ADDED', n: totals.linesAdded, kind: 'grouped' },
    { k: 'LINES DELETED', n: totals.linesDeleted, kind: 'grouped' },
    { k: 'NET LINES', n: totals.netLines, kind: 'grouped' },
    { k: 'TOTAL CHURN', n: totals.totalChurn, kind: 'compact' },
  ];

  return (
    <div className="border-b border-neutral-900 pb-5 md:pb-6 space-y-4 md:space-y-6">
      <div>
        <div className="mono-tag text-[10px] text-[#d6ff3e]">
          [06] CODE<span className="cursor-blink">_</span>
          <span className="text-neutral-500"> // MOSAIC · AREA = BYTES</span>
        </div>
        <h2 className="font-editorial text-4xl sm:text-5xl text-neutral-100 mt-1.5 md:mt-2">Source Composition</h2>
        <div className="mono-tag text-[9px] text-neutral-500 mt-1">
          WORKING-TREE SNAPSHOT · {resolving ? '…' : <NumGrouped value={langCount} className="inline-flex" />} LANGUAGES · LINE DELTAS TRACKED PER PERIOD
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 border-t border-neutral-900">
        {items.map((t, i) => (
          <div key={t.k} className={`relative py-3 px-3 sm:py-4 sm:px-4 group ${i > 0 ? 'md:border-l md:border-neutral-900' : ''}`}>
            <span className="absolute top-2 left-2 w-1.5 h-1.5 border-t border-l border-[#d6ff3e]/60" />
            <div className="mono-tag text-[8px] text-neutral-500 group-hover:text-[#d6ff3e] transition-colors">
              {t.k}
            </div>
            <div className="font-editorial text-3xl text-neutral-100 mt-1 tabular-nums group-hover:text-[#d6ff3e] transition-colors">
              {resolving ? (
                <SkNum h={28} w="70%" />
              ) : t.kind === 'bytes' ? (
                <NumBytes value={t.n} />
              ) : t.kind === 'compact' ? (
                <NumCompact value={t.n} />
              ) : (
                <NumGrouped value={t.n} />
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
