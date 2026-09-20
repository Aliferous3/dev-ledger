import { useField } from './useField';
import { Heatmap } from './Heatmap';
import { PeriodPills } from './PeriodPills';
import { GRAY, formatBytes, formatLong, formatNumber, languages, languageTotal } from '../fieldData';

/**
 * Design D — Card / Stack
 * Framed panels. Stats as a six-up. Language legend on hover.
 */
export function FieldD() {
  const f = useField();
  const [from, to] = f.range;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4 px-1">
        <div className="text-[11px] mono-tag text-neutral-400">02 — Field</div>
        <div className="flex flex-col items-end gap-3">
          <div className="text-[11px] mono-tag text-neutral-400">
            {formatLong(from)} — {formatLong(to)}
          </div>
          <PeriodPills period={f.period} setPeriod={f.setPeriod} />
        </div>
      </div>

      <div className="border border-neutral-900 bg-neutral-950/50 p-6 hover:border-neutral-800 transition-colors duration-500">
        <div className="flex items-center justify-between mb-5">
          <div className="text-[10px] mono-tag text-neutral-400">◰ Daily Contribution Field</div>
          <div className="text-[10px] mono-tag text-neutral-500">
            {f.stats.activeDays} / {f.span} Days Active
          </div>
        </div>
        <Heatmap
          hover={f.hover}
          setHover={f.setHover}
          isDimmed={f.isDimmed}
          colorFor={(c, hovered) => (hovered ? '#d6ff3e' : GRAY[c.intensity])}
          variant="square"
          peakIso={f.peak?.iso}
        />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <CardStat value={formatNumber(f.stats.commits)} label="Commits" />
        <CardStat value={formatNumber(f.stats.prs)} label="Pull Requests" />
        <CardStat value={formatNumber(f.stats.activeDays)} label="Active Days" />
        <CardStat value={formatNumber(f.stats.merged)} label="Merged PRs" />
        <CardStat value={formatNumber(f.stats.streak)} label="Longest Streak" />
        <CardStat value={formatNumber(f.stats.repos)} label="Repositories" />
      </div>

      <div className="border border-neutral-900 bg-neutral-950/50 p-6 hover:border-neutral-800 transition-colors duration-500">
        <div className="flex items-center justify-between mb-5">
          <div className="text-[10px] mono-tag text-neutral-400">◰ Language Composition</div>
          <div className="text-[10px] mono-tag text-neutral-500">C · 01</div>
        </div>
        <div className="flex h-14 gap-[3px]">
          {languages.map((l) => {
            const pct = (l.bytes / languageTotal) * 100;
            const on = f.hoverLang === l.name;
            const dim = f.hoverLang !== null && !on;
            return (
              <div
                key={l.name}
                onMouseEnter={() => f.setHoverLang(l.name)}
                onMouseLeave={() => f.setHoverLang(null)}
                className="relative cursor-pointer lang-seg overflow-hidden"
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
            const on = f.hoverLang === l.name;
            return (
              <button
                key={l.name}
                onMouseEnter={() => f.setHoverLang(l.name)}
                onMouseLeave={() => f.setHoverLang(null)}
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
      <div className="stat-num text-4xl md:text-5xl text-neutral-100 group-hover:text-[#d6ff3e] transition-colors duration-300">
        {value}
      </div>
      <div className="mt-3 text-[10px] mono-tag text-neutral-500">{label}</div>
    </div>
  );
}