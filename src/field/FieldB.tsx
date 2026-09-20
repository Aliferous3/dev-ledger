import { useField } from './useField';
import { Heatmap } from './Heatmap';
import { PeriodPills } from './PeriodPills';
import { LIME, formatBytes, formatLong, formatNumber, languages, languageTotal } from '../fieldData';

/**
 * Design B — Blueprint Grid
 * Engineering notebook: lime intensity, crosshair, pulsing live marker.
 */
export function FieldB() {
  const f = useField();
  const [from, to] = f.range;

  return (
    <div className="relative space-y-12">
      <div className="grid-bg absolute inset-0 -z-10 opacity-70" />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3 text-[11px] mono-tag text-neutral-300">
          <span className="text-[#d6ff3e]">◤</span>
          02 — Field
          <span className="w-1.5 h-1.5 rounded-full bg-[#d6ff3e] pulse-dot" />
        </div>
        <div className="flex flex-col items-end gap-3">
          <div className="text-[11px] mono-tag text-[#d6ff3e]/80">
            {formatLong(from)} — {formatLong(to)}
          </div>
          <PeriodPills period={f.period} setPeriod={f.setPeriod} lime />
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-4">
          <div className="text-[10px] mono-tag text-neutral-400">
            <span className="text-[#d6ff3e] mr-2">▣</span>
            Daily Contribution Field
          </div>
          <div className="text-[10px] mono-tag text-neutral-400">
            {f.stats.activeDays} / {f.span} Days Active
          </div>
        </div>
        <Heatmap
          hover={f.hover}
          setHover={f.setHover}
          isDimmed={f.isDimmed}
          colorFor={(c, hovered) => (hovered ? '#d6ff3e' : LIME[c.intensity])}
          variant="round"
          accentHover
          showCrosshair
          peakIso={f.peak?.iso}
        />
      </div>

      <div className="grid grid-cols-3 gap-px bg-neutral-900">
        <StatB value={formatNumber(f.stats.commits)} label="Commits" hint="Σ" />
        <StatB value={formatNumber(f.stats.prs)} label="Pull Requests" hint="PR" />
        <StatB value={formatNumber(f.stats.activeDays)} label="Active Days" hint="Δ" />
        <StatB value={formatNumber(f.stats.merged)} label="Merged PRs" hint="OK" small />
        <StatB value={formatNumber(f.stats.streak)} label="Longest Streak" hint="→" small />
        <StatB value={formatNumber(f.stats.repos)} label="Repositories" hint="R" small />
      </div>

      <div>
        <div className="flex items-center justify-between mb-4">
          <div className="text-[10px] mono-tag text-neutral-400">
            <span className="text-[#d6ff3e] mr-2">▣</span>
            Language Composition
          </div>
          <div className="text-[10px] mono-tag text-[#d6ff3e]">C · 01</div>
        </div>
        <div className="relative h-10 border border-neutral-800">
          <div className="absolute inset-0 flex">
            {languages.map((l) => {
              const pct = (l.bytes / languageTotal) * 100;
              const on = f.hoverLang === l.name;
              return (
                <div
                  key={l.name}
                  onMouseEnter={() => f.setHoverLang(l.name)}
                  onMouseLeave={() => f.setHoverLang(null)}
                  className="relative h-full cursor-pointer lang-seg"
                  style={{
                    width: `${pct}%`,
                    background: on ? '#d6ff3e' : 'transparent',
                    boxShadow: 'inset -1px 0 0 #1f1f1f',
                    backgroundImage: on
                      ? undefined
                      : 'repeating-linear-gradient(90deg, #d6ff3e 0 1px, transparent 1px 6px)',
                    backgroundColor: on ? '#d6ff3e' : '#0e0e0e',
                  }}
                >
                  {on && (
                    <span className="absolute -top-6 left-1/2 -translate-x-1/2 text-[9px] mono-tag text-[#d6ff3e] whitespace-nowrap">
                      {l.name} {formatBytes(l.bytes)}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        <div className="flex justify-between mt-3 text-[10px] mono-tag text-neutral-500">
          <span>TypeScript {formatBytes(languages[0].bytes)}</span>
          <span>Python {formatBytes(languages[1].bytes)}</span>
        </div>
      </div>
    </div>
  );
}

function StatB({
  value,
  label,
  hint,
  small = false,
}: {
  value: string;
  label: string;
  hint: string;
  small?: boolean;
}) {
  return (
    <div className="bg-[#0a0a0a] px-6 py-8 text-center group hover:bg-[#0e0e0e] transition-colors">
      <div className="text-[9px] mono-tag text-[#d6ff3e] mb-3 opacity-70">{hint}</div>
      <div
        className={`stat-num text-neutral-100 group-hover:text-[#d6ff3e] transition-colors duration-300 ${
          small ? 'text-3xl' : 'text-5xl md:text-6xl'
        }`}
      >
        {value}
      </div>
      <div className="mt-3 text-[10px] mono-tag text-neutral-500">{label}</div>
    </div>
  );
}