import type { Period } from '../types';
import { TerminalTicker } from './TerminalTicker';

interface Props {
  period: Period;
  setPeriod: (p: Period) => void;
  netGrowth: number;
  commits: number;
}

const PERIODS: Period[] = ['7D', '30D', '90D', 'YTD', '1Y', 'ALL'];

export function TerminalTickerHeader({ period, setPeriod }: Props) {
  return (
    <header className="sticky top-0 z-50 bg-[#0a0a0a]/90 backdrop-blur-md border-b border-neutral-900">
      {/* Main Top Bar */}
      <div className="max-w-[1360px] mx-auto px-6 md:px-12 py-3 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3 text-[11px] mono-tag">
          <span className="w-2 h-2 rounded-full bg-[#d6ff3e] pulse-dot" />
          <span className="text-neutral-100 font-semibold">DEV LEDGER</span>
          <span className="text-neutral-600 hidden sm:inline">/</span>
          <span className="text-neutral-400 hidden sm:inline">CODE METRICS</span>
          <span className="text-[9px] mono-tag px-1.5 py-0.5 border border-neutral-800 text-[#d6ff3e] hidden md:inline">
            v1.3.0
          </span>
        </div>

        <div className="flex items-center gap-4">
          <div className="hidden lg:flex items-center gap-4 text-[10px] mono-tag text-neutral-500">
            <a href="#section-01" className="hover:text-neutral-200 transition-colors">01 MEASURE</a>
            <span className="text-neutral-700">·</span>
            <a href="#section-02" className="hover:text-neutral-200 transition-colors">02 FIELD</a>
            <span className="text-neutral-700">·</span>
            <a href="#section-03" className="hover:text-neutral-200 transition-colors">03 INDEX</a>
            <span className="text-neutral-700">·</span>
            <a href="#section-04" className="hover:text-neutral-200 transition-colors">04 ARCHIVE</a>
          </div>

          <div className="flex items-center gap-1.5 pl-2 border-l border-neutral-800">
            <span className="text-[9px] mono-tag text-neutral-500 mr-1 hidden sm:inline">PERIOD</span>
            {PERIODS.map((p) => {
              const active = period === p;
              return (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  className={`text-[9px] mono-tag px-2 py-0.5 border transition-all ${
                    active
                      ? 'bg-[#d6ff3e] text-black border-[#d6ff3e] font-semibold shadow-[0_0_8px_rgba(214,255,62,0.35)]'
                      : 'border-neutral-800 text-neutral-400 hover:text-neutral-200 hover:border-neutral-600'
                  }`}
                >
                  {p}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Existing Dev Ledger telemetry marquee — the canonical ticker */}
      <TerminalTicker />
    </header>
  );
}
