import React from 'react';
import { useLedger } from '../store/live';

interface TerminalTickerProps {
  activeSection?: string;
}

/* Canonical telemetry ticker — values come from the restored
   /api/dashboard payload (period-scoped summary + all-time span).
   Under the fixture fallback these render the same strings as before. */
export const TerminalTicker: React.FC<TerminalTickerProps> = () => {
  const { dash, all, days } = useLedger();
  const s = dash.summary;
  const span = all.workShape.span;
  const topLang = all.languages[0];
  const langTotal = Math.max(
    1,
    all.languages.reduce((a, l) => a + l.code, 0),
  );
  const mergedPct = dash.github.pullRequests
    ? ((dash.github.mergedPrs / dash.github.pullRequests) * 100).toFixed(1)
    : '0.0';
  const dayCount = days.length || 1; // dense observed window

  const telemetry = [
    'SYS.STATUS // NOMINAL',
    `NET.GROWTH // +${(s.sourceAdded - s.sourceDeleted).toLocaleString('en-US')} B`,
    `SOURCE.BYTES // ${(s.languageBytes / 1_000_000).toFixed(1)} MB`,
    `COMMITS // ${s.commits.toLocaleString('en-US')}`,
    `PULL_REQ // ${dash.github.pullRequests}`,
    `PR.MERGED // ${dash.github.mergedPrs} (${mergedPct}%)`,
    `ACTIVE.DAYS // ${s.activeDays} / ${dayCount}`,
    `MAX.STREAK // ${s.longestStreak} DAYS`,
    `TOP.LANG // ${topLang ? `${topLang.language.toUpperCase()} ${((topLang.code / langTotal) * 100).toFixed(1)}%` : '—'}`,
    `REPOS.TOTAL // ${s.repos} NODES`,
    `CADENCE // ${(s.commits / Math.max(s.activeDays, 1)).toFixed(1)} COMMITS/DAY`,
    `SYNC // ${dash.sync.status.toUpperCase()}`,
    `RECORD.RANGE // ${span?.firstActive ?? all.range.from ?? '—'} -> ${span?.lastActive ?? all.range.to ?? '—'}`,
  ];

  return (
    <div className="w-full bg-[#050505] border-y border-[#1a1a1a] overflow-hidden select-none py-1 md:py-1.5 relative">
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
