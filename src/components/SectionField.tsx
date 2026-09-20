import React, { useState, useRef } from 'react';
import { Period } from '../types';
import { PeriodSelector } from './PeriodSelector';
import {
  FIELD_GRID,
  MONTH_NAMES,
  DOW_LETTERS,
  LANGUAGES,
  ContributionCell,
} from '../data/fieldData';
import { formatBytes, formatNumber } from '../data/measureData';

interface SectionFieldProps {
  period: Period;
  onPeriodChange: (p: Period) => void;
}

export const SectionField: React.FC<SectionFieldProps> = ({
  period,
  onPeriodChange,
}) => {
  const [hoverCell, setHoverCell] = useState<ContributionCell | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);
  const [hoverLang, setHoverLang] = useState<string | null>(null);
  const [asciiMode, setAsciiMode] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const gridContainerRef = useRef<HTMLDivElement>(null);

  const blockGlyphs = ['·', '░', '▒', '▓', '█'];
  const blockColors = ['#141414', '#2a2a2a', '#5c5c5c', '#a8a8a8', '#f4f4f4'];

  const handleCellEnter = (cell: ContributionCell, e: React.MouseEvent<HTMLDivElement>) => {
    setHoverCell(cell);
    if (gridContainerRef.current) {
      const containerRect = gridContainerRef.current.getBoundingClientRect();
      const cellRect = e.currentTarget.getBoundingClientRect();
      setTooltipPos({
        x: cellRect.left - containerRect.left + cellRect.width / 2,
        y: cellRect.top - containerRect.top,
      });
    }
  };

  const activeStats = {
    commits: 1421,
    prs: 439,
    activeDays: 58,
    mergedPrs: 426,
    longestStreak: 23,
    repositories: 7,
  };

  return (
    <section id="field" className="space-y-12 scroll-mt-24 pt-8">
      {/* Header row */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="text-[11px] font-mono tracking-widest text-[#777777] flex items-center gap-2">
          <span className="text-[#d6ff3e]">[02]</span>
          <span>FIELD</span>
          <span className="terminal-cursor text-[#d6ff3e]">_</span>
        </div>

        <div className="flex flex-col items-end gap-3">
          <div className="text-[11px] font-mono tracking-widest text-[#888888]">
            SEP 21, 2025 — SEP 20, 2026
          </div>
          <PeriodSelector selected={period} onChange={onPeriodChange} />
        </div>
      </div>

      {/* Contribution Field Subhead */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 text-[10px] font-mono tracking-widest text-[#666666] uppercase">
            <span>DAILY CONTRIBUTION FIELD</span>
            <div className="relative inline-block">
              <button
                onMouseEnter={() => setShowInfo(true)}
                onMouseLeave={() => setShowInfo(false)}
                className="w-3.5 h-3.5 rounded-full border border-[#444444] text-[9px] leading-none text-[#777777] hover:text-[#d6ff3e] hover:border-[#d6ff3e] flex items-center justify-center transition-colors"
              >
                ⓘ
              </button>
              {showInfo && (
                <div className="absolute left-0 bottom-full mb-2 w-64 p-2.5 bg-[#0e0e0e] border border-[#222222] text-[10px] text-[#aaaaaa] font-mono tracking-normal leading-relaxed z-30 shadow-2xl">
                  Temporal matrix of code activity. Cell intensity corresponds to total commits and byte flux recorded on that day.
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-4 text-[10px] font-mono tracking-widest text-[#666666]">
            <button
              onClick={() => setAsciiMode(!asciiMode)}
              className="text-[#888888] hover:text-[#d6ff3e] border border-[#222222] px-2 py-0.5 text-[9px] transition-colors"
            >
              MODE: {asciiMode ? 'ASCII [█]' : 'GRID [■]'}
            </button>
            <span className="text-[#888888]">
              {activeStats.activeDays} / 365 DAYS ACTIVE
            </span>
          </div>
        </div>

        {/* Matrix Grid Container */}
        <div
          ref={gridContainerRef}
          className="relative bg-[#070707] border border-[#1a1a1a] p-4 select-none overflow-x-auto"
          onMouseLeave={() => {
            setHoverCell(null);
            setTooltipPos(null);
          }}
        >
          <div className="flex gap-2">
            {/* Days of Week (S M T W T F S) */}
            <div className="flex flex-col justify-between text-[9px] font-mono text-[#555555] pr-1 py-[2px] shrink-0">
              {DOW_LETTERS.map((dow, i) => (
                <span key={i} className="h-3 sm:h-3.5 leading-3 sm:leading-3.5 flex items-center">
                  {dow}
                </span>
              ))}
            </div>

            {/* Matrix Weeks Grid */}
            <div className="flex-1 min-w-[620px]">
              <div
                className="grid gap-[3px]"
                style={{
                  gridTemplateColumns: `repeat(${FIELD_GRID.weeks.length}, minmax(0, 1fr))`,
                  gridTemplateRows: 'repeat(7, minmax(10px, 13px))',
                  gridAutoFlow: 'column',
                }}
              >
                {FIELD_GRID.weeks.map((week, wIdx) =>
                  week.map((cell, dIdx) => {
                    if (!cell) {
                      return <div key={`empty-${wIdx}-${dIdx}`} className="bg-transparent" />;
                    }

                    const isHovered = hoverCell?.date === cell.date;
                    const intensityColor = blockColors[cell.intensity];

                    return (
                      <div
                        key={cell.date}
                        onMouseEnter={(e) => handleCellEnter(cell, e)}
                        className={`grid-cell relative rounded-[1px] flex items-center justify-center cursor-crosshair ${
                          isHovered ? 'z-20' : ''
                        }`}
                        style={{
                          backgroundColor: asciiMode ? '#0a0a0a' : isHovered ? '#d6ff3e' : intensityColor,
                          boxShadow: isHovered
                            ? '0 0 12px #d6ff3e, inset 0 0 4px #d6ff3e'
                            : cell.intensity === 4
                            ? '0 0 4px rgba(255,255,255,0.2)'
                            : 'none',
                        }}
                      >
                        {asciiMode && (
                          <span
                            className="text-[10px] leading-none font-mono"
                            style={{
                              color: isHovered ? '#d6ff3e' : cell.intensity > 0 ? intensityColor : '#222222',
                              fontWeight: cell.intensity >= 3 ? 'bold' : 'normal',
                            }}
                          >
                            {blockGlyphs[cell.intensity]}
                          </span>
                        )}
                      </div>
                    );
                  })
                )}
              </div>

              {/* Month Labels Bar */}
              <div
                className="grid mt-2 text-[9px] font-mono text-[#555555] tracking-widest"
                style={{ gridTemplateColumns: `repeat(${FIELD_GRID.weeks.length}, minmax(0, 1fr))` }}
              >
                {FIELD_GRID.weeks.map((_, wIdx) => {
                  const monthIdx = Math.floor((wIdx / FIELD_GRID.weeks.length) * MONTH_NAMES.length);
                  const isMonthStart = wIdx % 4 === 0 && monthIdx < MONTH_NAMES.length;
                  return (
                    <div key={wIdx} className="overflow-visible whitespace-nowrap">
                      {isMonthStart ? MONTH_NAMES[monthIdx] : ''}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Interactive Cell Tooltip */}
          {hoverCell && tooltipPos && (
            <div
              className="absolute pointer-events-none z-30"
              style={{
                left: Math.max(90, Math.min(tooltipPos.x, (gridContainerRef.current?.clientWidth || 600) - 90)),
                top: tooltipPos.y,
                transform: 'translate(-50%, -125%)',
              }}
            >
              <div className="bg-[#050505] border border-[#d6ff3e] p-3 text-[10px] font-mono tracking-widest shadow-2xl min-w-[170px]">
                <div className="text-[#888888] text-[9px] border-b border-[#222222] pb-1 mb-2 flex justify-between">
                  <span>{hoverCell.date}</span>
                  <span className="text-[#d6ff3e]">ACTIVE</span>
                </div>
                <div className="grid grid-cols-2 gap-y-1.5 text-[10px]">
                  <span className="text-[#666666]">COMMITS</span>
                  <span className="text-right text-[#f5f5f5] font-bold">{hoverCell.commits}</span>

                  <span className="text-[#666666]">ADDED</span>
                  <span className="text-right text-[#d6ff3e]">+{formatNumber(hoverCell.added)}</span>

                  <span className="text-[#666666]">DELETED</span>
                  <span className="text-right text-[#888888]">-{formatNumber(hoverCell.deleted)}</span>

                  <span className="text-[#666666]">CHURN</span>
                  <span className="text-right text-[#aaaaaa]">
                    {hoverCell.added + hoverCell.deleted > 0
                      ? `${Math.round((hoverCell.deleted / (hoverCell.added + hoverCell.deleted)) * 100)}%`
                      : '0%'}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Primary 3 Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 pt-4">
        <div className="text-center group cursor-default">
          <div className="serif-hero text-6xl sm:text-7xl md:text-8xl text-[#f5f5f5] transition-colors duration-300 group-hover:text-[#d6ff3e]">
            {formatNumber(activeStats.commits)}
          </div>
          <div className="mt-3 text-[10px] font-mono tracking-widest text-[#666666] group-hover:text-[#aaaaaa] transition-colors uppercase">
            COMMITS
          </div>
        </div>

        <div className="text-center group cursor-default">
          <div className="serif-hero text-6xl sm:text-7xl md:text-8xl text-[#f5f5f5] transition-colors duration-300 group-hover:text-[#d6ff3e]">
            {formatNumber(activeStats.prs)}
          </div>
          <div className="mt-3 text-[10px] font-mono tracking-widest text-[#666666] group-hover:text-[#aaaaaa] transition-colors uppercase">
            PULL REQUESTS
          </div>
        </div>

        <div className="text-center group cursor-default">
          <div className="serif-hero text-6xl sm:text-7xl md:text-8xl text-[#f5f5f5] transition-colors duration-300 group-hover:text-[#d6ff3e]">
            {formatNumber(activeStats.activeDays)}
          </div>
          <div className="mt-3 text-[10px] font-mono tracking-widest text-[#666666] group-hover:text-[#aaaaaa] transition-colors uppercase">
            ACTIVE DAYS
          </div>
        </div>
      </div>

      {/* Secondary 3 Stats */}
      <div className="grid grid-cols-3 gap-8 pt-2">
        <div className="text-center group cursor-default">
          <div className="serif-hero text-3xl sm:text-4xl text-[#d0d0d0] transition-colors duration-300 group-hover:text-[#d6ff3e]">
            {formatNumber(activeStats.mergedPrs)}
          </div>
          <div className="mt-2 text-[9px] font-mono tracking-widest text-[#555555] group-hover:text-[#888888] transition-colors uppercase">
            MERGED PRS
          </div>
        </div>

        <div className="text-center group cursor-default">
          <div className="serif-hero text-3xl sm:text-4xl text-[#d0d0d0] transition-colors duration-300 group-hover:text-[#d6ff3e]">
            {formatNumber(activeStats.longestStreak)}
          </div>
          <div className="mt-2 text-[9px] font-mono tracking-widest text-[#555555] group-hover:text-[#888888] transition-colors uppercase">
            LONGEST STREAK
          </div>
        </div>

        <div className="text-center group cursor-default">
          <div className="serif-hero text-3xl sm:text-4xl text-[#d0d0d0] transition-colors duration-300 group-hover:text-[#d6ff3e]">
            {formatNumber(activeStats.repositories)}
          </div>
          <div className="mt-2 text-[9px] font-mono tracking-widest text-[#555555] group-hover:text-[#888888] transition-colors uppercase">
            REPOSITORIES
          </div>
        </div>
      </div>

      {/* Language Composition Bar */}
      <div className="pt-6 space-y-4">
        <div className="flex items-center justify-between text-[10px] font-mono tracking-widest text-[#666666]">
          <span className="uppercase">LANGUAGE COMPOSITION</span>
          <span className="text-[#555555]">C · 01</span>
        </div>

        {/* Multi-segment bar */}
        <div className="flex h-16 w-full gap-[2px] bg-[#0d0d0d] border border-[#1a1a1a] p-[2px]">
          {LANGUAGES.map((lang) => {
            const isHovered = hoverLang === lang.name;
            const isDimmed = hoverLang !== null && !isHovered;
            return (
              <div
                key={lang.name}
                onMouseEnter={() => setHoverLang(lang.name)}
                onMouseLeave={() => setHoverLang(null)}
                style={{ width: `${lang.percentage}%` }}
                className={`relative h-full flex items-center transition-all duration-200 cursor-pointer overflow-hidden ${
                  isHovered ? 'bg-[#d6ff3e] z-10' : 'bg-[#e5e5e5]'
                } ${isDimmed ? 'opacity-30' : 'opacity-100'}`}
              >
                {lang.name === 'TypeScript' && (
                  <span
                    className={`pl-4 text-[10px] font-mono tracking-widest font-semibold uppercase ${
                      isHovered ? 'text-black' : 'text-[#666666]'
                    }`}
                  >
                    TYPESCRIPT
                  </span>
                )}
                {isHovered && lang.name !== 'TypeScript' && (
                  <span className="absolute inset-0 flex items-center justify-center text-[9px] font-mono tracking-wider text-black uppercase font-bold whitespace-nowrap px-1">
                    {lang.name}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {/* Language Byte Footnotes */}
        <div className="flex items-center justify-between text-[10px] font-mono tracking-widest text-[#666666]">
          <span>
            TypeScript <span className="text-[#e0e0e0] ml-1">{formatBytes(LANGUAGES[0].bytes)}</span>
          </span>
          <span>
            {hoverLang && hoverLang !== 'TypeScript' ? hoverLang : 'Python'}{' '}
            <span className="text-[#e0e0e0] ml-1">
              {formatBytes(
                (hoverLang && LANGUAGES.find((l) => l.name === hoverLang)?.bytes) || LANGUAGES[1].bytes
              )}
            </span>
          </span>
        </div>
      </div>
    </section>
  );
};
