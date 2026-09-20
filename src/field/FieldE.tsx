import { useField } from './useField';
import { Heatmap } from './Heatmap';
import { PeriodPills } from './PeriodPills';
import { GRAY, formatBytes, formatLong, formatNumber, languages, languageTotal } from '../fieldData';

/**
 * Design E — Bracket / Annotated
 * Corner brackets, peak-day callout, annotated language bar.
 */
export function FieldE() {
  const f = useField();
  const [from, to] = f.range;
  const peak = f.peak;

  return (
    <div className="space-y-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="text-[11px] mono-tag text-neutral-400">
          ╲ 02 — Field
        </div>
        <div className="flex flex-col items-end gap-3">
          <div className="text-[11px] mono-tag text-neutral-400">
            {formatLong(from)} — {formatLong(to)}
          </div>
          <PeriodPills period={f.period} setPeriod={f.setPeriod} lime />
        </div>
      </div>

      <Bracket>
        <div className="flex items-center justify-between mb-5 px-2">
          <div className="text-[10px] mono-tag text-neutral-400">
            ╲ Daily Contribution Field
          </div>
          <div className="text-[10px] mono-tag text-neutral-500">
            {f.stats.activeDays} / {f.span} Days Active
          </div>
        </div>
        <div className="relative px-2 pb-2">
          <Heatmap
            hover={f.hover}
            setHover={f.setHover}
            isDimmed={f.isDimmed}
            colorFor={(c, hovered) => (hovered ? '#d6ff3e' : GRAY[c.intensity])}
            peakIso={peak?.iso}
            showCrosshair
          />
          {peak && (
            <div className="mt-4 flex items-center gap-3 text-[10px] mono-tag">
              <span className="text-[#d6ff3e]">▲ Peak</span>
              <span className="text-neutral-500">{formatLong(peak.date)}</span>
              <span className="text-neutral-300">
                {formatNumber(peak.commits)} commits
              </span>
              <span className="text-neutral-600">/</span>
              <span className="text-neutral-500">
                +{formatNumber(peak.added)} / -{formatNumber(peak.deleted)}
              </span>
            </div>
          )}
        </div>
      </Bracket>

      <div className="grid grid-cols-3 gap-8">
        <AnnoStat value={formatNumber(f.stats.commits)} label="Commits" tag="Σ" />
        <AnnoStat value={formatNumber(f.stats.prs)} label="Pull Requests" tag="PR" />
        <AnnoStat value={formatNumber(f.stats.activeDays)} label="Active Days" tag="Δ" />
      </div>
      <div className="grid grid-cols-3 gap-8">
        <AnnoStat value={formatNumber(f.stats.merged)} label="Merged PRs" tag="OK" small />
        <AnnoStat value={formatNumber(f.stats.streak)} label="Longest Streak" tag="→" small />
        <AnnoStat value={formatNumber(f.stats.repos)} label="Repositories" tag="R" small />
      </div>

      <Bracket>
        <div className="flex items-center justify-between mb-5 px-2">
          <div className="text-[10px] mono-tag text-neutral-400">╲ Language Composition</div>
          <div className="text-[10px] mono-tag text-neutral-500">C · 01</div>
        </div>
        <div className="px-2 pb-2">
          <div className="flex h-12">
            {languages.map((l, i) => {
              const pct = (l.bytes / languageTotal) * 100;
              const on = f.hoverLang === l.name;
              const dim = f.hoverLang !== null && !on;
              return (
                <div
                  key={l.name}
                  onMouseEnter={() => f.setHoverLang(l.name)}
                  onMouseLeave={() => f.setHoverLang(null)}
                  className="relative cursor-pointer lang-seg"
                  style={{
                    width: `${pct}%`,
                    background: on ? '#d6ff3e' : '#f4f4f4',
                    opacity: dim ? 0.22 : 1,
                    marginRight: i === languages.length - 1 ? 0 : 3,
                  }}
                >
                  {on && (
                    <div className="absolute -top-7 left-1/2 -translate-x-1/2 text-[9px] mono-tag text-[#d6ff3e] whitespace-nowrap">
                      ▲ {l.name} {formatBytes(l.bytes)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="flex justify-between mt-4 text-[10px] mono-tag text-neutral-500">
            <span>
              TypeScript <span className="text-neutral-300">{formatBytes(languages[0].bytes)}</span>
            </span>
            <span>
              Python <span className="text-neutral-300">{formatBytes(languages[1].bytes)}</span>
            </span>
          </div>
        </div>
      </Bracket>
    </div>
  );
}

function Bracket({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative p-3">
      <span className="absolute top-0 left-0 w-3 h-3 border-t border-l border-neutral-600" />
      <span className="absolute top-0 right-0 w-3 h-3 border-t border-r border-neutral-600" />
      <span className="absolute bottom-0 left-0 w-3 h-3 border-b border-l border-neutral-600" />
      <span className="absolute bottom-0 right-0 w-3 h-3 border-b border-r border-neutral-600" />
      {children}
    </div>
  );
}

function AnnoStat({
  value,
  label,
  tag,
  small = false,
}: {
  value: string;
  label: string;
  tag: string;
  small?: boolean;
}) {
  return (
    <div className="text-center group relative py-2">
      <div className="text-[9px] mono-tag text-neutral-600 group-hover:text-[#d6ff3e] transition-colors">
        {tag}
      </div>
      <div
        className={`stat-num text-neutral-100 group-hover:text-[#d6ff3e] transition-colors duration-300 ${
          small ? 'text-3xl mt-1' : 'text-6xl mt-1'
        }`}
      >
        {value}
      </div>
      <div className="mt-3 text-[10px] mono-tag text-neutral-500">{label}</div>
      <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-0 w-0 group-hover:w-8 h-px bg-[#d6ff3e] transition-all duration-300" />
    </div>
  );
}