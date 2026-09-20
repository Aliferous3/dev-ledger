import React, { useState, useRef } from 'react';
import { Period, RepositoryItem } from '../types';
import { PeriodSelector } from './PeriodSelector';
import { REPOSITORIES, generateHistoricalLanes } from '../data/indexData';
import { Lock } from 'lucide-react';
import { formatNumber } from '../data/measureData';

interface SectionIndexProps {
  period: Period;
  onPeriodChange: (p: Period) => void;
}

export const SectionIndex: React.FC<SectionIndexProps> = ({
  period,
  onPeriodChange,
}) => {
  const [hoveredRepoId, setHoveredRepoId] = useState<string | null>(null);
  const [laneHoverPct, setLaneHoverPct] = useState<number | null>(null);
  const lanesRef = useRef<HTMLDivElement>(null);

  const { commitsCurve, prsCurve, netLinesCurve } = generateHistoricalLanes(120);

  // Radar dimensions
  const RADAR_CX = 200;
  const RADAR_CY = 150;

  const handleLanesMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!lanesRef.current) return;
    const rect = lanesRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    setLaneHoverPct(x / rect.width);
  };

  const getStatusColor = (status: RepositoryItem['status']) => {
    switch (status) {
      case 'ACTIVE':
        return 'text-[#d6ff3e]';
      case 'STEADY':
        return 'text-[#e5e5e5]';
      case 'QUIET':
        return 'text-[#777777]';
      case 'DORMANT':
        return 'text-[#444444]';
    }
  };

  return (
    <section id="index" className="space-y-12 scroll-mt-24 pt-8">
      {/* Header row */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="text-[11px] font-mono tracking-widest text-[#777777] flex items-center gap-2">
          <span className="text-[#d6ff3e]">[03]</span>
          <span>INDEX</span>
          <span className="terminal-cursor text-[#d6ff3e]">_</span>
        </div>

        <div className="flex flex-col items-end gap-3">
          <div className="text-[11px] font-mono tracking-widest text-[#888888]">
            SEP 21, 2025 — SEP 20, 2026
          </div>
          <PeriodSelector selected={period} onChange={onPeriodChange} />
        </div>
      </div>

      {/* Subhead */}
      <div className="flex flex-wrap items-center justify-between text-[10px] font-mono tracking-widest text-[#666666] gap-2">
        <span className="uppercase">
          PROJECT CONSTELLATION — POSITION BY TEMPORAL CENTER, BANDED BY LANGUAGE
        </span>
        <span>7 NODES · 1 TRACES · C · 02</span>
      </div>

      {/* Constellation Radar Visual */}
      <div className="relative w-full h-72 bg-[#070707] border border-[#1a1a1a] flex items-center justify-center overflow-hidden group select-none">
        <svg viewBox="0 0 400 300" className="w-full h-full max-w-[600px] overflow-visible">
          {/* Subtle Grid crosshairs */}
          <line x1="200" y1="20" x2="200" y2="280" stroke="#141414" strokeWidth="1" strokeDasharray="2 3" />
          <line x1="40" y1="150" x2="360" y2="150" stroke="#141414" strokeWidth="1" strokeDasharray="2 3" />

          {/* Concentric radar orbital bands */}
          {[40, 70, 100, 130].map((r) => (
            <circle
              key={r}
              cx={RADAR_CX}
              cy={RADAR_CY}
              r={r}
              fill="none"
              stroke="#181818"
              strokeWidth="1"
              strokeDasharray={r === 100 ? '4 4' : 'none'}
            />
          ))}

          {/* Temporal trace connections between nodes */}
          {REPOSITORIES.map((repo) => {
            const rad = (repo.angle * Math.PI) / 180;
            const x1 = RADAR_CX + Math.cos(rad) * repo.radius;
            const y1 = RADAR_CY + Math.sin(rad) * repo.radius * 0.75;

            return repo.tracesTo?.map((targetId) => {
              const target = REPOSITORIES.find((r) => r.id === targetId);
              if (!target) return null;
              const targetRad = (target.angle * Math.PI) / 180;
              const x2 = RADAR_CX + Math.cos(targetRad) * target.radius;
              const y2 = RADAR_CY + Math.sin(targetRad) * target.radius * 0.75;
              const isHighlighted = hoveredRepoId === repo.id || hoveredRepoId === target.id;

              return (
                <line
                  key={`${repo.id}-${targetId}`}
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke={isHighlighted ? '#d6ff3e' : '#282828'}
                  strokeWidth={isHighlighted ? 1.5 : 0.75}
                  strokeDasharray={isHighlighted ? 'none' : '2 2'}
                  className="transition-all duration-300"
                />
              );
            });
          })}

          {/* Repository constellation nodes */}
          {REPOSITORIES.map((repo) => {
            const rad = (repo.angle * Math.PI) / 180;
            const x = RADAR_CX + Math.cos(rad) * repo.radius;
            const y = RADAR_CY + Math.sin(rad) * repo.radius * 0.75;
            const isHovered = hoveredRepoId === repo.id;

            return (
              <g
                key={repo.id}
                onMouseEnter={() => setHoveredRepoId(repo.id)}
                onMouseLeave={() => setHoveredRepoId(null)}
                className="cursor-pointer"
              >
                {/* Outer orbit halo for primary node */}
                {repo.id === 'D.01' && (
                  <circle
                    cx={x}
                    cy={y}
                    r={14}
                    fill="none"
                    stroke={isHovered ? '#d6ff3e' : '#444444'}
                    strokeWidth="1"
                    className={isHovered ? 'lime-pulse' : ''}
                  />
                )}

                {/* Concentric node rings */}
                <circle
                  cx={x}
                  cy={y}
                  r={isHovered ? 6 : 3.5}
                  fill={isHovered ? '#d6ff3e' : '#0a0a0a'}
                  stroke={isHovered ? '#d6ff3e' : '#888888'}
                  strokeWidth="1.5"
                  className="transition-all duration-200"
                />

                {/* Node Label on Hover */}
                {isHovered && (
                  <g>
                    <rect
                      x={x - 45}
                      y={y - 28}
                      width="90"
                      height="18"
                      fill="#050505"
                      stroke="#d6ff3e"
                      strokeWidth="1"
                    />
                    <text
                      x={x}
                      y={y - 16}
                      textAnchor="middle"
                      fill="#d6ff3e"
                      fontSize="9"
                      fontFamily="JetBrains Mono"
                      className="font-mono tracking-wider font-bold"
                    >
                      {repo.name.slice(0, 12)}
                    </text>
                  </g>
                )}
              </g>
            );
          })}
        </svg>

        {/* Center label */}
        <div className="absolute bottom-2 left-4 text-[9px] font-mono text-[#555555] tracking-widest">
          TEMPORAL RADAR // COORD (0,0)
        </div>
      </div>

      {/* Repository Table List */}
      <div className="border border-[#1a1a1a] divide-y divide-[#141414] bg-[#070707] overflow-x-auto">
        {REPOSITORIES.map((repo) => {
          const isHovered = hoveredRepoId === repo.id;
          return (
            <div
              key={repo.id}
              onMouseEnter={() => setHoveredRepoId(repo.id)}
              onMouseLeave={() => setHoveredRepoId(null)}
              className={`flex items-center justify-between px-6 py-4 text-[11px] font-mono tracking-wider transition-all duration-150 cursor-pointer ${
                isHovered ? 'bg-[#111111] text-[#ffffff] border-l-2 border-l-[#d6ff3e]' : 'text-[#888888]'
              }`}
            >
              {/* ID + Name */}
              <div className="flex items-center gap-6 min-w-[240px]">
                <span className={`text-[10px] ${isHovered ? 'text-[#d6ff3e]' : 'text-[#555555]'}`}>
                  {repo.id}
                </span>
                <span className="serif-hero text-lg text-[#f5f5f5] flex items-center gap-2">
                  {repo.name}
                  {repo.isPrivate && (
                    <Lock className="w-3 h-3 text-[#555555] inline opacity-70" />
                  )}
                </span>
              </div>

              {/* Language */}
              <div className="hidden sm:block min-w-[120px] text-left text-[10px] text-[#666666]">
                {repo.language}
              </div>

              {/* Status */}
              <div className={`min-w-[80px] text-left text-[10px] font-semibold tracking-widest ${getStatusColor(repo.status)}`}>
                {repo.status}
              </div>

              {/* Size */}
              <div className="min-w-[80px] text-right font-mono text-[#e0e0e0]">
                {repo.size}
              </div>

              {/* Commits */}
              <div className={`min-w-[60px] text-right font-mono ${isHovered ? 'text-[#d6ff3e] font-bold' : 'text-[#888888]'}`}>
                {repo.commits}
              </div>
            </div>
          );
        })}
      </div>

      {/* Historical Lanes — Shared Axis */}
      <div className="space-y-6 pt-6">
        <div className="flex items-center justify-between text-[10px] font-mono tracking-widest text-[#666666]">
          <span className="uppercase">HISTORICAL LANES</span>
          <span className="uppercase">SHARED AXIS</span>
        </div>

        <div
          ref={lanesRef}
          onMouseMove={handleLanesMouseMove}
          onMouseLeave={() => setLaneHoverPct(null)}
          className="relative bg-[#070707] border border-[#1a1a1a] p-6 space-y-8 cursor-crosshair group"
        >
          {/* Lane 1: Commits */}
          <LaneRow
            label="COMMITS"
            curve={commitsCurve}
            hoverPct={laneHoverPct}
            color="#f5f5f5"
          />

          {/* Lane 2: Pull Requests */}
          <LaneRow
            label="PULL REQUESTS"
            curve={prsCurve}
            hoverPct={laneHoverPct}
            color="#d0d0d0"
          />

          {/* Lane 3: Net Lines */}
          <LaneRow
            label="NET LINES"
            curve={netLinesCurve}
            hoverPct={laneHoverPct}
            color="#aaaaaa"
          />

          {/* Unified vertical crosshair line across all 3 lanes */}
          {laneHoverPct !== null && (
            <div
              className="absolute top-0 bottom-12 w-px bg-[#d6ff3e] pointer-events-none opacity-60"
              style={{ left: `${laneHoverPct * 100}%` }}
            />
          )}

          {/* Shared Axis Labels */}
          <div className="flex items-center justify-between pt-4 border-t border-[#1a1a1a] text-[9px] font-mono tracking-widest text-[#555555]">
            <span>2025-09-21</span>
            <span className="text-[#666666]">OBSERVATIONS SHARE ONE BASELINE</span>
            <span>2026-09-20</span>
          </div>
        </div>
      </div>
    </section>
  );
};

interface LaneRowProps {
  label: string;
  curve: number[];
  hoverPct: number | null;
  color: string;
}

const LaneRow: React.FC<LaneRowProps> = ({
  label,
  curve,
  hoverPct,
  color,
}) => {
  const W = 1000;
  const H = 40;

  const pathD = curve
    .map((v, i) => {
      const x = (i / (curve.length - 1)) * W;
      const y = H - v * 28 - 6;
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');

  const currentIdx = hoverPct !== null ? Math.floor(hoverPct * (curve.length - 1)) : null;
  const currentVal = currentIdx !== null ? curve[currentIdx] : null;

  return (
    <div className="flex items-center gap-6">
      <div className="w-32 shrink-0 text-[10px] font-mono tracking-widest text-[#666666] uppercase">
        {label}
      </div>
      <div className="flex-1 relative h-10">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full overflow-visible" preserveAspectRatio="none">
          {/* Baseline */}
          <line x1="0" x2={W} y1={H - 2} y2={H - 2} stroke="#181818" strokeWidth="1" />
          
          {/* Stream curve */}
          <path
            d={pathD}
            fill="none"
            stroke={color}
            strokeWidth="1.25"
            strokeLinecap="round"
            className="transition-colors duration-200"
          />

          {/* Scrubber node */}
          {currentIdx !== null && currentVal !== null && (
            <circle
              cx={(currentIdx / (curve.length - 1)) * W}
              cy={H - currentVal * 28 - 6}
              r={3.5}
              fill="#0a0a0a"
              stroke="#d6ff3e"
              strokeWidth="1.5"
            />
          )}
        </svg>

        {hoverPct !== null && currentVal !== null && (
          <div
            className="absolute top-0 text-[9px] font-mono text-[#d6ff3e] tracking-wider pointer-events-none"
            style={{
              left: `${hoverPct * 100}%`,
              transform: 'translate(-50%, -100%)',
            }}
          >
            {formatNumber(Math.round(currentVal * 1200))}
          </div>
        )}
      </div>
    </div>
  );
};
