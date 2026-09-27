import { useMemo, useState } from 'react';
import type { Period, MetricKey, DayData } from '../types';
import { MonthBins } from './MonthBins';
import { useLedger } from '../store/live';
import { NumBytes, NumGrouped } from '../ledger/Num';
import { SkNum } from '../ledger/Skeleton';

interface Props {
  period: Period;
  daysData: DayData[];
}

const TABS: { key: MetricKey; label: string; heroLabel: string }[] = [
  { key: 'GROWTH', label: 'GROWTH', heroLabel: 'NET SOURCE GROWTH' },
  { key: 'ADDED', label: 'ADDED', heroLabel: 'LINES ADDED' },
  { key: 'DELETED', label: 'DELETED', heroLabel: 'LINES DELETED' },
  { key: 'CHURN', label: 'CHURN', heroLabel: 'SOURCE CHURN' },
  { key: 'COMMITS', label: 'COMMITS', heroLabel: 'COMMITS' },
];

export function Section01Measure({ period, daysData }: Props) {
  const [activeTab, setActiveTab] = useState<MetricKey>('GROWTH');
  // Canonical period → ISO range (fixture window or live telemetry horizon).
  const { range, all, resolving } = useLedger();
  const metaFrom = range.from ?? all.workShape.span?.firstActive ?? '—';
  const metaTo = range.to ?? all.workShape.span?.lastActive ?? '—';
  const topLang = all.languages[0]?.language ?? '—';

  // Filter days by period — date-bounded so the full live history can feed
  // the series without breaking 7D/30D/YTD semantics.
  const filteredDays = useMemo(
    () =>
      daysData.filter(
        (d) =>
          (!range.from || d.date >= range.from) &&
          (!range.to || d.date <= range.to),
      ),
    [daysData, range],
  );

  // Hero value follows the active metric tab over the filtered range.
  // Raw number — Num handles grouping + the + prefix and animates the
  // transition when the metric tab or period changes.
  const heroValue = useMemo(() => {
    let cum = 0;
    for (const d of filteredDays) {
      if (activeTab === 'GROWTH') cum += d.dailyChange;
      else if (activeTab === 'ADDED') cum += d.added;
      else if (activeTab === 'DELETED') cum += d.deleted;
      else if (activeTab === 'CHURN') cum += d.added + d.deleted;
      else cum += d.commits;
    }
    return cum;
  }, [filteredDays, activeTab]);
  const heroSign =
    (activeTab === 'GROWTH' || activeTab === 'ADDED') && heroValue > 0 ? '+' : '';

  const currentTabObj = TABS.find((t) => t.key === activeTab)!;
  const bucketCount = useMemo(
    () => new Set(filteredDays.map((d) => d.date.slice(0, 7))).size,
    [filteredDays],
  );
  const periodLabel =
    period === '1Y' ? 'LAST YEAR' :
    period === 'ALL' ? 'ALL TIME' :
    period === 'YTD' ? 'YEAR TO DATE' :
    period;

  return (
    <section id="section-01" className="relative scroll-mt-28 space-y-8 md:space-y-12">
      {/* Top Section Breadcrumb — the global period selector lives in the
          sticky header and drives every section */}
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-neutral-900 pb-4">
        <div className="flex items-center gap-3 text-[11px] mono-tag text-neutral-300">
          <span className="text-[#d6ff3e] font-semibold">[01] MEASURE</span>
          <span className="text-[#d6ff3e] cursor-blink">_</span>
        </div>
      </div>

      {/* Hero Number Display */}
      <div className="text-center space-y-3 md:space-y-4 pt-1 md:pt-4">
        <div className="text-[10px] mono-tag text-neutral-500 tracking-[0.24em] flex items-center justify-center gap-2">
          <span>A · 01 · {currentTabObj.heroLabel}</span>
          <span className="inline-flex items-center justify-center w-3 h-3 rounded-full border border-neutral-700 text-[8px] text-neutral-400">
            i
          </span>
          <span>· {periodLabel}</span>
        </div>

        {/* Large Editorial Serif Number */}
        <div className="relative inline-block group">
          <div className="text-5xl min-[420px]:text-6xl sm:text-8xl md:text-9xl font-editorial font-light text-neutral-100 tracking-tight select-none transition-all duration-300 group-hover:text-[#d6ff3e]">
            {resolving ? (
              <SkNum h="0.85em" w="3.2em" className="mx-auto" />
            ) : (
              <NumGrouped value={heroValue} prefix={heroSign} />
            )}
          </div>
          <div className="text-[9px] mono-tag text-neutral-600 opacity-0 group-hover:opacity-100 transition-opacity absolute -bottom-5 left-1/2 -translate-x-1/2 whitespace-nowrap">
            // TELEMETRY PEAK: SEP 2026
          </div>
        </div>

        {/* Sub-Metadata Strip */}
        <div className="pt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-[10px] mono-tag text-neutral-500">
          <span>{metaFrom} — {metaTo}</span>
          <span className="text-neutral-700">·</span>
          <span>SOURCE BYTES <span className="text-neutral-300"><NumBytes value={all.summary.languageBytes} /></span></span>
          <span className="text-neutral-700">·</span>
          <span><NumGrouped value={all.summary.repos} /> REPOSITORIES</span>
          <span className="text-neutral-700">·</span>
          <span className="text-neutral-300">{topLang.toUpperCase()}</span>
        </div>

        {/* Interactive Metric Navigation Tabs */}
        <nav className="flex flex-wrap justify-center items-center gap-x-4 gap-y-1 sm:gap-x-8 md:gap-x-12 pt-3 md:pt-6 text-[11px] mono-tag">
          {TABS.map((tab) => {
            const active = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`tab-underline py-2 transition-colors duration-200 ${
                  active ? 'active text-neutral-100 font-semibold' : 'text-neutral-500 hover:text-neutral-300'
                }`}
              >
                {active && <span className="text-[#d6ff3e] mr-1.5">//</span>}
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* FIG.03 — MONTH BINS (replaces the old FIG.A/FIG.B chart stack) */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 mono-tag text-[11px]">
          <div className="flex items-center gap-3">
            <span className="bg-[#d6ff3e] text-black px-2 py-0.5 font-semibold text-[10px]">FIG.03</span>
            <span className="text-neutral-100">MONTH BINS</span>
            <span className="text-neutral-500 hidden sm:inline">— FIG.B: {bucketCount} BUCKETS</span>
          </div>
          <span className="text-neutral-600 text-[9px] hidden md:inline">
            {bucketCount} MONTH CARDS WITH NESTED DAY STRIPS — NO DEAD SPACE
          </span>
        </div>
        <MonthBins days={filteredDays} metric={activeTab} />
      </div>
    </section>
  );
}
