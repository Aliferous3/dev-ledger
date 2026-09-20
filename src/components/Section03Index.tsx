import { useState } from 'react';
import type { Period } from '../types';
import { REPOSITORIES } from '../store/metricsData';
import { DASHBOARD, periodToRange } from '../ledgerData';
import { HistoricalLanes } from '../retained/HistoricalLanes';

interface Props {
  period: Period;
  setPeriod: (p: Period) => void;
}

export function Section03Index({ period, setPeriod }: Props) {
  const [selectedRepoId, setSelectedRepoId] = useState<string>('D.01');
  const [hoverRepoId, setHoverRepoId] = useState<string | null>(null);

  const activeId = hoverRepoId ?? selectedRepoId;

  // Radar constellation layout
  // Center is at cx=320, cy=180
  const cx = 320;
  const cy = 180;
  const radarRadii = [40, 80, 120, 160];

  return (
    <section id="section-03" className="relative scroll-mt-28 space-y-12">
      {/* Top Breadcrumb & Period Selector */}
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-neutral-900 pb-4">
        <div className="flex items-center gap-3 text-[11px] mono-tag text-neutral-300">
          <span className="text-[#d6ff3e] font-semibold">[03] INDEX</span>
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

      {/* Constellation Radar View */}
      <div className="space-y-4">
        <div className="flex items-center justify-between text-[10px] mono-tag text-neutral-400">
          <span>PROJECT CONSTELLATION — POSITION BY TEMPORAL CENTER, BANDED BY LANGUAGE</span>
          <span className="text-neutral-500">7 NODES · 1 TRACES · C · 02</span>
        </div>

        <div className="relative bg-black/60 border border-neutral-900 h-[280px] sm:h-[320px] overflow-hidden flex items-center justify-center select-none">
          {/* Subtle CRT background grid */}
          <div className="pointer-events-none absolute inset-0 terminal-grid opacity-25" />

          <svg
            viewBox="0 0 640 320"
            className="w-full h-full max-w-[800px]"
          >
            {/* Concentric rings */}
            {radarRadii.map((r, i) => (
              <circle
                key={i}
                cx={cx}
                cy={cy}
                r={r}
                fill="none"
                stroke="#222"
                strokeWidth="1"
                strokeDasharray={i % 2 === 1 ? '3,4' : undefined}
              />
            ))}

            {/* Crosshair axes */}
            <line x1={cx - 180} y1={cy} x2={cx + 180} y2={cy} stroke="#1b1b1b" strokeWidth="1" />
            <line x1={cx} y1={cy - 140} x2={cx} y2={cy + 140} stroke="#1b1b1b" strokeWidth="1" />

            {/* Trace line connecting nodes */}
            <path
              d={`M ${cx + 70},${cy - 85} Q ${cx + 90},${cy - 50} ${cx + 80},${cy - 10}`}
              fill="none"
              stroke="#d6ff3e"
              strokeWidth="1"
              strokeDasharray="2,3"
              opacity="0.6"
            />

            {/* 7 Constellation Nodes */}
            {REPOSITORIES.map((repo) => {
              // Custom fixed coordinates to match the reference cluster pattern
              const coords: Record<string, { x: number; y: number }> = {
                'D.01': { x: cx + 70, y: cy - 85 },  // Primary active node with target circle
                'D.02': { x: cx + 95, y: cy - 70 },
                'D.03': { x: cx + 110, y: cy - 45 },
                'D.04': { x: cx + 80, y: cy - 10 },
                'D.05': { x: cx + 100, y: cy - 10 },
                'D.06': { x: cx + 80, y: cy + 18 },
                'D.07': { x: cx - 40, y: cy + 50 },  // Dormant solo node
              };

              const pt = coords[repo.id] || { x: cx, y: cy };
              const isSelected = activeId === repo.id;

              return (
                <g
                  key={repo.id}
                  className="cursor-pointer"
                  onClick={() => setSelectedRepoId(repo.id)}
                  onMouseEnter={() => setHoverRepoId(repo.id)}
                  onMouseLeave={() => setHoverRepoId(null)}
                >
                  {/* Outer reticle ring on active node */}
                  {isSelected && (
                    <circle
                      cx={pt.x}
                      cy={pt.y}
                      r="14"
                      fill="none"
                      stroke="#d6ff3e"
                      strokeWidth="1.2"
                      strokeDasharray="3,3"
                      className="animate-spin"
                      style={{ transformOrigin: `${pt.x}px ${pt.y}px`, animationDuration: '8s' }}
                    />
                  )}

                  {/* Secondary subtle halo */}
                  <circle
                    cx={pt.x}
                    cy={pt.y}
                    r={isSelected ? 8 : repo.id === 'D.01' ? 9 : 5}
                    fill={isSelected ? 'rgba(214,255,62,0.15)' : 'none'}
                    stroke={isSelected ? '#d6ff3e' : repo.id === 'D.01' ? '#c4c4c4' : '#555'}
                    strokeWidth="1"
                  />

                  {/* Core node dot */}
                  <circle
                    cx={pt.x}
                    cy={pt.y}
                    r={isSelected ? 3 : 2}
                    fill={isSelected ? '#d6ff3e' : '#fff'}
                  />

                  {/* Node label */}
                  {isSelected && (
                    <text
                      x={pt.x + 16}
                      y={pt.y + 3}
                      fill="#d6ff3e"
                      fontSize="9"
                      fontFamily="JetBrains Mono"
                      letterSpacing="0.1em"
                    >
                      {repo.id} {repo.name}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>

          {/* Bottom HUD bar inside constellation */}
          <div className="absolute bottom-3 left-4 right-4 flex items-center justify-between text-[9px] mono-tag text-neutral-600">
            <span>COORDS: LAT 44.8 · LNG 11.2 // POLAR RETICLE</span>
            <span className="text-[#d6ff3e]">ACTIVE: {activeId}</span>
          </div>
        </div>
      </div>

      {/* Repositories Table (matching exact data from Screenshot 3) */}
      <div className="border border-neutral-900 divide-y divide-neutral-900 bg-black/40">
        {REPOSITORIES.map((repo) => {
          const isSelected = activeId === repo.id;
          return (
            <div
              key={repo.id}
              onClick={() => setSelectedRepoId(repo.id)}
              onMouseEnter={() => setHoverRepoId(repo.id)}
              onMouseLeave={() => setHoverRepoId(null)}
              className={`px-4 sm:px-6 py-4 flex flex-wrap items-center justify-between gap-4 cursor-pointer transition-colors duration-150 ${
                isSelected ? 'bg-neutral-900/60 text-[#d6ff3e]' : 'hover:bg-neutral-950/80 text-neutral-300'
              }`}
            >
              {/* Left Column: ID & Repo Name in Serif */}
              <div className="flex items-center gap-4 min-w-[220px]">
                <span className="text-[10px] mono-tag text-neutral-500 w-8">
                  {repo.code}
                </span>
                <span className="font-editorial text-lg md:text-xl text-neutral-100 flex items-center gap-2">
                  <span className={isSelected ? 'text-[#d6ff3e]' : ''}>
                    {repo.name}
                  </span>
                  {repo.locked && (
                    <span className="text-[10px] text-neutral-500" title="Private">
                      🔒
                    </span>
                  )}
                </span>
              </div>

              {/* Middle: Language & Status */}
              <div className="flex items-center gap-6 text-[10px] mono-tag">
                <span className="w-24 text-neutral-400">{repo.language}</span>
                <span
                  className={`w-20 font-medium ${
                    repo.status === 'ACTIVE'
                      ? 'text-[#d6ff3e]'
                      : repo.status === 'STEADY'
                      ? 'text-neutral-300'
                      : repo.status === 'QUIET'
                      ? 'text-neutral-500'
                      : 'text-neutral-600'
                  }`}
                >
                  {repo.status}
                </span>
              </div>

              {/* Right: Bytes and Commits count */}
              <div className="flex items-center gap-8 text-[11px] mono-tag">
                <span className="w-16 text-right font-medium text-neutral-200">
                  {repo.bytesStr}
                </span>
                <span className="w-16 text-right text-neutral-400">
                  {repo.commits.toLocaleString('en-US')}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Historical Lanes — retained Dev Ledger implementation (shared-axis
          scrub, observation markers and baseline readout are unchanged) */}
      <div className="space-y-4 pt-4">
        <div className="relative bg-black/60 border border-neutral-900 p-6 select-none">
          <HistoricalLanes
            daily={DASHBOARD.daily}
            prsDaily={DASHBOARD.prsDaily}
            range={periodToRange(period)}
          />
        </div>
      </div>
    </section>
  );
}
