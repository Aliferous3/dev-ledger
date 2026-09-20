import { useField } from './useField';
import { Heatmap } from './Heatmap';
import { PeriodPills } from './PeriodPills';
import { GRAY, formatBytes, formatLong, formatNumber, languages, languageTotal } from '../fieldData';

/**
 * Design A — Mono-Editorial
 * Faithful recreation of the attached Field section.
 */
export function FieldA() {
  const f = useField();
  const [from, to] = f.range;

  return (
    <div className="space-y-12">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="text-[11px] mono-tag text-neutral-400">02 — Field</div>
        <div className="flex flex-col items-end gap-3">
          <div className="text-[11px] mono-tag text-neutral-400">
            {formatLong(from)} — {formatLong(to)}
          </div>
          <PeriodPills period={f.period} setPeriod={f.setPeriod} />
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 text-[10px] mono-tag text-neutral-400">
            Daily Contribution Field
            <InfoHint />
          </div>
          <div className="text-[10px] mono-tag text-neutral-400">
            {f.stats.activeDays} / {f.span} Days Active
          </div>
        </div>
        <Heatmap
          hover={f.hover}
          setHover={f.setHover}
          isDimmed={f.isDimmed}
          colorFor={(c, hovered) => (hovered ? '#d6ff3e' : GRAY[c.intensity])}
        />
      </div>

      <div className="grid grid-cols-3 gap-8 pt-4">
        <Stat value={formatNumber(f.stats.commits)} label="Commits" />
        <Stat value={formatNumber(f.stats.prs)} label="Pull Requests" />
        <Stat value={formatNumber(f.stats.activeDays)} label="Active Days" />
      </div>
      <div className="grid grid-cols-3 gap-8">
        <Stat value={formatNumber(f.stats.merged)} label="Merged PRs" small />
        <Stat value={formatNumber(f.stats.streak)} label="Longest Streak" small />
        <Stat value={formatNumber(f.stats.repos)} label="Repositories" small />
      </div>

      <LanguageBlock
        hoverLang={f.hoverLang}
        setHoverLang={f.setHoverLang}
      />
    </div>
  );
}

function Stat({
  value,
  label,
  small = false,
}: {
  value: string;
  label: string;
  small?: boolean;
}) {
  return (
    <div className="text-center group cursor-default">
      <div
        className={`stat-num text-neutral-100 transition-colors duration-300 group-hover:text-[#d6ff3e] ${
          small ? 'text-3xl' : 'text-6xl md:text-7xl'
        }`}
      >
        {value}
      </div>
      <div className="mt-3 text-[10px] mono-tag text-neutral-500 group-hover:text-neutral-300 transition-colors">
        {label}
      </div>
    </div>
  );
}

function InfoHint() {
  return (
    <span className="relative group/info inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border border-neutral-700 text-[8px] text-neutral-500 cursor-help">
      i
      <span className="absolute left-1/2 -translate-x-1/2 top-full mt-2 w-56 px-3 py-2 bg-[#111] border border-neutral-800 text-[9px] mono-tag text-neutral-400 opacity-0 pointer-events-none group-hover/info:opacity-100 transition-opacity z-20 tracking-widest leading-relaxed normal-case">
        Each cell is one day. Brightness encodes commit volume for the selected period.
      </span>
    </span>
  );
}

function LanguageBlock({
  hoverLang,
  setHoverLang,
}: {
  hoverLang: string | null;
  setHoverLang: (s: string | null) => void;
}) {
  return (
    <div className="pt-6">
      <div className="flex items-center justify-between mb-4">
        <div className="text-[10px] mono-tag text-neutral-400">Language Composition</div>
        <div className="text-[10px] mono-tag text-neutral-500">C · 01</div>
      </div>
      <div className="flex h-16 gap-[3px] bg-transparent">
        {languages.map((l) => {
          const pct = (l.bytes / languageTotal) * 100;
          const on = hoverLang === l.name;
          const dim = hoverLang !== null && !on;
          return (
            <div
              key={l.name}
              onMouseEnter={() => setHoverLang(l.name)}
              onMouseLeave={() => setHoverLang(null)}
              className="lang-seg relative flex items-center overflow-hidden cursor-pointer"
              style={{
                width: `${pct}%`,
                background: on ? '#d6ff3e' : '#f4f4f4',
                opacity: dim ? 0.28 : 1,
              }}
            >
              {l.name === 'TypeScript' && (
                <span
                  className={`pl-4 text-[10px] mono-tag ${
                    on ? 'text-black' : 'text-neutral-500'
                  }`}
                >
                  TypeScript
                </span>
              )}
              {on && l.name !== 'TypeScript' && (
                <span className="absolute inset-0 flex items-center justify-center text-[9px] mono-tag text-black whitespace-nowrap px-1">
                  {l.name}
                </span>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex items-start justify-between mt-3 text-[10px] text-neutral-500">
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
  );
}