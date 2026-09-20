import { useState } from 'react';
import type { Period } from './types';
import { DATA_365 } from './store/metricsData';
import { TerminalTickerHeader } from './components/TerminalTickerHeader';
import { UtilityBar } from './components/UtilityBar';
import { RightSidebarNav } from './components/RightSidebarNav';
import { Section01Measure } from './components/Section01Measure';
import { Section02Field } from './components/Section02Field';
import { Section03Index } from './components/Section03Index';
import { Section04Archive } from './components/Section04Archive';

export default function App() {
  const [period, setPeriod] = useState<Period>('1Y');
  const [crtOn, setCrtOn] = useState(false);

  // Compute live aggregates from data
  const netGrowth = 1756748;
  const totalCommits = 1421;

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-neutral-100 flex flex-col selection:bg-[#d6ff3e]/30 selection:text-white">
      {/* System utility bar: live UTC clock · CRT toggle · sync status */}
      <UtilityBar crtOn={crtOn} onToggleCrt={() => setCrtOn((v) => !v)} />

      {/* Sticky header: product bar + existing Dev Ledger marquee ticker */}
      <TerminalTickerHeader
        period={period}
        setPeriod={setPeriod}
        netGrowth={netGrowth}
        commits={totalCommits}
      />

      {/* Restrained CRT scanline treatment over the application surface */}
      {crtOn && (
        <div
          aria-hidden
          className="pointer-events-none fixed inset-0 z-[90] scanlines-overlay crt-vignette"
        />
      )}

      {/* Floating right sidebar navigation tracking sections */}
      <RightSidebarNav />

      {/* Main Longitudinal Record Content */}
      <main className="flex-1 max-w-[1280px] w-full mx-auto px-6 md:px-12 py-12 md:py-16 space-y-32">
        {/* 01 — MEASURE */}
        <Section01Measure
          period={period}
          daysData={DATA_365}
        />

        {/* 02 — FIELD */}
        <Section02Field
          period={period}
        />

        {/* 03 — INDEX */}
        <Section03Index
          period={period}
        />

        {/* 04 — ARCHIVE (The Shape of Your Work) */}
        <Section04Archive
          period={period}
        />
      </main>

      {/* Bottom Footer (matching reference bottom bar "END OF RECORD") */}
      <footer className="border-t border-neutral-900 bg-black/60 py-6 px-6 md:px-12 text-[10px] mono-tag text-neutral-500 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="text-neutral-400">END OF RECORD</span>
          <span className="text-neutral-700">·</span>
          <span>LONGITUDINAL TELEMETRY [JAN 2024 — SEP 2026]</span>
        </div>

        <div className="flex items-center gap-4">
          <span className="text-neutral-600">DEV LEDGER / CODE METRICS · v1.3.0</span>
          <span className="text-neutral-700">|</span>
          <span className="flex items-center gap-2 text-[#d6ff3e]">
            <span className="w-1.5 h-1.5 rounded-full bg-[#d6ff3e] pulse-dot" />
            STREAM ACTIVE
          </span>
        </div>
      </footer>
    </div>
  );
}
