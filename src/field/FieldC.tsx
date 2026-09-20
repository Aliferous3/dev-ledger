import { useField } from './useField';
import { PeriodPills } from './PeriodPills';
import {
  DOW,
  weeks,
  formatBytes,
  formatLong,
  formatNumber,
  languages,
  languageTotal,
} from '../fieldData';
import { CellTooltip } from './Tooltip';
import { useState } from 'react';

const BLOCKS = ['·', '░', '▒', '▓', '█'] as const;

/**
 * Design C — Terminal Ticker
 * Contribution field as a live CRT readout.
 */
export function FieldC() {
  const f = useField();
  const [from, to] = f.range;
  const [tipPos, setTipPos] = useState<{ x: number; y: number } | null>(null);

  return (
    <div className="space-y-10">
      <div className="overflow-hidden border-y border-neutral-900 py-1.5">
        <div className="flex marquee-track text-[10px] mono-tag text-neutral-500 whitespace-nowrap">
          {[0, 1].flatMap((k) =>
            [
              `// FIELD.ACTIVE ${f.stats.activeDays}/${f.span}`,
              `// COMMITS ${f.stats.commits}`,
              `// PR.OPEN ${f.stats.prs}`,
              `// STREAK ${f.stats.streak}D`,
              `// REPOS 7`,
              `// TS 8.3MB`,
              `// PY 845.5KB`,
              `// PERIOD ${f.period}`,
            ].map((s, i) => (
              <span key={`${k}-${i}`} className="px-6">
                {s}
                <span className="mx-6 text-[#d6ff3e]">◆</span>
              </span>
            )),
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="text-[11px] mono-tag text-neutral-300">
          [02] FIELD<span className="text-[#d6ff3e] cursor-blink">_</span>
        </div>
        <div className="flex flex-col items-end gap-3">
          <div className="text-[11px] mono-tag text-neutral-400">
            {formatLong(from)} — {formatLong(to)}
          </div>
          <PeriodPills period={f.period} setPeriod={f.setPeriod} lime />
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="text-[10px] mono-tag text-neutral-400">
            [A] DAILY_CONTRIBUTION_FIELD
          </div>
          <div className="text-[10px] mono-tag text-neutral-400">
            {f.stats.activeDays} / {f.span} DAYS_ACTIVE
          </div>
        </div>

        <div
          className="relative border border-neutral-900 bg-black/40 p-3 overflow-x-auto"
          onMouseLeave={() => {
            f.setHover(null);
            setTipPos(null);
          }}
        >
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="scan-line absolute top-0 bottom-0 w-1/4 bg-gradient-to-r from-transparent via-[#d6ff3e]/5 to-transparent" />
          </div>
          <div className="flex gap-3">
            <div className="flex flex-col justify-between text-[9px] mono-tag text-neutral-600 w-3 shrink-0 py-[1px]">
              {DOW.map((d, i) => (
                <span key={i} className="h-[14px] leading-[14px]">
                  {d}
                </span>
              ))}
            </div>
            <div
              className="grid gap-[2px] flex-1"
              style={{
                gridTemplateColumns: `repeat(${weeks.length}, minmax(0, 1fr))`,
                gridTemplateRows: 'repeat(7, 14px)',
                gridAutoFlow: 'column',
              }}
            >
              {weeks.map((week) =>
                week.days.map((cell, di) => {
                  if (!cell) return <div key={`${week.index}-${di}`} />;
                  const dim = f.isDimmed(cell);
                  const on = f.hover?.iso === cell.iso;
                  const ch = dim ? '·' : BLOCKS[cell.intensity];
                  return (
                    <div
                      key={cell.iso}
                      onMouseEnter={(e) => {
                        f.setHover(cell);
                        const root = (e.currentTarget.closest('.relative') as HTMLElement).getBoundingClientRect();
                        const r = e.currentTarget.getBoundingClientRect();
                        setTipPos({ x: r.left - root.left + r.width / 2, y: r.top - root.top });
                      }}
                      className="text-center text-[11px] leading-[14px] cursor-crosshair select-none transition-colors duration-150"
                      style={{
                        color: on ? '#d6ff3e' : cell.intensity >= 3 ? '#e5e5e5' : '#525252',
                        textShadow: on ? '0 0 8px rgba(214,255,62,0.8)' : 'none',
                        transform: on ? 'scale(1.4)' : 'scale(1)',
                      }}
                    >
                      {ch}
                    </div>
                  );
                }),
              )}
            </div>
          </div>
          <div
            className="grid mt-2 ml-6"
            style={{ gridTemplateColumns: `repeat(${weeks.length}, minmax(0, 1fr))` }}
          >
            {weeks.map((w) => (
              <div key={w.index} className="text-[8px] mono-tag text-neutral-600">
                {w.monthLabel ?? ''}
              </div>
            ))}
          </div>

          {f.hover && tipPos && (
            <div
              className="absolute z-20 pointer-events-none"
              style={{
                left: tipPos.x,
                top: tipPos.y,
                transform: 'translate(-50%, calc(-100% - 8px))',
              }}
            >
              <CellTooltip cell={f.hover} accent />
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 md:grid-cols-6 gap-px bg-neutral-900 border border-neutral-900">
        {[
          ['COMMITS', f.stats.commits],
          ['PULL_REQ', f.stats.prs],
          ['ACTIVE', f.stats.activeDays],
          ['MERGED', f.stats.merged],
          ['STREAK', f.stats.streak],
          ['REPOS', f.stats.repos],
        ].map(([label, value]) => (
          <div key={String(label)} className="bg-black px-3 py-5 group hover:bg-[#0a0a0a]">
            <div className="text-[9px] mono-tag text-neutral-600 group-hover:text-[#d6ff3e] transition-colors">
              {label}
            </div>
            <div className="mt-2 text-2xl stat-num text-neutral-100 group-hover:text-[#d6ff3e] transition-colors">
              {formatNumber(value as number)}
            </div>
          </div>
        ))}
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="text-[10px] mono-tag text-neutral-400">[B] LANGUAGE_COMPOSITION</div>
          <div className="text-[10px] mono-tag text-neutral-500">C · 01</div>
        </div>
        <div className="font-mono text-[11px] leading-6 text-neutral-400">
          {languages.map((l) => {
            const pct = l.bytes / languageTotal;
            const filled = Math.max(1, Math.round(pct * 48));
            const on = f.hoverLang === l.name;
            return (
              <div
                key={l.name}
                className="flex items-center gap-3 cursor-pointer"
                onMouseEnter={() => f.setHoverLang(l.name)}
                onMouseLeave={() => f.setHoverLang(null)}
              >
                <span className={`w-28 ${on ? 'text-[#d6ff3e]' : 'text-neutral-500'}`}>
                  {l.name.toLowerCase()}
                </span>
                <span className={on ? 'text-[#d6ff3e]' : 'text-neutral-300'}>
                  {'█'.repeat(filled)}
                  <span className="text-neutral-800">{'░'.repeat(48 - filled)}</span>
                </span>
                <span className={`w-20 text-right ${on ? 'text-[#d6ff3e]' : 'text-neutral-600'}`}>
                  {formatBytes(l.bytes)}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}