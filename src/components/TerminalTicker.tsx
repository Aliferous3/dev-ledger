import React from 'react';

interface TerminalTickerProps {
  activeSection?: string;
}

export const TerminalTicker: React.FC<TerminalTickerProps> = () => {
  const telemetry = [
    'SYS.STATUS // NOMINAL',
    'NET.GROWTH // +1,756,748 B',
    'SOURCE.BYTES // 10.0 MB',
    'COMMITS // 1,493',
    'PULL_REQ // 439',
    'PR.MERGED // 426 (97.0%)',
    'ACTIVE.DAYS // 58 / 365',
    'MAX.STREAK // 23 DAYS',
    'TOP.LANG // TYPESCRIPT 84.7%',
    'REPOS.TOTAL // 7 NODES',
    'FINGERPRINT // CADENCE 100',
    'LATENCY // 12ms',
    'CI.PIPELINE // PASS 99.4%',
    'RECORD.RANGE // 2024-01-01 -> 2026-09-20',
  ];

  return (
    <div className="w-full bg-[#050505] border-y border-[#1a1a1a] overflow-hidden select-none py-1.5 relative">
      <div className="absolute left-0 top-0 bottom-0 w-8 bg-gradient-to-r from-[#050505] to-transparent z-10 pointer-events-none" />
      <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-[#050505] to-transparent z-10 pointer-events-none" />
      
      <div className="animate-ticker text-[10px] font-mono tracking-widest text-[#777777] whitespace-nowrap">
        {[...telemetry, ...telemetry].map((item, idx) => (
          <span key={idx} className="inline-flex items-center px-4 hover:text-[#d6ff3e] transition-colors cursor-default">
            <span>{item}</span>
            <span className="mx-4 text-[#d6ff3e] text-[8px] opacity-70">◆</span>
          </span>
        ))}
      </div>
    </div>
  );
};
