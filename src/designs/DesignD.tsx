import { dates, daily, cumulative, formatNumber } from '../data';
import { useState } from 'react';

/**
 * Design D — "Card / Stack"
 * Charts live inside framed cards with labels. Accent colour reveals on hover.
 */
export function DesignD() {
  const [hover, setHover] = useState<number | null>(null);
  const W = 1100;
  const H = 280;
  const PADX = 40;
  const PADY = 30;
  const x = (i: number) => PADX + (i * (W - PADX * 2)) / (dates.length - 1);
  const yMax = Math.max(...cumulative);
  const y = (v: number) => PADY + (1 - v / yMax) * (H - PADY * 2);
  const path = cumulative
    .map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(2)} ${y(v).toFixed(2)}`)
    .join(' ');

  return (
    <div className="space-y-8">
      {/* Card A */}
      <div className="border border-neutral-900 bg-neutral-950/40 p-6 transition-colors duration-500 hover:border-neutral-800">
        <div className="flex items-center justify-between text-[10px] mono-tag text-neutral-500 mb-6">
          <span>◰ Fig. A — Cumulative Net Source Growth</span>
          <span>{dates.length} OBS.</span>
        </div>

        <div className="relative group" onMouseLeave={() => setHover(null)}>
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
            {/* Gradient fill under line */}
            <defs>
              <linearGradient id="fillD" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="#d6ff3e" stopOpacity="0.18" />
                <stop offset="100%" stopColor="#d6ff3e" stopOpacity="0" />
              </linearGradient>
            </defs>

            {/* Filled area */}
            <path
              d={`${path} L ${x(dates.length - 1)} ${H - PADY} L ${PADX} ${H - PADY} Z`}
              fill="url(#fillD)"
              className="opacity-0 group-hover:opacity-100 transition-opacity duration-700"
            />

            {[0.25, 0.5, 0.75].map((g) => (
              <line
                key={g}
                x1={PADX}
                x2={W - PADX}
                y1={PADY + (H - PADY * 2) * g}
                y2={PADY + (H - PADY * 2) * g}
                stroke="#1a1a1a"
              />
            ))}

            <path
              d={path}
              fill="none"
              stroke="#f5f5f5"
              strokeWidth={1.25}
              strokeLinecap="round"
              className="transition-all duration-500 group-hover:stroke-[#d6ff3e]"
            />

            {dates.map((d, i) => {
              const cx = x(i);
              const cy = y(cumulative[i]);
              const on = hover === i;
              return (
                <g key={i} onMouseEnter={() => setHover(i)}>
                  <rect x={cx - 60} y={0} width={120} height={H} fill="transparent" />
                  {on && (
                    <line x1={cx} x2={cx} y1={PADY} y2={H - PADY} stroke="#d6ff3e" strokeOpacity={0.4} strokeDasharray="3 4" />
                  )}
                  <circle
                    cx={cx}
                    cy={cy}
                    r={on ? 6 : 3}
                    fill={on ? '#d6ff3e' : '#0a0a0a'}
                    stroke={on ? '#d6ff3e' : '#777'}
                    strokeWidth={1}
                    className="transition-all duration-300"
                  />
                  <text
                    x={cx}
                    y={H - 4}
                    textAnchor="middle"
                    fontSize={9}
                    className="mono-tag transition-colors"
                    fill={on ? '#d6ff3e' : '#555'}
                  >
                    {d.slice(5)}
                  </text>
                </g>
              );
            })}
          </svg>

          {hover !== null && (
            <div
              className="absolute pointer-events-none"
              style={{
                left: `${(x(hover) / W) * 100}%`,
                top: `${(y(cumulative[hover]) / H) * 100}%`,
                transform: 'translate(-50%, -140%)',
              }}
            >
              <div className="bg-black border border-[#d6ff3e] px-3 py-2 text-[10px] mono-tag">
                <div className="text-[#d6ff3e]">{dates[hover]}</div>
                <div className="text-neutral-100 text-[12px] mono-tag mt-0.5">
                  +{formatNumber(cumulative[hover])}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Card B */}
      <div className="border border-neutral-900 bg-neutral-950/40 p-6 transition-colors duration-500 hover:border-neutral-800">
        <div className="flex items-center justify-between text-[10px] mono-tag text-neutral-500 mb-6">
          <span>◰ Fig. B — Daily Net Source Change</span>
          <span>7 DAYS</span>
        </div>
        <div className="relative h-44">
          <svg viewBox={`0 0 ${W} 180`} className="w-full h-full" preserveAspectRatio="none">
            <line x1={PADX} x2={W - PADX} y1={170} y2={170} stroke="#222" />
            {dates.map((d, i) => {
              const max = Math.max(...daily);
              const bh = (daily[i] / max) * 130;
              const bx = x(i) - 1.5;
              const by = 170 - bh;
              const on = hover === i;
              return (
                <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                  <rect
                    x={bx - 2}
                    y={by - 3}
                    width={7}
                    height={bh + 3}
                    fill={on ? '#d6ff3e' : '#888'}
                    className="transition-all duration-300"
                  />
                  <text
                    x={x(i)}
                    y={178}
                    textAnchor="middle"
                    fontSize={9}
                    className="mono-tag"
                    fill={on ? '#d6ff3e' : '#555'}
                  >
                    {d.slice(5)}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      </div>
    </div>
  );
}