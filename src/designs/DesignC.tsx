import { dates, daily, cumulative, formatNumber } from '../data';
import { useState } from 'react';

/**
 * Design C — "Terminal Ticker"
 * Looks like a live ticker tape / dashboard readout. Bars become 7-segment digits.
 */
export function DesignC() {
  const [hover, setHover] = useState<number | null>(null);
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
      {/* Ticker tape */}
      <div className="overflow-hidden border-y border-neutral-900 py-1.5">
        <div className="flex marquee-track text-[10px] mono-tag text-neutral-500 whitespace-nowrap">
          {[...Array(2)].flatMap((_, k) =>
            [
              `// SYS.LOAD 0.42`,
              `// MB.WRITTEN +10.0`,
              `// COMMITS 247`,
              `// CHURN -0.03`,
              `// BUILD.PASS 99.4%`,
              `// NIGHTLY.OK`,
              `// CI.GREEN`,
              `// LATENCY 12ms`,
            ].map((s, i) => (
              <span key={`${k}-${i}`} className="px-6">
                {s}
                <span className="mx-6 text-[#d6ff3e]">◆</span>
              </span>
            )),
          )}
        </div>
      </div>

      <div className="flex items-center justify-between text-[10px] mono-tag text-neutral-400">
        <span>
          [A] CUMULATIVE_NET_SOURCE_GROWTH<span className="text-[#d6ff3e]">_</span>
        </span>
        <span>{dates.length} OBS.</span>
      </div>

      <div className="relative group" onMouseLeave={() => setHover(null)}>
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

          {/* Animated line - dash offset trick for terminal "scanning" feel */}
          <path
            d={path}
            fill="none"
            stroke="#f5f5f5"
            strokeWidth={1.25}
            strokeLinecap="round"
            className="transition-all duration-500 group-hover:stroke-[#d6ff3e]"
          />

          {/* Stale ghost line - previous cumulative */}
          <path
            d={cumulative
              .map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(2)} ${(y(v) + 4).toFixed(2)}`)
              .join(' ')}
            fill="none"
            stroke="#262626"
            strokeWidth={1}
            strokeDasharray="2 3"
          />

          {dates.map((_, i) => {
            const cx = x(i);
            const cy = y(cumulative[i]);
            const on = hover === i;
            return (
              <g key={i} onMouseEnter={() => setHover(i)}>
                <rect x={cx - 60} y={0} width={120} height={H} fill="transparent" />
                {on && (
                  <>
                    <line x1={cx} x2={cx} y1={PADY} y2={H - PADY} stroke="#d6ff3e" strokeOpacity={0.5} />
                    <rect x={cx - 6} y={cy - 6} width={12} height={12} fill="none" stroke="#d6ff3e" />
                    <rect x={cx - 2} y={cy - 2} width={4} height={4} fill="#d6ff3e" />
                  </>
                )}
                {!on && <rect x={cx - 1} y={cy - 1} width={2} height={2} fill="#888" />}
              </g>
            );
          })}
        </svg>

        {hover !== null && (
          <div
            className="absolute pointer-events-none font-mono"
            style={{
              left: `${(x(hover) / W) * 100}%`,
              top: `${(y(cumulative[hover]) / H) * 100}%`,
              transform: 'translate(-50%, -150%)',
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

      <div className="space-y-6 pt-8">
        <div className="flex items-center justify-between text-[10px] mono-tag text-neutral-400">
          <span>
            [B] DAILY_NET_SOURCE_CHANGE<span className="text-[#d6ff3e]">_</span>
          </span>
          <span>7 DAYS</span>
        </div>
        <div className="relative h-44">
          <svg viewBox={`0 0 ${W} 180`} className="w-full h-full" preserveAspectRatio="none">
            <line x1={PADX} x2={W - PADX} y1={170} y2={170} stroke="#222" />
            {dates.map((_, i) => {
              const max = Math.max(...daily);
              const bh = (daily[i] / max) * 140;
              const bx = x(i) - 1.5;
              const by = 170 - bh;
              const on = hover === i;
              return (
                <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                  {/* Terminal block */}
                  <rect
                    x={bx - 1}
                    y={by - 2}
                    width={5}
                    height={bh + 2}
                    fill={on ? '#d6ff3e' : '#7a7a7a'}
                    className="transition-colors duration-200"
                  />
                  {on && (
                    <text
                      x={bx + 2}
                      y={by - 6}
                      fill="#d6ff3e"
                      fontSize={9}
                      className="mono-tag"
                      textAnchor="middle"
                    >
                      {formatNumber(daily[i])}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        </div>
      </div>
    </div>
  );
}