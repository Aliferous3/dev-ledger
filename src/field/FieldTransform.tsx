import { useMemo, useState } from 'react';
import {
  cells,
  computeStats,
  formatBytes,
  formatNumber,
  GRAY,
  inPeriod,
  languages,
  languageTotal,
  peakCell,
  periodDayCount,
  type DayCell,
  type Period,
} from '../fieldData';
import { Heatmap } from './Heatmap';

/* FIELD // TRANSFORM VIEW — DESIGN.D "Card / Stack" from the field study,
   transplanted as the expandable alternate render of the Field section.
   Driven by the app's global period; no local selector (single source of
   truth lives in the sticky header). */
export function FieldTransform({ period }: { period: Period }) {
  const [hover, setHover] = useState<DayCell | null>(null);
  const [hoverLang, setHoverLang] = useState<string | null>(null);

  const visible = useMemo(() => cells.filter((c) => inPeriod(c.date, period)), [period]);
  const stats = useMemo(() => computeStats(visible), [visible]);
  const peak = useMemo(() => peakCell(visible), [visible]);
  const span = periodDayCount(period);
  const isDimmed = (c: DayCell) => !inPeriod(c.date, period);

  return (
    <div className="space-y-6">
      <div className="border border-neutral-900 bg-neutral-950/50 p-6 hover:border-neutral-800 transition-colors duration-500">
        <div className="flex items-center justify-between mb-5">
          <div className="text-[10px] mono-tag text-neutral-400">◰ Daily Contribution Field</div>
          <div className="text-[10px] mono-tag text-neutral-500">
            {stats.activeDays} / {span} Days Active
          </div>
        </div>
        <Heatmap
          hover={hover}
          setHover={setHover}
          isDimmed={isDimmed}
          colorFor={(c, hovered) => (hovered ? '#d6ff3e' : GRAY[c.intensity])}
          variant="square"
          peakIso={peak?.iso}
        />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <CardStat value={formatNumber(stats.commits)} label="Commits" />
        <CardStat value={formatNumber(stats.prs)} label="Pull Requests" />
        <CardStat value={formatNumber(stats.activeDays)} label="Active Days" />
        <CardStat value={formatNumber(stats.merged)} label="Merged PRs" />
        <CardStat value={formatNumber(stats.streak)} label="Longest Streak" />
        <CardStat value={formatNumber(stats.repos)} label="Repositories" />
      </div>

      <div className="border border-neutral-900 bg-neutral-950/50 p-6 hover:border-neutral-800 transition-colors duration-500">
        <div className="flex items-center justify-between mb-5">
          <div className="text-[10px] mono-tag text-neutral-400">◰ Language Composition</div>
          <div className="text-[10px] mono-tag text-neutral-500">C · 01</div>
        </div>
        <div className="flex h-14 gap-[3px]">
          {languages.map((l) => {
            const pct = (l.bytes / languageTotal) * 100;
            const on = hoverLang === l.name;
            const dim = hoverLang !== null && !on;
            return (
              <div
                key={l.name}
                onMouseEnter={() => setHoverLang(l.name)}
                onMouseLeave={() => setHoverLang(null)}
                className="relative cursor-pointer overflow-hidden transition-all duration-150"
                style={{
                  width: `${pct}%`,
                  background: on ? '#d6ff3e' : '#f4f4f4',
                  opacity: dim ? 0.25 : 1,
                  transform: on ? 'scaleY(1.08)' : 'scaleY(1)',
                }}
              />
            );
          })}
        </div>
        <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2">
          {languages.map((l) => {
            const on = hoverLang === l.name;
            return (
              <button
                key={l.name}
                onMouseEnter={() => setHoverLang(l.name)}
                onMouseLeave={() => setHoverLang(null)}
                className={`text-[10px] mono-tag transition-colors ${
                  on ? 'text-[#d6ff3e]' : 'text-neutral-500 hover:text-neutral-300'
                }`}
              >
                <span
                  className="inline-block w-2 h-2 mr-2 align-middle"
                  style={{ background: on ? '#d6ff3e' : '#f4f4f4' }}
                />
                {l.name}
                <span className="ml-2 text-neutral-600">{formatBytes(l.bytes)}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function CardStat({ value, label }: { value: string; label: string }) {
  return (
    <div className="border border-neutral-900 bg-neutral-950/50 px-5 py-6 text-center group hover:border-[#d6ff3e]/40 transition-colors duration-300">
      <div className="font-editorial text-4xl md:text-5xl font-light text-neutral-100 group-hover:text-[#d6ff3e] transition-colors duration-300">
        {value}
      </div>
      <div className="mt-3 text-[10px] mono-tag text-neutral-500">{label}</div>
    </div>
  );
}
