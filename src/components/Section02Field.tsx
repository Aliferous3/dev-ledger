import { useState } from 'react';
import type { Period } from '../types';
import {
  weeks,
  DOW,
  formatBytes,
  languages,
  languageTotal,
  type DayCell,
} from '../fieldData';
import { CellTooltip } from '../field/Tooltip';

interface Props {
  period: Period;
  setPeriod: (p: Period) => void;
}

const BLOCKS = ['·', '░', '▒', '▓', '█'] as const;

export function Section02Field({ period, setPeriod }: Props) {
  const [hoverCell, setHoverCell] = useState<DayCell | null>(null);
  const [tipCoords, setTipCoords] = useState<{ x: number; y: number } | null>(null);
  const [hoverLang, setHoverLang] = useState<string | null>(null);

  return (
    <section id="section-02" className="relative scroll-mt-28 space-y-12">
      {/* Top Breadcrumb & Period Selector */}
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-neutral-900 pb-4">
        <div className="flex items-center gap-3 text-[11px] mono-tag text-neutral-300">
          <span className="text-[#d6ff3e] font-semibold">[02] FIELD</span>
          <span className="text-[#d6ff3e] cursor-blink">_</span>
        </div>
        <div className="flex flex-col items-end gap-2.5">
          <div className="text-[11px] mono-tag text-neutral-400">
            SEP 21, 2025 — SEP 20, 2026
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[9px] mono-tag text-neutral-500">PERIOD</span>
            {(['7D', '30D', '90D', 'YTD', '1Y', 'ALL'] as Period[]).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`text-[9px] mono-tag px-2 py-0.5 border transition-all ${
                  period === p
                    ? 'bg-[#d6ff3e] text-black border-[#d6ff3e] font-semibold'
                    : 'border-neutral-800 text-neutral-400 hover:text-neutral-200'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Daily Contribution Matrix in Terminal Ticker Style */}
      <div className="space-y-4">
        <div className="flex items-center justify-between text-[10px] mono-tag text-neutral-400">
          <div className="flex items-center gap-2">
            <span>DAILY CONTRIBUTION FIELD</span>
            <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border border-neutral-700 text-[8px] text-neutral-400">
              i
            </span>
          </div>
          <div className="text-neutral-400">
            <span className="text-[#d6ff3e]">58</span> / 365 DAYS ACTIVE
          </div>
        </div>

        {/* Matrix Container */}
        <div
          className="relative bg-black/60 border border-neutral-900 p-4 sm:p-6 overflow-x-auto select-none"
          onMouseLeave={() => {
            setHoverCell(null);
            setTipCoords(null);
          }}
        >
          {/* CRT scan sweep line */}
          <div className="pointer-events-none absolute inset-0 overflow-hidden opacity-30">
            <div className="scan-line-horiz absolute top-0 bottom-0 w-1/3 bg-gradient-to-r from-transparent via-[#d6ff3e]/10 to-transparent" />
          </div>

          <div className="flex gap-2 min-w-[720px]">
            {/* Day of Week Labels */}
            <div className="flex flex-col justify-between py-[2px] pr-2 w-4 shrink-0">
              {DOW.map((d, i) => (
                <span
                  key={i}
                  className="h-[14px] text-[9px] leading-[14px] mono-tag text-neutral-600"
                >
                  {d}
                </span>
              ))}
            </div>

            {/* Matrix Grid */}
            <div className="flex-1">
              <div
                className="grid gap-[2px]"
                style={{
                  gridTemplateColumns: `repeat(${weeks.length}, minmax(0, 1fr))`,
                  gridTemplateRows: 'repeat(7, 14px)',
                  gridAutoFlow: 'column',
                }}
              >
                {weeks.map((week) =>
                  week.days.map((cell, di) => {
                    if (!cell) {
                      return <div key={`${week.index}-${di}`} className="bg-transparent" />;
                    }
                    const hovered = hoverCell?.iso === cell.iso;
                    const blockChar = BLOCKS[cell.intensity];

                    return (
                      <div
                        key={cell.iso}
                        onMouseEnter={(e) => {
                          setHoverCell(cell);
                          const root = e.currentTarget.closest('.relative') as HTMLElement;
                          if (!root) return;
                          const rRoot = root.getBoundingClientRect();
                          const r = e.currentTarget.getBoundingClientRect();
                          setTipCoords({
                            x: r.left - rRoot.left + r.width / 2,
                            y: r.top - rRoot.top,
                          });
                        }}
                        className="flex items-center justify-center text-[11px] leading-[14px] cursor-crosshair transition-all duration-100"
                        style={{
                          color: hovered
                            ? '#d6ff3e'
                            : cell.intensity === 4
                            ? '#ffffff'
                            : cell.intensity === 3
                            ? '#c4c4c4'
                            : cell.intensity === 2
                            ? '#757575'
                            : cell.intensity === 1
                            ? '#484848'
                            : '#222222',
                          textShadow: hovered
                            ? '0 0 8px rgba(214,255,62,0.9)'
                            : cell.intensity === 4
                            ? '0 0 4px rgba(255,255,255,0.3)'
                            : 'none',
                          transform: hovered ? 'scale(1.4)' : 'scale(1)',
                          zIndex: hovered ? 20 : 1,
                        }}
                      >
                        {blockChar}
                      </div>
                    );
                  }),
                )}
              </div>

              {/* Month Markers */}
              <div
                className="grid mt-2"
                style={{ gridTemplateColumns: `repeat(${weeks.length}, minmax(0, 1fr))` }}
              >
                {weeks.map((week) => (
                  <div
                    key={week.index}
                    className="text-[9px] mono-tag text-neutral-600 leading-none"
                  >
                    {week.monthLabel ?? ''}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Tooltip HUD */}
          {hoverCell && tipCoords && (
            <div
              className="absolute z-40 pointer-events-none"
              style={{
                left: Math.min(Math.max(tipCoords.x, 90), 640),
                top: tipCoords.y,
                transform: 'translate(-50%, calc(-100% - 10px))',
              }}
            >
              <CellTooltip cell={hoverCell} accent />
            </div>
          )}
        </div>
      </div>

      {/* Six Prominent Statistics (matching exact values from Screenshot 2) */}
      <div className="space-y-6 pt-2">
        {/* Top 3 Primary Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 text-center">
          <div className="group cursor-default space-y-2">
            <div className="font-editorial text-6xl md:text-7xl font-light text-neutral-100 transition-colors duration-200 group-hover:text-[#d6ff3e]">
              1,421
            </div>
            <div className="text-[10px] mono-tag text-neutral-500 tracking-[0.2em] group-hover:text-neutral-300">
              COMMITS
            </div>
          </div>

          <div className="group cursor-default space-y-2">
            <div className="font-editorial text-6xl md:text-7xl font-light text-neutral-100 transition-colors duration-200 group-hover:text-[#d6ff3e]">
              439
            </div>
            <div className="text-[10px] mono-tag text-neutral-500 tracking-[0.2em] group-hover:text-neutral-300">
              PULL REQUESTS
            </div>
          </div>

          <div className="group cursor-default space-y-2">
            <div className="font-editorial text-6xl md:text-7xl font-light text-neutral-100 transition-colors duration-200 group-hover:text-[#d6ff3e]">
              58
            </div>
            <div className="text-[10px] mono-tag text-neutral-500 tracking-[0.2em] group-hover:text-neutral-300">
              ACTIVE DAYS
            </div>
          </div>
        </div>

        {/* Bottom 3 Secondary Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 text-center pt-2">
          <div className="group cursor-default space-y-1">
            <div className="font-editorial text-3xl md:text-4xl font-light text-neutral-200 transition-colors duration-200 group-hover:text-[#d6ff3e]">
              426
            </div>
            <div className="text-[9px] mono-tag text-neutral-500 tracking-[0.2em] group-hover:text-neutral-400">
              MERGED PRS
            </div>
          </div>

          <div className="group cursor-default space-y-1">
            <div className="font-editorial text-3xl md:text-4xl font-light text-neutral-200 transition-colors duration-200 group-hover:text-[#d6ff3e]">
              23
            </div>
            <div className="text-[9px] mono-tag text-neutral-500 tracking-[0.2em] group-hover:text-neutral-400">
              LONGEST STREAK
            </div>
          </div>

          <div className="group cursor-default space-y-1">
            <div className="font-editorial text-3xl md:text-4xl font-light text-neutral-200 transition-colors duration-200 group-hover:text-[#d6ff3e]">
              7
            </div>
            <div className="text-[9px] mono-tag text-neutral-500 tracking-[0.2em] group-hover:text-neutral-400">
              REPOSITORIES
            </div>
          </div>
        </div>
      </div>

      {/* Language Composition Bar */}
      <div className="space-y-3 pt-6 border-t border-neutral-900/60">
        <div className="flex items-center justify-between text-[10px] mono-tag text-neutral-400">
          <span>LANGUAGE COMPOSITION</span>
          <span className="text-neutral-500">C · 01</span>
        </div>

        <div className="flex h-14 md:h-16 gap-[3px] bg-black/40 border border-neutral-900 p-1">
          {languages.map((l) => {
            const pct = (l.bytes / languageTotal) * 100;
            const isHovered = hoverLang === l.name;
            const isDim = hoverLang !== null && !isHovered;

            return (
              <div
                key={l.name}
                onMouseEnter={() => setHoverLang(l.name)}
                onMouseLeave={() => setHoverLang(null)}
                className="relative flex items-center overflow-hidden cursor-pointer transition-all duration-150"
                style={{
                  width: `${pct}%`,
                  backgroundColor: isHovered ? '#d6ff3e' : '#f0f0f0',
                  opacity: isDim ? 0.25 : 1,
                  boxShadow: isHovered ? '0 0 14px rgba(214,255,62,0.6)' : 'none',
                }}
              >
                {l.name === 'TypeScript' && (
                  <span
                    className={`pl-4 text-[10px] mono-tag font-medium transition-colors ${
                      isHovered ? 'text-black' : 'text-neutral-500'
                    }`}
                  >
                    TYPESCRIPT
                  </span>
                )}
                {isHovered && l.name !== 'TypeScript' && (
                  <span className="absolute inset-0 flex items-center justify-center text-[9px] mono-tag text-black font-semibold whitespace-nowrap px-1">
                    {l.name}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex items-start justify-between text-[10px] mono-tag text-neutral-500">
          <span>
            TypeScript <span className="text-neutral-300 ml-1">{formatBytes(languages[0].bytes)}</span>
          </span>
          <span>
            {hoverLang && hoverLang !== 'TypeScript' ? hoverLang : 'Python'}{' '}
            <span className="text-neutral-300 ml-1">
              {formatBytes(
                (hoverLang && languages.find((l) => l.name === hoverLang)?.bytes) ||
                  languages[1].bytes,
              )}
            </span>
          </span>
        </div>
      </div>
    </section>
  );
}
