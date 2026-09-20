import { useMemo, useState, useRef } from 'react';
import type { Period, MetricKey, DayData } from '../types';

interface Props {
  period: Period;
  setPeriod: (p: Period) => void;
  daysData: DayData[];
}

const TABS: { key: MetricKey; label: string; heroLabel: string }[] = [
  { key: 'GROWTH', label: 'GROWTH', heroLabel: 'NET SOURCE GROWTH' },
  { key: 'ADDED', label: 'ADDED', heroLabel: 'LINES ADDED' },
  { key: 'DELETED', label: 'DELETED', heroLabel: 'LINES DELETED' },
  { key: 'CHURN', label: 'CHURN', heroLabel: 'SOURCE CHURN' },
  { key: 'COMMITS', label: 'COMMITS', heroLabel: 'COMMITS' },
];

export function Section01Measure({ period, setPeriod, daysData }: Props) {
  const [activeTab, setActiveTab] = useState<MetricKey>('GROWTH');
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  // Filter days by period
  const filteredDays = useMemo(() => {
    const total = daysData.length;
    if (period === '7D') return daysData.slice(total - 7);
    if (period === '30D') return daysData.slice(total - 30);
    if (period === '90D') return daysData.slice(total - 90);
    if (period === 'YTD') return daysData.slice(Math.max(0, total - 263));
    return daysData; // 1Y or ALL
  }, [daysData, period]);

  // Derive series for the active tab
  const { seriesCum, seriesDaily, heroValue } = useMemo(() => {
    let cum = 0;
    const sCum: number[] = [];
    const sDaily: number[] = [];

    for (const d of filteredDays) {
      let val = 0;
      if (activeTab === 'GROWTH') val = d.dailyChange;
      else if (activeTab === 'ADDED') val = d.added;
      else if (activeTab === 'DELETED') val = d.deleted;
      else if (activeTab === 'CHURN') val = d.added + d.deleted;
      else if (activeTab === 'COMMITS') val = d.commits;

      cum += val;
      sDaily.push(val);
      sCum.push(cum);
    }

    const last = sCum[sCum.length - 1] ?? 0;
    const sign = (activeTab === 'GROWTH' || activeTab === 'ADDED') && last > 0 ? '+' : '';
    const hero = `${sign}${last.toLocaleString('en-US')}`;

    return { seriesCum: sCum, seriesDaily: sDaily, heroValue: hero };
  }, [filteredDays, activeTab]);

  const maxCum = useMemo(() => Math.max(...seriesCum, 1), [seriesCum]);
  const maxDaily = useMemo(() => Math.max(...seriesDaily, 1), [seriesDaily]);

  // SVG coordinates for Fig A curve
  const svgWidth = 1000;
  const svgHeight = 220;
  const paddingX = 0;
  const paddingY = 16;

  const points = useMemo(() => {
    const len = seriesCum.length;
    if (len === 0) return '';
    return seriesCum
      .map((val, idx) => {
        const x = paddingX + (idx / Math.max(1, len - 1)) * (svgWidth - paddingX * 2);
        const y = svgHeight - paddingY - (val / maxCum) * (svgHeight - paddingY * 2);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }, [seriesCum, maxCum]);

  const areaPath = useMemo(() => {
    if (!points) return '';
    const firstX = 0;
    const lastX = svgWidth;
    const bottomY = svgHeight - 8;
    return `M ${firstX},${bottomY} L ${points.split(' ')[0]} ${points.split(' ').map(p => `L ${p}`).join(' ')} L ${lastX},${bottomY} Z`;
  }, [points]);

  const activeIdx = hoverIndex !== null && hoverIndex < filteredDays.length ? hoverIndex : null;
  const activeDay = activeIdx !== null ? filteredDays[activeIdx] : null;
  const activeCumVal = activeIdx !== null ? seriesCum[activeIdx] : null;
  const activeDailyVal = activeIdx !== null ? seriesDaily[activeIdx] : null;

  const chartRef = useRef<HTMLDivElement>(null);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!chartRef.current) return;
    const rect = chartRef.current.getBoundingClientRect();
    const relX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const ratio = relX / rect.width;
    const idx = Math.min(filteredDays.length - 1, Math.max(0, Math.floor(ratio * filteredDays.length)));
    setHoverIndex(idx);
  };

  const currentTabObj = TABS.find((t) => t.key === activeTab)!;

  return (
    <section id="section-01" className="relative scroll-mt-28 space-y-12">
      {/* Top Section Breadcrumb & Period Selector */}
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-neutral-900 pb-4">
        <div className="flex items-center gap-3 text-[11px] mono-tag text-neutral-300">
          <span className="text-[#d6ff3e] font-semibold">[01] MEASURE</span>
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

      {/* Hero Number Display */}
      <div className="text-center space-y-4 pt-4">
        <div className="text-[10px] mono-tag text-neutral-500 tracking-[0.24em] flex items-center justify-center gap-2">
          <span>A · 01 · {currentTabObj.heroLabel}</span>
          <span className="inline-flex items-center justify-center w-3 h-3 rounded-full border border-neutral-700 text-[8px] text-neutral-400">
            i
          </span>
          <span>· LAST YEAR</span>
        </div>

        {/* Large Editorial Serif Number */}
        <div className="relative inline-block group">
          <div className="text-6xl sm:text-8xl md:text-9xl font-editorial font-light text-neutral-100 tracking-tight select-none transition-all duration-300 group-hover:text-[#d6ff3e]">
            {heroValue}
          </div>
          <div className="text-[9px] mono-tag text-neutral-600 opacity-0 group-hover:opacity-100 transition-opacity absolute -bottom-5 left-1/2 -translate-x-1/2 whitespace-nowrap">
            // TELEMETRY PEAK: SEP 2026
          </div>
        </div>

        {/* Sub-Metadata Strip */}
        <div className="pt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-[10px] mono-tag text-neutral-500">
          <span>2025-09-21 — 2026-09-20</span>
          <span className="text-neutral-700">·</span>
          <span>SOURCE BYTES <span className="text-neutral-300">10.0 MB</span></span>
          <span className="text-neutral-700">·</span>
          <span>7 REPOSITORIES</span>
          <span className="text-neutral-700">·</span>
          <span className="text-neutral-300">TYPESCRIPT</span>
        </div>

        {/* Interactive Metric Navigation Tabs */}
        <nav className="flex flex-wrap justify-center items-center gap-x-5 gap-y-2 sm:gap-x-8 md:gap-x-12 pt-6 text-[11px] mono-tag">
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

      {/* Dual Chart Stack (FIG. A & FIG. B) with synchronised CRT HUD cursor */}
      <div
        ref={chartRef}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoverIndex(null)}
        className="relative bg-black/40 border border-neutral-900 p-6 md:p-8 space-y-8 select-none group/charts cursor-crosshair overflow-hidden"
      >
        {/* Subtle Horizontal Scanlines */}
        <div className="pointer-events-none absolute inset-0 terminal-grid opacity-30" />

        {/* FIG. A: Cumulative Net Source Growth */}
        <div className="relative space-y-3">
          <div className="flex items-center justify-between text-[10px] mono-tag text-neutral-400">
            <span className="flex items-center gap-2">
              <span className="text-[#d6ff3e]">FIG. A</span>
              <span>— CUMULATIVE {currentTabObj.heroLabel}</span>
            </span>
            <span className="text-neutral-500">{filteredDays.length} OBS.</span>
          </div>

          <div className="relative h-[220px] w-full border-b border-neutral-900">
            {/* Background Axis Grid Lines */}
            <div className="absolute inset-0 flex flex-col justify-between pointer-events-none">
              <div className="border-b border-neutral-900/60 w-full" />
              <div className="border-b border-neutral-900/60 w-full" />
              <div className="border-b border-neutral-900/60 w-full" />
              <div className="border-b border-neutral-900/60 w-full" />
            </div>

            <svg
              viewBox={`0 0 ${svgWidth} ${svgHeight}`}
              preserveAspectRatio="none"
              className="w-full h-full overflow-visible"
            >
              <defs>
                <linearGradient id="areaGlow" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#ffffff" stopOpacity="0.12" />
                  <stop offset="70%" stopColor="#d6ff3e" stopOpacity="0.03" />
                  <stop offset="100%" stopColor="#000000" stopOpacity="0" />
                </linearGradient>
              </defs>

              {/* Gradient Area */}
              <path d={areaPath} fill="url(#areaGlow)" />

              {/* Main Signal Line */}
              <polyline
                fill="none"
                stroke="#e8e8e8"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
                points={points}
              />

              {/* Synchronized Hover Point */}
              {activeIdx !== null && activeCumVal !== null && (
                <circle
                  cx={(activeIdx / Math.max(1, filteredDays.length - 1)) * svgWidth}
                  cy={svgHeight - paddingY - (activeCumVal / maxCum) * (svgHeight - paddingY * 2)}
                  r="4"
                  fill="#0a0a0a"
                  stroke="#d6ff3e"
                  strokeWidth="2.5"
                />
              )}
            </svg>

            {/* Synchronized Crosshair Line */}
            {activeIdx !== null && (
              <div
                className="absolute top-0 bottom-0 pointer-events-none z-10"
                style={{
                  left: `${(activeIdx / Math.max(1, filteredDays.length - 1)) * 100}%`,
                }}
              >
                <div className="w-px h-full border-l border-dashed border-[#d6ff3e]/60" />
              </div>
            )}
          </div>
        </div>

        {/* FIG. B: Daily Net Source Change (Bars / Spikes) */}
        <div className="relative space-y-3">
          <div className="flex items-center justify-between text-[10px] mono-tag text-neutral-400">
            <span className="flex items-center gap-2">
              <span className="text-[#d6ff3e]">FIG. B</span>
              <span>— DAILY NET SOURCE CHANGE</span>
            </span>
            <span className="text-neutral-500">{filteredDays.length} DAYS</span>
          </div>

          <div className="relative h-[140px] w-full border-b border-neutral-900">
            <div className="absolute inset-0 flex items-end gap-[1px]">
              {filteredDays.map((d, i) => {
                const val = seriesDaily[i];
                const heightPct = Math.max(val > 0 ? 3 : 1, (val / maxDaily) * 100);
                const isHovered = activeIdx === i;

                return (
                  <div
                    key={d.date}
                    className="flex-1 flex items-end h-full relative"
                  >
                    <div
                      className="w-full transition-all duration-100"
                      style={{
                        height: `${heightPct}%`,
                        backgroundColor: isHovered
                          ? '#d6ff3e'
                          : val > 50000
                          ? '#f0f0f0'
                          : val > 10000
                          ? '#8c8c8c'
                          : '#2a2a2a',
                        boxShadow: isHovered ? '0 0 8px rgba(214,255,62,0.8)' : 'none',
                      }}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* CRT HUD Hover Tooltip Box */}
        {activeDay && activeCumVal !== null && activeDailyVal !== null && (
          <div
            className="pointer-events-none absolute z-30 transition-all duration-75"
            style={{
              left: `${Math.min(88, Math.max(12, (activeIdx! / Math.max(1, filteredDays.length - 1)) * 100))}%`,
              top: '20px',
              transform: 'translateX(-50%)',
            }}
          >
            <div className="bg-[#111] border border-[#d6ff3e]/60 px-3 py-2 text-[10px] mono-tag shadow-2xl space-y-1 min-w-[170px] backdrop-blur-md">
              <div className="text-neutral-400 flex justify-between border-b border-neutral-800 pb-1">
                <span>{activeDay.date}</span>
                <span className="text-[#d6ff3e]">D.{activeDay.dayIndex}</span>
              </div>
              <div className="flex justify-between pt-0.5">
                <span className="text-neutral-500">CUMULATIVE:</span>
                <span className="text-neutral-100 font-semibold">
                  +{activeCumVal.toLocaleString('en-US')}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-500">DAILY CHANGE:</span>
                <span className="text-[#d6ff3e] font-semibold">
                  +{activeDailyVal.toLocaleString('en-US')}
                </span>
              </div>
              <div className="flex justify-between text-neutral-400 text-[9px]">
                <span>COMMITS: {activeDay.commits}</span>
                <span>+{activeDay.added} / -{activeDay.deleted}</span>
              </div>
            </div>
          </div>
        )}

        {/* Chart Footer Readout */}
        <div className="flex flex-wrap items-center justify-between text-[9px] mono-tag text-neutral-600 pt-2 border-t border-neutral-900/60">
          <span>// SYNCHRONIZED STREAM: FIG.A (INTEGRAL) + FIG.B (DERIVATIVE)</span>
          <span className="text-neutral-500">HOVER HORIZON TO INSPECT OBS.</span>
        </div>
      </div>
    </section>
  );
}
