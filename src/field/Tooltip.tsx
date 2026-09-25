import type { DayCell } from '../fieldData';
import { formatLong, formatNumber } from '../fieldData';

export function CellTooltip({
  cell,
  accent = false,
}: {
  cell: DayCell;
  accent?: boolean;
}) {
  const churn =
    cell.added + cell.deleted === 0
      ? '—'
      : ((cell.deleted / (cell.added + cell.deleted)) * 100).toFixed(0) + '%';

  return (
    <div
      className={`pointer-events-none min-w-[140px] sm:min-w-[168px] px-2.5 py-2 sm:px-3 sm:py-2.5 text-[9px] sm:text-[10px] mono-tag shadow-2xl ${
        accent
          ? 'bg-[#d6ff3e] text-black'
          : 'bg-[#111] text-neutral-300 border border-neutral-800'
      }`}
    >
      <div className={accent ? 'opacity-70' : 'text-neutral-400'}>
        {formatLong(cell.date)}
      </div>
      <div className="mt-2 grid grid-cols-[1fr_auto] gap-x-6 gap-y-1">
        <span className={accent ? 'opacity-70' : 'text-neutral-500'}>Commits</span>
        <span className={accent ? 'text-black' : 'text-neutral-200'}>
          {formatNumber(cell.commits)}
        </span>
        <span className={accent ? 'opacity-70' : 'text-neutral-500'}>Added</span>
        <span className={accent ? 'text-black' : 'text-neutral-200'}>
          {cell.added >= 0 ? '+' : ''}
          {formatNumber(cell.added)}
        </span>
        <span className={accent ? 'opacity-70' : 'text-neutral-500'}>Deleted</span>
        <span className={accent ? 'text-black' : 'text-neutral-200'}>
          {cell.deleted === 0 ? '-0' : '-' + formatNumber(cell.deleted)}
        </span>
        <span className={accent ? 'opacity-70' : 'text-neutral-500'}>Churn</span>
        <span className={accent ? 'text-black' : 'text-neutral-200'}>{churn}</span>
      </div>
    </div>
  );
}