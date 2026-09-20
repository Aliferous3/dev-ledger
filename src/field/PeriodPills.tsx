import { PERIODS, type Period } from '../fieldData';

export function PeriodPills({
  period,
  setPeriod,
  lime = false,
}: {
  period: Period;
  setPeriod: (p: Period) => void;
  lime?: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-[10px] mono-tag text-neutral-500">Period</span>
      <div className="flex items-center gap-[3px]">
        {PERIODS.map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={`period-btn ${period === p ? (lime ? 'active-lime' : 'active') : ''}`}
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}