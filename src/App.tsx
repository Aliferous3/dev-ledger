import { useState } from 'react';
import { Period } from './types';
import { TopBar } from './components/TopBar';
import { TerminalTicker } from './components/TerminalTicker';
import { SectionMeasure } from './components/SectionMeasure';
import { SectionField } from './components/SectionField';
import { SectionIndex } from './components/SectionIndex';
import { SectionArchive } from './components/SectionArchive';
import { FloatingNav } from './components/FloatingNav';

export default function App() {
  const [period, setPeriod] = useState<Period>('1Y');
  const [scanlines, setScanlines] = useState(false);

  return (
    <div className="relative min-h-screen bg-[#0a0a0a] text-[#f5f5f5] selection:bg-[#d6ff3e] selection:text-black">
      {/* Optional CRT Scanlines Layer */}
      {scanlines && (
        <div className="fixed inset-0 scanlines-overlay crt-vignette z-50 pointer-events-none" />
      )}

      {/* Sticky Terminal Header */}
      <TopBar
        scanlinesEnabled={scanlines}
        onToggleScanlines={() => setScanlines(!scanlines)}
      />

      {/* Top Telemetry Marquee Ticker */}
      <TerminalTicker />

      {/* Floating Right-Side Navigation Rail */}
      <FloatingNav />

      {/* Main Content Container */}
      <main className="max-w-[1240px] mx-auto px-6 sm:px-10 md:px-14 py-16 space-y-28 pb-32">
        {/* Section 01: MEASURE */}
        <SectionMeasure period={period} onPeriodChange={setPeriod} />

        {/* Section 02: FIELD */}
        <SectionField period={period} onPeriodChange={setPeriod} />

        {/* Section 03: INDEX */}
        <SectionIndex period={period} onPeriodChange={setPeriod} />

        {/* Section 04: ARCHIVE */}
        <SectionArchive period={period} onPeriodChange={setPeriod} />

        {/* Bottom Document Footer */}
        <footer className="pt-16 border-t border-[#1a1a1a] flex flex-wrap items-center justify-between gap-4 text-[10px] font-mono tracking-widest text-[#555555]">
          <div className="flex items-center gap-3">
            <span className="text-[#888888]">END OF RECORD</span>
            <span className="text-[#333333]">/</span>
            <span>CODE METRICS v2.6.4</span>
          </div>

          <div className="flex items-center gap-6">
            <span className="hidden sm:inline">SHA-256 // e9b7a421...cf83</span>
            <span className="flex items-center gap-2 text-[#d6ff3e]">
              <span className="w-1.5 h-1.5 rounded-full bg-[#d6ff3e] lime-pulse" />
              RECORD BUFFER VALIDATED
            </span>
          </div>
        </footer>
      </main>
    </div>
  );
}
