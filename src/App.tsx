import { useCallback, useState } from 'react';
import type { Period } from './types';
import { useBootTransition } from './transitions/BootLog';
import { LedgerContext, useDashboardStore } from './store/live';
import { TerminalTickerHeader } from './components/TerminalTickerHeader';
import { UtilityBar } from './components/UtilityBar';
import { RightSidebarNav } from './components/RightSidebarNav';
import { Section01Measure } from './components/Section01Measure';
import { Section02Field } from './components/Section02Field';
import { Section03Index } from './components/Section03Index';
import { Section04Archive } from './components/Section04Archive';
import { ActivityPage } from './components/ActivityPage';
import { CodePage } from './components/CodePage';

export default function App() {
  const [period, setPeriod] = useState<Period>('1Y');
  const [crtOn, setCrtOn] = useState(false);

  // One Boot Log transition shared by the keypad header and the right
  // rail — a second nav surface can't double-fire while one is active.
  const { firing, fire, overlay } = useBootTransition();
  const navigate = useCallback(
    (id: string, label: string) => {
      const el = document.getElementById(id);
      if (!el) return;
      fire(label, () => el.scrollIntoView({ behavior: 'instant' as ScrollBehavior }));
    },
    [fire],
  );

  // Live production telemetry (or the bundled fixture when /api/dashboard is
  // unreachable — e.g. vite-only dev). `dash` is scoped to the global period.
  const ledger = useDashboardStore(period);
  const netGrowth = ledger.dash.summary.sourceAdded - ledger.dash.summary.sourceDeleted;
  const totalCommits = ledger.dash.summary.commits;
  const span = ledger.all.workShape.span;
  const spanLabel = span?.firstActive && span?.lastActive
    ? `${monthYear(span.firstActive)} — ${monthYear(span.lastActive)}`
    : 'JAN 2024 — SEP 2026'; // fixture fallback

  return (
    <LedgerContext.Provider value={ledger}>
    <div className="min-h-screen bg-[#0a0a0a] text-neutral-100 flex flex-col selection:bg-[#d6ff3e]/30 selection:text-white">
      {/* System utility bar: live UTC clock · CRT toggle · sync status */}
      <UtilityBar crtOn={crtOn} onToggleCrt={() => setCrtOn((v) => !v)} />

      {/* Sticky header: keypad nav band + existing Dev Ledger marquee ticker */}
      <TerminalTickerHeader
        period={period}
        setPeriod={setPeriod}
        navigate={navigate}
        firing={firing}
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
      <RightSidebarNav navigate={navigate} />
      {overlay}

      {/* Main Longitudinal Record Content */}
      <main className="flex-1 max-w-[1280px] w-full mx-auto px-6 md:px-12 py-12 md:py-16 space-y-32">
        {/* 01 — MEASURE */}
        <Section01Measure
          period={period}
          daysData={ledger.days}
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

        {/* 05 — ACTIVITY */}
        <ActivityPage period={period} />

        {/* 06 — CODE */}
        <CodePage period={period} />
      </main>

      {/* Bottom Footer (matching reference bottom bar "END OF RECORD") */}
      <footer className="border-t border-neutral-900 bg-black/60 py-6 px-6 md:px-12 text-[10px] mono-tag text-neutral-500 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="text-neutral-400">END OF RECORD</span>
          <span className="text-neutral-700">·</span>
          <span>LONGITUDINAL TELEMETRY [{spanLabel}]</span>
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
    </LedgerContext.Provider>
  );
}

const MONTH_SHORT = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
function monthYear(iso: string) {
  return `${MONTH_SHORT[parseInt(iso.slice(5, 7), 10) - 1]} ${iso.slice(0, 4)}`;
}
