import React, { useState, useMemo, useRef } from 'react';
import { Period, MeasureTab, MEASURE_TABS, DailyPoint } from '../types';
import { MEASURE_DATA, filterPointsByPeriod, formatNumber } from '../data/measureData';
import { PeriodSelector } from './PeriodSelector';

interface SectionMeasureProps {
  period: Period;
  onPeriodChange: (p: Period) => void;
}

export const SectionMeasure: React.FC<SectionMeasureProps> = ({
  period,
  onPeriodChange,
}) => {
  const [activeTab, setActiveTab] = useState<MeasureTab>('GROWTH');
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  const chartRef = useRef<HTMLDivElement>(null);

  const points: DailyPoint[] = useMemo(() => {
    return filterPointsByPeriod(MEASURE_DATA, period);
  }, [period]);

  // Compute active hero metric based on tab
  const heroValue = useMemo(() => {
    if (points.length === 0) return '+0';
    const last = points[points.length - 1];
    switch (activeTab) {
      case 'GROWTH':
        return `+${formatNumber(last.cumulativeGrowth)}`;
      case 'ADDED':
        return `+${formatNumber(last.cumulativeAdded)}`;
      case 'DELETED':
        return `-${formatNumber(last.cumulativeDeleted)}`;
      case 'CHURN':
        return `${last.churn}%`;
      case 'COMMITS':
        return formatNumber(last.cumulativeCommits);
      default:
        return `+${formatNumber(last.cumulativeGrowth)}`;
    }
  }, [points, activeTab]);

  // Chart coordinates
  const W = 1100;
  const H = 220;
  const PAD_X = 16;
  const PAD_Y = 24;

  const getMetricValue = (p: DailyPoint, tab: MeasureTab): number => {
    switch (tab) {
      case 'GROWTH':
        return p.cumulativeGrowth;
      case 'ADDED':
        return p.cumulativeAdded;
      case 'DELETED':
        return p.cumulativeDeleted;
      case 'CHURN':
        return p.churn;
      case 'COMMITS':
        return p.cumulativeCommits;
    }
  };

  const getDailyMetricValue = (p: DailyPoint, tab: MeasureTab): number => {
    switch (tab) {
      case 'GROWTH':
        return p.growth;
      case 'ADDED':
        return p.added;
      case 'DELETED':
        return p.deleted;
      case 'CHURN':
        return p.churn;
      case 'COMMITS':
        return p.commits;
    }
  };

  const maxVal = useMemo(() => {
    const vals = points.map((p) => getMetricValue(p, activeTab));
    return Math.max(...vals, 1);
  }, [points, activeTab]);

  const maxDailyVal = useMemo(() => {
    const vals = points.map((p) => getDailyMetricValue(p, activeTab));
    return Math.max(...vals, 1);
  }, [points, activeTab]);

  const pathD = useMemo(() => {
    if (points.length < 2) return '';
    return points
      .map((p, i) => {
        const x = PAD_X + (i / (points.length - 1)) * (W - PAD_X * 2);
        const val = getMetricValue(p, activeTab);
        const y = H - PAD_Y - (val / maxVal) * (H - PAD_Y * 2);
        return `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
      })
      .join(' ');
  }, [points, activeTab, maxVal]);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!chartRef.current) return;
    const rect = chartRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const ratio = x / rect.width;
    const idx = Math.min(points.length - 1, Math.max(0, Math.floor(ratio * points.length)));
    setHoverIndex(idx);
  };

  const currentHoverPoint = hoverIndex !== null && points[hoverIndex] ? points[hoverIndex] : null;

  return (
    <section id="measure" className="space-y-10 scroll-mt-24">
      {/* Header row */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="text-[11px] font-mono tracking-widest text-[#777777] flex items-center gap-2">
          <span className="text-[#d6ff3e]">[01]</span>
          <span>MEASURE</span>
          <span className="terminal-cursor text-[#d6ff3e]">_</span>
        </div>

        <div className="flex flex-col items-end gap-3">
          <div className="text-[11px] font-mono tracking-widest text-[#888888]">
            SEP 21, 2025 — SEP 20, 2026
          </div>
          <PeriodSelector selected={period} onChange={onPeriodChange} />
        </div>
      </div>

      {/* Subtitle */}
      <div className="text-center">
        <div className="inline-flex items-center gap-2 text-[10px] font-mono tracking-widest text-[#666666] uppercase">
          <span>A · 01 · NET SOURCE GROWTH</span>
          <div className="relative inline-block">
            <button
              onMouseEnter={() => setShowInfo(true)}
              onMouseLeave={() => setShowInfo(false)}
              className="w-3.5 h-3.5 rounded-full border border-[#444444] text-[9px] leading-none text-[#777777] hover:text-[#d6ff3e] hover:border-[#d6ff3e] flex items-center justify-center transition-colors"
            >
              ⓘ
            </button>
            {showInfo && (
              <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 w-64 p-2.5 bg-[#0e0e0e] border border-[#222222] text-[10px] text-[#aaaaaa] font-mono tracking-normal leading-relaxed z-30 shadow-2xl">
                Cumulative net bytes added to tracked repositories minus deletions over the selected window.
              </div>
            )}
          </div>
          <span>· LAST YEAR</span>
        </div>
      </div>

      {/* Giant Hero Number */}
      <div className="text-center py-2">
        <div className="serif-hero text-7xl sm:text-8xl md:text-9xl text-[#f5f5f5] tracking-tight transition-all duration-300 hover:text-[#d6ff3e] select-none cursor-default">
          {heroValue}
        </div>
      </div>

      {/* Meta Bar */}
      <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-2 text-[10px] font-mono tracking-widest text-[#666666] uppercase">
        <span className="text-[#888888]">
          2025-09-21 <span className="mx-2 text-[#444444]">—</span> 2026-09-20
        </span>
        <span className="hidden sm:inline text-[#333333]">·</span>
        <span>
          SOURCE BYTES <span className="ml-1 text-[#d0d0d0]">10.0 MB</span>
        </span>
        <span className="hidden sm:inline text-[#333333]">·</span>
        <span>7 REPOSITORIES</span>
        <span className="hidden sm:inline text-[#333333]">·</span>
        <span>TYPESCRIPT</span>
      </div>

      {/* Interactive Tabs */}
      <div className="flex justify-center pt-2">
        <div className="flex items-center gap-8 sm:gap-12">
          {MEASURE_TABS.map((tab) => {
            const isActive = activeTab === tab;
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`terminal-tab-btn ${isActive ? 'active' : ''}`}
              >
                {tab}
              </button>
            );
          })}
        </div>
      </div>

      {/* FIG. A — Cumulative Net Source Growth */}
      <div className="space-y-4 pt-4">
        <div className="flex items-center justify-between text-[10px] font-mono tracking-widest text-[#666666]">
          <span>
            <span className="text-[#999999]">FIG. A</span> — CUMULATIVE NET SOURCE GROWTH
          </span>
          <span>{points.length} OBS.</span>
        </div>

        {/* Chart Viewport */}
        <div
          ref={chartRef}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHoverIndex(null)}
          className="relative bg-[#0a0a0a] border-b border-[#1f1f1f] py-4 cursor-crosshair group"
        >
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-44 sm:h-56 overflow-visible">
            {/* Grid Lines */}
            {[0.25, 0.5, 0.75].map((ratio) => (
              <line
                key={ratio}
                x1={PAD_X}
                x2={W - PAD_X}
                y1={PAD_Y + (H - PAD_Y * 2) * ratio}
                y2={PAD_Y + (H - PAD_Y * 2) * ratio}
                stroke="#181818"
                strokeWidth={1}
              />
            ))}

            {/* Baseline */}
            <line
              x1={PAD_X}
              x2={W - PAD_X}
              y1={H - PAD_Y}
              y2={H - PAD_Y}
              stroke="#222222"
              strokeWidth={1}
            />

            {/* Ghost line (subtle offset trajectory) */}
            <path
              d={pathD}
              fill="none"
              stroke="#222222"
              strokeWidth={1}
              strokeDasharray="2 3"
              transform="translate(0, 3)"
            />

            {/* Main Primary Line */}
            <path
              d={pathD}
              fill="none"
              stroke="#f5f5f5"
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="transition-all duration-300 group-hover:stroke-[#d6ff3e]"
            />

            {/* Active Hover Crosshair Line */}
            {hoverIndex !== null && currentHoverPoint && (
              <>
                {(() => {
                  const x = PAD_X + (hoverIndex / (points.length - 1)) * (W - PAD_X * 2);
                  const val = getMetricValue(currentHoverPoint, activeTab);
                  const y = H - PAD_Y - (val / maxVal) * (H - PAD_Y * 2);
                  return (
                    <g>
                      {/* Vertical Scrubber */}
                      <line
                        x1={x}
                        x2={x}
                        y1={PAD_Y}
                        y2={H - PAD_Y}
                        stroke="#d6ff3e"
                        strokeWidth={1}
                        strokeOpacity={0.6}
                        strokeDasharray="2 2"
                      />
                      {/* Horizontal Scrubber */}
                      <line
                        x1={PAD_X}
                        x2={W - PAD_X}
                        y1={y}
                        y2={y}
                        stroke="#d6ff3e"
                        strokeWidth={1}
                        strokeOpacity={0.25}
                      />
                      {/* Glowing Node Point */}
                      <circle
                        cx={x}
                        cy={y}
                        r={4}
                        fill="#0a0a0a"
                        stroke="#d6ff3e"
                        strokeWidth={1.5}
                        className="lime-pulse"
                      />
                    </g>
                  );
                })()}
              </>
            )}
          </svg>

          {/* Floating Tooltip */}
          {hoverIndex !== null && currentHoverPoint && (
            <div
              className="absolute pointer-events-none z-20"
              style={{
                left: `${(hoverIndex / (points.length - 1)) * 100}%`,
                top: `${
                  ((H - PAD_Y - (getMetricValue(currentHoverPoint, activeTab) / maxVal) * (H - PAD_Y * 2)) / H) * 100
                }%`,
                transform: 'translate(-50%, -130%)',
              }}
            >
              <div className="bg-[#050505] border border-[#d6ff3e] px-3 py-2 text-[10px] font-mono tracking-widest text-[#f5f5f5] shadow-2xl">
                <div className="text-[#888888] text-[9px]">{currentHoverPoint.date}</div>
                <div className="text-[#d6ff3e] font-bold text-xs mt-0.5">
                  +{formatNumber(getMetricValue(currentHoverPoint, activeTab))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* FIG. B — Daily Net Source Change */}
      <div className="space-y-4 pt-4">
        <div className="flex items-center justify-between text-[10px] font-mono tracking-widest text-[#666666]">
          <span>
            <span className="text-[#999999]">FIG. B</span> — DAILY NET SOURCE CHANGE
          </span>
          <span>{points.length} DAYS</span>
        </div>

        <div className="relative h-32 bg-[#0a0a0a] border-b border-[#1f1f1f]">
          <svg viewBox={`0 0 ${W} 120`} className="w-full h-full" preserveAspectRatio="none">
            {/* Baseline */}
            <line x1={PAD_X} x2={W - PAD_X} y1={114} y2={114} stroke="#222222" strokeWidth={1} />

            {/* Daily Bars */}
            {points.map((p, i) => {
              const val = getDailyMetricValue(p, activeTab);
              const barHeight = Math.max(1, (val / maxDailyVal) * 100);
              const x = PAD_X + (i / (points.length - 1)) * (W - PAD_X * 2);
              const y = 114 - barHeight;
              const isHovered = hoverIndex === i;
              const isMax = val === maxDailyVal && val > 0;

              return (
                <g key={i} onMouseEnter={() => setHoverIndex(i)} className="cursor-pointer">
                  <rect
                    x={x - 1}
                    y={y}
                    width={2}
                    height={barHeight}
                    fill={isHovered ? '#d6ff3e' : isMax ? '#f5f5f5' : val > 0 ? '#666666' : '#1a1a1a'}
                    className="transition-colors duration-150"
                  />
                  {isMax && (
                    <circle
                      cx={x}
                      cy={y - 4}
                      r={2.5}
                      fill="none"
                      stroke="#d6ff3e"
                      strokeWidth={1}
                    />
                  )}
                </g>
              );
            })}
          </svg>

          {/* Daily Tooltip */}
          {hoverIndex !== null && currentHoverPoint && (
            <div
              className="absolute pointer-events-none z-20"
              style={{
                left: `${(hoverIndex / (points.length - 1)) * 100}%`,
                bottom: '100%',
                transform: 'translateX(-50%) translateY(-6px)',
              }}
            >
              <div className="bg-[#0e0e0e] border border-[#333333] px-2.5 py-1 text-[9px] font-mono tracking-widest text-[#f5f5f5] shadow-xl whitespace-nowrap">
                <span className="text-[#888888]">{currentHoverPoint.date}: </span>
                <span className="text-[#d6ff3e]">+{formatNumber(getDailyMetricValue(currentHoverPoint, activeTab))}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
};
