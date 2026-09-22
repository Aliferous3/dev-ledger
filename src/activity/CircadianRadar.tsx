import type { RhythmBundle } from '../store/live';
import { NumPct } from '../ledger/Num';

/* Circadian radar body — extracted from ActivityRadar (Design 04) minus
   its internal page header. The active hour is owned by ActivityPage:
   `onHover` / `onSelect` mutate it, so the header focus box and this dial
   can never disagree. */
export function CircadianRadar({
  activeHour,
  onHover,
  onSelect,
  rhythm,
}: {
  activeHour: number;
  onHover: (h: number | null) => void;
  onSelect: (h: number) => void;
  rhythm: RhythmBundle;
}) {
  // 24 hours around the dial: hour 00 at top (-90°), 06 right, 12 bottom, 18 left
  const cx = 220;
  const cy = 220;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center bg-black/40 border border-neutral-900 p-6 md:p-8">
      {/* Left: 24-Hour Circular Chrono-Dial (SVG) */}
      <div className="lg:col-span-7 flex items-center justify-center relative select-none">
        <svg
          viewBox="0 0 440 440"
          className="w-full max-w-[420px] h-auto overflow-visible"
          role="img"
          aria-label="24-hour circadian commit dial"
        >
          <defs>
            <radialGradient id="chronoGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#d6ff3e" stopOpacity="0.12" />
              <stop offset="60%" stopColor="#d6ff3e" stopOpacity="0.02" />
              <stop offset="100%" stopColor="#000000" stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* Backdrop glow */}
          <circle cx={cx} cy={cy} r={180} fill="url(#chronoGlow)" />

          {/* Concentric rings for the 7 days */}
          {[45, 65, 85, 105, 125, 145, 165].map((r, i) => (
            <circle
              key={i}
              cx={cx}
              cy={cy}
              r={r}
              fill="none"
              stroke="#1f1f1f"
              strokeWidth="1"
              strokeDasharray={i % 2 === 1 ? '2 4' : undefined}
            />
          ))}

          {/* 24 Hour radial spokes — focusable targets; focus mirrors hover */}
          {Array.from({ length: 24 }).map((_, h) => {
            const angle = (h / 24) * 360 - 90;
            const rad = (angle * Math.PI) / 180;
            const x1 = cx + Math.cos(rad) * 45;
            const y1 = cy + Math.sin(rad) * 45;
            const x2 = cx + Math.cos(rad) * 175;
            const y2 = cy + Math.sin(rad) * 175;
            const isSelected = activeHour === h;
            const isTick = h % 3 === 0;

            return (
              <g
                key={h}
                className="cursor-pointer outline-none"
                role="button"
                tabIndex={0}
                aria-label={`Hour ${String(h).padStart(2, '0')}:00 UTC`}
                aria-pressed={isSelected}
                onClick={() => onSelect(h)}
                onMouseEnter={() => onHover(h)}
                onMouseLeave={() => onHover(null)}
                onFocus={() => onHover(h)}
                onBlur={() => onHover(null)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelect(h);
                  }
                }}
              >
                <line
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke={isSelected ? '#d6ff3e' : isTick ? '#333' : '#1c1c1c'}
                  strokeWidth={isSelected ? 2 : 1}
                />
                {/* invisible wide hit target along the spoke */}
                <line
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke="transparent"
                  strokeWidth="12"
                />

                {/* Outer Hour Label */}
                {isTick && (
                  <text
                    x={cx + Math.cos(rad) * 196}
                    y={cy + Math.sin(rad) * 196 + 3}
                    fill={isSelected ? '#d6ff3e' : '#666'}
                    fontSize="9"
                    fontFamily="JetBrains Mono"
                    textAnchor="middle"
                  >
                    {String(h).padStart(2, '0')}
                  </text>
                )}
              </g>
            );
          })}

          {/* Radial Sweep Needle pointing to active hour */}
          {(() => {
            const angle = (activeHour / 24) * 360 - 90;
            const rad = (angle * Math.PI) / 180;
            const nx = cx + Math.cos(rad) * 175;
            const ny = cy + Math.sin(rad) * 175;
            return (
              <g>
                <line
                  x1={cx}
                  y1={cy}
                  x2={nx}
                  y2={ny}
                  stroke="#d6ff3e"
                  strokeWidth="1.8"
                  strokeDasharray="4 3"
                  className="animate-pulse"
                />
                <circle cx={nx} cy={ny} r="4" fill="#d6ff3e" />
                <circle cx={nx} cy={ny} r="9" fill="none" stroke="#d6ff3e" strokeWidth="1" opacity="0.6" />
              </g>
            );
          })()}

          {/* Center Dial Hub */}
          <circle cx={cx} cy={cy} r="35" fill="#0d0d0d" stroke="#2d2d2d" strokeWidth="1.5" />
          <circle cx={cx} cy={cy} r="4" fill="#d6ff3e" className="pulse-dot" />
          <text
            x={cx}
            y={cy + 16}
            fill="#888"
            fontSize="8"
            fontFamily="JetBrains Mono"
            textAnchor="middle"
            letterSpacing="0.1em"
          >
            24H UTC
          </text>
        </svg>
      </div>

      {/* Right: Circadian breakdown and Window tiles */}
      <div className="lg:col-span-5 space-y-6">
        <div className="mono-tag text-[9px] text-neutral-400">CIRCADIAN DISTRIBUTION</div>

        <div className="space-y-3">
          {rhythm.windows.map((w) => (
            <div
              key={w.label}
              className="p-3 border border-neutral-900 bg-black/60 hover:border-neutral-700 transition-colors"
            >
              <div className="flex justify-between items-baseline mb-1">
                <span className="mono-tag text-[10px] text-neutral-200">{w.label}</span>
                <span className="font-editorial text-2xl text-[#d6ff3e] tabular-nums inline-flex"><NumPct value={w.pct} /></span>
              </div>
              <div className="w-full bg-neutral-900 h-1 overflow-hidden">
                <div className="h-full bg-[#d6ff3e]" style={{ width: `${w.pct * 2.2}%` }} />
              </div>
              <div className="mono-tag text-[8px] text-neutral-500 mt-1">{w.range}</div>
            </div>
          ))}
        </div>

        <div className="p-4 border border-neutral-800 bg-[#0e0e0e] mono-tag text-[9px] text-neutral-400 space-y-1">
          <div className="text-[#d6ff3e] font-semibold">// PEAK CADENCE LOCATED</div>
          <div>
            {rhythm.highlights.peakWeekday} {rhythm.highlights.peakWindow} UTC ACCOUNTS FOR{' '}
            <NumPct value={rhythm.windows[3]?.pct ?? 0} className="inline-flex" /> OF ALL ENGINE COMMITS.
          </div>
        </div>
      </div>
    </div>
  );
}
