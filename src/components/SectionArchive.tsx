import React, { useState } from 'react';
import { Period, ArchiveSubTab } from '../types';
import { PeriodSelector } from './PeriodSelector';
import {
  FINGERPRINT_METRICS,
  LANGUAGE_STRATA,
  ARCHIVE_MONTHS,
  MIGRATION_STEPS,
  BODY_OF_WORK_METRICS,
} from '../data/archiveData';
import { REPOSITORIES } from '../data/indexData';
import { Lock } from 'lucide-react';

interface SectionArchiveProps {
  period: Period;
  onPeriodChange: (p: Period) => void;
}

export const SectionArchive: React.FC<SectionArchiveProps> = ({
  period,
  onPeriodChange,
}) => {
  const [activeSubTab, setActiveSubTab] = useState<ArchiveSubTab>('F_01_FINGERPRINT');
  const [hoveredMetricId, setHoveredMetricId] = useState<string | null>(null);
  const [hoveredMonthIdx, setHoveredMonthIdx] = useState<number | null>(null);

  const SUB_TABS: { id: ArchiveSubTab; label: string }[] = [
    { id: 'F_01_FINGERPRINT', label: 'F · 01 FINGERPRINT' },
    { id: 'F_02_SUCCESSION', label: 'F · 02 SUCCESSION' },
    { id: 'F_03_LIFECYCLE', label: 'F · 03 LIFECYCLE' },
    { id: 'F_04_MIGRATION', label: 'F · 04 MIGRATION' },
    { id: 'F_05_SPAN', label: 'F · 05 SPAN' },
  ];

  return (
    <section id="archive" className="space-y-10 scroll-mt-24 pt-8">
      {/* Header row */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="text-[11px] font-mono tracking-widest text-[#777777] flex items-center gap-2">
          <span className="text-[#d6ff3e]">[04]</span>
          <span>ARCHIVE · F . 00 — LONGITUDINAL RECORD</span>
          <span className="terminal-cursor text-[#d6ff3e]">_</span>
        </div>

        <div className="flex flex-col items-end gap-3">
          <div className="text-[11px] font-mono tracking-widest text-[#888888]">
            ARCHIVAL RECORD · JAN 2024 — SEP 2026
          </div>
          <PeriodSelector selected={period} onChange={onPeriodChange} />
        </div>
      </div>

      {/* Main Serif Section Title */}
      <div className="space-y-6">
        <h2 className="serif-hero text-5xl sm:text-6xl md:text-7xl text-[#f5f5f5] tracking-tight">
          The Shape of Your Work
        </h2>

        {/* Sub Navigation Tabs */}
        <div className="flex flex-wrap items-center gap-6 sm:gap-10 border-b border-[#1a1a1a] pb-3">
          {SUB_TABS.map((tab) => {
            const isActive = activeSubTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveSubTab(tab.id)}
                className={`text-[10px] font-mono tracking-widest transition-all cursor-pointer ${
                  isActive
                    ? 'text-[#f5f5f5] font-bold border-b-2 border-[#d6ff3e] pb-1'
                    : 'text-[#666666] hover:text-[#cccccc]'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* SUB-VIEW 1: F · 01 FINGERPRINT */}
      {activeSubTab === 'F_01_FINGERPRINT' && (
        <div className="space-y-8 animate-fadeIn">
          <div className="flex items-center justify-between text-[10px] font-mono tracking-widest text-[#666666]">
            <span>
              DEVELOPMENT FINGERPRINT — STRUCTURAL SIGNATURE OF THE SELECTED PERIOD
            </span>
            <span>PERIOD · 1Y · F · 01</span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center bg-[#070707] border border-[#1a1a1a] p-6 sm:p-10">
            {/* Left: Concentric 9-Ring Arc Radar */}
            <div className="lg:col-span-5 flex items-center justify-center relative">
              <svg viewBox="0 0 320 320" className="w-full max-w-[300px] h-auto overflow-visible select-none">
                {FINGERPRINT_METRICS.map((metric) => {
                  const isHovered = hoveredMetricId === metric.id;
                  const r = metric.ringRadius;
                  const circumference = 2 * Math.PI * r;
                  const strokeDasharray = `${circumference * metric.fillPct} ${circumference}`;

                  return (
                    <g
                      key={metric.id}
                      onMouseEnter={() => setHoveredMetricId(metric.id)}
                      onMouseLeave={() => setHoveredMetricId(null)}
                      className="cursor-pointer"
                    >
                      {/* Full Track Ring */}
                      <circle
                        cx="160"
                        cy="160"
                        r={r}
                        fill="none"
                        stroke="#141414"
                        strokeWidth="4"
                      />

                      {/* Active Arc Progress */}
                      <circle
                        cx="160"
                        cy="160"
                        r={r}
                        fill="none"
                        stroke={isHovered ? '#d6ff3e' : '#f5f5f5'}
                        strokeWidth={isHovered ? '5' : '3.5'}
                        strokeDasharray={strokeDasharray}
                        strokeLinecap="round"
                        transform="rotate(-90 160 160)"
                        className="transition-all duration-300"
                        style={{
                          filter: isHovered ? 'drop-shadow(0 0 6px rgba(214,255,62,0.8))' : 'none',
                        }}
                      />
                    </g>
                  );
                })}

                {/* Center Core Dot */}
                <circle cx="160" cy="160" r="14" fill="#050505" stroke="#222222" strokeWidth="1" />
                <circle cx="160" cy="160" r="4" fill="#d6ff3e" className="lime-pulse" />
              </svg>
            </div>

            {/* Right: 3x3 Metric Cards */}
            <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-3 gap-6 sm:gap-8">
              {FINGERPRINT_METRICS.map((metric) => {
                const isHovered = hoveredMetricId === metric.id;
                return (
                  <div
                    key={metric.id}
                    onMouseEnter={() => setHoveredMetricId(metric.id)}
                    onMouseLeave={() => setHoveredMetricId(null)}
                    className={`p-3 border transition-all duration-200 cursor-pointer ${
                      isHovered
                        ? 'border-[#d6ff3e] bg-[#0d0d0d] shadow-lg shadow-[#d6ff3e]/10'
                        : 'border-transparent hover:border-[#222222]'
                    }`}
                  >
                    <div className="text-[9px] font-mono tracking-widest text-[#666666] uppercase mb-1">
                      {metric.id} · {metric.name}
                    </div>
                    <div
                      className={`serif-hero text-4xl sm:text-5xl transition-colors duration-200 ${
                        isHovered ? 'text-[#d6ff3e]' : 'text-[#f5f5f5]'
                      }`}
                    >
                      {metric.score}
                    </div>
                    <div className="mt-2 text-[9px] font-mono tracking-widest text-[#666666] uppercase">
                      {metric.detail}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* SUB-VIEW 2: F · 02 SUCCESSION */}
      {activeSubTab === 'F_02_SUCCESSION' && (
        <div className="space-y-6 animate-fadeIn">
          <div className="flex items-center justify-between text-[10px] font-mono tracking-widest text-[#666666]">
            <span>
              LANGUAGE SUCCESSION — BYTE PRESENCE OF REPOSITORIES ACTIVE EACH MONTH
            </span>
            <span>33 MONTHS · 8 STRATA · F · 02</span>
          </div>

          <div className="border border-[#1a1a1a] bg-[#070707] p-6 space-y-4 overflow-x-auto">
            {LANGUAGE_STRATA.map((strata) => (
              <div key={strata.language} className="flex items-center gap-6 py-2 border-b border-[#121212] last:border-0">
                <div className="w-32 shrink-0 text-[10px] font-mono tracking-wider text-[#777777] uppercase">
                  {strata.language}
                </div>

                <div className="flex-1 grid gap-[2px]" style={{ gridTemplateColumns: `repeat(33, minmax(0, 1fr))` }}>
                  {strata.activeMonths.map((isActive, mIdx) => (
                    <div
                      key={mIdx}
                      onMouseEnter={() => setHoveredMonthIdx(mIdx)}
                      onMouseLeave={() => setHoveredMonthIdx(null)}
                      className={`h-6 rounded-[1px] transition-all duration-150 cursor-pointer ${
                        isActive
                          ? hoveredMonthIdx === mIdx
                            ? 'bg-[#d6ff3e] scale-110 shadow-md shadow-[#d6ff3e]/40 z-10'
                            : 'bg-[#f5f5f5]'
                          : 'bg-[#121212]'
                      }`}
                      title={`${strata.language} · ${ARCHIVE_MONTHS[mIdx]}`}
                    />
                  ))}
                </div>
              </div>
            ))}

            <div className="text-[9px] font-mono tracking-widest text-[#444444] pt-2">
              +2 MINOR STRATA ELIDED
            </div>

            {/* Timeline Axis Footer */}
            <div className="flex items-center justify-between pt-4 border-t border-[#1a1a1a] text-[9px] font-mono tracking-widest text-[#555555]">
              <span>JAN 2024</span>
              <span className="text-[#777777]">HOVER FOR COMPOSITION</span>
              <span>SEP 2026</span>
            </div>
          </div>
        </div>
      )}

      {/* SUB-VIEW 3: F · 03 LIFECYCLE */}
      {activeSubTab === 'F_03_LIFECYCLE' && (
        <div className="space-y-6 animate-fadeIn">
          <div className="flex items-center justify-between text-[10px] font-mono tracking-widest text-[#666666]">
            <span>REPOSITORY LIFECYCLE — ACTIVITY, SILENCE, RETURNS</span>
            <span>ACTIVE / REVIVED / QUIESCENT / DORMANT · F · 03</span>
          </div>

          <div className="border border-[#1a1a1a] bg-[#070707] p-6 space-y-6 overflow-x-auto">
            {REPOSITORIES.map((repo) => (
              <div key={repo.id} className="flex items-center justify-between gap-6 py-2 border-b border-[#121212] last:border-0">
                {/* Repo Name + Active Range */}
                <div className="w-64 shrink-0">
                  <div className="serif-hero text-lg text-[#f5f5f5] flex items-center gap-2">
                    {repo.name}
                    {repo.isPrivate && <Lock className="w-3 h-3 text-[#555555]" />}
                  </div>
                  <div className="text-[9px] font-mono text-[#555555] tracking-widest mt-0.5">
                    {repo.activeRange}
                  </div>
                </div>

                {/* 33-Month Timeline Track */}
                <div className="flex-1 relative h-6 flex items-center">
                  {/* Subtle Timeline Axis */}
                  <div className="absolute inset-x-0 h-px bg-[#161616]" />

                  {/* For Aliferous3: Dashed return span */}
                  {repo.id === 'D.07' && (
                    <div className="absolute left-[3%] right-[8%] h-px border-t border-dashed border-[#444444]" />
                  )}

                  {/* Active Month Blocks */}
                  <div className="w-full grid gap-[2px] relative z-10" style={{ gridTemplateColumns: `repeat(33, minmax(0, 1fr))` }}>
                    {Array.from({ length: 33 }).map((_, mIdx) => {
                      const isBlockActive = repo.timelineBlocks.some((b) => b.month === mIdx && b.active);
                      return (
                        <div
                          key={mIdx}
                          className={`h-4 rounded-[1px] ${
                            isBlockActive ? 'bg-[#f5f5f5] hover:bg-[#d6ff3e] transition-colors cursor-pointer' : 'bg-transparent'
                          }`}
                          title={`${repo.name} · Month ${mIdx + 1}`}
                        />
                      );
                    })}
                  </div>
                </div>

                {/* Status Badge */}
                <div className="w-36 shrink-0 text-right">
                  <div
                    className={`text-[10px] font-mono tracking-widest font-semibold ${
                      repo.status === 'ACTIVE' ? 'text-[#d6ff3e]' : repo.status === 'QUIESCENT' ? 'text-[#888888]' : 'text-[#444444]'
                    }`}
                  >
                    {repo.status}
                  </div>
                  {repo.returnCount && (
                    <div className="text-[9px] font-mono text-[#777777] tracking-widest">
                      {repo.returnCount} RETURN
                    </div>
                  )}
                </div>
              </div>
            ))}

            {/* Lifecycle Status Glossary */}
            <div className="pt-6 border-t border-[#1a1a1a] grid grid-cols-1 md:grid-cols-2 gap-y-2 gap-x-8 text-[9px] font-mono tracking-widest text-[#555555]">
              <div>
                <span className="text-[#888888]">ACTIVE</span> — ACTIVITY WITHIN THE LAST MONTH
              </div>
              <div>
                <span className="text-[#888888]">REVIVED</span> — RESUMED AFTER A ≥3-MONTH GAP, ACTIVE NOW
              </div>
              <div>
                <span className="text-[#888888]">QUIESCENT</span> — INACTIVE 2–5 MONTHS AFTER PRIOR ACTIVITY
              </div>
              <div>
                <span className="text-[#888888]">DORMANT</span> — NO OBSERVED ACTIVITY FOR 6+ MONTHS
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SUB-VIEW 4: F · 04 MIGRATION */}
      {activeSubTab === 'F_04_MIGRATION' && (
        <div className="space-y-6 animate-fadeIn">
          <div className="flex items-center justify-between text-[10px] font-mono tracking-widest text-[#666666]">
            <span>WORK MIGRATION — DOMINANT REPOSITORY PER MONTH, IN SEQUENCE</span>
            <span>4 TRANSITIONS · F · 04</span>
          </div>

          <div className="border border-[#1a1a1a] bg-[#070707] p-8 space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-6">
              {MIGRATION_STEPS.map((step, idx) => (
                <div
                  key={idx}
                  className="bg-[#0c0c0c] border border-[#1a1a1a] p-5 hover:border-[#d6ff3e] transition-colors group cursor-default"
                >
                  <div className="text-[9px] font-mono text-[#555555] tracking-widest mb-2 group-hover:text-[#d6ff3e] transition-colors">
                    STAGE 0{idx + 1}
                  </div>
                  <div className="serif-hero text-xl text-[#f5f5f5] group-hover:text-[#d6ff3e] transition-colors">
                    {step.repoName}
                  </div>
                  <div className="mt-3 text-[10px] font-mono text-[#777777] tracking-widest">
                    {step.months} MO
                  </div>
                </div>
              ))}
            </div>

            <div className="text-[9px] font-mono tracking-widest text-[#555555] pt-4 border-t border-[#1a1a1a]">
              SHARED = SECOND REPOSITORY ≥30% OF THE MONTH'S COMMITS
            </div>
          </div>
        </div>
      )}

      {/* SUB-VIEW 5: F · 05 SPAN */}
      {activeSubTab === 'F_05_SPAN' && (
        <div className="space-y-6 animate-fadeIn">
          <div className="flex items-center justify-between text-[10px] font-mono tracking-widest text-[#666666]">
            <span>BODY OF WORK SPAN — ARCHIVAL RECORD</span>
            <span>F · 05</span>
          </div>

          <div className="border border-[#1a1a1a] bg-[#070707] p-8">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
              {BODY_OF_WORK_METRICS.map((metric) => (
                <div key={metric.label} className="group cursor-default">
                  <div className="text-[9px] font-mono tracking-widest text-[#555555] group-hover:text-[#d6ff3e] transition-colors uppercase">
                    {metric.label}
                  </div>
                  <div className="serif-hero text-3xl sm:text-4xl text-[#f5f5f5] mt-2 group-hover:text-[#d6ff3e] transition-colors">
                    {metric.value}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
