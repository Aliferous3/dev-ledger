import { dates, daily, cumulative, formatNumber } from '../data';
import { useState } from 'react';

/**
 * Design E — "Bracket / Annotated"
 * Minimalist with corner brackets framing charts, axis labels and a bold accent at the peak.
 */
export function DesignE() {
  const [hover, setHover] = useState<number | null>(null);
  const W = 1100;
  const H = 280;
  const PADX = 50;
  const PADY = 30;
  const x = (i: number) => PADX + (i * (W - PADX * 2)) / (dates.length - 1);
  const yMax = Math.max(...cumulative);
  const y = (v: number) => PADY + (1 - v / yMax) * (H - PADY * 2);
  const path = cumulative
    .map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(2)} ${y(v).toFixed(2)}`)
    .join(' ');

  const peakIdx = cumulative.indexOf(Math.max(...cumulative));

  return (
    <div className="space-y-10">
      <div className="flex items-center justify-between text-[10px] mono-tag text-neutral-500">
        <span>╲ Fig. A — Cumulative Net Source Growth</span>
        <span>{dates.length} OBS.</span>
      </div>

      <div
        className="relative group"
        onMouseLeave={() => setHover(null)}
        style={{
          boxShadow:
            'inset 24px 24px 0 -23px #262626, inset -24px -24px 0 -23px #262626',
        }}
      >
        {/* corner brackets */}
        <span className="absolute top-0 left-0 w-3 h-3 border-t border-l border-neutral-600" />
        <span className="absolute top-0 right-0 w-3 h-3 border-t border-r border-neutral-600" />
        <span className="absolute bottom-0 left-0 w-3 h-3 border-b border-l border-neutral-600" />
        <span className="absolute bottom-0 right-0 w-3 h-3 border-b border-r border-neutral-600" />

        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
          {[0.25, 0.5, 0.75].map((g) => (
            <line
              key={g}
              x1={PADX}
              x2={W - PADX}
              y1={PADY + (H - PADY * 2) * g}
              y2={PADY + (H - PADY * 2) * g}
              stroke="#171717"
            />
          ))}

          {/* axis labels - y */}
          <text x={6} y={PADY + 4} fill="#444" fontSize={9} className="mono-tag">
            PEAK
          </text>
          <text x={6} y={H - PADY + 4} fill="#444" fontSize={9} className="mono-tag">
            BASE
          </text>

          <path
            d={path}
            fill="none"
            stroke="#f5f5f5"
            strokeWidth={1.25}
            strokeLinecap="round"
            className="transition-all duration-500"
          />

          {/* Peak marker */}
          <g>
            <line
              x1={x(peakIdx)}
              x2={x(peakIdx)}
              y1={y(cumulative[peakIdx])}
              y2={H - PADY}
              stroke="#d6ff3e"
              strokeOpacity={0.4}
              strokeDasharray="2 4"
            />
            <circle
              cx={x(peakIdx)}
              cy={y(cumulative[peakIdx])}
              r={5}
              fill="#0a0a0a"
              stroke="#d6ff3e"
              strokeWidth={1.5}
              className="glow-on-hover"
            />
            <text
              x={x(peakIdx) - 8}
              y={y(cumulative[peakIdx]) - 10}
              textAnchor="end"
              fill="#d6ff3e"
              fontSize={10}
              className="mono-tag"
            >
              PEAK ▲
            </text>
          </g>

          {dates.map((_, i) => {
            const cx = x(i);
            const cy = y(cumulative[i]);
            const on = hover === i;
            if (i === peakIdx) return null;
            return (
              <g key={i} onMouseEnter={() => setHover(i)}>
                <rect x={cx - 60} y={0} width={120} height={H} fill="transparent" />
                {on && (
                  <line
                    x1={cx}
                    x2={cx}
                    y1={PADY}
                    y2={H - PADY}
                    stroke="#d6ff3e"
                    strokeOpacity={0.4}
                  />
                )}
                <circle
                  cx={cx}
                  cy={cy}
                  r={on ? 5 : 2.5}
                  fill={on ? '#d6ff3e' : '#0a0a0a'}
                  stroke={on ? '#d6ff3e' : '#666'}
                  strokeWidth={1}
                  className="transition-all duration-300"
                />
              </g>
            );
          })}

          {/* axis - x labels */}
          {dates.map((d, i) => (
            <text
              key={d}
              x={x(i)}
              y={H - 6}
              textAnchor="middle"
              fill={hover === i ? '#d6ff3e' : '#555'}
              fontSize={9}
              className="mono-tag transition-colors"
            >
              {d.slice(5)}
            </text>
          ))}
        </svg>

        {hover !== null && (
          <div
            className="absolute pointer-events-none"
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
        <div className="flex items-center justify-between text-[10px] mono-tag text-neutral-500">
          <span>╲ Fig. B — Daily Net Source Change</span>
          <span>7 DAYS</span>
        </div>
        <div
          className="relative h-44"
          style={{
            boxShadow:
              'inset 24px 24px 0 -23px #262626, inset -24px -24px 0 -23px #262626',
          }}
        >
          <span className="absolute top-0 left-0 w-3 h-3 border-t border-l border-neutral-600" />
          <span className="absolute top-0 right-0 w-3 h-3 border-t border-r border-neutral-600" />
          <span className="absolute bottom-0 left-0 w-3 h-3 border-b border-l border-neutral-600" />
          <span className="absolute bottom-0 right-0 w-3 h-3 border-b border-r border-neutral-600" />

          <svg viewBox={`0 0 ${W} 180`} className="w-full h-full" preserveAspectRatio="none">
            <line x1={PADX} x2={W - PADX} y1={170} y2={170} stroke="#1f1f1f" />
            {dates.map((_, i) => {
              const max = Math.max(...daily);
              const bh = (daily[i] / max) * 130;
              const bx = x(i) - 1.5;
              const by = 170 - bh;
              const on = hover === i;
              return (
                <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                  <rect
                    x={bx}
                    y={by}
                    width={3}
                    height={bh}
                    fill={on ? '#d6ff3e' : '#aaa'}
                    className="transition-all duration-300"
                  />
                  <line
                    x1={bx + 1.5}
                    x2={bx + 1.5}
                    y1={by + bh + 2}
                    y2={by + bh + 6}
                    stroke={on ? '#d6ff3e' : '#555'}
                    strokeWidth={1}
                  />
                </g>
              );
            })}
          </svg>
        </div>
      </div>
    </div>
  );
}