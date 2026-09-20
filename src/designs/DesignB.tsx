import { dates, daily, cumulative, formatNumber } from '../data';
import { useState } from 'react';

/**
 * Design B — "Blueprint Grid"
 * Engineering notebook aesthetic with grid background, crosshair markers and lime highlights.
 */
export function DesignB() {
  const [active, setActive] = useState<number | null>(null);
  const W = 1100;
  const H = 320;
  const PADX = 40;
  const PADY = 30;
  const x = (i: number) => PADX + (i * (W - PADX * 2)) / (dates.length - 1);
  const yMax = Math.max(...cumulative);
  const y = (v: number) => PADY + (1 - v / yMax) * (H - PADY * 2);

  const path = cumulative
    .map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(2)} ${y(v).toFixed(2)}`)
    .join(' ');

  return (
    <div className="space-y-10 relative">
      <div className="grid-bg absolute inset-0 -z-10 opacity-60" />

      <div className="flex items-center justify-between text-[10px] mono-tag text-neutral-400">
        <span>
          <span className="text-[#d6ff3e]">◤</span> Fig. A — Cumulative Net Source Growth
        </span>
        <span className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-[#d6ff3e] pulse-dot" />
          {dates.length} Obs.
        </span>
      </div>

      <div className="relative group" onMouseLeave={() => setActive(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
          {/* Grid */}
          {[0.25, 0.5, 0.75].map((g) => (
            <line
              key={g}
              x1={PADX}
              x2={W - PADX}
              y1={PADY + (H - PADY * 2) * g}
              y2={PADY + (H - PADY * 2) * g}
              stroke="#1a1a1a"
              strokeWidth={1}
              strokeDasharray="2 4"
            />
          ))}
          {/* Vertical guidelines */}
          {dates.map((_, i) => (
            <line
              key={i}
              x1={x(i)}
              x2={x(i)}
              y1={PADY}
              y2={H - PADY}
              stroke="#141414"
              strokeWidth={1}
            />
          ))}

          <path
            d={path}
            fill="none"
            stroke="#d6ff3e"
            strokeWidth={1.5}
            strokeLinecap="round"
            className="transition-all duration-700 group-hover:drop-shadow-[0_0_8px_rgba(214,255,62,0.5)]"
          />

          {dates.map((d, i) => {
            const cx = x(i);
            const cy = y(cumulative[i]);
            const on = active === i;
            return (
              <g key={i} onMouseEnter={() => setActive(i)}>
                <rect x={cx - 60} y={0} width={120} height={H} fill="transparent" />
                {/* Crosshair */}
                {on && (
                  <>
                    <line x1={cx} x2={cx} y1={PADY} y2={H - PADY} stroke="#d6ff3e" strokeOpacity={0.5} />
                    <line x1={PADX} x2={W - PADX} y1={cy} y2={cy} stroke="#d6ff3e" strokeOpacity={0.5} />
                    <circle cx={cx} cy={cy} r={8} fill="none" stroke="#d6ff3e" strokeWidth={1} className="pulse-dot" />
                  </>
                )}
                {/* Base dot */}
                <circle
                  cx={cx}
                  cy={cy}
                  r={on ? 4 : 2}
                  fill={on ? '#d6ff3e' : '#0a0a0a'}
                  stroke="#d6ff3e"
                  strokeWidth={1}
                  className="transition-all duration-300"
                />
                {/* Date label */}
                <text
                  x={cx}
                  y={H - 4}
                  textAnchor="middle"
                  fill={on ? '#d6ff3e' : '#555'}
                  fontSize={9}
                  className="mono-tag transition-colors duration-300"
                >
                  {d.slice(5)}
                </text>
              </g>
            );
          })}
        </svg>

        {active !== null && (
          <div
            className="absolute pointer-events-none"
            style={{
              left: `${(x(active) / W) * 100}%`,
              top: `${(y(cumulative[active]) / H) * 100}%`,
              transform: 'translate(-50%, -130%)',
            }}
          >
            <div className="relative bg-[#d6ff3e] text-black px-3 py-2 text-[10px] mono-tag shadow-[0_0_24px_rgba(214,255,62,0.4)]">
              <div className="opacity-70">{dates[active]}</div>
              <div className="text-[12px] mono-tag mt-0.5">
                {cumulative[active] >= 0 ? '+' : ''}
                {formatNumber(cumulative[active])}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Bar chart */}
      <div className="space-y-6 pt-8">
        <div className="flex items-center justify-between text-[10px] mono-tag text-neutral-400">
          <span>
            <span className="text-[#d6ff3e]">◤</span> Fig. B — Daily Net Source Change
          </span>
          <span>7 Days</span>
        </div>
        <div className="relative h-44">
          <svg viewBox={`0 0 ${W} 180`} className="w-full h-full" preserveAspectRatio="none">
            <line x1={PADX} x2={W - PADX} y1={170} y2={170} stroke="#222" />
            {dates.map((_, i) => {
              const max = Math.max(...daily);
              const bh = (daily[i] / max) * 140;
              const bx = x(i) - 1.5;
              const by = 170 - bh;
              const on = active === i;
              return (
                <g
                  key={i}
                  onMouseEnter={() => setActive(i)}
                  onMouseLeave={() => setActive(null)}
                  className="cursor-pointer"
                >
                  {/* Ticked extension below baseline */}
                  <line
                    x1={bx + 1.5}
                    x2={bx + 1.5}
                    y1={170}
                    y2={175}
                    stroke={on ? '#d6ff3e' : '#333'}
                    strokeWidth={1}
                  />
                  <rect
                    x={bx}
                    y={by}
                    width={3}
                    height={bh}
                    fill={on ? '#d6ff3e' : '#666'}
                    className="transition-all duration-300 hover:fill-[#d6ff3e]"
                  />
                  {/* Tick mark */}
                  <rect x={bx - 2} y={by - 2} width={7} height={2} fill={on ? '#d6ff3e' : '#888'} className="transition-colors" />
                </g>
              );
            })}
          </svg>
        </div>
      </div>
    </div>
  );
}