import { dates, daily, cumulative, formatNumber } from '../data';
import { useState } from 'react';

/**
 * Design A — "Mono-Editorial"
 * Faithful reproduction of the original aesthetic with hover polish.
 */
export function DesignA() {
  const [hoverLine, setHoverLine] = useState<number | null>(null);
  const [hoverBar, setHoverBar] = useState<number | null>(null);

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
    <div className="space-y-10">
      <div className="flex items-center justify-between text-[10px] mono-tag text-neutral-500">
        <span>Fig. A — Cumulative Net Source Growth</span>
        <span>{dates.length} Obs.</span>
      </div>

      {/* Line chart */}
      <div className="relative" onMouseLeave={() => setHoverLine(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
          {[0.25, 0.5, 0.75].map((g) => (
            <line
              key={g}
              x1={PADX}
              x2={W - PADX}
              y1={PADY + (H - PADY * 2) * g}
              y2={PADY + (H - PADY * 2) * g}
              stroke="#1a1a1a"
              strokeWidth={1}
            />
          ))}

          <path
            d={path}
            fill="none"
            stroke="#f5f5f5"
            strokeWidth={1.25}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="transition-all duration-500"
          />

          {/* Invisible hover zones */}
          {dates.map((_, i) => (
            <g key={i}>
              <rect
                x={x(i) - 60}
                y={0}
                width={120}
                height={H}
                fill="transparent"
                onMouseEnter={() => setHoverLine(i)}
              />
              {hoverLine === i && (
                <>
                  <line
                    x1={x(i)}
                    x2={x(i)}
                    y1={PADY}
                    y2={H - PADY}
                    stroke="#d6ff3e"
                    strokeOpacity={0.5}
                    strokeDasharray="2 4"
                  />
                  <circle
                    cx={x(i)}
                    cy={y(cumulative[i])}
                    r={5}
                    fill="#0a0a0a"
                    stroke="#d6ff3e"
                    strokeWidth={1.5}
                  />
                </>
              )}
            </g>
          ))}
        </svg>

        {hoverLine !== null && (
          <div
            className="absolute pointer-events-none"
            style={{
              left: `${(x(hoverLine) / W) * 100}%`,
              top: `${(y(cumulative[hoverLine]) / H) * 100}%`,
              transform: 'translate(-50%, -130%)',
            }}
          >
            <div className="relative bg-neutral-900 border border-neutral-800 px-3 py-2 text-[10px] mono-tag shadow-2xl">
              <div className="text-neutral-500">{dates[hoverLine]}</div>
              <div className="text-neutral-100 mt-0.5 text-[12px] mono-tag">
                {cumulative[hoverLine] >= 0 ? '+' : ''}
                {formatNumber(cumulative[hoverLine])}
              </div>
              <span className="arrow bg-neutral-900 border-r border-b border-neutral-800 absolute" />
            </div>
          </div>
        )}
      </div>

      {/* Bar chart */}
      <div className="space-y-6 pt-8">
        <div className="flex items-center justify-between text-[10px] mono-tag text-neutral-500">
          <span>Fig. B — Daily Net Source Change</span>
          <span>7 Days</span>
        </div>
        <div className="relative h-44">
          <svg viewBox={`0 0 ${W} 180`} className="w-full h-full" preserveAspectRatio="none">
            <line x1={PADX} x2={W - PADX} y1={170} y2={170} stroke="#1a1a1a" />
            {dates.map((_, i) => {
              const max = Math.max(...daily);
              const bh = (daily[i] / max) * 140;
              const bx = x(i) - 1.5;
              const by = 170 - bh;
              const isHover = hoverBar === i;
              const isPeak = daily[i] === max;
              return (
                <g key={i} onMouseEnter={() => setHoverBar(i)} onMouseLeave={() => setHoverBar(null)}>
                  <rect
                    x={bx}
                    y={by}
                    width={3}
                    height={bh}
                    fill={isHover ? '#d6ff3e' : isPeak ? '#f5f5f5' : '#9a9a9a'}
                    className="transition-all duration-300"
                  />
                  {isPeak && (
                    <circle
                      cx={bx + 1.5}
                      cy={by - 4}
                      r={3}
                      fill="none"
                      stroke="#f5f5f5"
                      strokeWidth={1}
                    />
                  )}
                </g>
              );
            })}
          </svg>
          {hoverBar !== null && (
            <div
              className="absolute pointer-events-none"
              style={{
                left: `${(x(hoverBar) / W) * 100}%`,
                bottom: `${((daily[hoverBar] / Math.max(...daily)) * 140) / 180 * 100 + 6}%`,
                transform: 'translateX(-50%)',
              }}
            >
              <div className="relative bg-neutral-900 border border-neutral-800 px-3 py-2 text-[10px] mono-tag">
                <div className="text-neutral-500">{dates[hoverBar]}</div>
                <div className="text-neutral-100 mt-0.5 text-[12px] mono-tag">
                  +{formatNumber(daily[hoverBar])}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}