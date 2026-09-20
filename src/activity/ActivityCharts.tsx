// Mini visualizations for the Activity page — the three Attachment-6
// charts from the study, driven by real period-filtered data.

import { useState } from 'react';
import { smoothPath } from '../retained/primitives';

export interface MonthBucket {
  key: string;   // 'YYYY-MM'
  name: string;  // 'AUG 2026'
  letter: string;
  commits: number;
  added: number;
  deleted: number;
}

export interface WeekdayBucket {
  name: string;
  total: number;
  pct: number;
}

// 1. Commits by month bar chart
export function CommitsByMonthChart({ months }: { months: MonthBucket[] }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const max = Math.max(...months.map((m) => m.commits), 1);
  const peak = months.reduce((a, m) => (m.commits > a.commits ? m : a), months[0]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between mono-tag text-[9px] text-neutral-500">
        <span>COMMITS BY MONTH</span>
        <span className="text-[#d6ff3e] tabular-nums">
          {hovered !== null
            ? `${months[hovered].name}: ${months[hovered].commits}`
            : peak
              ? `MAX ${peak.commits}`
              : '—'}
        </span>
      </div>
      <div className="relative h-28 flex items-end gap-2 border-b border-neutral-900 pb-1">
        {months.map((m, i) => {
          const heightPct = Math.max(4, (m.commits / max) * 100);
          const isHov = hovered === i;
          return (
            <div
              key={m.key}
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
              className="flex-1 h-full flex flex-col justify-end items-center cursor-pointer group"
            >
              <div
                className="w-full transition-all duration-300 rounded-[1px]"
                style={{
                  height: `${heightPct}%`,
                  backgroundColor: isHov ? '#d6ff3e' : i >= months.length - 2 ? '#ebebeb' : '#333333',
                  boxShadow: isHov ? '0 0 12px rgba(214,255,62,0.8)' : 'none',
                }}
              />
              <span
                className={`mono-tag text-[9px] mt-2 transition-colors ${isHov ? 'text-[#d6ff3e]' : 'text-neutral-500'}`}
              >
                {m.letter}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// 2. Additions vs deletions dual curve — real monthly totals projected
// into the study's 240×100 frame (flat → ramp → plateau silhouette).
export function AdditionsDeletionsChart({ months }: { months: MonthBucket[] }) {
  const [hovered, setHovered] = useState(false);

  const maxV = Math.max(...months.flatMap((m) => [m.added, m.deleted]), 1);
  const n = Math.max(months.length, 2);
  const pts = (pick: (m: MonthBucket) => number) =>
    months.map((m, i) => ({
      x: (i / (n - 1)) * 240,
      y: 82 - (pick(m) / maxV) * 62,
    }));
  const addPts = pts((m) => m.added);
  const delPts = pts((m) => m.deleted);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between mono-tag text-[9px] text-neutral-500">
        <span>ADDITIONS VS DELETIONS</span>
        <span className="flex items-center gap-2">
          <span className="inline-block w-2 h-[2px] bg-neutral-100" />
          <span className="text-neutral-400">ADD</span>
          <span className="inline-block w-2 h-[2px] bg-neutral-500" />
          <span className="text-neutral-500">DEL</span>
        </span>
      </div>
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className="relative h-28 border-b border-neutral-900 pb-1 cursor-crosshair group"
      >
        <svg viewBox="0 0 240 100" preserveAspectRatio="none" className="w-full h-full overflow-visible">
          <line x1="0" y1="82" x2="240" y2="82" stroke="#1c1c1c" strokeWidth="1" />
          <line x1="0" y1="20" x2="240" y2="20" stroke="#1c1c1c" strokeWidth="1" strokeDasharray="3 3" />

          <path
            d={smoothPath(addPts)}
            fill="none"
            stroke={hovered ? '#d6ff3e' : '#f2f2f2'}
            strokeWidth="1.8"
            className="transition-colors duration-300"
          />
          <path
            d={smoothPath(delPts)}
            fill="none"
            stroke="#6e6e6e"
            strokeWidth="1.6"
            className="transition-colors duration-300"
          />

          {addPts.length > 0 && (
            <>
              <circle cx={addPts[addPts.length - 1].x} cy={addPts[addPts.length - 1].y} r="2.5" fill="#f2f2f2" />
              <circle cx={delPts[delPts.length - 1].x} cy={delPts[delPts.length - 1].y} r="2.5" fill="#6e6e6e" />
            </>
          )}
        </svg>

        <div className="flex justify-between px-2 pt-1 mono-tag text-[9px] text-neutral-500">
          {months.map((m) => (
            <span key={m.key}>{m.letter}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

// 3. Weekday distribution bars
export function WeekdayDistributionChart({ weekdays }: { weekdays: WeekdayBucket[] }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const max = Math.max(...weekdays.map((d) => d.total), 1);
  const peak = weekdays.reduce((a, d) => (d.total > a.total ? d : a), weekdays[0]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between mono-tag text-[9px] text-neutral-500">
        <span>WEEKDAY DISTRIBUTION</span>
        <span className="text-[#d6ff3e] tabular-nums">
          {hoverIdx !== null
            ? `${weekdays[hoverIdx].name}: ${weekdays[hoverIdx].total} (${weekdays[hoverIdx].pct}%)`
            : peak
              ? `${peak.name} PEAK ${peak.total}`
              : '—'}
        </span>
      </div>
      <div className="relative h-28 flex items-end gap-1.5 border-b border-neutral-900 pb-1">
        {weekdays.map((d, i) => {
          const heightPct = Math.max(6, (d.total / max) * 100);
          const isHov = hoverIdx === i;
          const isWeekend = d.name === 'SAT' || d.name === 'SUN';
          return (
            <div
              key={d.name}
              onMouseEnter={() => setHoverIdx(i)}
              onMouseLeave={() => setHoverIdx(null)}
              className="flex-1 h-full flex flex-col justify-end items-center cursor-pointer group"
            >
              <div
                className="w-full transition-all duration-300 rounded-[1px]"
                style={{
                  height: `${heightPct}%`,
                  backgroundColor: isHov
                    ? '#d6ff3e'
                    : isWeekend
                      ? '#f0f0f0'
                      : d.name === 'WED'
                        ? '#999999'
                        : '#333333',
                  boxShadow: isHov ? '0 0 12px rgba(214,255,62,0.8)' : 'none',
                }}
              />
              <span
                className={`mono-tag text-[8px] mt-2 transition-colors ${
                  isHov ? 'text-[#d6ff3e]' : isWeekend ? 'text-neutral-300 font-medium' : 'text-neutral-600'
                }`}
              >
                {d.name}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Wrapper — three columns on desktop, stacked on smaller widths.
export function ActivityCharts({
  months,
  weekdays,
}: {
  months: MonthBucket[];
  weekdays: WeekdayBucket[];
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-6 border-t border-neutral-900">
      <CommitsByMonthChart months={months} />
      <AdditionsDeletionsChart months={months} />
      <WeekdayDistributionChart weekdays={weekdays} />
    </div>
  );
}
