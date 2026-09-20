import { useRef, useState } from 'react';
import { DOW, weeks, type DayCell } from '../fieldData';
import { CellTooltip } from './Tooltip';

export type HeatmapVariant = 'square' | 'round' | 'tick' | 'plus';

type Props = {
  hover: DayCell | null;
  setHover: (c: DayCell | null) => void;
  isDimmed: (c: DayCell) => boolean;
  colorFor: (c: DayCell, hovered: boolean) => string;
  variant?: HeatmapVariant;
  accentHover?: boolean;
  showCrosshair?: boolean;
  peakIso?: string | null;
};

export function Heatmap({
  hover,
  setHover,
  isDimmed,
  colorFor,
  variant = 'square',
  accentHover = false,
  showCrosshair = false,
  peakIso = null,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null);

  const onEnter = (c: DayCell, e: React.MouseEvent<HTMLDivElement>) => {
    setHover(c);
    const root = wrapRef.current?.getBoundingClientRect();
    const cell = e.currentTarget.getBoundingClientRect();
    if (!root) return;
    setTip({
      x: cell.left - root.left + cell.width / 2,
      y: cell.top - root.top,
    });
  };

  const shape =
    variant === 'round'
      ? 'rounded-full'
      : variant === 'tick'
        ? 'rounded-[1px]'
        : 'rounded-[1.5px]';

  return (
    <div ref={wrapRef} className="relative">
      <div
        className="grid"
        style={{
          gridTemplateColumns: `18px repeat(${weeks.length}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(7, minmax(0, 1fr)) 16px`,
          gap: '3px',
          aspectRatio: `${weeks.length + 1.2} / 7.6`,
        }}
      >
        {DOW.map((d, i) => (
          <div
            key={`dow-${i}`}
            className="text-[9px] mono-tag text-neutral-600 flex items-center"
            style={{ gridColumn: 1, gridRow: i + 1 }}
          >
            {d}
          </div>
        ))}

        {weeks.map((week) =>
          week.days.map((cell, di) => {
            const col = week.index + 2;
            const row = di + 1;
            if (!cell) {
              return (
                <div
                  key={`${week.index}-${di}`}
                  style={{ gridColumn: col, gridRow: row }}
                />
              );
            }
            const hovered = hover?.iso === cell.iso;
            const dim = isDimmed(cell);
            const isPeak = peakIso === cell.iso;
            const bg = dim ? '#1c1c1c' : colorFor(cell, hovered);

            return (
              <div
                key={cell.iso}
                onMouseEnter={(e) => onEnter(cell, e)}
                onMouseLeave={() => {
                  setHover(null);
                  setTip(null);
                }}
                className={`heat-cell relative ${shape}`}
                style={{
                  gridColumn: col,
                  gridRow: row,
                  background: bg,
                  boxShadow: hovered
                    ? '0 0 0 1px #d6ff3e, 0 0 14px rgba(214,255,62,0.4)'
                    : isPeak
                      ? '0 0 0 1px #d6ff3e'
                      : 'none',
                  transform: hovered ? 'scale(1.45)' : 'scale(1)',
                  opacity: dim ? 0.3 : 1,
                  zIndex: hovered ? 10 : 1,
                }}
              >
                {variant === 'plus' && cell.intensity > 0 && !dim && (
                  <span
                    className="absolute inset-0 flex items-center justify-center text-[8px] leading-none"
                    style={{ color: cell.intensity >= 3 ? '#0a0a0a' : '#888' }}
                  >
                    +
                  </span>
                )}
              </div>
            );
          }),
        )}

        {weeks.map((week) => (
          <div
            key={`m-${week.index}`}
            className="text-[9px] mono-tag text-neutral-600 leading-none flex items-end"
            style={{ gridColumn: week.index + 2, gridRow: 8 }}
          >
            {week.monthLabel ?? ''}
          </div>
        ))}
      </div>

      {showCrosshair && hover && tip && (
        <div className="pointer-events-none absolute inset-0 z-[5]">
          <div
            className="absolute top-0 bottom-5 w-px bg-[#d6ff3e]/25"
            style={{ left: tip.x }}
          />
        </div>
      )}

      {hover && tip && (
        <div
          className="absolute z-30 pointer-events-none"
          style={{
            left: Math.min(Math.max(tip.x, 90), (wrapRef.current?.offsetWidth ?? 400) - 90),
            top: tip.y,
            transform: tip.y < 90 ? 'translate(-50%, 18px)' : 'translate(-50%, calc(-100% - 10px))',
          }}
        >
          <CellTooltip cell={hover} accent={accentHover} />
        </div>
      )}
    </div>
  );
}